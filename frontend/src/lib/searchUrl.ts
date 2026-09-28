/**
 * The shareable search URL for a raw (untrimmed) query — an empty query maps
 * to the browse route `/search`.
 *
 * The URL mirrors the raw store value so that adopting `?q=` back into the
 * store round-trips to an identical string (design decision §3: compare-first
 * writes cannot loop). Trimming happens only when a request or a history
 * record is built from the query.
 */
export function buildSearchUrl(query: string): string {
  return query === "" ? "/search" : `/search?q=${encodeURIComponent(query)}`;
}
