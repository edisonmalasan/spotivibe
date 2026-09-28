"use client";

import type { Track } from "@/data/repositories";
import { fetchSearchResults } from "@/features/search/searchApi";
import { useEffect, useRef, useState } from "react";

/** Debounce between a query change and its request (design §4). */
export const SEARCH_DEBOUNCE_MS = 300;

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

/** The settled outcome of the most recent request for a given query. */
interface SettledOutcome {
  trimmed: string;
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
export function useSearchController(query: string): SearchController {
  const [outcome, setOutcome] = useState<SettledOutcome | null>(null);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef = useRef<() => void>(() => {});
  const trimmed = query.trim();

  const settled =
    outcome !== null && outcome.trimmed === trimmed ? outcome.surface : LOADING_SURFACE;
  const surface: SearchSurface = trimmed === "" ? BROWSE_SURFACE : settled;

  useEffect(() => {
    /** Cancel the pending debounce and invalidate any in-flight request. */
    function cancel(): void {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      seqRef.current += 1; // a response for an older sequence may never render
      abortRef.current?.abort();
      abortRef.current = null;
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
        setOutcome({ trimmed, surface });
      }
      try {
        if (!navigator.onLine) {
          // Offline at request time: no remote request is issued at all (spec).
          settle({ status: "empty", origin: "offline" });
          return;
        }
        const tracks = await fetchSearchResults(trimmed, controller.signal);
        settle(
          tracks.length > 0 ? { status: "results", tracks } : { status: "empty", origin: "remote" },
        );
      } catch {
        settle({ status: "error" }); // aborted/superseded runs fail the guard
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
  }, [trimmed]);

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
