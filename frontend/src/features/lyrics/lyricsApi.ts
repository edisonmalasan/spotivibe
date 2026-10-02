import type { Track } from "@/data/repositories";

/**
 * Client side of the M16 lyrics contract (spec `lyrics`):
 * `GET /api/lyrics?videoId=&title=&artist=&channel=&duration=` -> 200 with
 * `{ status: "ok", syncedLyrics, plainLyrics }` or `{ status: "unavailable", ... }`, or a
 * structured `{ error: { code, message } }` on 400/503.
 *
 * Follows the `similarApi.ts` / `discoveryApi.ts` pattern: parameters are bounded *here* so a
 * request always satisfies the server contract, the body is validated before use, and error codes
 * are read from either `{ error: { code } }` or a flat `{ error: "code" }` so the client is not
 * coupled to one encoding.
 *
 * **The one thing this module exists to get right** is that `unavailable` is a *success*, not a
 * failure. The route answers 200 with `status: "unavailable"` for a track that has no lyrics, and
 * this client keeps that as its own resolved outcome. Folding it into the error path would mean
 * the panel shows "couldn't reach the lyrics service" for most of the catalogue, which is both
 * untrue and useless to a listener.
 *
 * **Local-first contract** — as with related content, the only inputs are the playing track's own
 * public metadata and its provider id. There is no liked-track, playlist, history, session, or
 * language parameter in this surface, and {@link buildLyricsQuery} can construct nothing else, so
 * lyrics resolution cannot carry a taste profile off the device.
 */

/** Endpoint path for one lyrics resolution. */
export const LYRICS_ENDPOINT = "/api/lyrics";

/** Mirrors the server bound, so an over-long value fails locally and never hits the network. */
export const MAX_LYRICS_TITLE_LENGTH = 300;
export const MAX_LYRICS_ARTIST_LENGTH = 300;

/** A YouTube video id is exactly 11 URL-safe base64 characters. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Failure codes. `unavailable` is deliberately absent: it is an outcome, not a failure, and
 * listing it here would be the first step toward treating it as one.
 */
export type LyricsApiErrorCode = "invalid_request" | "upstream_unavailable" | "network";

export class LyricsApiError extends Error {
  readonly code: LyricsApiErrorCode;

  constructor(code: LyricsApiErrorCode, message = `Lyrics request failed (${code}).`) {
    super(message);
    this.name = "LyricsApiError";
    this.code = code;
  }
}

/** The provider's raw strings, exactly as returned — parsing is the panel's concern. */
export interface LyricsPayload {
  readonly syncedLyrics: string | null;
  readonly plainLyrics: string | null;
}

/** A resolved result: either lyrics, or a definite "this track has none". */
export type LyricsResolution =
  { readonly kind: "ok"; readonly payload: LyricsPayload } | { readonly kind: "unavailable" };

export interface LyricsRequest {
  /** The provider id — the YouTube video id. Also the server's cache key. */
  videoId: string;
  /** The track's own title, as shown. The server cleans it before searching. */
  title: string;
  artist?: string;
  channel?: string;
  durationSeconds?: number;
  signal?: AbortSignal;
}

/** Trim and bound a text parameter, or drop it when absent or blank. */
function boundedOptional(
  value: string | undefined,
  max: number,
  label: string,
): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  if (trimmed.length > max) {
    throw new LyricsApiError("invalid_request", `${label} must be at most ${max} characters.`);
  }
  return trimmed;
}

/**
 * Build the request path for one track's lyrics.
 *
 * Throws {@link LyricsApiError} with `invalid_request` — before any network call — for a malformed
 * or missing video id, or a parameter past its bound.
 */
export function buildLyricsQuery(request: Omit<LyricsRequest, "signal">): string {
  const videoId = request.videoId.trim();
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new LyricsApiError(
      "invalid_request",
      "A valid 11-character YouTube video id is required.",
    );
  }
  const title = boundedOptional(request.title, MAX_LYRICS_TITLE_LENGTH, "A track title") ?? "";
  const artist = boundedOptional(request.artist, MAX_LYRICS_ARTIST_LENGTH, "An artist name");
  const channel = boundedOptional(request.channel, MAX_LYRICS_ARTIST_LENGTH, "A channel name");

  const params = new URLSearchParams();
  params.set("videoId", videoId);
  params.set("title", title);
  if (artist !== undefined) params.set("artist", artist);
  if (channel !== undefined) params.set("channel", channel);
  // Rounded: a fractional duration is meaningless to the server's duration scoring, and a
  // non-integer is a 400 there. Rounding here keeps an out-of-bounds-looking value from
  // failing validation for the wrong reason.
  if (request.durationSeconds !== undefined && Number.isFinite(request.durationSeconds)) {
    params.set("duration", String(Math.max(0, Math.round(request.durationSeconds))));
  }
  return `${LYRICS_ENDPOINT}?${params.toString()}`;
}

