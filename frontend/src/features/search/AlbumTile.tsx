import Link from "next/link";
import { AlbumCard } from "@/components/design-system/AlbumCard";
import { albumHrefFromRelease } from "@/features/album/albumKeys";
import type { DerivedAlbum } from "@/features/search/derive";

interface AlbumTileProps {
  album: DerivedAlbum;
}

/**
 * The provider's release id for a derived album, when it supplied one.
 *
 * `deriveResults` builds each entry from the first `track.album` summary it saw,
 * and keeps that track as the representative — so the representative's album
 * summary is the release the entry describes. No id is not an error: the route
 * then resolves the minted `<title> - <artist>` text key, which is the common
 * case because providers expose no album lookup at any tier.
 */
function releaseIdFor(album: DerivedAlbum): string | undefined {
  return album.track.album?.id;
}

/**
 * Derived album entry (M9 task 6.1; spec: `catalog` — "Catalog entity keys and
 * resolution requests").
 *
 * The card is one **link** to the release page rather than a refine-the-query
 * button, and the link is minted by the one album-route helper so a link built
 * here classifies straight back into the identifiers it was built from.
 *
 * Signature change: `onSelect(name)` is gone — the tile no longer refines the
 * search query, so it has no callback left to call.
 */
export function AlbumTile({ album }: AlbumTileProps) {
  return (
    <Link
      href={albumHrefFromRelease({
        id: releaseIdFor(album),
        title: album.title,
        artistName: album.artistName,
      })}
      data-testid="search-album-tile"
      className="block w-full"
    >
      <AlbumCard title={album.title} artist={album.artistName} />
    </Link>
  );
}
