import { createInflightDedup, createTtlCache, type InflightDedup, type TtlCache } from "./cache";
import { runChain, type ChainOptions } from "./chain";
import { filterTracks } from "./filter";
import { dedupeTracks, normalizeForDedupe, qualityScore, sortTracks } from "./score";
import type { SearchSuccess, TierOutcome } from "./types";

/**
 * The catalog entity-resolution service (ROADMAP M9; design decisions 1–3).
 *
 * One requested entity is resolved from **one** bounded provider resolution:
 * at most two curated seed queries run sequentially through the **existing**
 * `runChain` — same four tiers, same outbound limiter, same per-attempt
 * timeout, same abort propagation — and *every* view the entity page needs is
 * derived from that single result set (design decision 1: no per-facet fan-out).
 *
 * Properties this service guarantees, and the spec relies on:
 *
 * - **Bounded fan-out, and a budget that is what keeps it bounded.** A request
 *   issues at most {@link CATALOG_SEED_CAP} provider queries, they run at most
 *   {@link CATALOG_SEED_CONCURRENCY} at a time, each within
 *   {@link CATALOG_SEED_TIMEOUT_MS}, and the whole loop stops after
 *   {@link CATALOG_FEED_BUDGET_MS}. The feed budget is the load-bearing bound:
 *   two seeds at 10s each would otherwise be a 20s request, and a user opening
 *   three entity pages at once would put six chains through the shared outbound
 *   limiter, where a chain spends its own budget *before* it queues for a slot.
 *   Sequential seeds plus the feed deadline make one entity cost
 *   `seeds × per-seed budget`, never more.
 * - **One coherent result set per entity.** Popular tracks, related artists,
 *   releases, and artist artwork are all derived from the same merged tracks, so
 *   the page can never show a shelf that contradicts the track list.
 * - **Per-seed failure tolerance.** A seed whose chain is exhausted is named in
 *   `seedsFailed` and the other seed still resolves the entity; a seed the feed
 *   budget stops is named in `seedsSkipped`, which is a budget outcome and never
 *   a provider failure.
 * - **No new filtering rules.** Merged tracks go through the existing
 *   `filterTracks` / `qualityScore` / `sortTracks` / `dedupeTracks` stages, so a
 *   catalog track is scored and ordered exactly like a search or discovery one.
 * - **Honest entity identity (design decisions 2–3).** An artist request only
 *   answers with tracks that credit the requested artist, and an album request
 *   reports `metadataIncomplete` instead of passing off an unconfirmed list as a
 *   tracklist. Nothing is substituted for an entity that did not resolve.
 * - **No user data.** The request carries an entity identifier drawn from a
 *   route key — never liked tracks, playlists, or history — and nothing is
 *   stored. This module imports nothing from `@/data` at all, which is what
 *   makes that structural rather than aspirational.
 *
 * Layered exactly like the discovery service: bounded TTL result cache → in-
 * flight dedupe → the chain, with failures never cached.
 */

/**
 * The canonical track a catalog resolution returns, taken from the search
 * chain's own result type: a catalog track *is* a search track, and this module
 * deliberately never imports the domain model from the data layer.
 */
export type CatalogTrack = SearchSuccess["tracks"][number];

/** One artwork entry as the canonical `Track` carries it. */
type CatalogArtwork = CatalogTrack["artwork"][number];

/**
 * Upper bound on provider queries one entity request may issue. Two is the
 * documented ceiling from design decision 1 (`X`, `X songs`): it is enough to
 * widen one cast without turning a page into a fan-out.
 */
export const CATALOG_SEED_CAP = 2;

/**
 * How many of an entity's planned seeds may be inside the chain at the same
 * time. One (sequential) for the reason documented on the discovery service:
 * the chain starts its request budget before it awaits the shared outbound
 * limiter, so a seed that merely queued for a slot would burn its budget
 * waiting and be reported as `timeout` without any provider being asked.
 */
export const CATALOG_SEED_CONCURRENCY = 1;

/**
 * Wall-clock budget for **one seed's** chain call, overriding the chain's own
 * {@link import("./chain").REQUEST_BUDGET_MS}.
 *
 * The same value discovery uses, for the same reason: it absorbs the limiter
 * queue and still bounds a single seed.
 */
export const CATALOG_SEED_TIMEOUT_MS = 10_000;

/**
 * Wall-clock budget for **one entity's** whole seed loop, after which no further
 * seed is started and the in-flight one is cut short.
 *
 * It is the bound that actually keeps a page from fanning out: the seed cap alone
 * still allows `2 × 10s`, and a page that mounted several entity views would put
 * several such loops through one four-slot limiter. The truncated seeds are
 * reported in `seedsSkipped` rather than failing the request.
 */
export const CATALOG_FEED_BUDGET_MS = 20_000;

/**
 * Catalog-resolution cache TTL. The routes mirror it as `Cache-Control:
 * max-age`, so a repeat entity view is answered from the shared store rather
 * than re-queried (spec: a short-lived HTTP cache).
 */
