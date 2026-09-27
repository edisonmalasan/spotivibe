"use client";

import { PlayPauseButton } from "@/components/player/PlaybackControls";
import { usePlayerStore } from "@/stores/playerStore";
import { Music2 } from "lucide-react";
import Link from "next/link";

/**
 * Compact-shell player slot above the bottom navigation (void-black strip):
 * artwork/title cluster linking to the expanded Now Playing route plus the
 * store-driven play/pause affordance. Errors surface in the subtitle slot
 * (role="alert"). Hidden from 1024px up (PlayerBar takes over).
 */
export function MiniPlayer() {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const errorMessage = usePlayerStore((state) => state.errorMessage);

  const artworkUrl = currentTrack?.artwork[0]?.url;
  const artistText = currentTrack
    ? currentTrack.artists.map((artist) => artist.name).join(", ") || "Unknown artist"
    : "";

  return (
    <div
      data-testid="mini-player"
      className="flex h-14 shrink-0 items-center gap-3 bg-void-black px-3"
    >
      <Link
        href="/now-playing"
        aria-label="Open Now Playing"
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-images bg-graphite">
          {artworkUrl ? (
            // Provider artwork thumbnails: dynamic remote URLs, no optimizer
            // allowlist yet (M9 owns asset handling).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={artworkUrl} alt="" className="size-full object-cover" />
          ) : (
            <Music2 className="size-4 text-fog" aria-hidden="true" />
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
      <PlayPauseButton />
    </div>
  );
}
