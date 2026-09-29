import { Music2 } from "lucide-react";

interface PlaylistCoverProps {
  /**
   * Derived/own cover URLs (design §8): 0 → placeholder tile, 1 → single
   * image, 2–4 → 2×2 grid with graphite-filling empty cells.
   */
  urls: string[];
  /** Cover box size (square) — e.g. `aspect-square w-full` for cards. */
  className?: string;
}

/**
 * DESIGN.md "Square Album Card" cover block for playlists: 6px image radius,
 * graphite backing, monochrome Music2 placeholder — used by the library
 * grid, the playlist detail hero, and the sidebar entries. Decorative
 * (`aria-hidden`): the entry's accessible name carries the playlist title.
 */
export function PlaylistCover({ urls, className = "" }: PlaylistCoverProps) {
  const box = `overflow-hidden rounded-images bg-graphite ${className}`;

  if (urls.length === 0) {
    return (
      <div className={`flex items-center justify-center ${box}`} aria-hidden="true">
        <Music2 className="size-8 text-fog" />
      </div>
    );
  }

  if (urls.length === 1) {
    return (
      <div className={box} aria-hidden="true">
        {/* Provider artwork thumbnails: dynamic remote URLs, no optimizer
            allowlist yet (M9 owns asset handling). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={urls[0]} alt="" className="size-full object-cover" />
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-2 grid-rows-2 ${box}`} aria-hidden="true">
      {urls.map((url, index) => (
        <span key={`${url}-${index}`} className="block overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="size-full object-cover" />
        </span>
      ))}
    </div>
  );
}
