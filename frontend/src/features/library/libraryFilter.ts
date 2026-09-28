/**
 * Local filter for the `/library` and Liked Songs surfaces (design §8):
 * case-insensitive substring matching over the trimmed query — pure, so the
 * matcher matrix is unit-tested directly and both surfaces behave the same.
 */

/** True when `query` (trimmed, case-insensitive) appears in any of `texts`. */
export function libraryFilterMatches(query: string, ...texts: string[]): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return texts.some((text) => text.toLowerCase().includes(needle));
}

/** Playlists whose name matches the query; order and identity preserved. */
export function filterPlaylists<T extends { name: string }>(
  playlists: readonly T[],
  query: string,
): T[] {
  if (query.trim() === "") return [...playlists];
  return playlists.filter((playlist) => libraryFilterMatches(query, playlist.name));
}
