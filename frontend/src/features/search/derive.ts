import type { Track } from "@/data/repositories";

/**
 * Pure client-side result derivation (design decision §1): Top Result,
 * Songs, Artists, and Albums are computed from the canonical `Track[]` alone —
 * no server grouping change and no provider shapes. Every entry is emitted
 * only where its metadata resolves, so the same Track contract serves both
 * remote results and local fallback matches.
 */

/** Trimmed + case-insensitive identity text (design §1). */
function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/** One distinct artist, keyed by normalized name; first occurrence wins. */
export interface DerivedArtist {
  key: string;
  name: string;
  /** Representative track (first result that credited this artist). */
  track: Track;
}

/** One distinct album, keyed by normalized title + primary artist. */
export interface DerivedAlbum {
  key: string;
  title: string;
  /** The album's primary artist (first artist credited on the track). */
  artistName: string;
  /** Representative track (first result carrying this album). */
  track: Track;
}

/** The clear best match for the query — artist > album > #1 track title. */
export type TopResult =
  | { kind: "artist"; artist: DerivedArtist }
  | { kind: "album"; album: DerivedAlbum }
  | { kind: "track"; track: Track };

export interface DerivedResults {
  /** Deduplicated songs in API relevance order. */
  songs: Track[];
  artists: DerivedArtist[];
  albums: DerivedAlbum[];
  /** `null` when no result is an exact match — no Top Result renders then. */
  topResult: TopResult | null;
}

/**
 * Derive every search section from a raw result list (design §1).
 *
 * - Songs collapse duplicates by `id`/`providerId`, first occurrence wins,
 *   preserving API relevance order.
 * - Artists dedupe by normalized name (first occurrence wins) and only appear
 *   where artist metadata resolves.
 * - Albums dedupe by normalized title + primary artist and only appear where
 *   `track.album` metadata resolves.
 * - Top Result requires an exact normalized match of the query against a
 *   result artist name, else a result album title, else the #1 track's title.
 *   No fuzzy or partial matching: no exact match → no Top Result.
 */
export function deriveResults(tracks: Track[], query: string): DerivedResults {
  const songs: Track[] = [];
  const artists: DerivedArtist[] = [];
  const albums: DerivedAlbum[] = [];
  const seenIds = new Set<string>();
  const seenProviderIds = new Set<string>();
  const seenArtists = new Set<string>();
  const seenAlbums = new Set<string>();

  for (const track of tracks) {
    if (!seenIds.has(track.id) && !seenProviderIds.has(track.providerId)) {
      seenIds.add(track.id);
      seenProviderIds.add(track.providerId);
      songs.push(track);
    }

    for (const artist of track.artists) {
      const name = artist.name.trim();
      if (name === "") continue; // artist metadata did not resolve
      const key = normalize(name);
      if (seenArtists.has(key)) continue;
      seenArtists.add(key);
      artists.push({ key, name, track });
    }

    const albumTitle = track.album?.title.trim();
    if (albumTitle === undefined || albumTitle === "") continue; // no album metadata
    const artistName = track.artists[0]?.name.trim() ?? "";
    const albumKey = `${normalize(albumTitle)}|${normalize(artistName)}`;
    if (seenAlbums.has(albumKey)) continue;
    seenAlbums.add(albumKey);
    albums.push({ key: albumKey, title: albumTitle, artistName, track });
  }

  return { songs, artists, albums, topResult: deriveTopResult(query, songs, artists, albums) };
}

/** Exact-match Top Result rule (design §1): artist, then album, then #1 title. */
function deriveTopResult(
  query: string,
  songs: Track[],
  artists: DerivedArtist[],
  albums: DerivedAlbum[],
): TopResult | null {
  const needle = normalize(query);
  if (needle === "") return null;

  const artist = artists.find((entry) => entry.key === needle);
  if (artist) return { kind: "artist", artist };

  const album = albums.find((entry) => normalize(entry.title) === needle);
  if (album) return { kind: "album", album };

  const first = songs[0];
  if (first !== undefined && normalize(first.title) === needle) {
    return { kind: "track", track: first };
  }

  return null;
}
