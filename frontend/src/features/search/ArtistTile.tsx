import { ArtistCard } from "@/components/design-system/ArtistCard";
import type { DerivedArtist } from "@/features/search/derive";

interface ArtistTileProps {
  artist: DerivedArtist;
  onSelect: (name: string) => void;
}

/**
 * Derived artist entry: the card itself is the refinement action
 * (design §8 — go-to-artist sets the query until M9 artist pages exist).
 */
export function ArtistTile({ artist, onSelect }: ArtistTileProps) {
  return (
    <button type="button" className="block w-full text-left" onClick={() => onSelect(artist.name)}>
      <ArtistCard name={artist.name} />
    </button>
  );
}
