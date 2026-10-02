import { Play } from "lucide-react";
import { formatClock } from "@/components/player/formatClock";
import type { Track } from "@/data/repositories";
import type { ReactNode } from "react";

interface SongRowProps {
  track: Track;
  /** Present once playback is wired; the row body becomes the activation. */
  onPlay?: () => void;
  /** Trailing slot for row context actions (result menu) — outside the row body. */
  trailing?: ReactNode;
}

function RowBody({ track, interactive }: { track: Track; interactive: boolean }) {
  const artistText = track.artists.map((artist) => artist.name).join(", ");

  return (
    <>
      {interactive && (
        // Decorative affordance — the button's accessible name is its label.
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-spotify-green text-void-black"
        >
          <Play className="size-4 fill-current" />
        </span>
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
    </>
  );
}

/**
 * Shared song row (`components/track` — design §11 moved it out of
 * `features/search` for its first non-search consumer, the M7 library):
 * canonical track information in
 * relevance order — play affordance, artwork, title, artists, album, duration.
 * Activation covers the row body so "click the result" and keyboard activation
 * are the same control; context actions stay outside it (no nested buttons).
 */
export function SongRow({ track, onPlay, trailing }: SongRowProps) {
  return (
    <li className="motion-feedback flex items-center gap-3 rounded-cards bg-smoke px-3 py-2 hover:bg-graphite">
      {onPlay ? (
        <button
          type="button"
          aria-label={`Play ${track.title}`}
          onClick={onPlay}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <RowBody track={track} interactive />
        </button>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <RowBody track={track} interactive={false} />
        </span>
      )}
      {trailing}
    </li>
  );
}
