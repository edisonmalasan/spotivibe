"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePlayerStore } from "@/stores/playerStore";
import type { Track } from "@/data/repositories";
import { ErrorState } from "@/components/design-system/ErrorState";
import { Skeleton } from "@/components/design-system/Skeleton";
import { scrollBehaviorFor, usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useLyricsForTrack } from "./useLyricsPanel";

/**
 * The Now Playing lyrics panel (ROADMAP M16, spec `lyrics`).
 *
 * A sibling in the existing Now Playing column — not an overlay, and not a tab. A tab was
 * considered and rejected: lyrics are only useful *while the track plays*, so hiding them behind a
 * control that also competes with the transport for attention is the wrong trade, and at 390x844
 * there is no room for a second navigation row.
 *
 * **The active line is `aria-current`, not an `aria-live` region.** Position advances about once a
 * second, so a live region would announce a new line every second — noise, not information. The
 * line's own current state is available to assistive technology on demand, which is strictly more
 * than the previous behaviour (Lyrix renders unlabelled divs) and far less speech.
 *
 * **Following yields.** A listener who scrolls away from the live position gets a "back to live"
 * control instead of a panel that drags itself back mid-sentence. This is the single most *felt*
 * difference between a lyrics panel that is pleasant to read and one that is not.
 */
export function LyricsPanel() {
  const currentTrack = usePlayerStore((state) => state.currentTrack);

  // "no track" is one of the four designed states, and the honest rendering of it is absence: an
  // empty Now Playing has nothing to be loading, unavailable, or broken about.
  if (currentTrack === null) return null;

  // The `key` is the mechanism for reset-on-track-change. Remounting on the provider id gives the
  // lyrics, the active line, the scroll position, and the follow flag a clean start with no reset
  // code to get wrong — and it is why the controller needs no cleanup for a superseded track.
  return <LyricsForTrack key={currentTrack.providerId} track={currentTrack} />;
}

function LyricsForTrack({ track }: { track: Track }) {
  const { state, activeIndex, following, resumeFollowing, reportScroll, retry } =
    useLyricsForTrack(track);
  const reducedMotion = usePrefersReducedMotion();

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLLIElement | null>>([]);

  const scrollActiveLineIntoView = useCallback(
    (index: number) => {
      const scroller = scrollerRef.current;
      const line = lineRefs.current[index];
      if (!scroller || !line) return;

      // Centre the line in the panel's viewport, measured from the two rects rather than from
      // `offsetTop` arithmetic. Lyrix computes `el.offsetTop - container.offsetTop`, which assumes
      // the scroller *is* the line's offset parent; that stops being true the moment the panel
      // gains a positioned wrapper, and the failure is a scroll to a plausible-looking wrong place
      // rather than an obvious error.
      const scrollerRect = scroller.getBoundingClientRect();
      const lineRect = line.getBoundingClientRect();
      const delta = lineRect.top - scrollerRect.top - (scroller.clientHeight - lineRect.height) / 2;
      if (delta === 0) return;
      scroller.scrollBy({ top: delta, behavior: scrollBehaviorFor(reducedMotion) });
    },
    [reducedMotion],
  );

  useEffect(() => {
    // Only while following. A listener who has scrolled away must not be dragged back.
    if (!following) return;
    if (state.kind !== "timed" || activeIndex < 0) return;
    scrollActiveLineIntoView(activeIndex);
  }, [following, state.kind, activeIndex, scrollActiveLineIntoView]);

  /**
   * Whether the active line currently sits in the panel's live band.
   *
   * Following is decided by *where the active line is*, not by *how the panel got there*. An
   * earlier draft compared scroll offsets against the last known value, which cannot distinguish a
   * smooth programmatic scroll — which fires a `scroll` event for every animation frame — from a
   * one-frame drag, so it read the panel's own scrolling as a manual scroll and switched following
   * off moments after enabling it. This rule cannot be tripped that way: the panel's own scroll
   * always ends with the line centred, and any listener scroll that moves the line out of the
   * middle band trips it.
   */
  const isActiveLineLive = useCallback((): boolean => {
    const scroller = scrollerRef.current;
    const line = activeIndex >= 0 ? lineRefs.current[activeIndex] : null;
    if (!scroller || !line) return true;
    const scrollerRect = scroller.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const bandTop = scrollerRect.top + scrollerRect.height * 0.25;
    const bandBottom = scrollerRect.top + scrollerRect.height * 0.75;
    return lineRect.top + lineRect.height >= bandTop && lineRect.top <= bandBottom;
  }, [activeIndex]);

  const handleScroll = useCallback(() => {
    reportScroll(isActiveLineLive());
  }, [isActiveLineLive, reportScroll]);

  return (
    <section
      aria-label="Lyrics"
      data-testid="lyrics-panel"
      data-lyrics-state={state.kind}
      className="flex min-h-0 flex-col gap-2"
    >
      {state.kind === "loading" ? <LoadingState /> : null}

      {state.kind === "unavailable" ? (
        <p data-testid="lyrics-unavailable" className="px-1 py-2 text-sm text-neutral-400">
          No lyrics available for this track.
        </p>
      ) : null}

      {state.kind === "error" ? (
        <div data-testid="lyrics-error">
          <ErrorState
            title="Lyrics couldn't be loaded"
            description="The lyrics service didn't respond. Playback is unaffected."
            onRetry={retry}
            // Deliberately not "Try again": the radio's own failure surface on this same page
            // already offers a button with exactly that label, and two identically-labelled retry
            // buttons on one screen leave the listener no way to tell which thing they are
            // retrying. A surface-level collision that only showed up in an existing test.
            retryLabel="Try lyrics again"
          />
        </div>
      ) : null}

      {state.kind === "plain" ? (
        <div
          data-testid="lyrics-plain"
          className="max-h-64 overflow-y-auto whitespace-pre-wrap px-1 py-2 text-sm leading-7 text-neutral-300"
        >
          {state.text}
        </div>
      ) : null}

      {state.kind === "timed" ? (
        <>
          <div
            ref={scrollerRef}
            onScroll={handleScroll}
            data-testid="lyrics-scroller"
            data-following={following}
            data-reduced-motion={reducedMotion}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <ol className="flex flex-col gap-4 py-6">
              {state.lines.map((line, index) => {
                const isActive = index === activeIndex;
                return (
                  <li
                    key={`${line.time}-${index}`}
                    ref={(element) => {
                      lineRefs.current[index] = element;
                    }}
                    data-testid="lyrics-line"
                    data-active={isActive}
                    aria-current={isActive ? "true" : undefined}
                    className={
                      isActive
                        ? "text-base font-semibold text-base-content"
                        : "text-base text-neutral-500 transition-colors"
                    }
                  >
                    {line.text}
                  </li>
                );
              })}
            </ol>
          </div>
          {following ? null : (
            <button
              type="button"
              onClick={resumeFollowing}
              data-testid="lyrics-back-to-live"
              className="self-start rounded-full bg-base-surface px-3 py-1 text-xs font-semibold text-base-content"
            >
              Back to live
            </button>
          )}
        </>
      ) : null}
    </section>
  );
}

/** A short skeleton run, so the panel reserves its space without claiming lyrics exist. */
function LoadingState() {
  return (
    <div data-testid="lyrics-loading" className="flex flex-col gap-3 py-2">
      <Skeleton variant="text" className="w-4/5" />
      <Skeleton variant="text" className="w-3/5" />
      <Skeleton variant="text" className="w-2/3" />
    </div>
  );
}
