import { z } from "zod";
import { guardRequest } from "@/server/http/guard";
import { LYRICS_HIT_TTL_MS, resolveLyrics, type LyricsHit } from "@/server/lyrics/lyricsService";

/**
 * The lyrics transport boundary (ROADMAP M16, spec `lyrics`).
 *
 * `GET /api/lyrics?videoId=&title=&artist=&channel=&duration=`
 *
 * Same contract as the other provider-mediated routes — zod validation before any outbound call,
 * `request.signal` propagated, bounded identifier text, a structured 400/503/499 — plus one
 * deliberate departure that the spec requires:
 *
 * - **"No lyrics for this track" is a 200, not a 404 and not a 5xx.** It is a *successful answer*
 *   to the question asked, and the most common one for a large fraction of catalogue tracks. A
 *   client that has to distinguish "absent" from "broken" by reading a status code is a client
 *   that will eventually get it wrong, and the difference matters to the listener: one is
 *   information, the other is an error to retry. So the payload carries an explicit `status`
 *   field and the panel branches on that rather than on the response code.
 * - **A provider failure is a 503** and is never cached, so the next play retries.
 *
 * `videoId` is the cache key and the only field the client must send correctly. `title`/`artist`/
 * `channel`/`duration` are the *search* key, because LRCLIB has no video-id lookup — they are
 * search inputs, not identity.
 */

const MAX_TITLE_LENGTH = 300;
const MAX_ARTIST_LENGTH = 300;
/** YouTube video ids are exactly 11 URL-safe base64 characters. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const lyricsParamsSchema = z.object({
  videoId: z
    .string()
    .trim()
    .regex(VIDEO_ID_PATTERN, "videoId must be an 11-character YouTube video id"),
  title: z
    .string()
    .trim()
    .max(MAX_TITLE_LENGTH, `title must be at most ${MAX_TITLE_LENGTH} characters`)
    .default(""),
  artist: z
    .string()
    .trim()
    .max(MAX_ARTIST_LENGTH, `artist must be at most ${MAX_ARTIST_LENGTH} characters`)
    .default(""),
  channel: z
    .string()
    .trim()
    .max(MAX_ARTIST_LENGTH, `channel must be at most ${MAX_ARTIST_LENGTH} characters`)
    .default(""),
  duration: z.coerce
    .number()
    .int("duration must be an integer")
    .min(0, "duration must not be negative")
    .max(24 * 60 * 60, "duration must be at most 24 hours")
    .default(0),
});

/** Shared with the service TTL so the header and the store cannot drift. */
const HIT_MAX_AGE_SECONDS = Math.round(LYRICS_HIT_TTL_MS / 1000);
const SUCCESS_CACHE_CONTROL = `public, max-age=${HIT_MAX_AGE_SECONDS}`;
const NO_STORE = "no-store";

function errorResponse(
  status: number,
  code: "invalid_request" | "upstream_unavailable",
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": NO_STORE } },
  );
}

/** A successful "there are no lyrics for this track" answer. */
function unavailableResponse(): Response {
  return Response.json(
    { status: "unavailable", syncedLyrics: null, plainLyrics: null },
    {
      // A miss is a real answer, so it is cacheable — but only briefly, matching the service's
      // shorter miss TTL. A shared cache holding this for a week would hide lyrics for a track
      // that gains them tomorrow.
      headers: { "Cache-Control": "public, max-age=60" },
    },
  );
}

function hitResponse(hit: LyricsHit): Response {
  return Response.json(
    { status: "ok", syncedLyrics: hit.syncedLyrics, plainLyrics: hit.plainLyrics },
    { headers: { "Cache-Control": SUCCESS_CACHE_CONTROL } },
  );
}

export async function GET(request: Request): Promise<Response> {
  // Throttled before anything else: a refused request must not have already cost a provider call.
  const throttled = guardRequest(request);
  if (throttled) return throttled;

  const params = new URL(request.url).searchParams;
  const parsed = lyricsParamsSchema.safeParse({
    videoId: params.get("videoId") ?? undefined,
    title: params.get("title") ?? undefined,
    artist: params.get("artist") ?? undefined,
    channel: params.get("channel") ?? undefined,
    // An empty `?duration=` is "not given", not a malformed number. `Number("")` is 0, and
    // 0 is also a legitimate "unknown duration", so both routes agree — but reading it as a
    // parse failure would report a bad request for an empty parameter.
    duration: params.get("duration") || undefined,
  });

  // Invalid input never reaches the provider.
  if (!parsed.success) {
    return errorResponse(
      400,
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Invalid request.",
    );
  }

  const { videoId, title, artist, channel, duration } = parsed.data;

  let result: Awaited<ReturnType<typeof resolveLyrics>>;
  try {
    result = await resolveLyrics({
      videoId,
      title,
      artist,
      channel,
      durationSeconds: duration,
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) {
      // Caller disconnected mid-flight — nothing left to deliver.
      return new Response(null, { status: 499, headers: { "Cache-Control": NO_STORE } });
    }
    throw error;
  }

  if (result.kind === "unavailable") return unavailableResponse();
  if (result.kind === "unreachable") {
    return errorResponse(
      503,
      "upstream_unavailable",
      "Lyrics are temporarily unavailable. Please try again shortly.",
    );
  }
  return hitResponse(result.hit);
}
