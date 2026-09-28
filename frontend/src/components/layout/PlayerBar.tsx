"use client";

import { IconButton } from "@/components/design-system/IconButton";
import {
  PlayPauseButton,
  RepeatToggle,
  ShuffleToggle,
  VolumeControls,
} from "@/components/player/PlaybackControls";
import { ProgressSlider } from "@/components/player/ProgressSlider";
import { usePlayerStore } from "@/stores/playerStore";
import { useQueueStore } from "@/stores/queueStore";
import { Heart, ListMusic, Music2, SkipBack, SkipForward } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Desktop player slot (72px, void-black) below the content area (spec:
 * store-backed playback state and control synchronization). Idle state keeps
 * the M1 placeholders with disabled transport; with a track it renders the
 * real title/artist, seekable progress, transport, shuffle/repeat, and
 * volume/mute — all dispatching store actions. Errors surface in the subtitle
 * slot (role="alert") so controls stay visible and operable alongside them.
 * The queue control navigates to `/queue` with its upcoming count in the
 * accessible name (design §5).
 */
export function PlayerBar() {
  const router = useRouter();
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const errorMessage = usePlayerStore((state) => state.errorMessage);
  const previous = usePlayerStore((state) => state.previous);
  const next = usePlayerStore((state) => state.next);
  const queueLength = useQueueStore((state) => state.queue.length);
  const queueIndex = useQueueStore((state) => state.queueIndex);
  const playOrder = useQueueStore((state) => state.playOrder);

  const artworkUrl = currentTrack?.artwork[0]?.url;
  const artistText = currentTrack
    ? currentTrack.artists.map((artist) => artist.name).join(", ") || "Unknown artist"
    : "";

  // Upcoming count in traversal order (design §5): entries after the current
  // one, or the whole list when nothing is current; empty → "Queue, empty".
  const position = playOrder.indexOf(queueIndex);
  const upcomingCount =
    queueIndex >= 0 && position !== -1 ? playOrder.length - 1 - position : queueLength;
  const queueLabel = upcomingCount > 0 ? `Queue, ${upcomingCount} upcoming` : "Queue, empty";

  return (
    <div
      data-testid="player-bar"
      className="hidden h-18 shrink-0 items-center gap-6 bg-void-black px-4 lg:flex"
    >
      <Link
        href="/now-playing"
        aria-label="Open Now Playing"
        className="flex w-1/3 min-w-0 items-center gap-3"
      >
        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-images bg-graphite">
          {artworkUrl ? (
            // Provider artwork URLs are dynamic remote thumbnails; no image
            // optimizer allowlist exists yet (M9 owns asset handling).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={artworkUrl} alt="" className="size-full object-cover" />
          ) : (
            <Music2 className="size-5 text-fog" aria-hidden="true" />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body-lg font-semibold text-pure-white">
            {currentTrack ? currentTrack.title : "Nothing playing"}
          </span>
          {errorMessage ? (
            <span role="alert" className="truncate text-caption font-regular text-mist">
              {errorMessage}
            </span>
          ) : (
            <span className="truncate text-caption font-regular text-mist">
              {currentTrack ? artistText : "Choose something to start"}
            </span>
          )}
        </span>
      </Link>

      <div className="flex max-w-xl flex-1 flex-col items-center gap-2">
        <div className="flex items-center gap-4">
          <IconButton label="Previous track" disabled={!currentTrack} onClick={() => previous()}>
            <SkipBack className="size-5" aria-hidden="true" />
          </IconButton>
          <PlayPauseButton size="md" />
          <IconButton label="Next track" disabled={!currentTrack} onClick={() => next()}>
            <SkipForward className="size-5" aria-hidden="true" />
          </IconButton>
        </div>
        <ProgressSlider />
      </div>

      <div className="flex w-1/3 items-center justify-end gap-2">
        <ShuffleToggle />
        <RepeatToggle />
        <IconButton label="Save to Liked Songs" disabled>
          <Heart className="size-5" aria-hidden="true" />
        </IconButton>
        <IconButton label={queueLabel} onClick={() => router.push("/queue")}>
          <ListMusic className="size-5" aria-hidden="true" />
        </IconButton>
        <VolumeControls />
      </div>
    </div>
  );
}
