import { z } from "zod";
import { guardRequest } from "@/server/http/guard";
import {
  CATALOG_CACHE_TTL_MS,
  resolveArtist,
  type ArtistSuccess,
  type CatalogFailure,
} from "@/server/music/catalog";

/**
 * Artist-page transport boundary (design decisions 1–2):
 * `GET /api/artist?name=<string>&id=<string>`.
 *
 * Mirrors the search and discovery routes' conventions — validate first (a 400
 * before any upstream call), pass `request.signal` through for cancellation,
 * project diagnostics onto the safe subset — with the entity contract's
 * differences: the accepted inputs are exactly an artist name and a provider
 * entity id (never liked tracks, playlists, or history), at least one of them is
 * required, an entity that resolved to nothing is a recoverable 404 rather than
 * a substituted answer, and every seed failing upstream is a 503.
 */

/** Bounded input lengths (spec: bounded name/title/artist/id). */
const MAX_NAME_LENGTH = 200;
const MAX_ID_LENGTH = 64;

const artistParamsSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "name must not be empty")
      .max(MAX_NAME_LENGTH, `name must be at most ${MAX_NAME_LENGTH} characters`)
      .optional(),
    id: z
      .string()
      .trim()
      .min(1, "id must not be empty")
      .max(MAX_ID_LENGTH, `id must be at most ${MAX_ID_LENGTH} characters`)
      .optional(),
  })
  .refine((value) => value.name !== undefined || value.id !== undefined, {
    message: "name or id is required",
  });

/** Shared with the in-module TTL cache so header and store cannot drift. */
const MAX_AGE_SECONDS = Math.round(CATALOG_CACHE_TTL_MS / 1000);
const SUCCESS_CACHE_CONTROL = `public, max-age=${MAX_AGE_SECONDS}`;
const ERROR_CACHE_CONTROL = "no-store";

function errorResponse(
  status: number,
  code: "invalid_request" | "unresolvable" | "upstream_unavailable",
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": ERROR_CACHE_CONTROL } },
  );
}

export async function GET(request: Request): Promise<Response> {
  // Throttled before anything else: a refused request must not have already
  // cost a provider call (spec `security` — bounded per-instance throttling).
  const throttled = guardRequest(request);
  if (throttled) return throttled;

  const params = new URL(request.url).searchParams;
  const parsed = artistParamsSchema.safeParse({
    name: params.get("name") ?? undefined,
    id: params.get("id") ?? undefined,
  });

  // Invalid input never reaches the provider chain.
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid artist request.";
    return errorResponse(400, "invalid_request", message);
  }

  const { name, id } = parsed.data;

  let result: ArtistSuccess | CatalogFailure;
  try {
    result = await resolveArtist({
      ...(name !== undefined ? { name } : {}),
      ...(id !== undefined ? { id } : {}),
      signal: request.signal,
    });
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
    // Nothing resolved is a recoverable not-found; nothing was even asked is an
    // upstream outage. The two are never collapsed into one answer.
    if (result.reason === "unresolvable") {
      return errorResponse(404, "unresolvable", "That artist could not be found.");
    }
    return errorResponse(
      503,
      "upstream_unavailable",
      "Artist information is temporarily unavailable. Please try again shortly.",
    );
  }

  return Response.json(
    {
      artist: result.artist,
      tracks: result.tracks,
      related: result.related,
      releases: result.releases,
      diagnostics: result.diagnostics,
    },
    { status: 200, headers: { "Cache-Control": SUCCESS_CACHE_CONTROL } },
  );
}
