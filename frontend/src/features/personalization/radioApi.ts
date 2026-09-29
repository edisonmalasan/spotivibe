import type { Track } from "@/data/repositories";

/**
 * Client half of the M10 radio contract (spec: `music-provider` — "Radio feed
 * resolution"; design §2/§3):
 * `GET /api/radio?kind=<>&title=<>&artist=<>&variant=<>&limit=<>&exclude=<ids>`
 * → 200 with `{ tracks, variant, diagnostics }`, or a structured
 * `{ error: { code, message } }` body on 400/404/503.
 *
 * Follows the `artistApi.ts` / `albumApi.ts` / `discoveryApi.ts` pattern
 * exactly: the request is classified and bounded *here* so it always satisfies
 * the server contract, the body is validated before use, only canonical
 * `Track[]` and the echoed rotation index leave this module, and error bodies
 * are read from either `{ error: { code } }` or a flat `{ error: "code" }` so
 * the client is not coupled to one encoding.
 *
 * **No personalization data leaves the device (design §3, spec scenario).**
 * {@link buildRadioQuery} can construct nothing but the six documented
 * parameters: a radio identity, the caller's own refill counter, a limit, and
 * the ids it wants kept out. There is no liked-track, playlist, history,
 * language, or profile parameter in this surface at all, and no taste-profile
 * weighting is ever read into a request — the local profile steers *ranking*
 * after the response, never the query.
 *
 * An empty result is not a success here: a refill whose every track was already
 * played is the server's `unresolvable` answer, reported as
 * {@link RadioApiError} with that code so the engine can end the radio
 * gracefully instead of looping on it (design §7).
 */

/** Endpoint path for one radio refill. */
export const RADIO_ENDPOINT = "/api/radio";

/**
 * Upper bound on one exclusion list (mirrors the server contract exactly). A
 * longer list is rejected **locally**, before the network: silently dropping
 * ids would quietly re-serve a track the caller has already played.
 */
export const MAX_RADIO_EXCLUDE = 60;

/** Upper bound on a track title (mirrors the server contract). */
export const MAX_RADIO_TITLE_LENGTH = 200;

/** Upper bound on an artist name (mirrors the server contract). */
export const MAX_RADIO_ARTIST_LENGTH = 200;

/** Upper bound on a caller-held rotation index (mirrors the server contract). */
export const MAX_RADIO_VARIANT = 999;

/** Upper bound on a requested track count (mirrors the server contract). */
export const MAX_RADIO_LIMIT = 50;

/** Every identity a radio may be started from (mirrors the server contract). */
export const RADIO_KINDS = ["track", "artist"] as const;

/** One radio identity kind: a single track, or a whole artist. */
export type RadioKind = (typeof RADIO_KINDS)[number];

/**
 * Server error codes plus the transport failure only the client can see.
 *
 * `unresolvable` is the one code that is *not* a failure: it is the route's
 * answer for a refill that produced no usable material (an exhausted played set
 * included), and the engine ends the radio on it rather than retrying.
 */
export type RadioApiErrorCode =
  "invalid_request" | "unresolvable" | "upstream_unavailable" | "network";

/**
 * Radio-refill failure carrying the code the engine maps onto its designed
 * state. Out-of-bounds input fails locally with `invalid_request` and never
 * reaches the network; every other unexpected HTTP status collapses onto
 * `upstream_unavailable` so the caller always speaks one of the four designed
 * answers.
 */
export class RadioApiError extends Error {
  readonly code: RadioApiErrorCode;

  constructor(code: RadioApiErrorCode, message = `Radio request failed (${code}).`) {
    super(message);
    this.name = "RadioApiError";
    this.code = code;
  }
}

/**
 * Whether `code` is worth offering a retry for.
 *
 * Everything except `unresolvable` and `invalid_request` is transient or a
 * client bug a retry may survive (the same call `useDiscoveryShelf` makes for
 * its shelves). `unresolvable` means this identity has no material left, and
 * `invalid_request` is a rejected request — both are settled answers, and
 * retrying either only re-sends the same dead question.
 */
export function isRetryableRadioError(code: RadioApiErrorCode): boolean {
  return code !== "unresolvable" && code !== "invalid_request";
}

