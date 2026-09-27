import { User } from "lucide-react";

interface ArtistCardProps {
  name: string;
  label?: string;
  className?: string;
}

/**
 * DESIGN.md "Circular Artist Card": no card fill at rest (the circle is the visual),
 * 500px-radius circular crop, name white 14px/600, 'Artist' label mist 12px,
 * 12px gap between circle and text; hover lifts the card surface.
 */
export function ArtistCard({ name, label = "Artist", className = "" }: ArtistCardProps) {
  return (
    <article
      className={`flex w-full flex-col gap-3 rounded-cards p-3 transition-colors hover:bg-graphite ${className}`}
    >
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-avatars bg-graphite">
        <User className="size-10 text-fog" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-body-lg font-semibold text-pure-white">{name}</h3>
        <span className="text-label font-regular text-mist">{label}</span>
      </div>
    </article>
  );
}
