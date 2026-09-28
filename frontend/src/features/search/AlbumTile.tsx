import { AlbumCard } from "@/components/design-system/AlbumCard";
import type { DerivedAlbum } from "@/features/search/derive";

interface AlbumTileProps {
  album: DerivedAlbum;
  onSelect: (name: string) => void;
}

/**
 * Derived album entry: the card itself is the refinement action
 * (design §8 — go-to-album sets the query until M9 album pages exist).
 */
export function AlbumTile({ album, onSelect }: AlbumTileProps) {
  return (
    <button type="button" className="block w-full text-left" onClick={() => onSelect(album.title)}>
      <AlbumCard title={album.title} artist={album.artistName} />
    </button>
  );
}
