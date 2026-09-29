/**
 * The genre catalog shared by the Home "Genres" tiles and the `/discover`
 * surface (ROADMAP M8 "genre discovery"; spec: `discovery` — "Discover surface
 * for genres and languages").
 *
 * Plain data plus a pure lookup: no repository, no storage, no network. Home
 * renders each entry as a navigation tile linking to `/discover?genre=<id>`,
 * and Discover resolves the same entry into its own discovery shelf, so the two
 * surfaces can never disagree about what a genre is.
 *
 * `query` is the caller-supplied seed term the `genre` feed kind is framed with
 * (the server localizes the framing noun). Provider queries are cross-language,
 * so the term is deliberately plain and neutral, and no entry claims a chart,
 * a ranking, or another service's curation.
 */

/** The `?genre=` search parameter Discover reads. */
export const DISCOVER_GENRE_PARAM = "genre";

/** One genre entry: a stable id, a display name, and a provider query term. */
export interface GenreEntry {
  /** Stable, URL-safe identifier — the value carried in `?genre=`. */
  readonly id: string;
  /** Display name for the tile and the Discover shelf title. */
  readonly name: string;
  /** Neutral seed term the discovery `genre` feed is queried with. */
  readonly query: string;
}

/** The shipped genre catalog — ten entries covering the broad ROADMAP span. */
export const GENRE_CATALOG: readonly GenreEntry[] = [
  { id: "pop", name: "Pop", query: "pop music" },
  { id: "rock", name: "Rock", query: "rock music" },
  { id: "hip-hop", name: "Hip-Hop", query: "hip hop rap" },
  { id: "electronic", name: "Electronic", query: "electronic dance music" },
  { id: "jazz", name: "Jazz", query: "jazz music" },
  { id: "classical", name: "Classical", query: "classical music" },
  { id: "country", name: "Country", query: "country music" },
  { id: "latin", name: "Latin", query: "latin music" },
  { id: "afrobeats", name: "Afrobeats", query: "afrobeats" },
  { id: "k-pop", name: "K-Pop", query: "k-pop" },
];

/** Case-insensitive lookup of a catalog genre by id, or `undefined`. */
export function findGenre(id: string | null | undefined): GenreEntry | undefined {
  if (id === null || id === undefined) return undefined;
  const wanted = id.trim().toLowerCase();
  if (wanted === "") return undefined;
  return GENRE_CATALOG.find((genre) => genre.id === wanted);
}

/** The Discover route a Home genre tile navigates to. */
export function genreHref(id: string): string {
  return `/discover?${DISCOVER_GENRE_PARAM}=${encodeURIComponent(id)}`;
}
