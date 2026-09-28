import type { Track } from "@/data/repositories";
import { getLocalData } from "@/data/localData";

/**
 * Local-library fallback for search (design §6): the remote is unreachable
 * (offline) or failed, so the query runs against the tracks the user owns
 * locally. Everything goes through the repositories — feature code never
 * touches IndexedDB (AGENTS.md architecture rules).
 */

/** Bounded number of listening-history events pulled into the fallback. */
export const LOCAL_HISTORY_LIMIT = 50;

/** The locally owned tracks a fallback query runs against. */
export interface LocalLibrary {
  /** Deduplicated tracks in source order: liked → playlists → history. */
  tracks: Track[];
}

/**
 * Read every locally owned track source and flatten it into one list,
 * deduplicated by track id with first-source-wins ordering: a track that is
 * liked, also in a playlist, and also in history appears once, in its liked
 * position.
 */
export async function loadLocalLibrary(): Promise<LocalLibrary> {
  const data = await getLocalData();
  const [liked, playlists, history] = await Promise.all([
    data.likedTracks.list(),
    data.playlists.list(),
    data.listeningHistory.list(LOCAL_HISTORY_LIMIT),
  ]);

  const tracks: Track[] = [];
  const seen = new Set<string>();
  const add = (track: Track): void => {
    if (seen.has(track.id)) return;
    seen.add(track.id);
    tracks.push(track);
  };

  for (const record of liked) add(record.track);
  for (const playlist of playlists) {
    for (const entry of playlist.tracks) add(entry.track);
  }
  for (const event of history) add(event.track);
  return { tracks };
}

/**
 * Case-insensitive substring match over title and artist names — pure so the
 * matching rule is testable without storage. A blank query matches nothing
 * (there is no remote request to fall back *from*).
 */
export function searchLocalLibrary(library: LocalLibrary, query: string): Track[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  return library.tracks.filter((track) => matches(track, needle));
}

/** True when the title or any artist name contains the lowercased needle. */
function matches(track: Track, needle: string): boolean {
  if (track.title.toLowerCase().includes(needle)) return true;
  return track.artists.some((artist) => artist.name.toLowerCase().includes(needle));
}
