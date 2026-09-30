import { SectionHeader } from "@/components/design-system/SectionHeader";
import type { Track } from "@/data/repositories";
import { AlbumTile } from "@/features/search/AlbumTile";
import { ArtistTile } from "@/features/search/ArtistTile";
import { deriveResults } from "@/features/search/derive";
import type { SearchMode } from "@/features/search/searchApi";
import { ResultMenu } from "@/features/search/ResultMenu";
import { SongRow } from "@/components/track/SongRow";
import { TopResultCard } from "@/features/search/TopResultCard";
import { useLikedTracks } from "@/features/search/useLikedTracks";

interface SearchResultsProps {
  tracks: Track[];
  /** The query the sections are derived against (Top Result matching). */
  query: string;
  /**
   * M12: which question produced these results. Podcast results present an
   * episode with its show/channel and its long-form duration, and resolve no
   * Albums section — a podcast's metadata carries no album identity, and an
   * empty section would be a section the product cannot fill.
   */
  mode?: SearchMode;
  /**
   * Refine action for the Top Result's artist/album card (query := entity
   * name). The derived artist/album tiles and the context menu open the real
   * catalog routes instead, so this is no longer every entity activation.
   */
  onRefine: (name: string) => void;
  /** Activate a song with its result set as playback context (design §9). */
  onPlay: (track: Track, context: Track[]) => void;
}

/**
 * Result surface (design §10): desktop puts Top Result + Songs in the left
 * column and derived Artists + Albums in the right; compact stacks the same
 * sections vertically. Every section renders only where it has entries, all
 * four sections derive from the canonical `Track[]` alone, and every song
 * result carries its context menu (like/playlist/navigation actions).
 *
 * The derived artist/album entries are links to the M9 catalog routes, not
 * refine-the-query buttons; only the Top Result's artist/album card still
 * refines, because it presents "the best match for this query" rather than an
 * entity to browse.
 */
export function SearchResults({
  tracks,
  query,
  mode = "music",
  onRefine,
  onPlay,
}: SearchResultsProps) {
  const { songs, artists, albums, topResult } = deriveResults(tracks, query);
  const { likedIds, toggleLike } = useLikedTracks();
  const topTrack = topResult?.kind === "track" ? topResult.track : null;
  const isPodcast = mode === "podcast";

  function menuFor(track: Track, context: Track[]) {
    return (
      <ResultMenu
        track={track}
        isLiked={likedIds?.has(track.id) ?? false}
        onPlay={() => onPlay(track, context)}
        onToggleLike={() => void toggleLike(track)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-8">
        {topResult && (
          <section>
            <SectionHeader title="Top Result" />
            <TopResultCard
              top={topResult}
              onSelect={onRefine}
              onPlay={topTrack ? () => onPlay(topTrack, songs) : undefined}
              menu={topTrack ? menuFor(topTrack, songs) : undefined}
            />
          </section>
        )}
        <section>
          <SectionHeader title={isPodcast ? "Episodes" : "Songs"} />
          <ul data-testid="search-results" className="flex flex-col gap-2">
            {songs.map((track) => (
              <SongRow
                key={track.id}
                track={track}
                onPlay={() => onPlay(track, songs)}
                trailing={menuFor(track, songs)}
              />
            ))}
          </ul>
        </section>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-8">
        {artists.length > 0 && (
          <section>
            <SectionHeader title={isPodcast ? "Shows" : "Artists"} />
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-2">
              {artists.map((artist) => (
                <li key={artist.key}>
                  <ArtistTile artist={artist} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* M12: no Albums section for podcast results — episode metadata resolves
            no album identity, so the section could only ever be empty. */}
        {!isPodcast && albums.length > 0 && (
          <section>
            <SectionHeader title="Albums" />
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-2">
              {albums.map((album) => (
                <li key={album.key}>
                  <AlbumTile album={album} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