export const CATALOG_CACHE_TTL_MS = 300_000;

/** Bound on cached entity resolutions (per runtime instance, best-effort). */
export const CATALOG_CACHE_MAX_ENTRIES = 60;

/** Maximum tracks one artist or similar-track request may return. */
export const CATALOG_ARTIST_TRACK_LIMIT = 20;

/** Maximum tracks one album request may return. */
export const CATALOG_ALBUM_TRACK_LIMIT = 30;

/** Maximum related artists one artist view may carry. */
export const CATALOG_RELATED_ARTIST_LIMIT = 10;

/**
 * Longest composed seed query this service will send upstream. A route key is
 * already bounded; this clips a composition such as `<artist> <title> album`
 * so no seed can grow without limit from concatenated identifier text.
 */
export const CATALOG_SEED_MAX_LENGTH = 200;

/** One planned provider attempt for an entity request. */
export interface CatalogSeed {
  /** The provider query text for this attempt. */
  query: string;
  /** What this seed is for, surfaced in tests and diagnostics narratives. */
  label?: string;
}

/**
 * Diagnostics for a catalog resolution. Consumers MUST NOT depend on these
 * fields; they are a safe subset (seed queries, tier ids and outcomes, cache
 * state) and never carry headers, keys, or raw upstream bodies.
 */
export interface CatalogDiagnostics {
  /**
   * How many seeds this request actually attempted — `seedsFailed.length` plus
   * the seeds that produced tracks. It is *not* the planned count when
   * {@link CatalogDiagnostics.seedsSkipped} is non-empty.
   */
  seedsTried: number;
  /**
   * The queries whose chain was exhausted, in attempt order. A non-empty list
   * is the spec's "one failing seed does not fail the request" signal; a list
   * holding every attempted query is the all-seeds upstream failure.
   */
  seedsFailed: string[];
  /**
   * The queries this request never got to — or never finished — because
   * {@link CATALOG_FEED_BUDGET_MS} elapsed first, in plan order.
   *
   * Deliberately distinct from {@link CatalogDiagnostics.seedsFailed}: no
   * provider was asked and none failed, so reporting a budget-skipped seed as a
   * failed seed would blame upstream for this service's own bound.
   */
  seedsSkipped: string[];
  /** Tier outcomes across every seed attempt, in attempt order. */
  tiersTried: TierOutcome[];
  /** True when the resolution was served from the TTL result cache. */
  cached: boolean;
  /** Canonical tracks in the response. */
  resultCount: number;
}

/** A person a resolved artist page links to, derived from the same result set. */
export interface CatalogArtistRef {
  id?: string;
  name: string;
  artworkUrl?: string;
  /** How many of the resolved tracks credit this artist. */
  trackCount: number;
}

/** A release the resolved tracks belong to, derived from the same result set. */
export interface CatalogReleaseRef {
  id?: string;
  title: string;
  artistName?: string;
  artworkUrl?: string;
  /** How many of the resolved tracks belong to this release. */
  trackCount: number;
}

/**
 * Why a resolution produced nothing:
 *
 * - `unresolvable` — a provider answered and nothing usable came back for the
 *   identifier (or nothing credits the requested entity). The endpoint reports
 *   404 rather than substituting a different entity.
 * - `upstream` — no provider answered at all: every seed exhausted its chain
 *   with a transport/parse failure, or the feed budget stopped them all. The
 *   endpoint reports 503.
 */
export type CatalogFailureReason = "unresolvable" | "upstream";

/** The artist identity an artist view presents. */
export interface ArtistView {
  id?: string;
  name: string;
  artworkUrl?: string;
}

/** The release metadata an album view presents. */
export interface AlbumView {
  id?: string;
  title: string;
  artistName?: string;
  artworkUrl?: string;
  year?: number;
}

/** A resolution that produced an entity view and its tracks. */
export interface ArtistSuccess {
  ok: true;
  artist: ArtistView;
  /** Canonical tracks that credit the resolved artist, in resolved order. */
  tracks: CatalogTrack[];
  related: CatalogArtistRef[];
  releases: CatalogReleaseRef[];
  diagnostics: CatalogDiagnostics;
}

/** A resolution that produced no entity view. */
export interface AlbumSuccess {
  ok: true;
  album: AlbumView;
  /** Canonical tracks in resolved order (never reordered into a tracklist). */
  tracks: CatalogTrack[];
  /**
   * `true` when no resolved track carries an album summary matching the
   * requested title (design decision 3). The caller shows an explicit notice
   * instead of presenting an unconfirmed list as a definitive tracklist.
   */
  metadataIncomplete: boolean;
  diagnostics: CatalogDiagnostics;
}

/** A similar-track resolution that produced candidates. */
export interface SimilarSuccess {
  ok: true;
  /** Candidate tracks, never including the excluded source track. */
  tracks: CatalogTrack[];
  diagnostics: CatalogDiagnostics;
}

