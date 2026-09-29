import type { Track } from "@/data/repositories";

/**
 * Client side of the M9 related-content contract (spec: `catalog` — "Related
 * content for the current track"; design §8):
 * `GET /api/similar?title=<>&artist=<>&exclude=<trackId>` → 200 with
 * `{ tracks, diagnostics }`, or a structured `{ error: { code, message } }` body
 * on 400/404/503.
 *
 * Follows the `discoveryApi.ts` / `artistApi.ts` / `albumApi.ts` pattern exactly:
 * the parameters are bounded *here* so a request always satisfies the server
 * contract, the body is validated before use, only provider-agnostic metadata and
 * `Track[]` leave this module, and error bodies are read from either
 * `{ error: { code } }` or a flat `{ error: "code" }` so the client is not
 * coupled to one encoding.
 *
 * Local-first contract — the reason this module can hold no library or user
 * input at all: a request carries **only the playing track's own public
 * metadata** (its title, its credited artist, and its id as the exclusion).
 * There is no liked-track, playlist, history, session, or language parameter in
 * this surface, and {@link buildSimilarQuery} can construct nothing else. Related
 * content therefore needs no cloud profile and no stored identity of any kind.
 *
 * The exclusion is belt and braces: the server already drops the source track
 * from its candidates (a candidate whose `id` *or* `providerId` matches is
 * removed after the merge), and the shelf filters once more on the client. Two
 * independent checks are warranted here precisely because "the current track
 * appears in its own suggestions" is the one failure a user would read as the
 * app being broken.
 */

/** Endpoint path for one similar-track resolution. */
export const SIMILAR_ENDPOINT = "/api/similar";

/** Upper bound on the source track's title (mirrors the server contract). */
export const MAX_SIMILAR_TITLE_LENGTH = 200;

/** Upper bound on the optional artist narrowing (mirrors the server contract). */
export const MAX_SIMILAR_ARTIST_LENGTH = 200;

/**
 * Upper bound on the excluded track id (mirrors the server contract). A
 * canonical id is `youtube:<11 chars>`, so this is generous; it exists so a
 * malformed id cannot put an unbounded string on the request line.
 */
export const MAX_SIMILAR_EXCLUDE_LENGTH = 64;

/**
 * Server error codes plus the transport failure only the client can see.
 *
 * `unresolvable` is the one code that is *not* a failure: it is the route's
 * answer for a track nothing similar was found for, and the shelf turns it into
 * its ordinary explained-empty state rather than an error surface.
 */
export type SimilarApiErrorCode =
  "invalid_request" | "unresolvable" | "upstream_unavailable" | "network";

/**
 * Similar-track resolution failure carrying the code the shelf maps onto its
 * designed state. Out-of-bounds input fails locally with `invalid_request` and
 * never reaches the network; every other unexpected HTTP status collapses onto
 * `upstream_unavailable` so the shelf always speaks one of the four designed
 * answers.
 */
export class SimilarApiError extends Error {
  readonly code: SimilarApiErrorCode;

  constructor(code: SimilarApiErrorCode, message = `Similar-tracks request failed (${code}).`) {
    super(message);
    this.name = "SimilarApiError";
    this.code = code;
  }
}

/**
 * The resolution's `diagnostics` envelope, kept deliberately opaque.
 *
 * No client surface renders a diagnostic field, and provider tier ids/outcomes
 * must never become part of the client contract (the M8 search safety rule). So
 * nothing is projected: the untouched payload is available under `raw` for tests
 * and debugging, and nothing is lost.
 */
export interface SimilarDiagnostics {
  readonly raw: Readonly<Record<string, unknown>>;
}

/** One similar-track resolution: the candidates plus the safe diagnostics. */
export interface SimilarTrackSet {
  /**
   * Candidate tracks. The server has already dropped the excluded source track;
   * the shelf filters once more, so a shelf can never offer a user the track
   * they are already listening to.
   */
  readonly tracks: Track[];
  readonly diagnostics: SimilarDiagnostics;
}

/** Everything one similar-tracks request needs. */
export interface SimilarTracksRequest {
  /** The source track's public title — the only required input. */
  title: string;
  /** Optional artist narrowing, folded into the composed provider seeds. */
  artist?: string;
  /** Source track id; a candidate with this `id`/`providerId` is dropped. */
  exclude?: string;
  /** Caller-owned abort — an unmounted or superseded shelf cancels its request. */
  signal?: AbortSignal;
}

/** Minimal runtime guard for the canonical Track fields the shelf renders. */
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

