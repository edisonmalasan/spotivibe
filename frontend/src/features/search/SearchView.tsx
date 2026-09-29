"use client";

import { Button } from "@/components/design-system/Button";
import { EmptyState } from "@/components/design-system/EmptyState";
import { ErrorState } from "@/components/design-system/ErrorState";
import type { Track } from "@/data/repositories";
import { RecentSearches } from "@/features/search/RecentSearches";
import { SearchResults } from "@/features/search/SearchResults";
import { SearchSkeletons } from "@/features/search/SearchSkeletons";
import { useSearchController, type SearchSurface } from "@/features/search/useSearchController";
import { buildSearchUrl } from "@/lib/searchUrl";
import { usePlayerStore } from "@/stores/playerStore";
import { useSearchStore } from "@/stores/searchStore";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

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
 * The request state machine lives in {@link useSearchController}; this
 * component only maps its surface onto the rendering below.
 */
export function SearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = useSearchStore((state) => state.query);
  const setQuery = useSearchStore((state) => state.setQuery);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const param = searchParams.get("q") ?? "";
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { surface, retry } = useSearchController(query);

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

  return (
    <SearchSurfaceView
      surface={surface}
      query={query}
      retry={retry}
      onRefine={setQuery}
      onPlay={(track, context) => playTrack(track, context, "search")}
    />
  );
}

/**
 * Presentational mapping of the state model (design §5) — every variant
 * renders a full surface, so no state can show as a blank region.
 */
function SearchSurfaceView({
  surface,
  query,
  retry,
  onRefine,
  onPlay,
}: {
  surface: SearchSurface;
  query: string;
  retry(): void;
  /**
   * Refine action for the Top Result's artist/album card (query := entity
   * name). Derived artist/album tiles and the context menu navigate to the M9
   * catalog routes instead; refined search stays the behavior for genuine text
   * queries (the top bar, recents, and Top Result).
   */
  onRefine(name: string): void;
  /** Activate a result within its result set as playback context (design §9). */
  onPlay(track: Track, context: Track[]): void;
}): ReactNode {
  const trimmed = query.trim();
  switch (surface.status) {
    case "browse":
      return <RecentSearches onSelect={onRefine} />;
    case "loading":
      return (
        <div data-testid="search-loading" role="status">
          <span className="sr-only">Searching…</span>
          <SearchSkeletons />
        </div>
      );
    case "results":
      return (
        <SearchResults
          tracks={surface.tracks}
          query={trimmed}
          onRefine={onRefine}
          onPlay={onPlay}
        />
      );
    case "empty":
      return surface.origin === "offline" ? (
        <EmptyState
          title={`No local results for "${trimmed}"`}
          description="You are offline — reconnect to search the full catalog."
        />
      ) : (
        <EmptyState
          title={`No results for "${trimmed}"`}
          description="Check the spelling or try different keywords."
        />
      );
    case "local":
      return (
        <>
          <div
            role="status"
            data-testid="fallback-notice"
            className="flex flex-wrap items-center justify-between gap-4 rounded-cards bg-graphite px-4 py-3"
          >
            <p className="text-body text-mist">
              {surface.origin === "offline"
                ? "Offline — showing matches from your library."
                : "Search is unavailable — showing matches from your library."}
            </p>
            {surface.origin === "error" && <Button onClick={retry}>Try again</Button>}
          </div>
          <SearchResults
            tracks={surface.tracks}
            query={trimmed}
            onRefine={onRefine}
            onPlay={onPlay}
          />
        </>
      );
    case "error":
      return (
        <ErrorState
          title="Search failed"
          description="We could not complete your search. Check your connection and try again."
          onRetry={retry}
        />
      );
    default: {
      const exhaustive: never = surface;
      return exhaustive;
    }
  }
}
