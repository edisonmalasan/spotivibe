import { z } from "zod";
import {
  CATALOG_CACHE_TTL_MS,
  resolveAlbum,
  type AlbumSuccess,
  type CatalogFailure,
} from "@/server/music/catalog";

/**
 * Album-page transport boundary (design decision 3):
 * `GET /api/album?title=<string>&artist=<string>&id=<string>`.
 *
 * Same contract as the artist route — zod validation before any provider call,
 * `request.signal` passed through for cancellation, bounded identifier text, no
 * local-library or user input of any kind — plus the release-specific piece:
 * the response states explicitly whether album metadata was confirmed for the
 * returned tracks, so the page never presents an approximate search result as a
 * definitive tracklist.
 */

/** Bounded input lengths (spec: bounded name/title/artist/id). */
const MAX_TITLE_LENGTH = 200;
const MAX_ARTIST_LENGTH = 200;
const MAX_ID_LENGTH = 64;

const albumParamsSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "title must not be empty")
      .max(MAX_TITLE_LENGTH, `title must be at most ${MAX_TITLE_LENGTH} characters`)
      .optional(),
    artist: z
      .string()
      .trim()
      .min(1, "artist must not be empty")
      .max(MAX_ARTIST_LENGTH, `artist must be at most ${MAX_ARTIST_LENGTH} characters`)
      .optional(),
    id: z
      .string()
      .trim()
      .min(1, "id must not be empty")
      .max(MAX_ID_LENGTH, `id must be at most ${MAX_ID_LENGTH} characters`)
      .optional(),
  })
  .refine((value) => value.title !== undefined || value.id !== undefined, {
    message: "title or id is required",
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
  const parsed = albumParamsSchema.safeParse({
    title: params.get("title") ?? undefined,
    artist: params.get("artist") ?? undefined,
    id: params.get("id") ?? undefined,
  });

  // Invalid input never reaches the provider chain.
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid album request.";
    return errorResponse(400, "invalid_request", message);
  }

  const { title, artist, id } = parsed.data;

  let result: AlbumSuccess | CatalogFailure;
  try {
    result = await resolveAlbum({
      ...(title !== undefined ? { title } : {}),
      ...(artist !== undefined ? { artist } : {}),
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
    if (result.reason === "unresolvable") {
      return errorResponse(404, "unresolvable", "That album could not be found.");
    }
    return errorResponse(
      503,
      "upstream_unavailable",
      "Album information is temporarily unavailable. Please try again shortly.",
    );
  }

  return Response.json(
    {
      album: result.album,
      tracks: result.tracks,
      metadataIncomplete: result.metadataIncomplete,
      diagnostics: result.diagnostics,
    },
    { status: 200, headers: { "Cache-Control": SUCCESS_CACHE_CONTROL } },
  );
}
