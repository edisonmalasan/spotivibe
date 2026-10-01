import {
  createInflightDedup,
  createTtlCache,
  type InflightDedup,
  type TtlCache,
} from "@/server/music/cache";
import { fetchJson, HttpFetchError } from "@/server/http/fetchJson";

/**
 * The lyrics resolution service (ROADMAP M16, spec `lyrics` — "Lyrics are resolved for the
 * active track").
 *
 * Lyrix's `lyricsService.ts` holds the part of this that is genuinely load-bearing: YouTube
 * titles are noisy, LRCLIB indexes by metadata rather than by video id, so a title that still
 * reads "[Official Video]" does not match. Its `cleanTitle` and `splitArtistTitle` are the
 * accumulated result of that problem and are ported here in behaviour.
 *
 * Three things are **not** ported, and the difference is the point of this module:
 *
 * - **No database.** Lyrix caches lyrics in Prisma. Spotivibe has no server-side store, and
 *   adding one to hold a derived, reproducible value would be the most invasive thing this
 *   milestone could do. The existing `createTtlCache` and `createInflightDedup` are per-instance
 *   and best-effort, which is the right trade: a cold instance re-fetches and loses nothing.
 * - **One query, not two.** Lyrix runs a structured `track_name`+`artist_name` search and a
 *   free-text `q` search concurrently via `Promise.allSettled`. Two requests per lookup doubles
 *   provider load for a marginal recall gain, against a free service that asks clients to be
 *   polite. M3 established a shared outbound limiter and per-attempt timeout; this inherits both
 *   through `fetchJson` rather than bypassing them.
 * - **A miss is a distinct outcome from a failure.** "This track has no lyrics" is a fact about
 *   the track; "we could not reach the provider" is a fact about the network. Collapsing them
 *   would both mislead the listener and poison the cache — a transient outage cached as a
 *   permanent miss would hide lyrics for a week.
 */

/** LRCLIB's public search API. No key, no account, no quota to hold. */
const LRCLIB_SEARCH = "https://lrclib.net/api/search";

/** Identifying this client is what LRCLIB asks for, and it costs nothing. */
const LRCLIB_USER_AGENT = "Spotivibe/1.0 (personal, local-first music player)";

/** Per-attempt timeout, matching the provider layer's other bounded calls. */
export const LYRICS_TIMEOUT_MS = 5_000;

/** A hit is worth keeping longer than a miss is worth trusting. */
export const LYRICS_HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LYRICS_MISS_TTL_MS = 24 * 60 * 60 * 1000;

/** Bounded so a pathological provider response cannot grow the cache without limit. */
const LYRICS_CACHE_MAX_ENTRIES = 256;

