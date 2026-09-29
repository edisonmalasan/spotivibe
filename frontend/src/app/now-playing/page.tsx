"use client";

import { Button } from "@/components/design-system/Button";
import { IconButton } from "@/components/design-system/IconButton";
import {
  PlayPauseButton,
  RepeatToggle,
  ShuffleToggle,
  VolumeControls,
} from "@/components/player/PlaybackControls";
import { ProgressSlider } from "@/components/player/ProgressSlider";
import { startTrackRadio, stopRadio, useRadioStatus } from "@/features/personalization/startRadio";
import { clearRefillFailure } from "@/features/personalization/RefillAgent";
import { MoreLikeThisShelf } from "@/features/related/MoreLikeThisShelf";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePlayerStore } from "@/stores/playerStore";
import { ChevronDown, Heart, ListMusic, Music2, Radio, SkipBack, SkipForward } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Expanded Now Playing route (spec: store-backed playback state and control
 * synchronization). Renders the current track, seekable progress, transport,
 * shuffle/repeat, and volume/mute from the store; idle keeps the M1
 * placeholders with disabled controls. The visible "Watch on YouTube"
 * attribution links out to the watch page (policy: no referrer suppression,
 * no in-app extraction), and the bottom padding keeps content clear of the
 * docked video surface while a track is active.
 *
 * M9 added the surface's presentation layer (spec: `catalog` — "Now Playing
 * presentation of the current track"; design decisions 6 and 7), none of which
 * introduces state:
 *
 * - **Artwork-derived background.** The current artwork is rendered as a
 *   blurred, low-opacity, oversized backdrop behind the content — genuinely
 *   artwork-derived, with no canvas sampling and no extra request (decision 6).
 *   A track with no artwork renders the plain surface: no empty image box, no
 *   broken-image placeholder.
 * - **Long-title treatment.** The title sits in a fixed-width overflow box; a
 *   CSS keyframe scrolls a *duplicated* title only when the title was measured
 *   to overflow, and never under `prefers-reduced-motion` (decision 7). The
 *   measurement runs once per title change — no observer, no per-frame work —
 *   and the full string stays available as the element's `title`.
 * - **More Like This.** A related-content shelf for the playing track, rendered
 *   below the transport area and inside the existing bottom padding so it
 *   clears the docked player. It reuses the shared shelf primitives and never
 *   autoplays.
 *
 * The surface reads exactly the same `playerStore`/`libraryStore` slices as
 * before, so it and the player region cannot disagree about the current track,
 * status, position, or like state without a reload.
 *
 * M10 adds the radio entry point (spec: `app-shell` — "Now Playing surface"):
 *
 * - **A radio action, omitted without a seed.** A radio needs an identity, so
 *   the control is rendered only when there *is* a current track — never as a
 *   disabled affordance, which would offer an action the surface cannot perform.
 *   Activating it starts one radio from that track and replaces the queue.
 * - **A radio indicator while one is playing.** Presentational only: it reads
 *   `useRadioStatus`, so the label follows the same store the refill agent and
 *   the queue view read and cannot disagree with them.
 * - **A non-blocking retry after a refused start.** A start the engine could not
 *   complete leaves the queue and playback untouched, so this surface says so
 *   and offers to try again — a polite status line, never a modal and never a
 *   disabled control.
 */
