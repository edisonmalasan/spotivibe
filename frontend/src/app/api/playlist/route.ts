import { z } from "zod";
import { PLAYLIST_CACHE_TTL_MS, runResolvePlaylist } from "@/server/music/playlist";
import { parsePlaylistRef } from "@/server/music/playlistRef";
import type { PlaylistDiagnostics, PlaylistResult } from "@/server/music/types";

/**
 * Playlist-import transport boundary (design decision 9):
 * `GET /api/playlist?src=<ref>`.
 *
 * Mirrors the search route's conventions — validate first (400 before any
 * upstream call), pass `request.signal` through for cancellation, project
 * diagnostics onto the safe subset — with two decision-9 differences:
 * the endpoint accepts exactly one parameter (`src`, never local data), and
 * a definitive upstream "unavailable" answer maps to 404 rather than 503.
 */

/** Bounded input length (design decision 9: non-empty after trim, ≤500). */
const MAX_SRC_LENGTH = 500;

const playlistParamsSchema = z.object({
  src: z
    .string()
    .trim()
    .min(1, "src must not be empty")
    .max(MAX_SRC_LENGTH, `src must be at most ${MAX_SRC_LENGTH} characters`),
});

/** Shared with the in-module TTL cache so header and store cannot drift. */
const MAX_AGE_SECONDS = Math.round(PLAYLIST_CACHE_TTL_MS / 1000);
const SUCCESS_CACHE_CONTROL = `public, max-age=${MAX_AGE_SECONDS}`;
const ERROR_CACHE_CONTROL = "no-store";

type PlaylistErrorCode = "invalid_input" | "playlist_unavailable" | "upstream_unavailable";

function errorResponse(status: number, code: PlaylistErrorCode): Response {
  return Response.json(
    { error: code },
    { status, headers: { "Cache-Control": ERROR_CACHE_CONTROL } },
  );
}

/** Project diagnostics onto the safe subset (tier ids/outcomes only). */
function safeDiagnostics(diagnostics: PlaylistDiagnostics): PlaylistDiagnostics {
  return {
    tiers: diagnostics.tiers.map((entry) => ({ tier: entry.tier, outcome: entry.outcome })),
  };
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const parsed = playlistParamsSchema.safeParse({
    src: params.get("src") ?? undefined,
  });

  // Invalid input never reaches the provider chain.
  if (!parsed.success) {
    return errorResponse(400, "invalid_input");
  }

  // A reference that is not a YouTube playlist ID/URL is likewise rejected
  // before any upstream call.
  const playlistId = parsePlaylistRef(parsed.data.src);
  if (playlistId === null) {
    return errorResponse(400, "invalid_input");
  }

  let result: PlaylistResult;
  try {
    result = await runResolvePlaylist({ playlistId, signal: request.signal });
  } catch (error) {
    if (request.signal.aborted) {
      // Caller disconnected mid-flight — nothing left to deliver.
      return new Response(null, {
        status: 499,
        headers: { "Cache-Control": ERROR_CACHE_CONTROL },
      });
    }
    throw error;
  }

  if (!result.ok) {
    if (result.reason === "unavailable") {
      return errorResponse(404, "playlist_unavailable");
    }
    return errorResponse(503, "upstream_unavailable");
  }

  return Response.json(
    { playlist: result.playlist, diagnostics: safeDiagnostics(result.diagnostics) },
    { status: 200, headers: { "Cache-Control": SUCCESS_CACHE_CONTROL } },
  );
}