/** A catalog resolution that produced no entity view. */
export interface CatalogFailure {
  ok: false;
  reason: CatalogFailureReason;
  diagnostics: CatalogDiagnostics;
}

/** The structured failure every resolver returns when it resolved nothing. */
export type CatalogResolution = ArtistSuccess | AlbumSuccess | SimilarSuccess | CatalogFailure;

/** How an artist entity is identified by the caller. */
export interface ArtistRequest {
  /** Artist name, matched case/punctuation-insensitively against credits. */
  name?: string;
  /** Provider entity id, used as the query term when no name was given. */
  id?: string;
  /** Maximum tracks to return (defaults to {@link CATALOG_ARTIST_TRACK_LIMIT}). */
  limit?: number;
  /** Incoming request's abort signal — cancellation propagates upstream. */
  signal?: AbortSignal;
}

/** How an album entity is identified by the caller. */
export interface AlbumRequest {
  /** Release title, matched case/punctuation-insensitively against summaries. */
  title?: string;
  /** Optional artist narrowing, folded into the composed seeds. */
  artist?: string;
  /** Provider entity id; also the album id the view reports back. */
  id?: string;
  /** Maximum tracks to return (defaults to {@link CATALOG_ALBUM_TRACK_LIMIT}). */
  limit?: number;
  /** Incoming request's abort signal — cancellation propagates upstream. */
  signal?: AbortSignal;
}

/** How similar tracks are identified by the caller. */
export interface SimilarRequest {
  /** The source track's public title (never its local record). */
  title: string;
  /** Optional artist narrowing, folded into the composed seeds. */
  artist?: string;
  /** Source track id — a candidate with this `id`/`providerId` is dropped. */
  exclude?: string;
  /** Maximum candidates to return (defaults to the artist track limit). */
  limit?: number;
  /** Incoming request's abort signal — cancellation propagates upstream. */
  signal?: AbortSignal;
}

/** Chain options for one entity request, plus the service's own feed budget. */
export interface CatalogOptions extends ChainOptions {
  /** Total wall-clock budget for the seed loop (tests use short values). */
  feedBudgetMs?: number;
}

/** Cache/dedup key: the normalized artist identifier plus the track limit. */
export function artistCacheKey(request: ArtistRequest): string {
  return `artist:${normalizedKey(request.name)}|${normalizedKey(request.id)}|${request.limit ?? CATALOG_ARTIST_TRACK_LIMIT}`;
}

/** Cache/dedup key: the normalized release identifier plus the track limit. */
export function albumCacheKey(request: AlbumRequest): string {
  return `album:${normalizedKey(request.title)}|${normalizedKey(request.artist)}|${normalizedKey(request.id)}|${request.limit ?? CATALOG_ALBUM_TRACK_LIMIT}`;
}

/** Cache/dedup key: the source track, its exclusion, and the candidate limit. */
export function similarCacheKey(request: SimilarRequest): string {
  return `similar:${normalizedKey(request.title)}|${normalizedKey(request.artist)}|${normalizedKey(request.exclude)}|${request.limit ?? CATALOG_ARTIST_TRACK_LIMIT}`;
}

