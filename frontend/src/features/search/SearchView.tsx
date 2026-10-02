"use client";

import { Button } from "@/components/design-system/Button";
import { EmptyState } from "@/components/design-system/EmptyState";
import { ErrorState } from "@/components/design-system/ErrorState";
import type { Track } from "@/data/repositories";
import {
  SEARCH_MODE_PARAM,
  searchModeFromParam,
  type SearchMode,
} from "@/features/search/searchApi";
import { PodcastCategoryList } from "@/features/search/PodcastCategoryList";
import { RecentSearches } from "@/features/search/RecentSearches";
import { SearchResults } from "@/features/search/SearchResults";
import { SearchSkeletons } from "@/features/search/SearchSkeletons";
import { useSearchController, type SearchSurface } from "@/features/search/useSearchController";
import { buildSearchUrl } from "@/lib/searchUrl";
import { usePlayerStore } from "@/stores/playerStore";
import { useSearchStore } from "@/stores/searchStore";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, type ReactNode } from "react";

/** URL-write cadence shared with the top bar (design decision §3). */
export const URL_SYNC_DEBOUNCE_MS = 300;

/**
 * M12: the two modes the control offers. The labels name the question rather
 * than promising results, and podcast mode carries its own expectation — a
 * long-form filter the listener may not expect — so the control can state it.
 */
export const SEARCH_MODE_OPTIONS: ReadonlyArray<{ mode: SearchMode; label: string }> = [
  { mode: "music", label: "Music" },
  { mode: "podcast", label: "Podcasts" },
];

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
  // M12: the mode is URL state, so a deep link or a back/forward step reproduces
  // it. An absent or unrecognized value means music — a shared URL must still
  // produce a working search rather than an error.
  const mode = searchModeFromParam(searchParams.get(SEARCH_MODE_PARAM));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { surface, retry } = useSearchController(query, mode);

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
      router.replace(buildSearchUrl(latest, mode));
    }, URL_SYNC_DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [query, param, mode, router]);

  /**
   * Switching mode preserves the query and re-runs the search in the new mode.
   *
   * The URL write goes through the same debounced `replace` as typing, so a
   * mode switch cannot push a history entry the back button would have to walk
   * through, and the top-bar input is untouched — the value the listener typed
   * stays in it and in the store.
   */
  const switchMode = useCallback(
    (next: SearchMode) => {
      if (next === mode) return;
      router.replace(buildSearchUrl(useSearchStore.getState().query, next));
    },
    [mode, router],
  );

  return (
    <>
      <SearchModeSwitch mode={mode} onSelect={switchMode} />
      <SearchSurfaceView
        surface={surface}
        query={query}
        mode={mode}
        retry={retry}
        onRefine={setQuery}
        onPlay={(track, context) => playTrack(track, context, "search")}
      />
    </>
  );
}

/**
 * The mode control (M12).
 *
 * A radio group rather than a toggle: the two modes are not on/off, they are two
 * questions, and the selected one is always visible to a screen reader through
 * `aria-checked`. The labels describe the question rather than promising results
 * — no "podcasts" claim the provider may not be able to answer.
 */
function SearchModeSwitch({
  mode,
  onSelect,
}: {
  mode: SearchMode;
  onSelect(mode: SearchMode): void;
}): ReactNode {
  return (
    <div
      role="radiogroup"
      aria-label="Search mode"
      data-testid="search-mode-switch"
      className="flex items-center gap-2"
    >
      {SEARCH_MODE_OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          role="radio"
          aria-checked={mode === option.mode}
          data-testid={`search-mode-${option.mode}`}
          onClick={() => onSelect(option.mode)}
          className={`motion-feedback rounded-buttons px-3 py-2 text-body-lg font-bold ${
            mode === option.mode
              ? "bg-pure-white text-void-black"
              : "bg-carbon text-mist hover:bg-graphite hover:text-pure-white"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Presentational mapping of the state model (design §5) — every variant
 * renders a full surface, so no state can show as a blank region.
 */
function SearchSurfaceView({
  surface,
  query,
  mode,
  retry,
  onRefine,
  onPlay,
}: {
  surface: SearchSurface;
  query: string;
  /** M12: drives the empty-state wording and the result presentation. */
  mode: SearchMode;
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
      // M12: podcast mode's browse state is the curated categories; music mode's
      // is unchanged, because recent searches apply to whatever was typed last.
      return mode === "podcast" ? (
        <>
          <PodcastCategoryList />
          <RecentSearches onSelect={onRefine} />
        </>
      ) : (
        <RecentSearches onSelect={onRefine} />
      );
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
          mode={mode}
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
      ) : mode === "podcast" ? (
        // M12: the empty state names the mode and the query, so a listener can
        // tell "no podcasts matched" from "the search failed" and from music mode
        // returning nothing for the same words.
        <EmptyState
          title={`No podcasts found for "${trimmed}"`}
          description="Podcast search looks for episodes of at least 10 minutes. Try different keywords or a category."
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
            mode={mode}
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
