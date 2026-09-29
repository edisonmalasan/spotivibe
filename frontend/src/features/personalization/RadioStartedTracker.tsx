"use client";

import { type JSX, useEffect, useRef } from "react";
import { usePlayerStore } from "@/stores/playerStore";
import { useRadioStore } from "@/stores/radioStore";

/**
 * The radio's **played-set keeper** (M10 task 4.1's client half; spec `radio` —
 * "Played-track dedupe" / "Radio refill"; design §3).
 *
 * A radio excludes what it has played by *knowing* what it played, and nothing
 * else on the device records that: `queueStore`'s history stack is traversal
 * bookkeeping, `historyStore` is the long-lived listening dataset, and neither
 * is scoped to one radio's life. So this tracker is the single writer of
 * `radioStore.markPlayed`, and it is deliberately the smallest possible observer:
 *
 * - **It watches the current track, not the queue.** What the spec calls played
 *   is what the listener has actually reached, and `playerStore.currentTrack` is
 *   the one place that already means that.
 * - **It writes only while a radio is active.** With no radio there is no
 *   session to scope a played set to, and recording anyway would exclude those
 *   tracks from the *next* radio's refills — which have never played them.
 * - **It cannot loop or start anything.** It issues no request, moves no
 *   pointer, and touches no transport; the store's own dedupe plus the ref below
 *   make a repeat a no-op, so re-rendering (or a StrictMode double-invoke)
 *   cannot grow the set.
 *
 * Mounted with the persistent player, beside `useListeningRecorder` in the app
 * shell and for the same reason: the radio outlives route changes, so an observer
 * on a page would stop recording the moment the user browsed elsewhere.
 */

/**
 * The testable core (M10 task 4.1): record the current track into the active
 * radio's played set, and do nothing at all when there is no radio.
 */
export function useRadioPlayedTracker(): void {
  const currentTrackId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const hasRadio = useRadioStore((state) => state.seed !== null);

  /**
   * The last id this mount recorded. Belt-and-braces with the store's own
   * dedupe: it is what makes the effect idempotent against a re-render or a
   * StrictMode double-invoke, without relying on the store to be the only
   * thing preventing a repeat.
   */
  const lastMarked = useRef<string | null>(null);

  useEffect(() => {
    if (!hasRadio) {
      // Scoped to one radio's life: with no radio the memory is meaningless, and
      // carrying it across would silence the first record of the next one.
      lastMarked.current = null;
      return;
    }
    if (currentTrackId === null || currentTrackId === lastMarked.current) return;
    lastMarked.current = currentTrackId;
    // The store refuses an empty id, a repeat, and (itself) a write with no
    // radio, so this call is safe from any of the states reachable here.
    useRadioStore.getState().markPlayed(currentTrackId);
  }, [hasRadio, currentTrackId]);
}

/**
 * The mounted tracker. Renders nothing — it is an observer, like
 * `useListeningRecorder`, and a page that mounted its own copy would stop
 * recording as soon as the user navigated away.
 */
export function RadioStartedTracker(): JSX.Element {
  useRadioPlayedTracker();
  return <></>;
}
