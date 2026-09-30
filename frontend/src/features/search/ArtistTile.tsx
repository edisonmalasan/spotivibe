import Link from "next/link";
import { ArtistCard } from "@/components/design-system/ArtistCard";
import { artistHref } from "@/features/artist/artistKeys";
import type { DerivedArtist } from "@/features/search/derive";

interface ArtistTileProps {
  artist: DerivedArtist;
}

/**
 * The provider id for a derived artist, when the tier that produced these
 * results supplied one.
 *
 * `deriveResults` builds each entry from one `track.artists[i]` credit and keys
 * it by that credit's normalized name, so the representative track's credit for
 * the same normalized name **is** the credit the entry came from — this is a
 * lookup, not a second guess. No id is not an error: it is the text-key half of
 * the artist route (see `artistKeys`), which is what keeps an id-less entry
 * activatable.
 *
 * A **blank** id counts as no id (M12). `??` alone would treat `""` as an id and
 * produce `/artist/` — a link to the route with no key, which renders not-found
 * and prefetches a 404. Podcast channels make this common: the Invidious tier
 * routinely returns a show whose name resolves and whose channel id is present
 * but empty, so the id is *there and blank* rather than absent. The name is the
 * usable key there, and the entry must stay activatable — the M9 contract, not a
 * nicety.
 */
function providerIdFor(artist: DerivedArtist): string | undefined {
  const id = artist.track.artists.find(
    (credit) => credit.name.trim().toLowerCase() === artist.key,
  )?.id;
  return id !== undefined && id.trim() !== "" ? id : undefined;
}

/**
 * Derived artist entry (M9 task 6.1; spec: `catalog` — "Catalog entity keys and
 * resolution requests").
 *
 * The card is one **link** to the artist page rather than a refine-the-query
 * button: click, Enter, and Space are the same activation, and the resulting
 * route is shareable. The key is the provider id when one was supplied and the
 * artist's name otherwise, so both shapes resolve.
 *
 * Signature change: `onSelect(name)` is gone — the tile no longer refines the
 * search query, so it has no callback left to call.
 */
export function ArtistTile({ artist }: ArtistTileProps) {
  return (
    <Link
      href={artistHref(providerIdFor(artist) ?? artist.name)}
      data-testid="search-artist-tile"
      className="block w-full"
    >
      <ArtistCard name={artist.name} />
    </Link>
  );
}
