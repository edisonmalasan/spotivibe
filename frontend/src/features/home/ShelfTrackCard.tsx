import { Music2 } from "lucide-react";
import type { Track } from "@/data/repositories";
import { playFromShelf } from "@/features/home/browsePlayback";
import { bestArtworkUrl } from "@/lib/playlistPresentation";

/**
 * A playable square track card for a discovery shelf (DESIGN.md "Square Album
 * Card"; design §9: shelf activation).
 *
 * The whole card is one real `<button>`, so it is keyboard operable and carries
 * a visible focus ring through the global `:focus-visible` outline — a
 * click-handling `<div>` would satisfy neither. The accessible name names *both*
 * the track and its artist, which is what a screen-reader user needs to decide
 * whether to activate a tile they cannot see.
 *
 * Geometry follows DESIGN.md exactly: 6px card radius, 12px padding, a 1:1 cover
 * at the 6px image radius, title white 14px/600, artist mist 14px/400, carbon
 * `#121212` surface lifting to graphite `#1f1f1f` on hover. With no artwork the
 * card keeps the same monochrome `Music2` placeholder `AlbumCard` uses, so a
 * shelf never renders a broken image box.
 *
 * Activation is the only way this card starts playback: rendering it, or the
 * shelf resolving, plays nothing.
 */

/** Intrinsic cover size; the box is fluid, so this only declares the 1:1 ratio. */
const ARTWORK_SIZE = 300;

export interface ShelfTrackCardProps {
  /** The track this card plays. */
  track: Track;
  /** The shelf's tracks — the playback context, so a shelf plays through. */
  context: readonly Track[];
  className?: string;
}

/** `Daft Punk, Pharrell Williams`, or a neutral label for no credited artist. */
function artistText(track: Track): string {
  const names = track.artists.map((artist) => artist.name.trim()).filter((name) => name !== "");
  return names.length > 0 ? names.join(", ") : "Unknown artist";
}

/**
 * One playable track tile. Click, Enter, and Space all go through
 * `playFromShelf`, which records the `browse` queue source.
 */
export function ShelfTrackCard({ track, context, className = "" }: ShelfTrackCardProps) {
  const artwork = bestArtworkUrl(track);
  const artists = artistText(track);

  return (
    <button
      type="button"
      data-testid="shelf-track-card"
      aria-label={`Play ${track.title} by ${artists}`}
      onClick={() => {
        playFromShelf(track, context);
      }}
      className={`flex w-full flex-col gap-2 rounded-cards bg-carbon p-3 text-left transition-colors hover:bg-graphite ${className}`}
    >
      <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-cards bg-graphite">
        {artwork === undefined ? (
          <Music2 className="size-8 text-fog" aria-hidden="true" />
        ) : (
          // Provider artwork thumbnails: dynamic remote URLs, no optimizer
          // allowlist yet (M9 owns asset handling).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artwork}
            alt=""
            width={ARTWORK_SIZE}
            height={ARTWORK_SIZE}
            loading="lazy"
            className="size-full rounded-cards object-cover"
          />
        )}
      </span>
      <span className="flex flex-col gap-1">
        <span className="truncate text-body-lg font-semibold text-pure-white">{track.title}</span>
        <span className="truncate text-body-lg font-regular text-mist">{artists}</span>
      </span>
    </button>
  );
}
