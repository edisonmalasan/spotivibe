import { Play, User } from "lucide-react";
import { formatClock } from "@/components/player/formatClock";
import type { TopResult } from "@/features/search/derive";
import type { ReactNode } from "react";

interface TopResultCardProps {
  top: TopResult;
  /** Refinement action for artist/album tops (query := entity name). */
  onSelect: (name: string) => void;
  /** Present once playback is wired; only meaningful for a track top. */
  onPlay?: () => void;
  /** Context-menu slot for a track top (song results expose the menu). */
  menu?: ReactNode;
}

/**
 * Prominent clear-best-match presentation (spec "A clear best match renders
 * as Top Result"). Track tops play; artist/album tops refine the query —
 * both stay within canonical Track metadata (no entity pages yet).
 */
export function TopResultCard({ top, onSelect, onPlay, menu }: TopResultCardProps) {
  if (top.kind === "track") {
    const { track } = top;
    const artistText = track.artists.map((artist) => artist.name).join(", ");
    return (
      <div
        data-testid="top-result"
        className="motion-reveal motion-feedback rounded-cards bg-carbon p-5 hover:bg-graphite"
      >
        <span className="grid size-24 place-items-center overflow-hidden rounded-images bg-graphite">
          {track.artwork[0] ? (
            // Provider artwork thumbnails: dynamic remote URLs, no optimizer
            // allowlist yet (M9 owns asset handling).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.artwork[0].url} alt="" className="size-full object-cover" />
          ) : null}
        </span>
        <p className="mt-4 truncate text-heading font-bold text-pure-white">{track.title}</p>
        <p className="truncate text-body-lg font-regular text-mist">{artistText}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-label font-bold uppercase text-mist">Song</span>
          <span className="flex items-center gap-2">
            {menu}
            {onPlay && (
              <button
                type="button"
                aria-label={`Play ${track.title}`}
                onClick={onPlay}
                className="motion-feedback grid size-10 place-items-center rounded-full bg-spotify-green text-void-black"
              >
                <Play className="size-5 fill-current" aria-hidden="true" />
              </button>
            )}
          </span>
        </div>
        {track.durationSeconds !== undefined && (
          <p className="mt-2 text-body text-mist tabular-nums">
            {formatClock(track.durationSeconds)}
          </p>
        )}
      </div>
    );
  }

  const isArtist = top.kind === "artist";
  const name = isArtist ? top.artist.name : top.album.title;
  const subtitle = isArtist ? "Artist" : top.album.artistName;
  const typeLabel = isArtist ? "Artist" : "Album";

  return (
    <button
      type="button"
      data-testid="top-result"
      className="motion-reveal motion-feedback block w-full rounded-cards bg-carbon p-5 text-left hover:bg-graphite"
      onClick={() => onSelect(name)}
    >
      <span className="grid size-24 place-items-center overflow-hidden rounded-full bg-graphite">
        {isArtist ? (
          <User className="size-10 text-fog" aria-hidden="true" />
        ) : (
          <span className="text-label font-bold uppercase text-mist">{typeLabel}</span>
        )}
      </span>
      <span className="mt-4 block truncate text-heading font-bold text-pure-white">{name}</span>
      <span className="block truncate text-body-lg font-regular text-mist">{subtitle}</span>
      <span className="mt-4 block text-label font-bold uppercase text-mist">{typeLabel}</span>
    </button>
  );
}
