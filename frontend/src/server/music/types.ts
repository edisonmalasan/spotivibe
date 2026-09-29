import type { Track } from "@/data/repositories";

/**
 * Shared server-side types for the music provider layer (ROADMAP M3).
 *
 * The pipeline is two-stage (design.md decision 1): each tier parses its raw
 * upstream response into {@link ProviderCandidate}s (Spotivibe-owned, never
 * renderer shapes), and one shared normalizer converts candidates into
 * canonical {@link Track}s. Nothing here crosses the HTTP boundary except
 * `Track` and the safe diagnostics subset.
 */

/**
 * Discovery tiers in fixed fallback order (ROADMAP §7.2:
 * YouTube Music Innertube → YouTube Web Innertube → Invidious → Piped).
 */
export type TierId = "ytmusic" | "ytweb" | "invidious" | "piped";

/** Tier ids in chain order — the orchestrator iterates this. */
export const TIER_ORDER: readonly TierId[] = ["ytmusic", "ytweb", "invidious", "piped"];

/**
 * Why a tier attempt failed (spec: failure taxonomy).
 *
 * `unavailable` is playlist-import only (design decision 9): a tier reached
 * YouTube and received a definitive "this playlist is private/deleted/not
 * found" answer — retrying other tiers cannot change it, so the chain stops.
 */
export type ProviderFailureKind =
  "timeout" | "network" | "http" | "parse" | "empty" | "unavailable";

/** An artwork candidate as offered by a tier; normalization picks the best. */
export interface ArtworkCandidate {
  url: string;
  width?: number;
  height?: number;
}

/**
 * Tier-specific parse output: the minimal common shape every provider can
 * produce. Deliberately not a `Track` — normalization/filtering/scoring are
 * shared, centralized stages that must behave identically for every tier.
 */
export interface ProviderCandidate {
  /** The YouTube video ID — the playback identity (ROADMAP §8.1). */
  videoId: string;
  title: string;
  /** Channel/artist display text exactly as the tier presented it. */
  artistText?: string;
  /** Channel id when the tier provides one. */
  artistId?: string;
  /** Album title when the tier provides one (e.g. the YTMusic album run). */
  albumTitle?: string;
  /** Album id when the tier provides one. */
  albumId?: string;
  /** Artwork candidates of any size; normalization selects the largest. */
  artwork: ArtworkCandidate[];
  /** Seconds, only when the tier presented a parsable duration. */
  durationSeconds?: number;
  /** Explicit category marker when the tier provides one. */
  categoryHint?: "music" | "podcast";
  /** Producing tier (kept through normalization for diagnostics/scoring). */
  tier: TierId;
}

/** Per-tier outcome recorded in diagnostics (safe subset — no secrets). */
export interface TierOutcome {
  tier: TierId;
  outcome: "ok" | "skipped" | ProviderFailureKind;
}

/**
 * Diagnostics metadata returned alongside tracks. Consumers MUST NOT depend
 * on these fields (spec: search API contract); they never contain headers,
 * keys, instance credentials, or raw upstream bodies.
 */
export interface SearchDiagnostics {
  /** Tier that produced the returned tracks. */
  tier?: TierId;
  tiersTried: TierOutcome[];
  cached: boolean;
  resultCount: number;
}

export interface SearchSuccess {
  ok: true;
  tracks: Track[];
  diagnostics: SearchDiagnostics;
}

export interface SearchFailure {
  ok: false;
  tiersTried: TierOutcome[];
}

export type SearchResult = SearchFailure | SearchSuccess;

/** What the route layer hands to the search service. */
export interface SearchRequest {
  query: string;
  limit: number;
  /** Incoming request's abort signal — cancellation propagates upstream. */
  signal?: AbortSignal;
  /**
   * Per-attempt upstream timeout. Set by the chain from its configured
   * budget; absent means the tier default.
   */
  timeoutMs?: number;
}

/**
 * One discovery tier. Implementations live in `src/server/music/providers/`
 * and are server-only: UI code imports none of this (spec: UI code carries no
 * provider types).
 */
export interface MusicProvider {
  readonly id: TierId;
  /**
   * Query this tier and return parseable candidates.
   *
   * @throws {ProviderError} with a failure kind on transport/parse failure.
   * @returns an empty array when the response parsed but carried no items.
   */
  search(request: SearchRequest): Promise<ProviderCandidate[]>;
}

/* ------------------------------------------------------------------ *
 * Playlist import (ROADMAP M7, design decision 9).
 * ------------------------------------------------------------------ */

/**
 * Documented import cap: at most 500 entries are resolved per playlist
 * (bounded serverless work; the response is marked `truncated` when more
 * existed — design decision 9).
 */
export const PLAYLIST_ENTRY_CAP = 500;

/**
 * One playlist row: a candidate, or `null` for a row that exists upstream but
 * cannot become a `Track` (unavailable/unnormalizable video). Nulls are
 * skipped and counted as `skipped` — they are content the source listed, not
 * absent content (design decision 9).
 */
export type PlaylistEntry = ProviderCandidate | null;

/** What one tier's playlist resolver produced (raw entries, source order). */
export interface PlaylistResolution {
  title: string;
  description?: string;
  /** In source order, at most {@link PLAYLIST_ENTRY_CAP} entries. */
  entries: PlaylistEntry[];
  /** More entries existed beyond the cap (design decision 9). */
  truncated: boolean;
}

/** What the chain hands one playlist resolver. */
export interface PlaylistRequest {
  playlistId: string;
  /** Incoming request's abort signal — cancellation propagates upstream. */
  signal?: AbortSignal;
  /**
   * Per-attempt upstream timeout. Set by the chain from its configured
   * value; absent means the tier default.
   */
  timeoutMs?: number;
}

/**
 * One playlist resolution tier. Implementations live beside their search
 * counterparts in `src/server/music/providers/` and are server-only.
 */
export interface PlaylistResolver {
  readonly id: TierId;
  /**
   * Fetch and parse one playlist, following continuations up to
   * {@link PLAYLIST_ENTRY_CAP}.
   *
   * @throws {ProviderError} — kind `unavailable` is a definitive
   * private/deleted/not-found answer (stops the chain); every other kind is
   * a transport/parse failure (the chain falls through to the next tier).
   */
  resolvePlaylist(request: PlaylistRequest): Promise<PlaylistResolution>;
}

/** Diagnostics for a playlist resolution — tier ids/outcomes only. */
export interface PlaylistDiagnostics {
  tiers: TierOutcome[];
}

export interface PlaylistSuccess {
  ok: true;
  playlist: {
    title: string;
    description?: string;
    /** Canonical tracks — no provider shapes, no quality scoring (design decision 9). */
    tracks: Track[];
    /** Source entries that could not become tracks (unavailable/unnormalizable). */
    skipped: number;
    /** Present only when the 500-entry cap cut the playlist short. */
    truncated?: boolean;
  };
  diagnostics: PlaylistDiagnostics;
}

export interface PlaylistFailure {
  ok: false;
  /** `unavailable` → 404; `upstream` → 503 (design decision 9). */
  reason: "unavailable" | "upstream";
  tiers: TierOutcome[];
}

export type PlaylistResult = PlaylistFailure | PlaylistSuccess;
