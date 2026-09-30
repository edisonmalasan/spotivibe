"use client";

import type { Track } from "@/data/repositories";
import { getLocalData } from "@/data/localData";
import {
  fetchSearchResults,
  DEFAULT_SEARCH_MODE,
  type SearchMode,
} from "@/features/search/searchApi";
import { loadLocalLibrary, searchLocalLibrary } from "@/features/search/localSearch";
import { useEffect, useRef, useState } from "react";

/** Debounce between a query change and its request (design §4). */
export const SEARCH_DEBOUNCE_MS = 300;

/** How long a settled result set must stay active before it is recorded (§7). */
export const SETTLE_RECORD_MS = 1500;

/**
 * The search surface state model (design §5). Exactly one variant renders at a
 * time, so no state can fall through to a blank region:
 *
 * - `browse`   — empty query: recents or the browse empty state
 * - `loading`  — no settled outcome for the current query yet: skeletons
 * - `results`  — remote success with tracks
 * - `empty`    — settled with nothing to show (`origin` names remote vs offline)
 * - `local`    — local-library fallback matches (`origin` names why)
 * - `error`    — remote failure and no local matches: retryable error state
 */
export type SearchSurface =
  | { status: "browse" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "results"; tracks: Track[] }
  | { status: "empty"; origin: "remote" | "offline" }
  | { status: "local"; tracks: Track[]; origin: "offline" | "error" };

export interface SearchController {
  surface: SearchSurface;
  /** Re-run the current query immediately, bypassing the debounce. */
  retry(): void;
}

/** Shared identities for the two stateless surfaces (no per-render churn). */
const BROWSE_SURFACE: SearchSurface = { status: "browse" };
const LOADING_SURFACE: SearchSurface = { status: "loading" };

/**
 * The settled outcome of the most recent request for a given query **and mode**
 * (M12). The mode is part of the identity, not just the request: switching modes
 * re-runs the search instead of showing the other mode's results, which is the
 * difference between a mode and a filter.
 */
interface SettledOutcome {
  trimmed: string;
  mode: SearchMode;
  surface: Exclude<SearchSurface, { status: "browse" } | { status: "loading" }>;
}

/**
 * Page-local request orchestration (design §4/§5): 300 ms debounce, a
 * monotonically increasing request sequence, and one AbortController per
 * request. A response settles the surface only when its sequence is still the
 * latest AND its controller was never aborted — both guards, because abort
 * races are real (design §4).
 *
 * `browse`/`loading` are derived from the current query versus the settled
 * outcome rather than written from an effect; effects only orchestrate timers,
 * requests, and subscriptions, and settle state from async continuations.
 * `navigator.onLine` is read at request time, and `online`/`offline` listeners
 * re-run the current query while the route is mounted.
 */
export function useSearchController(
  query: string,
  mode: SearchMode = DEFAULT_SEARCH_MODE,
): SearchController {
  const [outcome, setOutcome] = useState<SettledOutcome | null>(null);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef = useRef<() => void>(() => {});
  const trimmed = query.trim();

  const settled =
    outcome !== null && outcome.trimmed === trimmed && outcome.mode === mode
      ? outcome.surface
      : LOADING_SURFACE;
  const surface: SearchSurface = trimmed === "" ? BROWSE_SURFACE : settled;

  useEffect(() => {
    /** Cancel the pending debounce and invalidate any in-flight request. */
    function cancel(): void {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (recordTimerRef.current !== null) {
        // Query change/unmount abandons the settle window before recording.
        clearTimeout(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      seqRef.current += 1; // a response for an older sequence may never render
      abortRef.current?.abort();
      abortRef.current = null;
    }

    /**
     * Start the settle window (design §7) for a result set the remote
     * actually answered with: results and remote empties record after
     * {@link SETTLE_RECORD_MS}; errors, offline surfaces, and local fallbacks
     * never do. The record goes through the repository only.
     */
    function scheduleRecord(text: string, settled: SettledOutcome["surface"]): void {
      const recordable =
        settled.status === "results" || (settled.status === "empty" && settled.origin === "remote");
      if (!recordable) return;
      if (recordTimerRef.current !== null) {
        clearTimeout(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      recordTimerRef.current = setTimeout(() => {
        recordTimerRef.current = null;
        void getLocalData()
          .then((data) => data.searchHistory.record(text))
          .catch((error: unknown) => console.warn("[search] history record failed:", error));
      }, SETTLE_RECORD_MS);
    }

    /**
     * Local-library matches for the current query (design §6). `null` means
     * storage itself was unavailable, so the caller degrades to its non-local
     * surface instead of showing an empty fallback as if nothing matched.
     */
    async function localMatches(): Promise<Track[] | null> {
      try {
        return searchLocalLibrary(await loadLocalLibrary(), trimmed, mode);
      } catch (error) {
        console.warn("[search] local fallback read failed:", error);
        return null;
      }
    }

    /** Issue the request for this effect's trimmed query. */
    async function execute(): Promise<void> {
      cancel(); // supersede anything pending or in flight before this request
      const seq = ++seqRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      /** Settle the surface only for the request that is still current. */
      function settle(surface: SettledOutcome["surface"]): void {
        if (seq !== seqRef.current || controller.signal.aborted) return;
        setOutcome({ trimmed, mode, surface });
        scheduleRecord(trimmed, surface);
      }
      try {
        if (!navigator.onLine) {
          // Offline at request time: no remote request is issued at all (spec);
          // the local library answers the query instead (design §6).
          const matches = await localMatches();
          settle(
            matches !== null && matches.length > 0
              ? { status: "local", tracks: matches, origin: "offline" }
              : { status: "empty", origin: "offline" },
          );
          return;
        }
        const tracks = await fetchSearchResults(trimmed, controller.signal, mode);
        settle(
          tracks.length > 0 ? { status: "results", tracks } : { status: "empty", origin: "remote" },
        );
      } catch {
        if (controller.signal.aborted) return; // superseded request: no fallback work
        // Remote failure (design §6): local matches with a notice, or the
        // retryable error state when the local library has nothing either.
        const matches = await localMatches();
        settle(
          matches !== null && matches.length > 0
            ? { status: "local", tracks: matches, origin: "error" }
            : { status: "error" },
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    }

    runRef.current =
      trimmed === ""
        ? () => {}
        : () => {
            void execute();
          };
    if (trimmed === "") return cancel;

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void execute();
    }, SEARCH_DEBOUNCE_MS);

    return cancel;
  }, [trimmed, mode]);

  // Connectivity listeners live as long as the route: a change drops the
  // current outcome (loading instead of stale content) and re-runs the query
  // immediately, without waiting out another debounce.
  useEffect(() => {
    function handleConnectivityChange(): void {
      setOutcome(null);
      runRef.current();
    }
    window.addEventListener("online", handleConnectivityChange);
    window.addEventListener("offline", handleConnectivityChange);
    return () => {
      window.removeEventListener("online", handleConnectivityChange);
      window.removeEventListener("offline", handleConnectivityChange);
    };
  }, []);

  function retry(): void {
    setOutcome(null); // surface loading immediately; the run settles it again
    runRef.current();
  }

  return { surface, retry };
}