/** One candidate as LRCLIB returns it. Only the fields this service reads. */
interface LrcLibCandidate {
  trackName?: string;
  artistName?: string;
  duration?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

/** What the service resolved: the provider's raw strings, plus where they came from. */
export interface LyricsHit {
  /** The provider's LRC text, or `null`. Parsing is the client's concern. */
  syncedLyrics: string | null;
  /** The provider's untimed text, or `null`. */
  plainLyrics: string | null;
  source: "lrclib";
}

export type LyricsResult =
  | { kind: "hit"; hit: LyricsHit }
  /** A real answer: the provider was reached and has no lyrics for this track. */
  | { kind: "unavailable" }
  /** The provider could not be reached, timed out, or answered unintelligibly. */
  | { kind: "unreachable"; reason: string };

/**
 * Strip the decorations YouTube titles carry and lyrics services do not index.
 *
 * Ported from Lyrix's `cleanTitle` in behaviour: the patterns name the specific noise that
 * actually appears in video titles — `(Official Video)`, `| Lyrics`, `HD`, `4K`, `MV`, and a
 * trailing `ft.` — rather than a generic "remove punctuation" that would also mangle real titles.
 *
 * **One deliberate widening.** Lyrix's trailing-suffix pattern strips a suffix that is a *single*
 * noise word, so `Song Title - Official Music Video` survives it intact and then matches nothing in
 * LRCLIB. That is one of the most common YouTube title forms there is, so the suffix here is a
 * *run* of noise words rather than one. Missing a match costs the whole feature for that track;
 * over-stripping only widens the query slightly, which duration-aware scoring recovers from — so
 * the asymmetry favours stripping more.
 */
export function cleanTitle(raw: string): string {
  // Spelled with escapes rather than literal dashes so the pattern survives any tooling that
  // round-trips this file through a non-UTF-8 encoding.
  const NOISE = "official|lyric|lyrics|audio|music|video|visuali|visualizer|hd|hq|4k|mv";
  return raw
    .replace(
      /\s*[([][^)\]]*(?:official|video|audio|lyric|lyrics|hd|hq|4k|mv|visuali)[^)\]]*[)\]]/gi,
      "",
    )
    .replace(/\s*\|.*$/i, "")
    .replace(new RegExp(`\\s*[-\u2013\u2014]\\s*(?:(?:${NOISE})\\b\\s*)+$`, "i"), "")
    .replace(/\s*\bft\.?\s*/gi, " feat. ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Split a YouTube title into track and artist.
 *
 * Tries the separators that actually appear (` - `, ` – `, ` — `, ` ~ `) and falls back to the
 * channel as the artist, which is the common case for auto-generated topic channels where the
 * "channel" really is the artist.
 *
 * The separator list uses escapes rather than literal dashes: a literal en/em dash in source has
 * already been silently corrupted once in this repository by a non-UTF-8 tooling round-trip, and a
 * corrupted separator fails *open* — the split simply does not happen, so lyrics are never found.
 */
export function splitArtistTitle(
  title: string,
  channel: string,
): { trackName: string; artistName: string } {
  for (const separator of [" - ", " \u2013 ", " \u2014 ", " ~ "]) {
    const index = title.indexOf(separator);
    if (index > 0 && index < title.length - separator.length) {
      return {
        artistName: title.slice(0, index).trim(),
        trackName: title.slice(index + separator.length).trim(),
      };
    }
  }
  return { trackName: title, artistName: channel };
}

/**
 * Score a candidate against the requested track. Higher is better.
 *
 * Timed lyrics are worth far more than untimed: they are the difference between a panel that
 * follows playback and a panel that is a wall of text. Duration is the tie-breaker among timed
 * candidates, because a same-song-different-extend match will otherwise win arbitrarily.
 *
 * Exported for direct testing, since the ordering it produces is the behaviour the spec names and
 * a scoring function that is only exercised through a mocked provider is a function whose
 * arithmetic nobody has read.
 */
export function scoreCandidate(candidate: LrcLibCandidate, durationSeconds: number): number {
  let score = 0;
  if (candidate.syncedLyrics) score += 100;
  if (candidate.plainLyrics) score += 10;
  // An instrumental has no lyrics to show, so it is never the right answer even when it is a
  // perfect duration match.
  if (candidate.instrumental) return -Infinity;
  if (candidate.duration !== undefined && candidate.duration > 0 && durationSeconds > 0) {
    const difference = Math.abs(candidate.duration - durationSeconds);
    if (difference <= 2) score += 50;
    else if (difference <= 5) score += 30;
    else if (difference <= 15) score += 10;
    else score -= difference / 10;
  }
  return score;
}

/** Caches and dedupes, per runtime instance. Best-effort by design (see the module note). */
interface LyricsCaches {
  hits: TtlCache<LyricsResult>;
  misses: TtlCache<LyricsResult>;
  inflight: InflightDedup<LyricsResult>;
}

/**
 * Build a fresh set of caches.
 *
 * `createTtlCache` returns a closed object with a getter-only `size` and no `delete`/`clear`, so
 * "reset the caches" cannot be implemented by mutating one. It is implemented by replacing the
 * holder instead — which is also why the holder is a `let` and not a `const`.
 */
function createCaches(now?: () => number): LyricsCaches {
  return {
    hits: createTtlCache<LyricsResult>({
      ttlMs: LYRICS_HIT_TTL_MS,
      maxEntries: LYRICS_CACHE_MAX_ENTRIES,
      ...(now ? { now } : {}),
    }),
    misses: createTtlCache<LyricsResult>({
      ttlMs: LYRICS_MISS_TTL_MS,
      maxEntries: LYRICS_CACHE_MAX_ENTRIES,
      ...(now ? { now } : {}),
    }),
    inflight: createInflightDedup<LyricsResult>(),
  };
}

let caches: LyricsCaches = createCaches();

/** Observation for tests: current cache occupancy. */
export const lyricsCacheSizes = (): { hits: number; misses: number; inflight: number } => ({
  hits: caches.hits.size,
  misses: caches.misses.size,
  inflight: caches.inflight.size,
});

/** Clear every cache. Test isolation, and the hot-reload path. */
export function resetLyricsCaches(now?: () => number): void {
  caches = createCaches(now);
}

/** A caller-supplied fetcher, so tests can drive the provider without a network. */
export type LyricsFetcher = typeof fetchJson;

export interface ResolveLyricsInput {
  /** The provider id — the YouTube video id. The cache key, and never the search key. */
  videoId: string;
  title: string;
  artist: string;
  channel: string;
  /** The track's known duration in seconds; 0 when unknown. */
  durationSeconds: number;
  signal?: AbortSignal;
  /** Injected for tests. Defaults to the shared bounded `fetchJson`. */
  fetchJson?: LyricsFetcher;
}

/**
 * Resolve lyrics for a track.
 *
 * Cached per video id, de-duplicated per video id while in flight, and bounded on every axis: one
 * provider request, one timeout, and a cache with a size cap.
 */
export async function resolveLyrics(input: ResolveLyricsInput): Promise<LyricsResult> {
  const cached = caches.hits.get(input.videoId) ?? caches.misses.get(input.videoId);
  if (cached) return cached;

  return caches.inflight.run(input.videoId, async () => {
    // Re-check inside the dedup: a concurrent caller may have populated the cache between the
    // first check and acquiring the in-flight slot.
    const settled = caches.hits.get(input.videoId) ?? caches.misses.get(input.videoId);
    if (settled) return settled;

    const result = await queryProvider(input);

    // **A failure is never cached.** Caching an outage as a miss would hide lyrics for the whole
    // miss TTL — a day — for a track that has them.
    if (result.kind === "hit") caches.hits.set(input.videoId, result);
    else if (result.kind === "unavailable") caches.misses.set(input.videoId, result);

    return result;
  });
}

async function queryProvider(input: ResolveLyricsInput): Promise<LyricsResult> {
  const cleaned = cleanTitle(input.title);
  const { trackName, artistName } = splitArtistTitle(cleaned, input.artist || input.channel);
  if (trackName === "") return { kind: "unavailable" };

  const params = new URLSearchParams({ track_name: trackName });
  if (artistName !== "") params.set("artist_name", artistName);

  const fetchImpl = input.fetchJson ?? fetchJson;
  let candidates: unknown;
  try {
    candidates = await fetchImpl<LrcLibCandidate[] | null>(`${LRCLIB_SEARCH}?${params}`, {
      headers: { "User-Agent": LRCLIB_USER_AGENT, Accept: "application/json" },
      ...(input.signal ? { signal: input.signal } : {}),
      timeoutMs: LYRICS_TIMEOUT_MS,
    });
  } catch (error) {
    // A caller disconnect is not an upstream failure and must propagate untouched, or the route
    // cannot tell "the user left" from "the provider is down".
    if (input.signal?.aborted) throw error;
    const reason = error instanceof HttpFetchError ? error.kind : "unknown";
    return { kind: "unreachable", reason };
  }

  if (!Array.isArray(candidates)) return { kind: "unreachable", reason: "parse" };

  const best = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, input.durationSeconds) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score)[0];

  const synced = best?.candidate.syncedLyrics?.trim() || null;
  const plain = best?.candidate.plainLyrics?.trim() || null;
  if (synced === null && plain === null) return { kind: "unavailable" };

  return { kind: "hit", hit: { syncedLyrics: synced, plainLyrics: plain, source: "lrclib" } };
}
