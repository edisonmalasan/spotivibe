import type { Track } from "@/data/repositories";
import { MAX_SELECTED_LANGUAGES, isLanguageCode, normalizeLanguageCodes } from "@/lib/languages";

/**
 * Client side of the M8 discovery contract (design §1/§2/§3):
 * `GET /api/discover?kind=<kind>&languages=<csv>&seeds=<csv>&limit=<n>` → 200
 * with a flat `{ tracks, diagnostics }` body, or a flat
 * `{ error: "invalid_request" | "upstream_unavailable" }` body on 400/503.
 *
 * Follows the `searchApi.ts` / `playlistApi.ts` pattern: parameters are
 * validated and bounded here so a request always satisfies the contract, the
 * body is validated before use, only provider-agnostic metadata and `Track[]`
 * leave this module, and `diagnostics` is reduced to the non-provider fields
 * (tier ids/outcomes stay server-side — the search safety rule). Error bodies
 * are read from either `{ error: { code } }` or a flat `{ error: "code" }`.
 *
 * Local-first contract (spec: local-only personalization inputs): a request
 * carries nothing but the feed kind, the selected catalog language codes, and
 * short caller-supplied seed terms. No liked-track, playlist, or history
 * payload is ever sent.
 *
 * Wire format: `languages` and `seeds` are comma-separated lists; `seeds` is
 * omitted entirely when the caller supplies none (the server then composes the
 * feed from its own catalog). Values are percent-encoded by `URLSearchParams`.
 */

/** Endpoint path for one composed discovery feed. */
export const DISCOVERY_ENDPOINT = "/api/discover";

/** The composable feed kinds the server accepts (one shelf per request). */
export const DISCOVERY_KINDS = [
  "trending",
  "genre",
  "podcast",
  "collection",
  "for-you",
  "mix",
] as const;

export type DiscoveryKind = (typeof DISCOVERY_KINDS)[number];

/** At least one selected language — a feed always has an attribution language. */
export const MIN_DISCOVERY_LANGUAGES = 1;
/** Mirrors the shared catalog's selection cap (one user-owned preference). */
export const MAX_DISCOVERY_LANGUAGES = MAX_SELECTED_LANGUAGES;
/** Upper bound on caller-supplied seed terms (mirrors the server contract). */
export const MAX_DISCOVERY_SEEDS = 8;
/** Upper bound on one seed term's length. */
export const MAX_SEED_LENGTH = 80;
/** Result bounds (server default is 20, max 50). */
export const MIN_DISCOVERY_LIMIT = 1;
export const MAX_DISCOVERY_LIMIT = 50;
export const DISCOVERY_LIMIT = 20;

/** Server error codes plus the transport failure only the client can see. */
export type DiscoveryErrorCode = "invalid_request" | "upstream_unavailable" | "network";

/**
 * Discovery failure carrying the code a shelf maps onto its designed message.
 * Out-of-bounds input fails locally with `invalid_request` (no network call);
 * every other unexpected HTTP status collapses onto `upstream_unavailable` so
 * the UI always speaks one of the three designed messages.
 */
export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;

  constructor(code: DiscoveryErrorCode, message = `Discovery request failed (${code}).`) {
    super(message);
    this.name = "DiscoveryError";
    this.code = code;
  }
}

/**
 * The non-provider part of the server's `diagnostics` envelope. Provider tier
 * ids/outcomes (`tiersTried`) are never typed here — they stay server-side; the
 * untouched payload is available under `raw` for tests and debugging only, so
 * nothing is silently lost and nothing provider-specific becomes a contract.
 */
export interface DiscoveryDiagnostics {
  /** The feed kind the server composed. */
  readonly kind?: string;
  /** Language codes the feed was composed for, after normalization. */
  readonly languages?: string[];
  /** How many seeds the server attempted. */
  readonly seedsTried?: number;
  /**
   * Seed queries whose tier chain was exhausted while their siblings still
   * produced results — the spec's "one failing seed does not fail the feed"
   * signal. A list holding every attempted query is the all-seeds failure.
   */
  readonly seedsFailed?: string[];
  /** Canonical tracks in the response. */
  readonly resultCount?: number;
  /** Whether the feed was served from the server's short-lived cache. */
  readonly cached?: boolean;
  readonly raw: Readonly<Record<string, unknown>>;
}

/** One composed feed: canonical tracks plus the safe diagnostics projection. */
export interface DiscoveryFeed {
  tracks: Track[];
  diagnostics: DiscoveryDiagnostics;
}

/** Everything one shelf request needs. */
export interface DiscoveryFeedRequest {
  /** Which curated feed to compose. */
  kind: DiscoveryKind;
  /** Selected catalog language codes (1..8); unknown codes are dropped. */
  languages: readonly string[];
  /** Short caller-supplied taste terms; omitted entirely when empty. */
  seeds?: readonly string[];
  /** Requested track count (1..50, default 20). */
  limit?: number;
  /** Caller-owned abort — a superseded shelf cancels its own request. */
  signal?: AbortSignal;
}

/** Whether `value` is one of the server's composable feed kinds. */
export function isDiscoveryKind(value: unknown): value is DiscoveryKind {
  return typeof value === "string" && (DISCOVERY_KINDS as readonly string[]).includes(value);
}

/** Minimal runtime guard for the canonical Track fields results are rendered from. */
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((entry) => typeof entry === "string") ? (value as string[]) : undefined;
}

/**
 * Reduce the server's `diagnostics` to the fields the client may read. Provider
 * tier ids and per-tier outcomes are intentionally absent from the projection;
 * the untouched payload is available under `raw` so nothing is silently lost.
 */
