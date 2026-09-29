import { createInflightDedup, createTtlCache, type InflightDedup, type TtlCache } from "./cache";
import { isProviderError } from "./errors";
import { outboundLimiter, type Semaphore } from "./limiter";
import { finalizePlaylistEntries } from "./normalize";
import { invidiousPlaylistResolver } from "./providers/invidious";
import { pipedPlaylistResolver } from "./providers/piped";
import { ATTEMPT_TIMEOUT_MS } from "./providers/support";
import { ytmusicPlaylistResolver } from "./providers/ytmusic";
import { ytwebPlaylistResolver } from "./providers/ytweb";
import {
  PLAYLIST_ENTRY_CAP,
  type PlaylistDiagnostics,
  type PlaylistRequest,
  type PlaylistResolution,
  type PlaylistResolver,
  type PlaylistResult,
  type PlaylistSuccess,
  type TierOutcome,
} from "./types";

/**
 * The playlist-import resolution service (design decision 9).
 *
 * Layered exactly like search — bounded TTL cache → in-flight dedupe →
 * tier chain — with one deliberate difference: playlist import is *not*
 * relevance search, so the chain stops at the first tier that successfully
 * answers (source order, no filtering/scoring) and a tier's definitive
 * "private/deleted/not found" answer stops the chain entirely because no
 * other tier can change it.
 */

/** Playlist-resolution cache TTL; the route mirrors it as `max-age`. */
export const PLAYLIST_CACHE_TTL_MS = 60_000;
/** Bound on cached playlist entries (cheap, per-runtime-instance). */
export const PLAYLIST_CACHE_MAX_ENTRIES = 20;

/** Cache/dedup key: the canonical playlist ID (post-`parsePlaylistRef`). */
export function playlistCacheKey(playlistId: string): string {
  return `playlist:${playlistId}`;
}

/** Fixed tier order — identical to the search chain (ROADMAP §7.2). */
export const DEFAULT_PLAYLIST_RESOLVERS: readonly PlaylistResolver[] = [
  ytmusicPlaylistResolver,
  ytwebPlaylistResolver,
  invidiousPlaylistResolver,
  pipedPlaylistResolver,
];

export interface PlaylistChainOptions {
  /** Override the tier list (tests). */
  resolvers?: readonly PlaylistResolver[];
  /** Per-attempt upstream timeout in ms (tests use short timeouts). */
  attemptTimeoutMs?: number;
  /** Override the concurrency gate (tests observe serialization). */
  limiter?: Semaphore;
}

/**
 * Walk {@link DEFAULT_PLAYLIST_RESOLVERS} in tier order until one tier
 * answers (design decision 9):
 *
 * - transport/parse failure (any `ProviderError` kind except
 *   `unavailable`) → record the kind and fall through to the next tier;
 * - a definitive `unavailable` answer → stop immediately with
 *   `reason: "unavailable"` (the route answers 404);
 * - a successful parse → finalize to canonical tracks and return (even
 *   when the source listing is empty: the tier reached YouTube and answered,
 *   which is a different fact from "the tier failed");
 * - every tier failed → `reason: "upstream"` (the route answers 503).
 *
 * Only caller cancellation throws — mirroring `runChain`.
 */
export async function resolvePlaylist(
  request: PlaylistRequest,
  options: PlaylistChainOptions = {},
): Promise<PlaylistResult> {
  const resolvers = options.resolvers ?? DEFAULT_PLAYLIST_RESOLVERS;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const limiter = options.limiter ?? outboundLimiter;

  const tiers: TierOutcome[] = [];

  for (const resolver of resolvers) {
    let resolution: PlaylistResolution;
    try {
      const release = await limiter.acquire(request.signal);
      try {
        resolution = await resolver.resolvePlaylist({
          ...request,
          timeoutMs: attemptTimeoutMs,
        });
      } finally {
        release();
      }
    } catch (error) {
      // Caller cancellation is not a tier outcome — propagate it as-is.
      if (request.signal?.aborted) {
        throw request.signal.reason ?? error;
      }
      const kind = isProviderError(error) ? error.kind : "parse";
      tiers.push({ tier: resolver.id, outcome: kind });
      if (kind === "unavailable") {
        return { ok: false, reason: "unavailable", tiers };
      }
      continue;
    }

    // Defensive cap slice: a resolver must stop at the documented cap, but
    // the chain never trusts that alone (bounded serverless work).
    const capped = resolution.entries.length > PLAYLIST_ENTRY_CAP;
    const entries = capped ? resolution.entries.slice(0, PLAYLIST_ENTRY_CAP) : resolution.entries;
    const { tracks, skipped } = finalizePlaylistEntries(entries);
    const truncated = resolution.truncated || capped;

    tiers.push({ tier: resolver.id, outcome: "ok" });
    const playlist: PlaylistSuccess["playlist"] = {
      title: resolution.title,
      ...(resolution.description ? { description: resolution.description } : {}),
      tracks,
      skipped,
      ...(truncated ? { truncated: true } : {}),
    };
    const diagnostics: PlaylistDiagnostics = { tiers };
    return { ok: true, playlist, diagnostics };
  }

  return { ok: false, reason: "upstream", tiers };
}

export interface PlaylistDeps {
  cache: TtlCache<PlaylistSuccess>;
  inflight: InflightDedup<PlaylistResult>;
  chainOptions?: PlaylistChainOptions;
}

const defaultCache = createTtlCache<PlaylistSuccess>({
  ttlMs: PLAYLIST_CACHE_TTL_MS,
  maxEntries: PLAYLIST_CACHE_MAX_ENTRIES,
});
const defaultInflight = createInflightDedup<PlaylistResult>();

/** The process-wide service state the route uses (documented shared state). */
export const defaultPlaylistDeps: PlaylistDeps = {
  cache: defaultCache,
  inflight: defaultInflight,
};

/**
 * Run one resolution through cache → dedup → chain. Failures are never
 * cached: an exhausted or unavailable answer retries on the next call.
 */
export async function runResolvePlaylist(
  request: PlaylistRequest,
  deps: PlaylistDeps = defaultPlaylistDeps,
): Promise<PlaylistResult> {
  const key = playlistCacheKey(request.playlistId);

  const cached = deps.cache.get(key);
  if (cached) return cached;

  return deps.inflight.run(key, async () => {
    const result = await resolvePlaylist(request, deps.chainOptions);
    if (result.ok) deps.cache.set(key, result);
    return result;
  });
}
