import { Play } from "lucide-react";
import { formatClock } from "@/components/player/formatClock";
import type { Track } from "@/data/repositories";
import type { ReactNode } from "react";

interface SongRowProps {
  track: Track;
  /** Present once playback is wired; the row shows a play affordance then. */
  onPlay?: () => void;
  /** Trailing slot for row context actions (result menu). */
  trailing?: ReactNode;
}

/**
 * Feature-local song row (design §8 keeps the primitive out of the design
 * system until another feature needs it): canonical track information in
 * relevance order — artwork, title, artists, album, duration.
 */
export function SongRow({ track, onPlay, trailing }: SongRowProps) {
  const artistText = track.artists.map((artist) => artist.name).join(", ");

  return (
    <li className="flex items-center gap-3 rounded-cards bg-smoke px-3 py-2 transition-colors hover:bg-graphite">
      {onPlay && (
        <button
          type="button"
          aria-label={`Play ${track.title}`}
          onClick={onPlay}
          className="grid size-8 shrink-0 place-items-center rounded-full bg-spotify-green text-void-black transition hover:scale-105"
        >
          <Play className="size-4 fill-current" aria-hidden="true" />
        </button>
      )}
      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-images bg-graphite">
        {track.artwork[0] ? (
          // Provider artwork thumbnails: dynamic remote URLs, no optimizer
          // allowlist yet (M9 owns asset handling).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={track.artwork[0].url} alt="" className="size-full object-cover" />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body-lg font-regular text-pure-white">{track.title}</span>
        <span className="truncate text-body text-mist">{artistText}</span>
      </span>
      {track.album && (
        <span className="hidden w-40 shrink-0 truncate text-body text-mist md:block">
          {track.album.title}
        </span>
      )}
      {track.durationSeconds !== undefined && (
        <span className="shrink-0 text-body text-mist tabular-nums">
          {formatClock(track.durationSeconds)}
        </span>
      )}
      {trailing}
    </li>
  );
}
