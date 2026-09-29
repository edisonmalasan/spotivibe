import type { Track } from "@/data/repositories";
import { albumRequestKey } from "@/features/album/albumKeys";

/**
 * Client side of the M9 album contract (spec: `catalog` — "Album page" /
 * "Catalog entity keys and resolution requests"; design §1/§2/§3):
 * `GET /api/album?title=<>&artist=<>&id=<>` → 200 with
 * `{ album, tracks, metadataIncomplete, diagnostics }`, or a structured
 * `{ error: { code, message } }` body on 400/404/503.
 *
 * Follows the `artistApi.ts` / `discoveryApi.ts` / `searchApi.ts` pattern
 * exactly: the key is classified and bounded *here* so a request always
 * satisfies the server contract, the body is validated before use, only
 * provider-agnostic metadata and `Track[]` leave this module, and error bodies
 * are read from either `{ error: { code } }` or a flat `{ error: "code" }` so
 * the client is not coupled to one encoding.
 *
 * Local-first contract: a request carries **only** the release identifier — the
 * route key, as `id` or as `title` (+ optional `artist`). There is no
 * liked-track, playlist, history, or language parameter in this surface at all,
 * and {@link buildAlbumQuery} can construct nothing else.
 *
 * The release-specific half of the contract is `metadataIncomplete` (design §3):
 * a search-derived resolution frequently cannot confirm that the tracks it
 * returned belong to the requested release, and this surface reports that fact
 * rather than presenting an approximate list as a tracklist. It is carried
 * through as a plain boolean and the *view* decides what to say about it.
 */

/** Endpoint path for one album resolution. */
export const ALBUM_ENDPOINT = "/api/album";

/**
 * Upper bound on a release entity id (mirrors the server contract exactly). A
 * YouTube channel id is 24 characters; the slack absorbs a future provider's
 * longer token without letting an unbounded string reach the request line.
 */
export const MAX_ALBUM_ID_LENGTH = 64;

/** Upper bound on a release title (mirrors the server contract). */
export const MAX_ALBUM_TITLE_LENGTH = 200;

/** Upper bound on the optional artist narrowing (mirrors the server contract). */
export const MAX_ALBUM_ARTIST_LENGTH = 200;

/**
 * Server error codes plus the transport failure only the client can see.
 *
 * `unresolvable` is the one code that is *not* a failure: it is the route's
 * answer for a key that names no release, and the page turns it into a
 * recoverable not-found state rather than an error surface.
 */
export type AlbumApiErrorCode =
  "invalid_request" | "unresolvable" | "upstream_unavailable" | "network";

/**
 * Album resolution failure carrying the code the page maps onto its designed
 * state. Out-of-bounds input fails locally with `invalid_request` and never
 * reaches the network; every other unexpected HTTP status collapses onto
 * `upstream_unavailable` so the UI always speaks one of the four designed
 * answers.
 */
export class AlbumApiError extends Error {
  readonly code: AlbumApiErrorCode;

  constructor(code: AlbumApiErrorCode, message = `Album request failed (${code}).`) {
    super(message);
    this.name = "AlbumApiError";
    this.code = code;
  }
}

/**
 * Whether `code` is worth offering a retry for.
 *
 * Everything except `unresolvable` is transient or a client bug that a retry
 * may well survive; `unresolvable` is the route saying this key names no
 * release, and retrying it only re-sends the same dead identifier.
 */
export function isRetryableAlbumError(code: AlbumApiErrorCode): boolean {
  return code !== "unresolvable";
}

/**
 * The resolution's `diagnostics` envelope, kept deliberately opaque.
 *
 * No client surface renders a diagnostic field, and provider tier ids/outcomes
 * must never become part of the client contract (the M8 search safety rule). So
 * nothing is projected: the untouched payload is available under `raw` for tests
 * and debugging, and nothing is lost.
 */
export interface AlbumDiagnostics {
  readonly raw: Readonly<Record<string, unknown>>;
}