/** One radio refill: the material to append, and the cycle it came from. */
export interface RadioFeed {
  /**
   * Canonical tracks in the server's resolved order. Every id the caller
   * excluded is already absent, but the caller still re-filters client-side
   * (design §3: the server can only honor the ids it was given).
   */
  tracks: Track[];
  /** The rotation index these results were planned from. */
  variant: number;
}

/** Everything one radio refill request needs. */
export interface RadioFeedRequest {
  /** Which identity the radio follows. */
  kind: RadioKind;
  /** Public track title. Required for `kind: "track"`, ignored for `"artist"`. */
  title?: string;
  /** Public artist name. Required for `kind: "artist"`, optional narrowing otherwise. */
  artist?: string;
  /** The caller's own refill counter — the only rotation input (design §2). */
  variant: number;
  /** Maximum tracks to ask for. */
  limit?: number;
  /** Ids to keep out of the result (the caller's played set). */
  exclude?: readonly string[];
}

/** Minimal runtime guard for the canonical Track fields the radio appends. */
function isTrackLike(value: unknown): value is Track {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Track>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.providerId === "string" &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.artists)
  );
}

/** A non-negative whole number, or `undefined` for anything else. */
function asIndex(value: unknown, maximum: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > maximum) return undefined;
  return value;
}

/**
 * Build the request parameters for one radio refill, validating them first.
 *
 * Throws {@link RadioApiError} with `invalid_request` — **before any network
 * call** — for a missing or out-of-bounds identity, a rotation index outside
 * its range, or an exclusion list longer than {@link MAX_RADIO_EXCLUDE} or
 * carrying an over-long id. The bound is a rejection, never a truncation.
 *
 * Exactly the six documented keys are ever set. There is no code path from this
 * module to a liked-track, history, language, or profile parameter.
 */
export function buildRadioQuery(request: RadioFeedRequest): URLSearchParams {
  const params = new URLSearchParams();
  if (!RADIO_KINDS.includes(request.kind)) {
    throw new RadioApiError("invalid_request", `kind must be one of ${RADIO_KINDS.join(", ")}.`);
  }
  params.set("kind", request.kind);

  const title = request.title?.trim();
  const artist = request.artist?.trim();
  if (request.kind === "artist") {
    if (artist === undefined || artist.length === 0) {
      throw new RadioApiError("invalid_request", "An artist radio requires an artist.");
    }
    if (artist.length > MAX_RADIO_ARTIST_LENGTH) {
      throw new RadioApiError(
        "invalid_request",
        `An artist name must be at most ${MAX_RADIO_ARTIST_LENGTH} characters.`,
      );
    }
    params.set("artist", artist);
  } else {
    if (title === undefined || title.length === 0) {
      throw new RadioApiError("invalid_request", "A track radio requires a title.");
    }
    if (title.length > MAX_RADIO_TITLE_LENGTH) {
      throw new RadioApiError(
        "invalid_request",
        `A track title must be at most ${MAX_RADIO_TITLE_LENGTH} characters.`,
      );
    }
    params.set("title", title);
    if (artist !== undefined && artist.length > 0) {
      if (artist.length > MAX_RADIO_ARTIST_LENGTH) {
        throw new RadioApiError(
          "invalid_request",
          `An artist name must be at most ${MAX_RADIO_ARTIST_LENGTH} characters.`,
        );
      }
      params.set("artist", artist);
    }
  }

  const variant = asIndex(request.variant, MAX_RADIO_VARIANT);
  if (variant === undefined) {
    throw new RadioApiError(
      "invalid_request",
      `variant must be a whole number between 0 and ${MAX_RADIO_VARIANT}.`,
    );
  }
  params.set("variant", String(variant));

  if (request.limit !== undefined) {
    const limit = asIndex(request.limit, MAX_RADIO_LIMIT);
    if (limit === undefined || limit < 1) {
      throw new RadioApiError(
        "invalid_request",
        `limit must be a whole number between 1 and ${MAX_RADIO_LIMIT}.`,
      );
    }
    params.set("limit", String(limit));
  }

  const exclude = (request.exclude ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
  if (exclude.length > MAX_RADIO_EXCLUDE) {
    // Rejected, never truncated: dropping ids the caller asked to exclude would
    // quietly re-serve an already-played track.
    throw new RadioApiError(
      "invalid_request",
      `An exclusion list must contain at most ${MAX_RADIO_EXCLUDE} ids.`,
    );
  }
  if (exclude.length > 0) params.set("exclude", exclude.join(","));

  return params;
}

/**
 * Validate a success body and return the refill.
 *
 * Two answers are reported as `unresolvable` rather than as an error: a body
 * that is not the `{ … }` envelope this contract describes *and* carries no
 * usable `variant`, and a body whose `tracks` array is empty. The second is the
 * spec's "everything excluded is an empty result, not a substitution" case
 * reaching the client, and the engine ends the radio on it rather than
 * re-requesting the same exhausted cycle.
 *
 * A body that violates the *shape* of the contract (not an object, `tracks`
 * absent or not an array, a malformed track, a non-integer `variant`) is an
 * upstream contract violation rather than a resolution answer, so it reports as
 * `upstream_unavailable`.
 */
export function parseRadioResponse(body: unknown): RadioFeed {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new RadioApiError("upstream_unavailable", "Radio response was not an object.");
  }
  const raw = body as Record<string, unknown>;

  const variant = asIndex(raw.variant, MAX_RADIO_VARIANT);
  if (variant === undefined) {
    throw new RadioApiError("upstream_unavailable", "Radio response did not carry a variant.");
  }

  if (!Array.isArray(raw.tracks) || !raw.tracks.every(isTrackLike)) {
    throw new RadioApiError("upstream_unavailable", "Radio response did not contain valid tracks.");
  }
  // Nothing left to play: the honest answer is an empty feed, which the engine
  // turns into a graceful end rather than a substitution or a retry loop.
  if (raw.tracks.length === 0) {
    throw new RadioApiError("unresolvable", "Radio response resolved no tracks.");
  }

  return { tracks: raw.tracks, variant };
}

