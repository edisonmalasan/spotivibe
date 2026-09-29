import { z } from "zod";
import {
  RADIO_CACHE_TTL_MS,
  RADIO_MAX_EXCLUDE,
  RADIO_MAX_EXCLUDE_ID_LENGTH,
  RADIO_MAX_LIMIT,
  RADIO_MAX_VARIANT,
  RADIO_KINDS,
  RADIO_TRACK_LIMIT,
  resolveRadio,
  type RadioFailure,
  type RadioSuccess,
} from "@/server/music/radio";

/**
 * Radio-feed transport boundary (design decisions 2 and 3):
 * `GET /api/radio?kind=track|artist&title=&artist=&variant=&limit=&exclude=`.
 *
 * Same contract as the artist, album, and discovery routes — zod validation
 * before any provider call, `request.signal` passed through for cancellation,
 * bounded identifier text, a structured 400/404/503/499, and a short-lived HTTP
 * cache — with the radio-specific rules the spec names for this endpoint:
 *
 * - **The accepted inputs are exactly the six keys above.** There is no
 *   liked-track, playlist, history, language, or profile parameter in this
 *   surface, so a radio request cannot carry a taste profile out of the device
 *   even if a future caller tried to send one — the schema ignores it and
 *   nothing reads it.
 * - **`variant` is the caller's own refill counter**, used only to rotate the
 *   curated seed phrases. The server stores nothing about it, so a request
 *   reveals no listening history.
 * - **`exclude` is a bounded comma-separated id list, and an over-long list is
 *   rejected rather than truncated.** Silently dropping ids would quietly
 *   re-serve a track the caller has already played, which is the one failure
 *   mode the bound exists to prevent.
 */

/** Bounded input lengths (spec: bounded identity text). */
const MAX_TITLE_LENGTH = 200;
const MAX_ARTIST_LENGTH = 200;

/** Split a comma-separated parameter into trimmed, non-empty entries. */
function commaSeparated(raw: string): string[] {
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

const radioParamsSchema = z
  .object({
    kind: z.enum(RADIO_KINDS, {
      message: `kind must be one of ${RADIO_KINDS.join(", ")}`,
    }),
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
    variant: z.coerce
      .number()
      .int("variant must be an integer")
      .min(0, "variant must be at least 0")
      .max(RADIO_MAX_VARIANT, `variant must be at most ${RADIO_MAX_VARIANT}`)
      .default(0),
    limit: z.coerce
      .number()
      .int("limit must be an integer")
      .min(1, "limit must be at least 1")
      .max(RADIO_MAX_LIMIT, `limit must be at most ${RADIO_MAX_LIMIT}`)
      .default(RADIO_TRACK_LIMIT),
    exclude: z
      .string()
      .transform(commaSeparated)
      .pipe(
        z
          .array(
            z
              .string()
              .max(
                RADIO_MAX_EXCLUDE_ID_LENGTH,
                `each excluded id must be at most ${RADIO_MAX_EXCLUDE_ID_LENGTH} characters`,
              ),
          )
          // A rejected list, never a truncated one.
          .max(RADIO_MAX_EXCLUDE, `exclude must contain at most ${RADIO_MAX_EXCLUDE} ids`),
      )
      .optional(),
  })
  .refine(
    (value) => (value.kind === "artist" ? value.artist !== undefined : value.title !== undefined),
    {
      message: 'kind "artist" requires an artist, and kind "track" requires a title',
    },
  );

/** Shared with the in-module TTL cache so header and store cannot drift. */
const MAX_AGE_SECONDS = Math.round(RADIO_CACHE_TTL_MS / 1000);
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
  const parsed = radioParamsSchema.safeParse({
    kind: params.get("kind") ?? undefined,
    title: params.get("title") ?? undefined,
    artist: params.get("artist") ?? undefined,
    // An empty `?variant=`/`?limit=` is "not given", not a malformed number: the
    // documented default applies. `Number("")` would otherwise coerce to 0.
    variant: params.get("variant") || undefined,
    limit: params.get("limit") || undefined,
    exclude: params.get("exclude") ?? undefined,
  });

  // Invalid input never reaches the provider chain — including an exclusion list
  // past the documented bound, which is rejected here rather than truncated.
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid radio request.";
    return errorResponse(400, "invalid_request", message);
  }

  const { kind, title, artist, variant, limit, exclude } = parsed.data;

  let result: RadioSuccess | RadioFailure;
  try {
    result = await resolveRadio({
      kind,
      ...(title !== undefined ? { title } : {}),
      ...(artist !== undefined ? { artist } : {}),
      variant,
      limit,
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
    if (result.reason === "invalid_request") {
      // The service re-checks the bounds it owns; a request that got this far
      // was already schema-validated, so this is defence in depth.
      return errorResponse(400, "invalid_request", "Invalid radio request.");
    }
    if (result.reason === "unresolvable") {
      // No usable identity, or everything resolved was already played. The
      // honest answer is an empty feed, never a substitution.
      return errorResponse(404, "unresolvable", "No more tracks are available for this radio.");
    }
    return errorResponse(
      503,
      "upstream_unavailable",
      "Radio tracks are temporarily unavailable. Please try again shortly.",
    );
  }

  return Response.json(
    { tracks: result.tracks, variant: result.variant, diagnostics: result.diagnostics },
    { status: 200, headers: { "Cache-Control": SUCCESS_CACHE_CONTROL } },
  );
}