/** Normalized, whitespace-collapsed identifier text for cache keys. */
function normalizedKey(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The caller's identifier, trimmed, or `undefined` when it was absent or blank.
 *
 * Every resolver reads its inputs through this one gate, so a whitespace-only
 * route key is "no key" everywhere instead of a seed that queries for nothing.
 */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/** Trim, collapse whitespace, clip to length, and drop empties from a plan. */
function normalizeSeedPlan(planned: readonly (CatalogSeed | null)[]): CatalogSeed[] {
  const seeds: CatalogSeed[] = [];
  const seen = new Set<string>();
  for (const seed of planned) {
    if (seed === null) continue;
    const query = seed.query.trim().replace(/\s+/g, " ").slice(0, CATALOG_SEED_MAX_LENGTH);
    if (query.length === 0) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    seeds.push({ query, ...(seed.label !== undefined ? { label: seed.label } : {}) });
    if (seeds.length === CATALOG_SEED_CAP) break;
  }
  return seeds;
}

/**
 * Plan an artist request's provider attempts (design decision 1): the name
 * itself and `<name> songs`. An id-only request — a route key that looked like a
 * provider entity id — plans a single seed using that id as the query term,
 * because no tier exposes a channel/browse capability to ask instead.
 */
export function planArtistSeeds(request: ArtistRequest): CatalogSeed[] {
  const name = request.name?.trim();
  if (name !== undefined && name.length > 0) {
    return normalizeSeedPlan([
      { query: name, label: "artist" },
      { query: `${name} songs`, label: "artist songs" },
    ]);
  }
  const id = request.id?.trim();
  if (id === undefined || id.length === 0) return [];
  return normalizeSeedPlan([{ query: id, label: "artist id" }]);
}

/**
 * Plan an album request's provider attempts: `<title>` and `<title> album`, or
 * `<artist> <title>` and `<title> <artist> album` when the caller narrowed the
 * request to an artist. An absent title plans nothing — the id-only case is
 * folded into the title by {@link resolveAlbum} so this planner stays a pure
 * function of the release's own text.
 */
export function planAlbumSeeds(request: AlbumRequest): CatalogSeed[] {
  const title = request.title?.trim();
  if (title === undefined || title.length === 0) return [];
  const artist = request.artist?.trim();
  if (artist === undefined || artist.length === 0) {
    return normalizeSeedPlan([
      { query: title, label: "album" },
      { query: `${title} album`, label: "album title" },
    ]);
  }
  return normalizeSeedPlan([
    { query: `${artist} ${title}`, label: "album artist title" },
    { query: `${title} ${artist} album`, label: "album title artist" },
  ]);
}

/**
 * Plan a similar-track request's provider attempts: the source track's
 * `artist title` identity and the same text framed as a similarity query.
 */
export function planSimilarSeeds(request: SimilarRequest): CatalogSeed[] {
  const title = request.title.trim();
  if (title.length === 0) return [];
  const artist = request.artist?.trim();
  if (artist === undefined || artist.length === 0) {
    return normalizeSeedPlan([
      { query: title, label: "similar title" },
      { query: `${title} similar`, label: "similar title query" },
    ]);
  }
  return normalizeSeedPlan([
    { query: `${artist} ${title}`, label: "similar artist title" },
    { query: `${artist} ${title} similar`, label: "similar artist title query" },
  ]);
}

/**
 * Whether a credited artist string is the same artist as the requested name.
 *
 * Case- and punctuation-insensitive (it reuses the shared dedupe
 * normalization), and it also matches a credit that *begins* with the requested
 * name followed by a separator — providers present `"Daft Punk feat. Pharrell"`
 * or `"Radiohead - Live at Glastonbury"` as the channel for a track that plainly
 * belongs to the requested artist. The separator requirement keeps it narrow:
 * `"Boards of Canada"` never matches a request for `"Bo"`.
 */
function creditsArtist(credited: string, requested: string): boolean {
  const left = normalizeForDedupe(credited);
  const right = normalizeForDedupe(requested);
  if (left.length === 0 || right.length === 0) return false;
  return left === right || left.startsWith(`${right} `);
}

/** Whether a track credits `artistName` under the documented matching rule. */
function trackCredits(track: CatalogTrack, artistName: string): boolean {
  return track.artists.some((artist) => creditsArtist(artist.name, artistName));
}

/** Rendered pixel area of one artwork entry, defaulting to 0 when unknown. */
function artworkArea(artwork: CatalogArtwork): number {
  return (artwork.width ?? 0) * (artwork.height ?? 0);
}

/**
 * The best artwork across `artworks`: the largest rendered area, ties keeping
 * input order (which is the resolved order, so the result is deterministic).
 */
function bestArtworkUrl(artworks: readonly CatalogArtwork[]): string | undefined {
  let best: CatalogArtwork | undefined;
  for (const artwork of artworks) {
    if (artwork.url.length === 0) continue;
    if (best === undefined || artworkArea(artwork) > artworkArea(best)) best = artwork;
  }
  return best?.url;
}

/**
 * The best artwork among the tracks crediting `artistName`, or `undefined` when
 * no such track carries one (the design records that the artist hero falls back
 * to a placeholder — channel avatars are rarely present in search results).
 */
export function bestArtistArtwork(artistName: string, tracks: CatalogTrack[]): string | undefined {
  const credited = tracks.filter((track) => trackCredits(track, artistName));
  return bestArtworkUrl(credited.flatMap((track) => track.artwork));
}

/**
 * Related artists: every non-primary artist credited across `tracks`, ranked by
 * how many resolved tracks credit them (descending) and then by first appearance
 * (design decision 1), capped at `limit`.
 *
 * Deterministic by construction — no score, no randomness, stable input order —
 * and it excludes the primary artist under the same matching rule used
 * everywhere else, so `"Daft Punk feat. Pharrell"` credits do not turn the
 * primary into its own related artist.
 */
export function deriveRelatedArtists(
  primaryName: string,
  tracks: CatalogTrack[],
  limit: number = CATALOG_RELATED_ARTIST_LIMIT,
): CatalogArtistRef[] {
  interface Tally {
    name: string;
    id?: string;
    trackCount: number;
    firstIndex: number;
    artwork: CatalogArtwork[];
  }

  const tallies = new Map<string, Tally>();
  tracks.forEach((track, trackIndex) => {
    // A credit repeated inside one track's artist list is still one track.
    const credited = new Map<string, CatalogTrack["artists"][number]>();
    for (const artist of track.artists) {
      const key = normalizeForDedupe(artist.name);
      if (key.length === 0 || creditsArtist(artist.name, primaryName)) continue;
      if (!credited.has(key)) credited.set(key, artist);
    }
    for (const [key, artist] of credited) {
      const existing = tallies.get(key);
      if (existing === undefined) {
        tallies.set(key, {
          name: artist.name,
          ...(artist.id !== undefined ? { id: artist.id } : {}),
          trackCount: 1,
          firstIndex: trackIndex,
          artwork: [...track.artwork],
        });
        continue;
      }
      existing.trackCount += 1;
      if (existing.id === undefined && artist.id !== undefined) existing.id = artist.id;
      existing.artwork.push(...track.artwork);
    }
  });

  const ranked = [...tallies.values()].sort(
    (a, b) => b.trackCount - a.trackCount || a.firstIndex - b.firstIndex,
  );

  return ranked.slice(0, Math.max(0, limit)).map((tally) => {
    const artworkUrl = bestArtworkUrl(tally.artwork);
    return {
      ...(tally.id !== undefined ? { id: tally.id } : {}),
      name: tally.name,
      ...(artworkUrl !== undefined ? { artworkUrl } : {}),
      trackCount: tally.trackCount,
    };
  });
}

/**
 * Releases: the resolved tracks grouped by album summary title (tracks with no
 * album summary belong to no release and are skipped), ordered by how many
 * resolved tracks each release holds (descending) and then by title ascending.
 *
 * A release's artwork is the best artwork among its member tracks, which is the
 * only artwork a search-derived resolution can honestly offer — providers expose
 * no album-artwork endpoint, so it is a member's thumbnail or nothing.
 */
export function deriveReleases(tracks: CatalogTrack[]): CatalogReleaseRef[] {
  interface Group {
    title: string;
    id?: string;
    artistName?: string;
    trackCount: number;
    artwork: CatalogArtwork[];
  }

  const groups = new Map<string, Group>();
  for (const track of tracks) {
    const album = track.album;
    if (album === undefined) continue;
    const key = normalizeForDedupe(album.title);
    if (key.length === 0) continue;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        title: album.title,
        ...(album.id !== undefined ? { id: album.id } : {}),
        ...(track.artists[0] !== undefined ? { artistName: track.artists[0].name } : {}),
        trackCount: 1,
        artwork: [...track.artwork],
      });
      continue;
    }
    existing.trackCount += 1;
    if (existing.id === undefined && album.id !== undefined) existing.id = album.id;
    existing.artwork.push(...track.artwork);
  }

  return [...groups.values()]
    .sort((a, b) => b.trackCount - a.trackCount || compareTitles(a.title, b.title))
    .map((group) => {
      const artworkUrl = bestArtworkUrl(group.artwork);
      return {
        ...(group.id !== undefined ? { id: group.id } : {}),
        title: group.title,
        ...(group.artistName !== undefined ? { artistName: group.artistName } : {}),
        ...(artworkUrl !== undefined ? { artworkUrl } : {}),
        trackCount: group.trackCount,
      };
    });
}