/**
 * Read the server's error code from a structured error body. The route answers
 * `{ error: { code, message } }`; a flat `{ error: "code" }` (the M7 playlist
 * shape) is accepted too, so the client is not coupled to one encoding.
 */
function readErrorCode(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    return (error as { code?: unknown }).code;
  }
  return (body as { code?: unknown }).code;
}

/** Normalize the code aliases the route may use onto the four designed codes. */
function toDesignedCode(raw: unknown): RadioApiErrorCode | undefined {
  if (raw === "invalid_request" || raw === "invalid_input" || raw === "invalid") {
    return "invalid_request";
  }
  if (raw === "unresolvable" || raw === "not_found" || raw === "notfound") {
    return "unresolvable";
  }
  if (raw === "upstream_unavailable") return "upstream_unavailable";
  return undefined;
}

/** Map a non-ok response onto its designed error code (status as fallback). */
async function toRadioError(response: Response): Promise<RadioApiError> {
  try {
    const designed = toDesignedCode(readErrorCode(await response.json()));
    if (designed !== undefined) return new RadioApiError(designed);
  } catch {
    // Non-JSON error body — fall through to the status mapping below.
  }
  if (response.status === 400 || response.status === 422) {
    return new RadioApiError("invalid_request");
  }
  if (response.status === 404) return new RadioApiError("unresolvable");
  return new RadioApiError("upstream_unavailable");
}

/**
 * Fetch one radio refill.
 *
 * - out-of-bounds or missing input → `invalid_request` without a network call
 * - non-ok response → the server's structured error code (status as fallback)
 * - fetch/parse transport failure → `network` (a caller abort rethrows)
 * - a 200 body that resolved nothing → `unresolvable`
 * - malformed success body → `upstream_unavailable`
 */
export async function fetchRadioFeed(
  request: RadioFeedRequest,
  options: { signal?: AbortSignal } = {},
): Promise<RadioFeed> {
  // Bounded locally first: a request this module cannot make a valid one of
  // must never reach the network.
  const params = buildRadioQuery(request);
  const signal = options.signal;

  let response: Response;
  try {
    response = await fetch(`${RADIO_ENDPOINT}?${params.toString()}`, signal ? { signal } : {});
  } catch (error) {
    // A cancelled or unmounted refill is not a failure to report.
    if (signal?.aborted) throw error;
    throw new RadioApiError("network");
  }
  if (!response.ok) {
    throw await toRadioError(response);
  }
  try {
    return parseRadioResponse(await response.json());
  } catch (error) {
    // A connection cut mid-body re-reads as a transport failure; parse
    // failures already carry their designed code.
    if (signal?.aborted) throw error;
    if (error instanceof RadioApiError) throw error;
    throw new RadioApiError("network");
  }
}
