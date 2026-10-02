import type { SearchEntryRecord, Track } from "@/data/repositories";
import { getLocalData } from "@/data/localData";
import type { SearchMode } from "@/features/search/searchApi";

/**
 * The search feature's reads of local data (design §6).
 *
 * Both readers live here rather than at their call sites because they are the two
 * places this feature touches storage at all: a results request falls back to the
 * locally owned library, and the suggestion lane (M18 §5) offers the searches
 * this device has made. Everything goes through the repositories — feature code
 * never touches IndexedDB (AGENTS.md architecture rules) — and a reader that is
 * *named* in the architecture guard is a deliberate addition rather than a silent
 * second path into the data layer.
 */

/** Bounded number of listening-history events pulled into the fallback. */
export const LOCAL_HISTORY_LIMIT = 50;

/**
 * This device's recent searches, newest first, optionally bounded.
 *
 * Used by the suggestion lane, which must reach the same records as the browse
 * state's recents list but through a lane of its own — it settles on its own
 * debounce and its own cancellation, and it never records (a suggestion is not a
 * search until it is committed).
 */
export async function loadSearchHistory(limit?: number): Promise<SearchEntryRecord[]> {
  const data = await getLocalData();
  return data.searchHistory.list(limit);
}

/**
 * The locally owned tracks a fallback query runs against.
 *
 * Read when the remote is unreachable (offline) or failed, so the query runs
 * against the tracks the user owns locally instead of returning nothing.
 */
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
 *
 * M12: the mode narrows the *matches*, not the matching rule. In podcast mode a
 * liked song is not an answer to "find me podcasts" — and the surface would
 * present it under an **Episodes** heading, which is a claim the record does not
 * support. Podcast mode therefore keeps podcast records only, and a listener with
 * no matching episode gets the podcast empty state rather than a mislabelled row.
 */
export function searchLocalLibrary(
  library: LocalLibrary,
  query: string,
  mode: SearchMode = "music",
): Track[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  return library.tracks.filter(
    (track) => matches(track, needle) && (mode !== "podcast" || track.category === "podcast"),
  );
}

/** True when the title or any artist name contains the lowercased needle. */
function matches(track: Track, needle: string): boolean {
  if (track.title.toLowerCase().includes(needle)) return true;
  return track.artists.some((artist) => artist.name.toLowerCase().includes(needle));
}