/** Locale-independent title ordering, so release order never varies by host. */
function compareTitles(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** The most frequent non-empty `pick`ed string, ties keeping input order. */
function dominantText<T>(
  values: readonly T[],
  pick: (value: T) => string | undefined,
): string | undefined {
  const counts = new Map<string, { value: string; count: number }>();
  for (const value of values) {
    const picked = pick(value);
    if (picked === undefined) continue;
    const key = normalizeForDedupe(picked);
    if (key.length === 0) continue;
    const existing = counts.get(key);
    if (existing === undefined) counts.set(key, { value: picked, count: 1 });
    else existing.count += 1;
  }
  let best: { value: string; count: number } | undefined;
  for (const entry of counts.values()) {
    if (best === undefined || entry.count > best.count) best = entry;
  }
  return best?.value;
}

/** Whether any resolved track carries an album summary matching `title`. */
function hasMatchingAlbum(tracks: CatalogTrack[], title: string): boolean {
  return tracks.some((track) => albumMatches(track, title));
}

/** Whether a track's album summary is the requested release. */
function albumMatches(track: CatalogTrack, title: string): boolean {
  const wanted = normalizeForDedupe(title);
  if (wanted.length === 0) return false;
  return track.album !== undefined && normalizeForDedupe(track.album.title) === wanted;
}

/** The album id the given tracks agree on, or `undefined` when none carries one. */
function dominantAlbumId(tracks: CatalogTrack[]): string | undefined {
  return dominantText(tracks, (track) => track.album?.id);
}

/** Empty diagnostics for a request that never reached a provider. */
function freshDiagnostics(): CatalogDiagnostics {
  return {
    seedsTried: 0,
    seedsFailed: [],
    seedsSkipped: [],
    tiersTried: [],
    cached: false,
    resultCount: 0,
  };
}

/**
 * Whether a resolution that produced nothing should be reported as an upstream
 * failure rather than as an unresolvable entity.
 *
 * `unresolvable` means a provider *answered* and carried nothing usable — the
 * chain records that as a tier `empty` outcome, which is a different fact from
 * a tier that never answered. Everything else (only transport/parse failures,
 * or no attempt at all because the feed budget stopped the loop) is `upstream`,
 * because in that case the identifier was never actually tested.
 */
function isUpstreamFailure(diagnostics: CatalogDiagnostics): boolean {
  if (diagnostics.tiersTried.length === 0) return true;
  return diagnostics.tiersTried.every(
    (entry) => entry.outcome !== "empty" && entry.outcome !== "ok",
  );
}

/** One seed's chain outcome; a `null` result means the chain itself threw. */
interface SeedAttempt {
  seed: CatalogSeed;
  result: Awaited<ReturnType<typeof runChain>> | null;
}

/**
 * Run one entity's planned seeds sequentially through the existing chain and
 * merge them into one canonical track set.
 *
 * Mirrors the discovery service's bound structure exactly: a feed-level
 * `AbortSignal.timeout`, the caller's abort folded in with
 * `AbortSignal.any`, at most {@link CATALOG_SEED_CONCURRENCY} chains in flight,
 * a per-seed budget of {@link CATALOG_SEED_TIMEOUT_MS}, and a plan-ordered merge
 * so the diagnostics and the resulting order do not depend on which seed
 * settled first. Only caller cancellation escapes; any other per-seed failure
 * degrades into `seedsFailed`, and a seed the feed budget stops is reported in
 * `seedsSkipped`.
 */
async function runSeeds(
  seeds: readonly CatalogSeed[],
  limit: number,
  signal: AbortSignal | undefined,
  options: CatalogOptions,
  diagnostics: CatalogDiagnostics,
): Promise<CatalogTrack[]> {
  if (seeds.length === 0) return [];

  const seedBudgetMs = options.budgetMs ?? CATALOG_SEED_TIMEOUT_MS;
  // The entity's own wall clock: it decides how long this resolution may keep
  // *starting* seeds, and it is the only reason a planned seed can go
  // unattempted.
  const feedSignal = AbortSignal.timeout(options.feedBudgetMs ?? CATALOG_FEED_BUDGET_MS);
  // A seed dies with the entity, so one slow seed cannot overrun the feed
  // budget by its own budget on top of it.
  const seedSignal = signal ? AbortSignal.any([signal, feedSignal]) : feedSignal;

  // Indexed by plan position so the merge stays in plan order regardless of
  // which worker finished first: `undefined` means "never attempted".
  const attempts: Array<SeedAttempt | undefined> = new Array<SeedAttempt | undefined>(seeds.length);
  let nextSeed = 0;
  let stopped = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextSeed;
      nextSeed += 1;
      if (index >= seeds.length || stopped) return;
      // The feed budget is spent: this seed is never attempted, so it cannot be
      // reported as a provider failure.
      if (feedSignal.aborted) return;
      const seed = seeds[index];
      try {
        attempts[index] = {
          seed,
          result: await runChain(
            { query: seed.query, limit, signal: seedSignal },
            { ...options, budgetMs: seedBudgetMs },
          ),
        };
      } catch (error) {
        // Only caller cancellation escapes the chain; re-throw it so the route
        // can answer 499, and stop the remaining workers from starting seeds.
        if (signal?.aborted) {
          stopped = true;
          throw signal.reason ?? error;
        }
        // The feed's own deadline cut the seed short: a budget outcome, not an
        // upstream failure, so it is reported as skipped rather than failed.
        if (feedSignal.aborted) {
          stopped = true;
          return;
        }
        attempts[index] = { seed, result: null };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(CATALOG_SEED_CONCURRENCY, seeds.length)) }, () =>
      worker(),
    ),
  );

  const scored: CatalogTrack[] = [];
  for (const [index, attempt] of attempts.entries()) {
    const seed = seeds[index];
    if (attempt === undefined) {
      diagnostics.seedsSkipped.push(seed.query);
      continue;
    }
    if (attempt.result === null) {
      diagnostics.seedsFailed.push(seed.query);
      continue;
    }
    // Tier outcomes are recorded for *every* attempt, successful or not: the
    // all-seeds-failed path is exactly where they are worth having. The chain
    // carries them under `diagnostics` on success and at the top level on
    // failure, so both shapes are read here.
    diagnostics.tiersTried.push(
      ...(attempt.result.ok ? attempt.result.diagnostics.tiersTried : attempt.result.tiersTried),
    );
    if (!attempt.result.ok) {
      diagnostics.seedsFailed.push(seed.query);
      continue;
    }
    for (const track of attempt.result.tracks) {
      // Quality is scored against the seed that produced the track (the same
      // query the chain used), so a merged entity set is ordered exactly like
      // one search result.
      scored.push({ ...track, qualityScore: qualityScore(track, seed.query) });
    }
  }
  diagnostics.seedsTried = seeds.length - diagnostics.seedsSkipped.length;

  const tracks = dedupeTracks(sortTracks(filterTracks(scored))).slice(0, limit);
  diagnostics.resultCount = tracks.length;
  return tracks;
}

