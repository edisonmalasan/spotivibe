"use client";

import { IconButton } from "@/components/design-system/IconButton";
import {
  PlayPauseButton,
  RepeatToggle,
  ShuffleToggle,
  VolumeControls,
} from "@/components/player/PlaybackControls";
import { ProgressSlider } from "@/components/player/ProgressSlider";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePlayerStore } from "@/stores/playerStore";
import { ChevronDown, Heart, ListMusic, Music2, SkipBack, SkipForward } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Expanded Now Playing route (spec: store-backed playback state and control
 * synchronization). Renders the current track, seekable progress, transport,
 * shuffle/repeat, and volume/mute from the store; idle keeps the M1
 * placeholders with disabled controls. The visible "Watch on YouTube"
 * attribution links out to the watch page (policy: no referrer suppression,
 * no in-app extraction), and the bottom padding keeps content clear of the
 * docked video surface while a track is active.
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

  return (
    <div
      className={
        currentTrack
          ? "flex min-h-full flex-col items-center gap-6 px-4 py-6 pb-[320px] lg:pb-56"
          : "flex min-h-full flex-col items-center gap-6 px-4 py-6"
      }
    >
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

        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-heading font-bold text-pure-white">
            {currentTrack ? currentTrack.title : "Nothing playing"}
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
    </div>
  );
}
