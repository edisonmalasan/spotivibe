import { SEARCH_MODE_PARAM, type SearchMode } from "@/features/search/searchApi";

/**
 * The shareable search URL for a raw (untrimmed) query — an empty query maps
 * to the browse route `/search`.
 *
 * The URL mirrors the raw store value so that adopting `?q=` back into the
 * store round-trips to an identical string (design decision §3: compare-first
 * writes cannot loop). Trimming happens only when a request or a history
 * record is built from the query.
 *
 * M12: the mode travels in the same URL, so a podcast-mode result set is
 * shareable and survives back/forward. Music mode is written **only** when it is
 * podcast mode, so a music URL stays byte-identical to the pre-M12 shape —
 * shared music links do not change because podcasts exist.
 */
export function buildSearchUrl(query: string, mode: SearchMode = "music"): string {
  if (query === "") {
    return mode === "podcast" ? `/search?${SEARCH_MODE_PARAM}=podcast` : "/search";
  }
  const base = `/search?q=${encodeURIComponent(query)}`;
  return mode === "podcast" ? `${base}&${SEARCH_MODE_PARAM}=podcast` : base;
}
