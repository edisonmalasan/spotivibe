import { Music2 } from "lucide-react";

interface AlbumCardProps {
  title: string;
  artist: string;
  className?: string;
}

/**
 * DESIGN.md "Square Album Card": carbon surface (blends into the carbon main content),
 * 6px card radius, 12px card padding, square 1:1 cover at 6px image radius,
 * title white 14px/600, artist mist 14px/400, hover lifts to graphite.
 */
export function AlbumCard({ title, artist, className = "" }: AlbumCardProps) {
  return (
    <article
      className={`flex w-full flex-col gap-2 rounded-cards bg-carbon p-3 transition-colors hover:bg-graphite ${className}`}
    >
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-images bg-graphite">
        <Music2 className="size-8 text-fog" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-body-lg font-semibold text-pure-white">{title}</h3>
        <p className="text-body-lg font-regular text-mist">{artist}</p>
      </div>
    </article>
  );
}
