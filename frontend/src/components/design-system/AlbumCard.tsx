import { Music2 } from "lucide-react";

/**
 * Intrinsic cover size for `artworkUrl` (M8 shelves). The cover box is fluid, so
 * the attributes only declare the 1:1 ratio the browser reserves before the
 * image arrives — the layout shift guard DESIGN.md's "tight square crop" needs.
 */
const ARTWORK_SIZE = 300;

interface AlbumCardProps {
  title: string;
  artist: string;
  /**
   * Optional real cover image (design §7). Discovery shelves resolve provider
   * artwork; surfaces without one (search tiles) omit it and keep the
   * monochrome placeholder, so the card never renders a broken image box.
   */
  artworkUrl?: string;
  className?: string;
}

/**
 * DESIGN.md "Square Album Card": carbon surface (blends into the carbon main content),
 * 6px card radius, 12px card padding, square 1:1 cover at 6px image radius,
 * title white 14px/600, artist mist 14px/400, hover lifts to graphite.
 */
export function AlbumCard({ title, artist, artworkUrl, className = "" }: AlbumCardProps) {
  return (
    <article
      className={`motion-reveal motion-feedback flex w-full flex-col gap-2 rounded-cards bg-carbon p-3 hover:bg-graphite ${className}`}
    >
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-images bg-graphite">
        {artworkUrl === undefined ? (
          <Music2 className="size-8 text-fog" aria-hidden="true" />
        ) : (
          // Provider artwork thumbnails: dynamic remote URLs, no optimizer
          // allowlist yet (M9 owns asset handling).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artworkUrl}
            alt={title}
            width={ARTWORK_SIZE}
            height={ARTWORK_SIZE}
            loading="lazy"
            className="size-full rounded-cards object-cover"
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-body-lg font-semibold text-pure-white">{title}</h3>
        <p className="text-body-lg font-regular text-mist">{artist}</p>
      </div>
    </article>
  );
}
