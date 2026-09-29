import type { Track } from "@/data/repositories";
import { artistRequestKey } from "@/features/artist/artistKeys";

/**
 * Client side of the M9 catalog contract (spec: `catalog` — "Catalog entity
 * keys and resolution requests"; design §1/§2):
 * `GET /api/artist?name=<>&id=<>` → 200 with
 * `{ artist, tracks, related, releases, diagnostics }`, or a structured
 * `{ error: { code, message } }` body on 400/404/503.
 *
 * Follows the `discoveryApi.ts` / `searchApi.ts` pattern exactly: the key is
 * classified and bounded *here* so a request always satisfies the server
 * contract, the body is validated before use, only provider-agnostic metadata
 * and `Track[]` leave this module, and error bodies are read from either
 * `{ error: { code } }` or a flat `{ error: "code" }` so the client is not
 * coupled to one encoding.
 *
 * Local-first contract: a request carries **only** the entity identifier — the
 * route key, as either `id` or `name`. There is no liked-track, playlist,
 * history, or language parameter in this surface at all, and
 * {@link buildArtistQuery} can construct nothing else.
 *
 * Every section of the artist page is derived from this one response
 * (design §1), so this module issues exactly one request per page view.
 */

/** Endpoint path for one artist resolution. */
export const ARTIST_ENDPOINT = "/api/artist";

/**
 * Upper bound on an entity id (mirrors the server contract). A YouTube channel
 * id is 24 characters; the slack absorbs a future provider's longer token
 * without letting an unbounded string reach the request line.
 */
export const MAX_ARTIST_ID_LENGTH = 64;

/** Upper bound on a text key (mirrors the server contract). */
export const MAX_ARTIST_NAME_LENGTH = 120;

/**
 * Server error codes plus the transport failure only the client can see.
 *
 * `unresolvable` is the one code that is *not* a failure: it is the route's
 * answer for a key that names no artist, and the page turns it into a
 * recoverable not-found state rather than an error surface.
 */
export type ArtistApiErrorCode =
  "invalid_request" | "unresolvable" | "upstream_unavailable" | "network";

/**
 * Artist resolution failure carrying the code the page maps onto its designed
 * state. Out-of-bounds input fails locally with `invalid_request` and never
 * reaches the network; every other unexpected HTTP status collapses onto
 * `upstream_unavailable` so the UI always speaks one of the four designed
 * answers.
 */
export class ArtistApiError extends Error {
  readonly code: ArtistApiErrorCode;

  constructor(code: ArtistApiErrorCode, message = `Artist request failed (${code}).`) {
    super(message);
    this.name = "ArtistApiError";
    this.code = code;
  }
}

/**
 * Whether `code` is worth offering a retry for.
 *
 * Everything except `unresolvable` is transient or a client bug that a retry
 * may well survive (the same call `useDiscoveryShelf` makes for its shelves);
 * `unresolvable` is the route saying this key names no artist, and retrying it
 * only re-sends the same dead identifier.
 */
export function isRetryableArtistError(code: ArtistApiErrorCode): boolean {
  // `unresolvable` is a settled answer (the key resolves to no artist) and
  // `invalid_request` is a client-side key problem, so neither is fixed by
  // waiting for the provider. Both are therefore *not* retryable, which is what
  // lets the view show each one's own copy instead of sending the user off to
  // check a connection that was never the problem.
  return code !== "unresolvable" && code !== "invalid_request";
}

/**
 * The unresolved payload's `diagnostics` envelope, kept deliberately opaque.
 *
 * Unlike the discovery feed, no client surface renders a diagnostic field, and
 * provider tier ids/outcomes must never become part of the client contract
 * (the M8 search safety rule). So nothing is projected: the untouched payload is
 * available under `raw` for tests and debugging, and nothing is lost.
 */
export interface ArtistDiagnostics {
  readonly raw: Readonly<Record<string, unknown>>;
}

/** The resolved artist: identity, plus artwork when the provider supplied it. */
export interface ArtistIdentity {
  /** Provider entity id, when the resolution carried one. */
  readonly id?: string;
  readonly name: string;
  /**
   * Best available artist image. Derived from member-track artwork (channel
   * avatars are rarely present in search results), so it is legitimately
   * absent and the page falls back to a circular placeholder.
   */
  readonly artworkUrl?: string;
}