export default function NowPlayingPage() {
  const router = useRouter();
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const errorMessage = usePlayerStore((state) => state.errorMessage);
  const previous = usePlayerStore((state) => state.previous);
  const next = usePlayerStore((state) => state.next);
  const likedIds = useLibraryStore((state) => state.likedIds);
  const hydrate = useLibraryStore((state) => state.hydrate);
  const toggleLike = useLibraryStore((state) => state.toggleLike);
  const isLiked = currentTrack != null && likedIds?.has(currentTrack.id) === true;
  // M10: the radio's own state, read from the same store the refill agent uses.
  const radio = useRadioStatus();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const artworkUrl = currentTrack?.artwork[0]?.url;
  const artistText = currentTrack
    ? currentTrack.artists.map((artist) => artist.name).join(", ") || "Unknown artist"
    : "";
  const watchUrl = currentTrack
    ? `https://www.youtube.com/watch?v=${currentTrack.providerId}`
    : null;
  const displayTitle = currentTrack ? currentTrack.title : "Nothing playing";

  // The long-title treatment is one boolean of *presentation* state derived by
  // measuring the DOM, never a second source of playback truth.
  const titleBoxRef = useRef<HTMLParagraphElement>(null);
  const titleTextRef = useRef<HTMLSpanElement>(null);
  const [titleOverflows, setTitleOverflows] = useState(false);

  useEffect(() => {
    const box = titleBoxRef.current;
    const text = titleTextRef.current;
    if (box === null || text === null) {
      setTitleOverflows(false);
      return;
    }
    // Measured once per title change (design decision 7): a `ResizeObserver` or
    // a scroll listener would be per-frame work for a purely cosmetic effect.
    // `text` is the intrinsic width of one title copy and `box` is the width it
    // has to fit, in both the static and the scrolling form, so the same
    // comparison is valid whichever state the previous title left behind.
    setTitleOverflows(text.scrollWidth > box.clientWidth);
  }, [displayTitle]);

  /**
   * M10: start a radio from the current track, or re-try one that was refused.
   *
   * One helper for both buttons so the two affordances cannot drift — they are
   * the same action, offered at two moments. It takes the track from the closure
   * rather than reading the store again, so it can never act on a track that
   * changed between the render and the click.
   */
  const startRadioFromCurrent = (): void => {
    if (currentTrack === null) return;
    void startTrackRadio(currentTrack);
  };

  /**
   * Ending a radio is not a playback action: the queue keeps playing exactly as
   * it is, and only the radio's identity and its refills go away. The queue's own
   * source is left alone, because the radio's tracks are still the queue.
   */
  const endRadio = (): void => {
    stopRadio();
    clearRefillFailure();
  };

  /**
   * The retry line appears only when nothing is playing as a radio *and* the last
   * attempt is what failed — a failed refill of a live radio is the refill
   * agent's notice to show, and it clears the message itself when the radio
   * resumes, so this surface never duplicates or contradicts it.
   */
  const showRadioRetry = radio.error !== null && !radio.active && currentTrack !== null;

  return (
    <div
      className={
        currentTrack
          ? "relative isolate flex min-h-full flex-col items-center gap-6 px-4 py-6 pb-[320px] lg:pb-56"
          : "relative isolate flex min-h-full flex-col items-center gap-6 px-4 py-6"
      }
    >
      {/*
        The artwork backdrop sits behind every layer of content: `isolate` on the
        root keeps the negative z-index inside this subtree, and
        `pointer-events-none` plus `aria-hidden` make it purely decorative.
      */}
      {artworkUrl ? (
        // Provider artwork thumbnails: dynamic remote URLs, no optimizer
        // allowlist yet (M9 owns asset handling).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artworkUrl}
          alt=""
          aria-hidden="true"
          data-testid="now-playing-background"
          className="pointer-events-none absolute inset-0 -z-10 size-full scale-110 object-cover opacity-30 blur-2xl"
        />
      ) : null}

      <div className="flex w-full max-w-3xl items-center justify-between">
        <Link
          href="/"
          aria-label="Close Now Playing"
          className="inline-flex size-8 items-center justify-center rounded-buttons text-pure-white transition hover:bg-smoke"
        >
          <ChevronDown className="size-5" aria-hidden="true" />
        </Link>
        <h1 className="text-link font-bold text-pure-white">Now Playing</h1>
        <span className="size-8" aria-hidden="true" />
      </div>

      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-images bg-graphite">
          {artworkUrl ? (
            // Provider artwork thumbnails: dynamic remote URLs, no optimizer
            // allowlist yet (M9 owns asset handling).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={artworkUrl} alt="" className="size-full object-cover" />
          ) : (
            <Music2 className="size-16 text-fog" aria-hidden="true" />
          )}
        </div>

        <div className="flex w-full flex-col items-center gap-1 text-center">
          {/*
            The title box is a fixed-width, single-line overflow container. It
            holds one copy of the title when the text fits — statically, with the
            full string on `title` — and a two-copy track scrolled by one copy's
            width when it does not, which loops seamlessly. The second copy is
            `aria-hidden`, so the accessible name stays a single full title
            whichever form is rendered; `aria-label` states it explicitly rather
            than letting the duplicated text be read twice.
          */}
          <p
            ref={titleBoxRef}
            data-testid="now-playing-title"
            title={displayTitle}
            aria-label={displayTitle}
            className="w-full overflow-hidden whitespace-nowrap text-heading font-bold text-pure-white"
          >
            <span className={titleOverflows ? "inline-block w-max" : "block"}>
              <span ref={titleTextRef} className={titleOverflows ? "pr-8" : "block truncate"}>
                {displayTitle}
              </span>
              {titleOverflows ? (
                <span className="now-playing-marquee inline-block" aria-hidden="true">
                  <span className="pr-8">{displayTitle}</span>
                </span>
              ) : null}
            </span>
          </p>
          <p className="text-body-lg font-regular text-mist">
            {currentTrack ? artistText : "Choose something to start"}
          </p>
        </div>

        {errorMessage ? (
          <p role="alert" className="text-body font-regular text-pure-white">
            {errorMessage}
          </p>
        ) : null}

        <ProgressSlider />

        {/*
          M10: the radio's two presentation pieces, both reading the same store
          the refill agent and the queue view read. The indicator is text, not an
          icon-only control, so the state is announced rather than implied.
        */}
        {radio.active ? (
          <p
            data-testid="now-playing-radio-indicator"
            className="flex items-center gap-2 text-body-lg font-regular text-mist"
          >
            <Radio className="size-4" aria-hidden="true" />
            <span>Radio</span>
          </p>
        ) : null}
        {showRadioRetry ? (
          <div
            role="status"
            data-testid="now-playing-radio-failure"
            className="flex flex-wrap items-center justify-center gap-2"
          >
            <span className="text-body-lg font-regular text-pure-white">{radio.error}</span>
            <Button variant="pill" onClick={startRadioFromCurrent}>
              Try again
            </Button>
          </div>
        ) : null}

        <div className="flex items-center gap-4">
          <IconButton
            label={isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"}
            disabled={!currentTrack}
            onClick={() => {
              if (currentTrack) void toggleLike(currentTrack);
            }}
          >
            <Heart className={isLiked ? "size-5 fill-current" : "size-5"} aria-hidden="true" />
          </IconButton>
          <IconButton label="Previous track" disabled={!currentTrack} onClick={() => previous()}>
            <SkipBack className="size-5" aria-hidden="true" />
          </IconButton>
          <PlayPauseButton size="md" />
          <IconButton label="Next track" disabled={!currentTrack} onClick={() => next()}>
            <SkipForward className="size-5" aria-hidden="true" />
          </IconButton>
          <IconButton label="Queue" onClick={() => router.push("/queue")}>
            <ListMusic className="size-5" aria-hidden="true" />
          </IconButton>
          {/* A radio needs a seed, so the action is omitted rather than disabled.
              While one is playing the same control ends it — the radio is
              cancelable (spec: "Radio modes"), and a control that only ever
              starts would leave no way out. */}
          {currentTrack !== null ? (
            <IconButton
              label={radio.active ? "End radio" : "Start track radio"}
              data-testid="now-playing-radio"
              onClick={radio.active ? endRadio : startRadioFromCurrent}
            >
              <Radio className="size-5" aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>

        <div className="flex items-center gap-4">
          <ShuffleToggle />
          <RepeatToggle />
          <VolumeControls />
        </div>

        {watchUrl ? (
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener"
            data-testid="now-playing-attribution"
            className="text-body font-regular text-mist underline-offset-2 transition-colors hover:text-pure-white hover:underline"
          >
            Watch on YouTube
          </a>
        ) : null}
      </div>

      <div className="w-full max-w-3xl">
        <MoreLikeThisShelf />
      </div>
    </div>
  );
}