/** Per-resolver cache + in-flight dedupe state. */
export interface ResolverDeps<S extends ArtistSuccess | AlbumSuccess | SimilarSuccess> {
  cache: TtlCache<S>;
  inflight: InflightDedup<S | CatalogFailure>;
}

/** The service state {@link resolveArtist} and its siblings share. */
export interface CatalogDeps {
  artist: ResolverDeps<ArtistSuccess>;
  album: ResolverDeps<AlbumSuccess>;
  similar: ResolverDeps<SimilarSuccess>;
  /** Chain options applied to every seed's `runChain` call (tests inject tiers). */
  chainOptions?: CatalogOptions;
}

const defaultArtistCache = createTtlCache<ArtistSuccess>({
  ttlMs: CATALOG_CACHE_TTL_MS,
  maxEntries: CATALOG_CACHE_MAX_ENTRIES,
});
const defaultAlbumCache = createTtlCache<AlbumSuccess>({
  ttlMs: CATALOG_CACHE_TTL_MS,
  maxEntries: CATALOG_CACHE_MAX_ENTRIES,
});
const defaultSimilarCache = createTtlCache<SimilarSuccess>({
  ttlMs: CATALOG_CACHE_TTL_MS,
  maxEntries: CATALOG_CACHE_MAX_ENTRIES,
});