/** One release derived from the resolved tracks (grouped by album title). */
export interface ArtistRelease {
  readonly id?: string;
  readonly title: string;
  readonly artistName?: string;
  readonly artworkUrl?: string;
  /** How many of the resolved tracks belong to this release. */
  readonly trackCount: number;
}

/**
 * One related artist. The provider has no related-artists capability, so these
 * are the non-primary artists credited across the same resolved tracks — the
 * shelf is honest about being drawn from the tracks above it.
 */
export interface ArtistRelatedArtist {
  readonly id?: string;
  readonly name: string;
  readonly artworkUrl?: string;
  /** How many of the resolved tracks credit this artist. */
  readonly trackCount: number;
}

/** One artist resolution: identity, the feed, and its two derived sections. */
export interface ArtistDetail {
  readonly artist: ArtistIdentity;
  readonly tracks: Track[];
  readonly related: readonly ArtistRelatedArtist[];
  readonly releases: readonly ArtistRelease[];
  readonly diagnostics: ArtistDiagnostics;
}

/** Everything one artist request needs. */
export interface ArtistRequest {
  /** The route key: a provider entity id or a normalized text key. */
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

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * The resolved identity, or `undefined` when the payload carries no usable one.
 * A blank name is no identity — a page cannot render an artist called "" — so it
 * reports unresolvable rather than substituting the requested key.
 */
function parseArtistIdentity(value: unknown): ArtistIdentity | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const name = asNonBlankString(raw.name);
  if (name === undefined) return undefined;
  return { id: asNonBlankString(raw.id), name, artworkUrl: asNonBlankString(raw.artworkUrl) };
}

/**
 * The derived related-artist entries, in the order the server ranked them.
 *
 * Malformed entries are dropped rather than failing the page: this section is
 * explicitly "where the provider gave us something" (spec: "their releases
 * where resolvable"), and one unusable entry must not cost the user the whole
 * artist page.
 */
function parseRelated(value: unknown): ArtistRelatedArtist[] {
  if (!Array.isArray(value)) return [];
  const entries: ArtistRelatedArtist[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const name = asNonBlankString(raw.name);
    if (name === undefined) continue;
    entries.push({
      id: asNonBlankString(raw.id),
      name,
      artworkUrl: asNonBlankString(raw.artworkUrl),
      trackCount: asCount(raw.trackCount),
    });
  }
  return entries;
}

/** The derived release entries; the same drop-the-unusable rule as `parseRelated`. */
function parseReleases(value: unknown): ArtistRelease[] {
  if (!Array.isArray(value)) return [];
  const entries: ArtistRelease[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const title = asNonBlankString(raw.title);
    if (title === undefined) continue;
    entries.push({
      id: asNonBlankString(raw.id),
      title,
      artistName: asNonBlankString(raw.artistName),
      artworkUrl: asNonBlankString(raw.artworkUrl),
      trackCount: asCount(raw.trackCount),
    });
  }
  return entries;
}

/** The untouched `diagnostics` payload, or an empty record when it is absent. */
function parseDiagnostics(value: unknown): ArtistDiagnostics {
  if (typeof value !== "object" || value === null) return { raw: {} };
  return { raw: value as Record<string, unknown> };
}

/**
 * Build the request path for one artist, validating the key first.
 * Throws {@link ArtistApiError} with `invalid_request` — before any network
 * call — for a blank key or one whose identifier is out of bounds.
 *
 * Exactly one of `id`/`name` is ever set: the key is *classified*, never both,
 * which is what keeps an unresolvable id from being re-sent as a name (spec: an
 * unresolvable key is never substituted).
 */