/**
 * Trim an optional text parameter, or drop it.
 *
 * An absent, blank, or whitespace-only value is *no* narrowing, not an empty one:
 * `?artist=` would be a 400 from the route, and a blank artist would narrow the
 * composed seed to nothing useful in any case.
 */
function boundedOptional(
  value: string | undefined,
  max: number,
  label: string,
): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") return undefined;
  if (trimmed.length > max) {
    throw new SimilarApiError("invalid_request", `${label} must be at most ${max} characters.`);
  }
  return trimmed;
}

/** The untouched `diagnostics` payload, or an empty record when it is absent. */
function parseDiagnostics(value: unknown): SimilarDiagnostics {
  if (typeof value !== "object" || value === null) return { raw: {} };
  return { raw: value as Record<string, unknown> };
}

/**
 * Build the request path for one source track, validating every parameter first.
 * Throws {@link SimilarApiError} with `invalid_request` — before any network
 * call — for a blank title or a parameter beyond its bound.
 *
 * Exactly `title`, `artist`, and `exclude` can appear: this function is the
 * whole input surface, so a library or user payload has nowhere to be added.
 */
export function buildSimilarQuery(
  request: Pick<SimilarTracksRequest, "title" | "artist" | "exclude">,
): string {
  const title = boundedOptional(request.title, MAX_SIMILAR_TITLE_LENGTH, "A track title");
  if (title === undefined) {
    throw new SimilarApiError("invalid_request", "A track title is required.");
  }
  const artist = boundedOptional(request.artist, MAX_SIMILAR_ARTIST_LENGTH, "An artist name");
  const exclude = boundedOptional(request.exclude, MAX_SIMILAR_EXCLUDE_LENGTH, "A track id");

  const params = new URLSearchParams();
  params.set("title", title);
  if (artist !== undefined) params.set("artist", artist);
  if (exclude !== undefined) params.set("exclude", exclude);
  return `${SIMILAR_ENDPOINT}?${params.toString()}`;
}

/**
 * Validate a success body and return the candidates.
 *
 * A body that violates the *shape* of the contract (not an object, `tracks`
 * absent or not an array, a malformed track) is an upstream contract violation
 * rather than a resolution answer, so it reports as `upstream_unavailable`.
 * A body whose `tracks` array is simply empty is a legitimate answer — nothing
 * similar resolved — and reaches the caller as an empty set, which the shelf
 * renders as its explained-empty state rather than as a failure.
 */
export function parseSimilarResponse(body: unknown): SimilarTrackSet {
  // An array is `typeof "object"`, but it is not the `{ … }` envelope this
  // contract describes, so it must not be mistaken for one.
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new SimilarApiError("upstream_unavailable", "Similar response was not an object.");
  }
  const raw = body as Record<string, unknown>;
  if (!Array.isArray(raw.tracks) || !raw.tracks.every(isTrackLike)) {
    throw new SimilarApiError(
      "upstream_unavailable",
      "Similar response did not contain valid tracks.",
    );
  }
  return { tracks: raw.tracks, diagnostics: parseDiagnostics(raw.diagnostics) };
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
function toDesignedCode(raw: unknown): SimilarApiErrorCode | undefined {
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
async function toSimilarError(response: Response): Promise<SimilarApiError> {
  try {
    const designed = toDesignedCode(readErrorCode(await response.json()));
    if (designed !== undefined) return new SimilarApiError(designed);
  } catch {
    // Non-JSON error body — fall through to the status mapping below.
  }
  if (response.status === 400 || response.status === 422) {
    return new SimilarApiError("invalid_request");
  }
  if (response.status === 404) return new SimilarApiError("unresolvable");
  return new SimilarApiError("upstream_unavailable");
}

/**
 * Resolve the tracks similar to one source track through the local API.
 *
 * - out-of-bounds or blank input → `invalid_request` without a network call
 * - non-ok response → the server's structured error code (status as fallback)
 * - fetch/parse transport failure → `network` (an abort rethrows for the caller)
 * - malformed success body → `upstream_unavailable`
 */
export async function fetchSimilarTracks(request: SimilarTracksRequest): Promise<SimilarTrackSet> {
  const url = buildSimilarQuery(request);
  const signal = request.signal;

  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch (error) {
    // A dismissed or superseded shelf's abort is not a failure to report.
    if (signal?.aborted) throw error;
    throw new SimilarApiError("network");
  }
  if (!response.ok) {
    throw await toSimilarError(response);
  }
  try {
    return parseSimilarResponse(await response.json());
  } catch (error) {
    // A connection cut mid-body re-reads as a transport failure; parse
    // failures already carry their designed code.
    if (signal?.aborted) throw error;
    if (error instanceof SimilarApiError) throw error;
    throw new SimilarApiError("network");
  }
}