/** Read a possibly-null string, treating blank and whitespace-only as absent. */
function nullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Validate a success body.
 *
 * A body that violates the contract's *shape* is an upstream contract violation
 * (`upstream_unavailable`), while a well-formed `status: "unavailable"` is a legitimate answer and
 * is returned as such. The distinction is the whole point of this function, so it is written as
 * two explicit branches rather than one "if anything is odd, throw".
 */
export function parseLyricsResponse(body: unknown): LyricsResolution {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new LyricsApiError("upstream_unavailable", "Lyrics response was not an object.");
  }
  const raw = body as Record<string, unknown>;

  if (raw.status === "unavailable") return { kind: "unavailable" };

  if (raw.status !== "ok") {
    throw new LyricsApiError("upstream_unavailable", "Lyrics response had an unexpected status.");
  }

  const syncedLyrics = nullableText(raw.syncedLyrics);
  const plainLyrics = nullableText(raw.plainLyrics);
  // `status: "ok"` with neither string is a contract violation, not an empty result: the route
  // answers `unavailable` in exactly that case, so reaching here means the two disagree.
  if (syncedLyrics === null && plainLyrics === null) {
    throw new LyricsApiError("upstream_unavailable", "Lyrics response reported ok with no lyrics.");
  }
  return { kind: "ok", payload: { syncedLyrics, plainLyrics } };
}

/** Read the server's error code from a structured error body. */
function readErrorCode(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    return (error as { code?: unknown }).code;
  }
  return (body as { code?: unknown }).code;
}

function toDesignedCode(raw: unknown): LyricsApiErrorCode | undefined {
  if (raw === "invalid_request" || raw === "invalid_input" || raw === "invalid") {
    return "invalid_request";
  }
  if (raw === "upstream_unavailable") return "upstream_unavailable";
  return undefined;
}

async function toLyricsError(response: Response): Promise<LyricsApiError> {
  try {
    const designed = toDesignedCode(readErrorCode(await response.json()));
    if (designed !== undefined) return new LyricsApiError(designed);
  } catch {
    // Non-JSON error body — fall through to the status mapping below.
  }
  if (response.status === 400 || response.status === 422) {
    return new LyricsApiError("invalid_request");
  }
  return new LyricsApiError("upstream_unavailable");
}

/**
 * Resolve one track's lyrics through the local API.
 *
 * - out-of-bounds or malformed input -> `invalid_request`, without a network call
 * - non-ok response -> the server's structured error code (status as fallback)
 * - fetch/parse transport failure -> `network` (an abort rethrows for the caller)
 * - a well-formed `unavailable` -> a resolved `unavailable`, **not** a thrown error
 */
export async function fetchLyrics(request: LyricsRequest): Promise<LyricsResolution> {
  const url = buildLyricsQuery(request);
  const signal = request.signal;

  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch (error) {
    // A dismissed or superseded panel's abort is not a failure to report.
    if (signal?.aborted) throw error;
    throw new LyricsApiError("network");
  }
  if (!response.ok) {
    throw await toLyricsError(response);
  }
  try {
    return parseLyricsResponse(await response.json());
  } catch (error) {
    // A connection cut mid-body re-reads as a transport failure; a parse failure already
    // carries its designed code.
    if (signal?.aborted) throw error;
    if (error instanceof LyricsApiError) throw error;
    throw new LyricsApiError("network");
  }
}

/** The track metadata this surface sends, taken from the playing track and nothing else. */
export function lyricsRequestFor(track: Track, signal?: AbortSignal): LyricsRequest {
  // `artists` is `ArtistSummary[]`, so the *name* is what a lyrics service indexes by; the id
  // would be a provider-internal identifier that means nothing to LRCLIB.
  const artist = track.artists
    .map((entry) => entry.name.trim())
    .filter((name) => name !== "")
    .join(", ");
  const duration = track.durationSeconds;
  return {
    videoId: track.providerId,
    title: track.title,
    ...(artist === "" ? {} : { artist }),
    ...(typeof duration === "number" && Number.isFinite(duration) && duration > 0
      ? { durationSeconds: duration }
      : {}),
    ...(signal ? { signal } : {}),
  };
}