/** The process-wide service state the routes use (documented shared state). */
export const defaultCatalogDeps: CatalogDeps = {
  artist: { cache: defaultArtistCache, inflight: createInflightDedup() },
  album: { cache: defaultAlbumCache, inflight: createInflightDedup() },
  similar: { cache: defaultSimilarCache, inflight: createInflightDedup() },
};

/**
 * Run one entity resolution through cache → dedup → composition. Successes are
 * cached for {@link CATALOG_CACHE_TTL_MS} and reported with `cached: true`;
 * failures are never cached, so a retry re-queries upstream.
 */
async function runCached<S extends ArtistSuccess | AlbumSuccess | SimilarSuccess>(
  state: ResolverDeps<S>,
  key: string,
  compose: () => Promise<S | CatalogFailure>,
): Promise<S | CatalogFailure> {
  const cached = state.cache.get(key);
  if (cached) {
    return { ...cached, diagnostics: { ...cached.diagnostics, cached: true } };
  }
  return state.inflight.run(key, async () => {
    const result = await compose();
    if (result.ok) state.cache.set(key, result);
    return result;
  });
}

/**
 * Resolve an artist by name or by provider entity id and derive the whole
 * artist view — identity, popular tracks, related artists, releases — from that
 * one bounded resolution (design decision 1).
 *
 * A name-keyed request answers only with tracks that credit the requested
 * artist, so a search that returned somebody else's upload is reported
 * unresolvable instead of being presented as this artist's catalogue. An
 * id-keyed request cannot be verified that way (no tier exposes a channel
 * lookup), so its merged result set is used as resolved and the identity is read
 * from the credits themselves.
 */
export async function resolveArtist(
  request: ArtistRequest,
  deps: CatalogDeps = defaultCatalogDeps,
): Promise<ArtistSuccess | CatalogFailure> {
  return runCached(deps.artist, artistCacheKey(request), async () => {
    const limit = request.limit ?? CATALOG_ARTIST_TRACK_LIMIT;
    const diagnostics = freshDiagnostics();
    const seeds = planArtistSeeds(request);
    const merged = await runSeeds(
      seeds,
      limit,
      request.signal,
      deps.chainOptions ?? {},
      diagnostics,
    );
    if (merged.length === 0) {
      return { ok: false, reason: reasonFor(diagnostics, seeds), diagnostics };
    }

    const requestedName = present(request.name);
    const requestedId = present(request.id);
    const tracks =
      requestedName !== undefined
        ? merged.filter((track) => trackCredits(track, requestedName))
        : merged;
    if (tracks.length === 0) {
      // A provider answered with tracks, but none of them credit the requested
      // artist: this entity did not resolve, and nothing may stand in for it.
      return { ok: false, reason: "unresolvable", diagnostics };
    }
    diagnostics.resultCount = tracks.length;

    // The requested name *is* the identity. An id-keyed request has no text to
    // report, so the identity is read from the credits the chain returned — the
    // most-credited artist of its own result set, ties keeping resolved order.
    const name = requestedName ?? dominantText(tracks, (track) => track.artists[0]?.name) ?? "";
    const id =
      requestedId ??
      tracks.flatMap((track) => track.artists).find((artist) => artist.id !== undefined)?.id;
    const artworkUrl = bestArtistArtwork(name, tracks);

    return {
      ok: true,
      artist: {
        ...(id !== undefined ? { id } : {}),
        name,
        ...(artworkUrl !== undefined ? { artworkUrl } : {}),
      },
      tracks,
      related: deriveRelatedArtists(name, tracks),
      releases: deriveReleases(tracks),
      diagnostics,
    };
  });
}

