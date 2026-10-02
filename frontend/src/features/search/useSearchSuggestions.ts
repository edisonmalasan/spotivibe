"use client";

import type { SearchEntryRecord } from "@/data/repositories";
import { loadSearchHistory } from "@/features/search/localSearch";
import { deriveSuggestions, type SearchSuggestion } from "@/features/search/suggestions";
import { useSearchStore } from "@/stores/searchStore";
import { useEffect, useRef, useState } from "react";

/**
 * The suggestion lane (M18 task 4.2; design decision 5).
 *
 * **This is a second lane, not a mode of `useSearchController`.** The controller
 * owns the results request: its 300 ms debounce, its per-request
 * `AbortController`, and its monotonic sequence are asserted by an existing suite
 * and are not touched here. This hook owns a *separate* debounce (shorter — a
 * suggestion list that lags the field feels broken), a *separate*
 * `AbortController` per request, and a *separate* sequence counter. Nothing here
 * is reachable from the controller and nothing in the controller is reachable
 * from here, which is what makes "a suggestion request and a results request
 * never cancel one another" a structural property rather than a convention: a
 * shared timer or a shared abort ref is the only way those two could interact,
 * and there is not one.
 *
 * **The query is read from `searchStore` rather than passed in.** The field is
 * already controlled by that store, so a lane fed a second copy of the query
 * could derive suggestions for a query the field is not showing. Reading the one
 * authority makes that impossible to express.
 *
 * **The abort is honoured at the settle boundary.** `searchHistory.list()` takes
 * no `AbortSignal` — the repository interface is a plain read — so this lane's
 * `AbortController` is the cancellation *token*: the effect cleanup flips its
 * `signal`, and every continuation checks both the signal and this lane's own
 * sequence before it writes. A superseded or cancelled request therefore renders
 * nothing and reports nothing; a cancelled request is not a failure and is never
 * reported as one.
 */

/**
 * Debounce between a keystroke and the suggestion request it starts.
 *
 * Shorter than {@link SEARCH_DEBOUNCE_MS}'s 300 ms on purpose: the results list
 * can afford to be late because the listener is reading it, while the popup's
 * whole job is to be there *while* the listener is still typing.
 */
export const SUGGESTION_DEBOUNCE_MS = 120;

/**
 * How much history one suggestion request reads.
 *
 * Bounded for the same reason `localSearch` bounds its history pull: the popup
 * shows at most `MAX_SUGGESTIONS` rows, so reading an unbounded list would cost
 * a transaction whose size grows with how long the application has been used,
 * on a keystroke.
 */
export const SUGGESTION_HISTORY_LIMIT = 12;

/** A settled set of suggestions, tagged with the query they were derived for. */
interface SettledSuggestions {
  query: string;
  items: SearchSuggestion[];
}

/** Shared empty identity: no suggestions yet must not churn every render. */
const NO_SUGGESTIONS: SearchSuggestion[] = [];

/**
 * Suggestions for the search field, or an empty list while none are on offer.
 *
 * `enabled` is the field's own state, not the lane's: a dismissed or unfocused
 * field asks for nothing, so focusing the field with an empty query is what
 * offers this device's recents, and no read happens until it does.
 */
export function useSearchSuggestions(enabled: boolean): SearchSuggestion[] {
  const query = useSearchStore((state) => state.query);
  const trimmed = query.trim();
  const [settled, setSettled] = useState<SettledSuggestions | null>(null);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    /**
     * Cancel this lane's pending debounce and invalidate its in-flight request.
     *
     * Every ref touched here belongs to *this* lane. That is the whole of the
     * independence claim, and it is why the function reads as it does: a lane
     * that shared a timer ref or an abort ref with the search controller would be
     * able to cancel a results request, and no test of the popup alone could see
     * it happen.
     */
    function cancel(): void {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Invalidate the in-flight response before it can settle, then abort it.
      seqRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    }

    /** True when this continuation belongs to the request that is still current. */
    function isCurrent(seq: number, controller: AbortController): boolean {
      return seq === seqRef.current && !controller.signal.aborted;
    }

    /** Read this device's history through the repository, and derive from it. */
    async function run(seq: number, controller: AbortController, forQuery: string): Promise<void> {
      let history: SearchEntryRecord[];
      try {
        history = await loadSearchHistory(SUGGESTION_HISTORY_LIMIT);
      } catch (error) {
        if (!isCurrent(seq, controller)) return; // superseded: not this request's news
        // Storage unavailable. A suggestion list is an aid, not a surface: the
        // popup simply offers nothing, and the reason is logged rather than
        // rendered, because a failed *hint* is not something a listener asked a
        // question about.
        console.warn("[search] suggestions unavailable:", error);
        setSettled({ query: forQuery, items: [] });
        return;
      }
      if (!isCurrent(seq, controller)) return; // superseded or cancelled: renders nothing
      setSettled({ query: forQuery, items: deriveSuggestions(forQuery, history) });
    }

    if (!enabled) {
      cancel();
      return cancel;
    }

    const seq = ++seqRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void run(seq, controller, trimmed);
    }, SUGGESTION_DEBOUNCE_MS);

    return cancel;
  }, [trimmed, enabled]);

  // **Derived, never written from the effect.** Two things gate what is on offer:
  // the field must currently be asking (`enabled`), and a settled set only counts
  // for the query it was derived for. Deriving rather than clearing is the same
  // rule the search controller uses for its own `browse`/`loading` surfaces, and
  // it is what keeps this hook from writing state synchronously inside an effect
  // — a reset written there would cascade a render on every keystroke.
  //
  // The `settled.query === trimmed` half is deliberately **redundant with
  // `isCurrent`**, and that redundancy is load-bearing in one direction only. It
  // cannot be violated on its own: no code path calls `setSettled` with a query
  // the lane is no longer on, because the request-side guard rejects such a
  // response before it reaches the setter. Which means it has no induced-violation
  // case of its own — removing it alone leaves every test green, and a case that
  // cannot fail is worse than no case. It stays because it is what makes the
  // hook's contract true *by construction* rather than by remembering that the
  // guard above was not refactored: if a future change adds a second writer, this
  // is the check that stops a stale answer from reaching the popup.
  if (!enabled) return NO_SUGGESTIONS;
  return settled !== null && settled.query === trimmed ? settled.items : NO_SUGGESTIONS;
}