export function buildArtistQuery(request: Pick<ArtistRequest, "key">): string {
  const identifier = artistRequestKey(request.key);
  if (identifier === null) {
    throw new ArtistApiError("invalid_request", "An artist key is required.");
  }

  const params = new URLSearchParams();
  if ("id" in identifier) {
    if (identifier.id.length > MAX_ARTIST_ID_LENGTH) {
      throw new ArtistApiError(
        "invalid_request",
        `An artist id must be at most ${MAX_ARTIST_ID_LENGTH} characters.`,
      );
    }
    params.set("id", identifier.id);
  } else {
    if (identifier.name.length > MAX_ARTIST_NAME_LENGTH) {
      throw new ArtistApiError(
        "invalid_request",
        `An artist name must be at most ${MAX_ARTIST_NAME_LENGTH} characters.`,
      );
    }
    params.set("name", identifier.name);
  }

  return `${ARTIST_ENDPOINT}?${params.toString()}`;
}

/**
 * Validate a success body and return the artist resolution.
 *
 * Two failures are reported as `unresolvable` rather than as an error: a body
 * with **no usable `artist`**, and a body whose **`tracks` array is empty**.
 * Both are the same answer to the same question — the provider resolved no
 * artist here — and both must reach the user as a recoverable not-found state
 * rather than as a page that resolved an artist and then showed nothing.
 *
 * A body that violates the *shape* of the contract (not an object, `tracks`
 * absent or not an array, a malformed track) is an upstream contract violation
 * rather than a resolution answer, so it reports as `upstream_unavailable`.
 */
export function parseArtistResponse(body: unknown): ArtistDetail {
  // An array is `typeof "object"`, but it is not the `{ … }` envelope this
  // contract describes — it carries no `artist`, so without this check it would
  // be misreported as "resolved no artist" rather than as a broken contract.
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ArtistApiError("upstream_unavailable", "Artist response was not an object.");
  }
  const raw = body as Record<string, unknown>;

  const artist = parseArtistIdentity(raw.artist);
  if (artist === undefined) {
    throw new ArtistApiError("unresolvable", "Artist response did not resolve an artist.");
  }

  if (!Array.isArray(raw.tracks) || !raw.tracks.every(isTrackLike)) {
    throw new ArtistApiError(
      "upstream_unavailable",
      "Artist response did not contain valid tracks.",
    );
  }
  // An artist with no tracks has nothing to play, like, or seed a radio from —
  // the surface would render an identity and three empty sections, which is
  // exactly the "blank region" the spec forbids.
  if (raw.tracks.length === 0) {
    throw new ArtistApiError("unresolvable", "Artist response resolved no tracks.");
  }

  return {
    artist,
    tracks: raw.tracks,
    related: parseRelated(raw.related),
    releases: parseReleases(raw.releases),
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
function toDesignedCode(raw: unknown): ArtistApiErrorCode | undefined {
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
async function toArtistError(response: Response): Promise<ArtistApiError> {
  try {
    const designed = toDesignedCode(readErrorCode(await response.json()));
    if (designed !== undefined) return new ArtistApiError(designed);
  } catch {
    // Non-JSON error body — fall through to the status mapping below.
  }
  if (response.status === 400 || response.status === 422) {
    return new ArtistApiError("invalid_request");
  }
  if (response.status === 404) return new ArtistApiError("unresolvable");
  return new ArtistApiError("upstream_unavailable");
}

/**
 * Resolve one artist through the local API.
 *
 * - out-of-bounds or blank key → `invalid_request` without a network call
 * - non-ok response → the server's structured error code (status as fallback)
 * - fetch/parse transport failure → `network` (an abort rethrows for the caller)
 * - a 200 body that resolved nothing → `unresolvable`
 * - malformed success body → `upstream_unavailable`
 */
export async function fetchArtist(request: ArtistRequest): Promise<ArtistDetail> {
  const url = buildArtistQuery(request);
  const signal = request.signal;

  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch (error) {
    // A dismissed or superseded page's abort is not a failure to report.
    if (signal?.aborted) throw error;
    throw new ArtistApiError("network");
  }
  if (!response.ok) {
    throw await toArtistError(response);
  }
  try {
    return parseArtistResponse(await response.json());
  } catch (error) {
    // A connection cut mid-body re-reads as a transport failure; parse
    // failures already carry their designed code.
    if (signal?.aborted) throw error;
    if (error instanceof ArtistApiError) throw error;
    throw new ArtistApiError("network");
  }
}
