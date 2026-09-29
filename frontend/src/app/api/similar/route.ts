import { z } from "zod";
import {
  CATALOG_CACHE_TTL_MS,
  resolveSimilar,
  type CatalogFailure,
  type SimilarSuccess,
} from "@/server/music/catalog";

/**
 * Similar-track transport boundary ("More Like This"):
 * `GET /api/similar?title=<string>&artist=<string>&exclude=<trackId>`.
 *
 * Same contract as the artist and album routes — zod validation before any
 * provider call, `request.signal` passed through for cancellation, bounded
 * identifier text, a structured 404/503/499, and a short-lived HTTP cache — plus
 * the two pieces the spec names for this endpoint: the source track is identified
 * by its *public* `title`/`artist` metadata only (never a local record, a liked
 * track, a playlist, or listening history), and `exclude` is honored server-side
 * so the source track can never reappear among the candidates.
 */

/** Bounded input lengths (spec: bounded name/title/artist/id). */
const MAX_TITLE_LENGTH = 200;
const MAX_ARTIST_LENGTH = 200;
/** A canonical track id is `youtube:<11 chars>`; bounded either way. */
const MAX_EXCLUDE_LENGTH = 64;

const similarParamsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "title must not be empty")
    .max(MAX_TITLE_LENGTH, `title must be at most ${MAX_TITLE_LENGTH} characters`),
  artist: z
    .string()
    .trim()
    .min(1, "artist must not be empty")
    .max(MAX_ARTIST_LENGTH, `artist must be at most ${MAX_ARTIST_LENGTH} characters`)
    .optional(),
  exclude: z
    .string()
    .trim()
    .min(1, "exclude must not be empty")
    .max(MAX_EXCLUDE_LENGTH, `exclude must be at most ${MAX_EXCLUDE_LENGTH} characters`)
    .optional(),
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
  const params = new URL(request.url).searchParams;
  const parsed = similarParamsSchema.safeParse({
    title: params.get("title") ?? undefined,
    artist: params.get("artist") ?? undefined,
    exclude: params.get("exclude") ?? undefined,
  });

  // Invalid input never reaches the provider chain.
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid similar-tracks request.";
    return errorResponse(400, "invalid_request", message);
  }

  const { title, artist, exclude } = parsed.data;

  let result: SimilarSuccess | CatalogFailure;
  try {
    result = await resolveSimilar({
      title,
      ...(artist !== undefined ? { artist } : {}),
      ...(exclude !== undefined ? { exclude } : {}),
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
    if (result.reason === "unresolvable") {
      return errorResponse(404, "unresolvable", "No similar tracks could be found.");
    }
    return errorResponse(
      503,
      "upstream_unavailable",
      "Similar tracks are temporarily unavailable. Please try again shortly.",
    );
  }

  return Response.json(
    { tracks: result.tracks, diagnostics: result.diagnostics },
    { status: 200, headers: { "Cache-Control": SUCCESS_CACHE_CONTROL } },
  );
}