/**
 * Resolve an album (or any release) by title, optionally narrowed by artist,
 * and report whether album metadata was actually confirmed for the tracks that
 * came back (design decision 3).
 *
 * The tracks are returned in resolved order and are never reordered into a
 * tracklist: search-derived releases are frequently an approximation, and
 * `metadataIncomplete` is how the caller learns that instead of guessing. An
 * id-only request is folded into the title here so the planner stays a pure
 * function of the release's own text.
 */
export async function resolveAlbum(
  request: AlbumRequest,
  deps: CatalogDeps = defaultCatalogDeps,
): Promise<AlbumSuccess | CatalogFailure> {
  return runCached(deps.album, albumCacheKey(request), async () => {
    const limit = request.limit ?? CATALOG_ALBUM_TRACK_LIMIT;
    const diagnostics = freshDiagnostics();
    const requestedTitle = present(request.title);
    const requestedArtist = present(request.artist);
    const requestedId = present(request.id);
    // No tier exposes an album/browse lookup, so an id-keyed request is asked
    // with the id as its query term, exactly as an id-keyed artist request is.
    const title = requestedTitle ?? requestedId ?? "";
    const seeds = planAlbumSeeds({
      title,
      ...(requestedArtist !== undefined ? { artist: requestedArtist } : {}),
    });
    const tracks = await runSeeds(
      seeds,
      limit,
      request.signal,
      deps.chainOptions ?? {},
      diagnostics,
    );
    if (tracks.length === 0) {
      return { ok: false, reason: reasonFor(diagnostics, seeds), diagnostics };
    }

    // The tracks whose album summary *confirms* the requested title. Everything
    // else the search returned still travels in `tracks` — the resolution is
    // never silently narrowed into a fabricated tracklist — but it is never used
    // as the release's own metadata (design decision 3).
    const confirmed =
      requestedTitle !== undefined
        ? tracks.filter((track) => albumMatches(track, requestedTitle))
        : tracks.filter((track) => track.album !== undefined);

    const album: AlbumView = {
      title,
      ...(requestedId !== undefined ? { id: requestedId } : {}),
      ...(requestedArtist !== undefined ? { artistName: requestedArtist } : {}),
    };
    const id = requestedId ?? dominantAlbumId(confirmed);
    if (id !== undefined) album.id = id;
    const artistName = requestedArtist ?? dominantText(tracks, (track) => track.artists[0]?.name);
    if (artistName !== undefined) album.artistName = artistName;
    // Only a *confirmed* member's artwork becomes the release's cover: an
    // unconfirmed search hit's thumbnail is somebody else's picture, and
    // presenting it as this album's art would be the same fabricated authority
    // the incompleteness flag exists to prevent.
    const artworkUrl = bestArtworkUrl(confirmed.flatMap((track) => track.artwork));
    if (artworkUrl !== undefined) album.artworkUrl = artworkUrl;

    return {
      ok: true,
      album,
      tracks,
      // No requested title, or no resolved track carries an album summary
      // matching it (case/punctuation-insensitive) — the caller must say so
      // rather than present the list as a definitive tracklist.
      metadataIncomplete: requestedTitle === undefined || !hasMatchingAlbum(tracks, requestedTitle),
      diagnostics,
    };
  });
}

/**
 * Resolve similar-track candidates for a track's public `title`/`artist`, and
 * never return the source track itself: a candidate whose `id` *or* `providerId`
 * equals the excluded track is dropped after the merge, so neither the
 * `youtube:<id>` canonical id nor a bare video id can leak back in.
 */
export async function resolveSimilar(
  request: SimilarRequest,
  deps: CatalogDeps = defaultCatalogDeps,
): Promise<SimilarSuccess | CatalogFailure> {
  return runCached(deps.similar, similarCacheKey(request), async () => {
    const limit = request.limit ?? CATALOG_ARTIST_TRACK_LIMIT;
    const diagnostics = freshDiagnostics();
    const seeds = planSimilarSeeds(request);
    const merged = await runSeeds(
      seeds,
      limit,
      request.signal,
      deps.chainOptions ?? {},
      diagnostics,
    );
    if (merged.length === 0) {
      return { ok: false, reason: reasonFor(diagnostics, seeds), diagnostics };
    }

    const exclude = present(request.exclude);
    const tracks =
      exclude === undefined
        ? merged
        : merged.filter((track) => track.id !== exclude && track.providerId !== exclude);
    if (tracks.length === 0) {
      return { ok: false, reason: "unresolvable", diagnostics };
    }
    diagnostics.resultCount = tracks.length;
    return { ok: true, tracks, diagnostics };
  });
}

/** Classify a seed loop that produced no tracks. */
function reasonFor(
  diagnostics: CatalogDiagnostics,
  seeds: readonly CatalogSeed[],
): CatalogFailureReason {
  if (seeds.length === 0) return "unresolvable";
  return isUpstreamFailure(diagnostics) ? "upstream" : "unresolvable";
}
