"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlayerStore } from "@/stores/playerStore";
import type { Track } from "@/data/repositories";
import { activeLineIndex, parseLyricsPayload, type LyricLine } from "./lyricsTiming";
import { fetchLyrics, lyricsRequestFor, type LyricsPayload } from "./lyricsApi";

/**
 * Lyrics state for one track, plus the follow-with-override behaviour (spec `lyrics` — "The lyrics
 * panel shows the active line and follows playback").
 *
 * **State is tagged with the request it belongs to, and everything is derived from that tag.**
 * There is no "reset" code. A settled outcome is stored as `{ key, resolution }`, the hook knows
 * its own current key, and a result whose key does not match is treated as *not yet arrived*. So
 *
 * - a track change needs no cleanup, because the previous track's result no longer matches;
 * - a slow response for a superseded track is discarded by that same comparison, with no generation
 *   counter to keep in step with anything; and
 * - a retry is just a new key, so "loading" falls out of "no result for this key" rather than from a
 *   flag that something has to remember to clear.
 *
 * The first version did the opposite: it reset `payload`/`failure`/`following` in the effect body and
 * carried a generation counter. That is the shape `react-hooks/set-state-in-effect` exists to catch,
 * and the rule was right — a synchronous `setState` in an effect causes a cascading render, and the
 * generation counter was a second source of truth that could disagree with the payload it guarded.
 * Deriving the reset removed the bug class rather than silencing the warning.
 *
 * **The four states are a discriminated union, not three booleans.** `loading`, `unavailable`, and
 * `error` are genuinely different facts, and the most common one — `unavailable` — is not a failure.
 * Independent booleans would admit contradictory states (`loading && error`) and would make "is this
 * an error?" a judgement at every call site. The spec asks for four distinguishable states, and the
 * cheapest honest way to get that is to make the impossible combinations unrepresentable.
 */

/** The four designed answers, plus the absence of a track to answer about. */
export type LyricsPanelState =
  | { readonly kind: "no-track" }
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error" }
  | { readonly kind: "timed"; readonly lines: readonly LyricLine[] }
  | { readonly kind: "plain"; readonly text: string };

export interface LyricsPanelController {
  readonly state: LyricsPanelState;
  /** Index into the timed lines, or -1. Always -1 unless `state.kind === "timed"`. */
  readonly activeIndex: number;
  /** False once the listener has scrolled away; the panel then offers a way back. */
  readonly following: boolean;
  /** Return to the live position and resume following. */
  readonly resumeFollowing: () => void;
  /**
   * Report a scroll the listener caused, as "is the active line still in the live band".
   *
   * The decision lives here rather than in the component so `following` has exactly one owner. A
   * second copy of the flag in the panel could disagree with this one, and the symptom of that
   * disagreement — a panel that stops following, or refuses to resume — is invisible until someone
   * reads the state closely.
   */
  readonly reportScroll: (isActiveLineLive: boolean) => void;
  /** Re-request, for the error state's retry. */
  readonly retry: () => void;
}

/** What one request concluded. Mirrors the route's three outcomes exactly. */
type Resolution =
  | { readonly kind: "ok"; readonly payload: LyricsPayload }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error" };

/** A settled outcome, tagged with the key of the request that produced it. */
interface Settled {
  readonly key: string;
  readonly resolution: Resolution;
}

/**
 * The controller for one track. Mounted with `key={providerId}`, so a track change remounts it and
 * every piece of state — the settled result, the attempt counter, and the follow flag — starts fresh
 * by construction rather than by a reset.
 */
export function useLyricsForTrack(track: Track): LyricsPanelController {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [following, setFollowing] = useState(true);

  const requestKey = `${track.providerId}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    void fetchLyrics(lyricsRequestFor(track, controller.signal)).then(
      (resolution) => {
        // Tagging the result is what makes a late response harmless: if the track or the attempt has
        // moved on, this `key` no longer matches and the result is never read.
        setSettled({ key: requestKey, resolution });
      },
      () => {
        // A rejection is either this effect's own teardown or a genuine failure. Only the latter is
        // reported; the former would otherwise paint an error on a listener who simply skipped a
        // track.
        if (controller.signal.aborted) return;
        setSettled({ key: requestKey, resolution: { kind: "error" } });
      },
    );

    return () => {
      controller.abort();
    };
  }, [requestKey, track]);

  // The one derivation everything else reads. A `settled` belonging to another key is "not arrived".
  const current = settled !== null && settled.key === requestKey ? settled.resolution : null;

  const state = useMemo<LyricsPanelState>(() => {
    if (current === null) return { kind: "loading" };
    if (current.kind === "unavailable") return { kind: "unavailable" };
    if (current.kind === "error") return { kind: "error" };

    const parsed = parseLyricsPayload(current.payload);
    // Timed lines win when both exist, because they carry strictly more information.
    if (parsed.lines.length > 0) return { kind: "timed", lines: parsed.lines };
    if (parsed.plain !== null) return { kind: "plain", text: parsed.plain };
    // A successful response carrying neither kind of text is not a state the spec has, and it is
    // not a failure either. "Unavailable" is the honest reading: the provider had nothing for this
    // track.
    return { kind: "unavailable" };
  }, [current]);

  const positionSeconds = usePlayerStore((state) => state.positionSeconds);
  const timedLines = state.kind === "timed" ? state.lines : null;
  const activeIndex = useMemo(
    () => (timedLines === null ? -1 : activeLineIndex(timedLines, positionSeconds)),
    [timedLines, positionSeconds],
  );

  const resumeFollowing = useCallback(() => setFollowing(true), []);
  const reportScroll = useCallback((isActiveLineLive: boolean) => {
    // Scrolling away suspends following; scrolling back to the live position resumes it. Reading it
    // as a *set* on every scroll event, rather than only ever turning it off, is what makes
    // "return to the live position" work without the listener having to find a button first.
    setFollowing(isActiveLineLive);
  }, []);
  const retry = useCallback(() => setAttempt((previous) => previous + 1), []);

  return { state, activeIndex, following, resumeFollowing, reportScroll, retry };
}