/** The resolved release: identity plus whatever metadata the provider gave. */
export interface AlbumRelease {
  /** Provider release id, when the resolution carried one. */
  readonly id?: string;
  readonly title: string;
  readonly artistName?: string;
  /**
   * The release's cover, taken only from a **confirmed** member track's
   * artwork — an unconfirmed search hit's thumbnail is somebody else's
   * picture. Legitimately absent (providers expose no album-artwork endpoint),
   * and the page falls back to its placeholder cover.
   */
  readonly artworkUrl?: string;
  /**
   * Release year, when the resolution carried one. Providers rarely expose it
   * through search, so the page treats it as optional metadata and never
   * requires it.
   */
  readonly year?: number;
}

/** One album resolution: the release, its tracks, and the completeness flag. */
export interface AlbumDetail {
  readonly album: AlbumRelease;
  /** The resolved tracks, in the order the API returned them. */
  readonly tracks: Track[];
  /**
   * `true` when no resolved track carried album metadata matching the request
   * (design §3). The list is still shown, but never as a confirmed tracklist.
   */
  readonly metadataIncomplete: boolean;
  readonly diagnostics: AlbumDiagnostics;
}

/** Everything one album request needs. */
export interface AlbumRequest {
  /** The route key: a provider entity id, a `title - artist` key, or a title. */
  key: string;
  /** Caller-owned abort — an unmounted or superseded page cancels its request. */
  signal?: AbortSignal;
}

/** Minimal runtime guard for the canonical Track fields the page renders. */
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

function asNonBlankString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** A positive whole-number year, or `undefined` for anything else. */
function asYear(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * The resolved release, or `undefined` when the payload carries no usable one.
 * A blank title is no identity — a page cannot render a release called "" — so
 * it reports unresolvable rather than substituting the requested key.
 */
function parseAlbumRelease(value: unknown): AlbumRelease | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const title = asNonBlankString(raw.title);
  if (title === undefined) return undefined;
  const year = asYear(raw.year);
  return {
    id: asNonBlankString(raw.id),
    title,
    artistName: asNonBlankString(raw.artistName),
    artworkUrl: asNonBlankString(raw.artworkUrl),
    year,
  };
}

/** The untouched `diagnostics` payload, or an empty record when it is absent. */
function parseDiagnostics(value: unknown): AlbumDiagnostics {
  if (typeof value !== "object" || value === null) return { raw: {} };
  return { raw: value as Record<string, unknown> };
}

/**
 * Build request path for one album, validating the key first.
 * Throws {@link AlbumApiError} with `invalid_request` — before any network
 * call — for a blank key or one whose identifier is out of bounds.
 *
 * Exactly one of `id` / `title` is ever set: the key is *classified*, never
 * both, which is what keeps an unresolvable id from being re-sent as a title
 * (spec: an unresolvable key is never substituted). `artist` is an optional
 * narrowing beside `title` — it never travels alone, because a title with no
 * release is not a request.
 */
export function buildAlbumQuery(request: Pick<AlbumRequest, "key">): string {
  const identifier = albumRequestKey(request.key);
  if (identifier === null) {
    throw new AlbumApiError("invalid_request", "An album key is required.");
  }

  const params = new URLSearchParams();
  if ("id" in identifier) {
    if (identifier.id.length > MAX_ALBUM_ID_LENGTH) {
      throw new AlbumApiError(
        "invalid_request",
        `An album id must be at most ${MAX_ALBUM_ID_LENGTH} characters.`,
      );
    }
    params.set("id", identifier.id);
  } else {
    if (identifier.title.length > MAX_ALBUM_TITLE_LENGTH) {
      throw new AlbumApiError(
        "invalid_request",
        `An album title must be at most ${MAX_ALBUM_TITLE_LENGTH} characters.`,
      );
    }
    params.set("title", identifier.title);
    if (identifier.artist !== undefined) {
      if (identifier.artist.length > MAX_ALBUM_ARTIST_LENGTH) {
        throw new AlbumApiError(
          "invalid_request",
          `An album artist must be at most ${MAX_ALBUM_ARTIST_LENGTH} characters.`,
        );
      }
      params.set("artist", identifier.artist);
    }
  }

  return `${ALBUM_ENDPOINT}?${params.toString()}`;
}

