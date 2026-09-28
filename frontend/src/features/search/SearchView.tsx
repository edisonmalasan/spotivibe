"use client";

import { SearchBrowseEmpty } from "@/features/search/SearchBrowseEmpty";
import { buildSearchUrl } from "@/lib/searchUrl";
import { useSearchStore } from "@/stores/searchStore";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/** URL-write cadence shared with the top bar (design decision §3). */
export const URL_SYNC_DEBOUNCE_MS = 300;

/**
 * M5 search surface (design decisions §2/§3): the client host rendered by the
 * `/search` route. Owns two-way URL synchronization:
 *
 * - URL → store: `?q=` adopts into `searchStore` on mount and whenever it
 *   changes (deep link, back/forward).
 * - store → URL: a debounced, compare-first `replace` (never `push`) so
 *   neither direction can loop and history steps land on settled queries.
 *
 * Request orchestration and result rendering arrive with the controller.
 */
export function SearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = useSearchStore((state) => state.query);
  const setQuery = useSearchStore((state) => state.setQuery);
  const param = searchParams.get("q") ?? "";
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // URL → store: adopt the param whenever it changes (deep link/back/forward).
  // The compare-first guard makes adopting an identical value a no-op, which
  // is what keeps the two directions from echoing each other.
  useEffect(() => {
    if (param === useSearchStore.getState().query) return;
    setQuery(param);
  }, [param, setQuery]);

  // store → URL: debounce edits into `replace`, skipping when the store and
  // the param already agree.
  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (query === param) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const latest = useSearchStore.getState().query;
      if (latest !== query || latest === param) return; // superseded/adopted
      router.replace(buildSearchUrl(latest));
    }, URL_SYNC_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [query, param, router]);

  return <SearchBrowseEmpty />;
}
