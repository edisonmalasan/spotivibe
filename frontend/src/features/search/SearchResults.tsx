import { SectionHeader } from "@/components/design-system/SectionHeader";
import type { Track } from "@/data/repositories";
import { AlbumTile } from "@/features/search/AlbumTile";
import { ArtistTile } from "@/features/search/ArtistTile";
import { deriveResults } from "@/features/search/derive";
import { ResultMenu } from "@/features/search/ResultMenu";
import { SongRow } from "@/features/search/SongRow";
import { TopResultCard } from "@/features/search/TopResultCard";
import { useLikedTracks } from "@/features/search/useLikedTracks";

interface SearchResultsProps {
  tracks: Track[];
  /** The query the sections are derived against (Top Result matching). */
  query: string;
  /** Refine action for artist/album selection (query := entity name). */
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
 */
export function SearchResults({ tracks, query, onRefine, onPlay }: SearchResultsProps) {
  const { songs, artists, albums, topResult } = deriveResults(tracks, query);
  const { likedIds, toggleLike } = useLikedTracks();
  const topTrack = topResult?.kind === "track" ? topResult.track : null;

  function menuFor(track: Track, context: Track[]) {
    return (
      <ResultMenu
        track={track}
        isLiked={likedIds?.has(track.id) ?? false}
        onPlay={() => onPlay(track, context)}
        onToggleLike={() => void toggleLike(track)}
        onRefine={onRefine}
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
          <SectionHeader title="Songs" />
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
            <SectionHeader title="Artists" />
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-2">
              {artists.map((artist) => (
                <li key={artist.key}>
                  <ArtistTile artist={artist} onSelect={onRefine} />
                </li>
              ))}
            </ul>
          </section>
        )}
        {albums.length > 0 && (
          <section>
            <SectionHeader title="Albums" />
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-2">
              {albums.map((album) => (
                <li key={album.key}>
                  <AlbumTile album={album} onSelect={onRefine} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
