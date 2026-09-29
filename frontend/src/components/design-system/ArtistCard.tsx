import { User } from "lucide-react";

/**
 * Intrinsic photo size for `artworkUrl` (M8 shelves). The circle is fluid, so
 * the attributes only declare the 1:1 ratio the browser reserves before the
 * image arrives — the layout shift guard DESIGN.md's circular crop needs.
 */
const ARTWORK_SIZE = 300;

interface ArtistCardProps {
  name: string;
  label?: string;
  /**
   * Optional real artist photo (design §7). Popular Artists resolves the best
   * available artwork per artist; surfaces without one (search tiles) omit it
   * and keep the monochrome placeholder rather than an empty circle.
   */
  artworkUrl?: string;
  className?: string;
}

/**
 * DESIGN.md "Circular Artist Card": no card fill at rest (the circle is the visual),
 * 500px-radius circular crop, name white 14px/600, 'Artist' label mist 12px,
 * 12px gap between circle and text; hover lifts the card surface.
 */
export function ArtistCard({
  name,
  label = "Artist",
  artworkUrl,
  className = "",
}: ArtistCardProps) {
  return (
    <article
      className={`flex w-full flex-col gap-3 rounded-cards p-3 transition-colors hover:bg-graphite ${className}`}
    >
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-avatars bg-graphite">
        {artworkUrl === undefined ? (
          <User className="size-10 text-fog" aria-hidden="true" />
        ) : (
          // Provider artist photos: dynamic remote URLs, no optimizer
          // allowlist yet (M9 owns asset handling).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={artworkUrl}
            alt={name}
            width={ARTWORK_SIZE}
            height={ARTWORK_SIZE}
            loading="lazy"
            className="size-full rounded-avatars object-cover"
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-body-lg font-semibold text-pure-white">{name}</h3>
        <span className="text-label font-regular text-mist">{label}</span>
      </div>
    </article>
  );
}