export function parseDiscoveryDiagnostics(value: unknown): DiscoveryDiagnostics {
  if (typeof value !== "object" || value === null) return { raw: {} };
  const raw = value as Record<string, unknown>;
  return {
    kind: asString(raw.kind),
    languages: asStringArray(raw.languages),
    seedsTried: asCount(raw.seedsTried),
    seedsFailed: asStringArray(raw.seedsFailed),
    resultCount: asCount(raw.resultCount),
    cached: asBoolean(raw.cached),
    raw,
  };
}

/**
 * Bound the selected languages: drop unknown/blank codes, drop duplicates in
 * the user's order, and cap at the shared catalog limit. An entirely unknown
 * list is a client bug, not a silent fallback to English, so it is rejected.
 */
function boundLanguages(languages: readonly string[]): string[] {
  const known = languages
    .map((code) => code.trim())
    .filter((code) => code !== "" && isLanguageCode(code));
  if (known.length < MIN_DISCOVERY_LANGUAGES) {
    throw new DiscoveryError("invalid_request", "At least one catalog language code is required.");
  }
  return normalizeLanguageCodes(known);
}

/** Bound seed terms: trim, cap each at 80 characters, cap the list at 8. */
function boundSeeds(seeds: readonly string[] | undefined): string[] {
  // Omitted or empty: the server composes the feed from its own catalog.
  if (seeds === undefined || seeds.length === 0) return [];
  const bounded = seeds
    .map((seed) => seed.trim().slice(0, MAX_SEED_LENGTH))
    .filter((seed) => seed !== "")
    .slice(0, MAX_DISCOVERY_SEEDS);
  if (bounded.length === 0) {
    throw new DiscoveryError(
      "invalid_request",
      "Seed terms must contain at least one non-empty term.",
    );
  }
  return bounded;
}

/** Validate the requested count against the contract's bounds. */
function boundLimit(limit: number | undefined): number {
  if (limit === undefined) return DISCOVERY_LIMIT;
  if (!Number.isInteger(limit) || limit < MIN_DISCOVERY_LIMIT || limit > MAX_DISCOVERY_LIMIT) {
    throw new DiscoveryError(
      "invalid_request",
      `limit must be an integer between ${MIN_DISCOVERY_LIMIT} and ${MAX_DISCOVERY_LIMIT}.`,
    );
  }
  return limit;
}

/**
 * Build the request path for one feed, validating every parameter first.
 * Throws {@link DiscoveryError} with `invalid_request` — before any network
 * call — when a parameter is missing, unknown, or out of bounds.
 */
export function buildDiscoveryQuery(request: DiscoveryFeedRequest): string {
  if (!isDiscoveryKind(request.kind)) {
    throw new DiscoveryError("invalid_request", `Unknown discovery kind: ${String(request.kind)}`);
  }
  const languages = boundLanguages(request.languages);
  const seeds = boundSeeds(request.seeds);
  const limit = boundLimit(request.limit);

  const params = new URLSearchParams();
  params.set("kind", request.kind);
  params.set("languages", languages.join(","));
  if (seeds.length > 0) params.set("seeds", seeds.join(","));
  params.set("limit", String(limit));
  return `${DISCOVERY_ENDPOINT}?${params.toString()}`;
}

/**
 * Validate a success body and return its feed. A malformed payload is an
 * upstream contract violation, not a client bug, so it reports as
 * `upstream_unavailable`.
 */
export function parseDiscoveryResponse(body: unknown): DiscoveryFeed {
  if (typeof body !== "object" || body === null) {
    throw new DiscoveryError("upstream_unavailable", "Discovery response was not an object.");
  }
  const tracks = (body as { tracks?: unknown }).tracks;
  if (!Array.isArray(tracks) || !tracks.every(isTrackLike)) {
    throw new DiscoveryError(
      "upstream_unavailable",
      "Discovery response did not contain valid tracks.",
    );
  }
  return {
    tracks,
    diagnostics: parseDiscoveryDiagnostics((body as { diagnostics?: unknown }).diagnostics),
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

/** Map a non-ok response onto its designed error code (status as fallback). */
async function toDiscoveryError(response: Response): Promise<DiscoveryError> {
  try {
    const code = readErrorCode(await response.json());
    if (code === "invalid_request" || code === "invalid_input" || code === "invalid") {
      return new DiscoveryError("invalid_request");
    }
    if (code === "upstream_unavailable") return new DiscoveryError("upstream_unavailable");
  } catch {
    // Non-JSON error body — fall through to the status mapping below.
  }
  if (response.status === 400 || response.status === 422) {
    return new DiscoveryError("invalid_request");
  }
  return new DiscoveryError("upstream_unavailable");
}

/**
 * Compose one discovery feed through the local API.
 *
 * - out-of-bounds input → `invalid_request` without a network call
 * - non-ok response → the server's flat error code (status as fallback)
 * - fetch/parse transport failure → `network` (an abort rethrows for the caller)
 * - malformed success body → `upstream_unavailable`
 */
export async function fetchDiscoveryFeed(request: DiscoveryFeedRequest): Promise<DiscoveryFeed> {
  const url = buildDiscoveryQuery(request);
  const signal = request.signal;

  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch (error) {
    // A dismissed or superseded shelf's abort is not a failure to report.
    if (signal?.aborted) throw error;
    throw new DiscoveryError("network");
  }
  if (!response.ok) {
    throw await toDiscoveryError(response);
  }
  try {
    return parseDiscoveryResponse(await response.json());
  } catch (error) {
    // A connection cut mid-body re-reads as a transport failure; parse
    // failures already carry their designed code.
    if (signal?.aborted) throw error;
    if (error instanceof DiscoveryError) throw error;
    throw new DiscoveryError("network");
  }
}