/**
 * Validate a success body and return the album resolution.
 *
 * Two failures are reported as `unresolvable` rather than as an error: a body
 * with **no usable `album`**, and a body whose **`tracks` array is empty**. Both
 * are the same answer to the same question — the provider resolved no release
 * here — and both must reach the user as a recoverable not-found state rather
 * than as a page that resolved a release and then showed nothing.
 *
 * A body that violates the *shape* of the contract (not an object, `tracks`
 * absent or not an array, a malformed track) is an upstream contract violation
 * rather than a resolution answer, so it reports as `upstream_unavailable`.
 *
 * `metadataIncomplete` is read strictly: only an explicit `true` is true, so a
 * missing or malformed flag defaults to the *complete* reading. That is the
 * safe direction for the one flag the server sets deliberately — the
 * alternative would nag about incompleteness on every response that predates the
 * field.
 */
export function parseAlbumResponse(body: unknown): AlbumDetail {
  // An array is `typeof "object"`, but it is not the `{ … }` envelope this
  // contract describes — it carries no `album`, so without this check it would
  // be misreported as "resolved no release" rather than as a broken contract.
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AlbumApiError("upstream_unavailable", "Album response was not an object.");
  }
  const raw = body as Record<string, unknown>;

  const album = parseAlbumRelease(raw.album);
  if (album === undefined) {
    throw new AlbumApiError("unresolvable", "Album response did not resolve a release.");
  }

  if (!Array.isArray(raw.tracks) || !raw.tracks.every(isTrackLike)) {
    throw new AlbumApiError("upstream_unavailable", "Album response did not contain valid tracks.");
  }
  // A release with no tracks has nothing to play, like, or add to a playlist —
  // the surface would render a hero and an empty list, which is exactly the
  // "blank region" the spec forbids.
  if (raw.tracks.length === 0) {
    throw new AlbumApiError("unresolvable", "Album response resolved no tracks.");
  }

  return {
    album,
    // The order is the server's resolved order and is carried through untouched:
    // a search-derived list is an approximation, and re-sorting it here would
    // claim an authority the resolution never had.
    tracks: raw.tracks,
    metadataIncomplete: raw.metadataIncomplete === true,
    diagnostics: parseDiagnostics(raw.diagnostics),
  };
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
function toDesignedCode(raw: unknown): AlbumApiErrorCode | undefined {
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
async function toAlbumError(response: Response): Promise<AlbumApiError> {
  try {
    const designed = toDesignedCode(readErrorCode(await response.json()));
    if (designed !== undefined) return new AlbumApiError(designed);
  } catch {
    // Non-JSON error body — fall through to the status mapping below.
  }
  if (response.status === 400 || response.status === 422) {
    return new AlbumApiError("invalid_request");
  }
  if (response.status === 404) return new AlbumApiError("unresolvable");
  return new AlbumApiError("upstream_unavailable");
}

/**
 * Resolve one album through the local API.
 *
 * - out-of-bounds or blank key → `invalid_request` without a network call
 * - non-ok response → the server's structured error code (status as fallback)
 * - fetch/parse transport failure → `network` (an abort rethrows for the caller)
 * - a 200 body that resolved nothing → `unresolvable`
 * - malformed success body → `upstream_unavailable`
 */
export async function fetchAlbum(request: AlbumRequest): Promise<AlbumDetail> {
  const url = buildAlbumQuery(request);
  const signal = request.signal;

  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch (error) {
    // A dismissed or superseded page's abort is not a failure to report.
    if (signal?.aborted) throw error;
    throw new AlbumApiError("network");
  }
  if (!response.ok) {
    throw await toAlbumError(response);
  }
  try {
    return parseAlbumResponse(await response.json());
  } catch (error) {
    // A connection cut mid-body re-reads as a transport failure; parse
    // failures already carry their designed code.
    if (signal?.aborted) throw error;
    if (error instanceof AlbumApiError) throw error;
    throw new AlbumApiError("network");
  }
}
