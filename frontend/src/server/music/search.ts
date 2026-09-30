import { createInflightDedup, createTtlCache, type InflightDedup, type TtlCache } from "./cache";
import { runChain, type ChainOptions } from "./chain";
import type { SearchCategory, SearchRequest, SearchResult, SearchSuccess } from "./types";

/**
 * The search service the route layer calls (design decisions 6–8).
 *
 * Layered best-effort resilience per runtime instance:
 * 1. bounded TTL result cache (successful results only) — `cached: true`
 *    diagnostics mark hits;
 * 2. in-flight deduplication — identical normalized queries share one
 *    upstream call;
 * 3. the four-tier chain with budget/abort/limiter handling.
 *
 * Failures are never cached: an exhausted request retries on the next call.
 * The cache TTL doubles as the HTTP `max-age` the route advertises — the
 * route imports {@link SEARCH_CACHE_TTL_MS} so the two cannot drift.
 */

/** Result-cache TTL; the route mirrors it as `Cache-Control: max-age`. */
export const SEARCH_CACHE_TTL_MS = 60_000;
/** Bound on cached entries (design decision 6: ~100). */
export const SEARCH_CACHE_MAX_ENTRIES = 100;

/**
 * Cache/dedup key: the normalized query (trimmed, lowercased) plus the requested
 * limit and the **category** the question was asked in.
 *
 * M12: the category is part of the key because a podcast result must never be
 * served for a music query or the reverse — that is a correctness property a
 * post-filter cannot have, because the two answers are different upstream
 * questions (design decision 1). An absent category means `"music"`, so a
 * pre-M12 key and a `music` key are the same key.
 */
export function searchCacheKey(
  query: string,
  limit: number,
  category: SearchCategory = "music",
): string {
  return `${query.trim().toLowerCase()}|${category}|${limit}`;
}

export interface SearchDeps {
  cache: TtlCache<SearchSuccess>;
  inflight: InflightDedup<SearchResult>;
  chainOptions?: ChainOptions;
}

const defaultCache = createTtlCache<SearchSuccess>({
  ttlMs: SEARCH_CACHE_TTL_MS,
  maxEntries: SEARCH_CACHE_MAX_ENTRIES,
});
const defaultInflight = createInflightDedup<SearchResult>();

/** The process-wide service state the route uses (documented shared state). */
export const defaultSearchDeps: SearchDeps = {
  cache: defaultCache,
  inflight: defaultInflight,
};

/** Run one search through cache → dedup → chain. */
export async function runSearch(
  request: SearchRequest,
  deps: SearchDeps = defaultSearchDeps,
): Promise<SearchResult> {
  const key = searchCacheKey(request.query, request.limit, request.category);

  const cached = deps.cache.get(key);
  if (cached) {
    return { ...cached, diagnostics: { ...cached.diagnostics, cached: true } };
  }

  return deps.inflight.run(key, async () => {
    const result = await runChain(request, deps.chainOptions);
    if (result.ok) deps.cache.set(key, result);
    return result;
  });
}
