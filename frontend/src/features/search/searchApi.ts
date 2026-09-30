import type { Track } from "@/data/repositories";

/**
 * Client side of the M3 search contract (consumed unchanged, design §Context):
 * `GET /api/search?q=<trim 1..200>&limit=<1..50, default 20>&category=<mode>`
 * → 200 with a flat `{ tracks, diagnostics }` body. The UI reads only `tracks` —
 * depending on `diagnostics` is forbidden by the `music-provider` spec.
 *
 * M12 adds the search **mode** (`SearchMode`) to the request and to the URL. The
 * mode is a question for the provider, not a client-side filter, so it is sent
 * rather than applied here (design decision 1).
 */

/** Bounded query length (mirrors the server contract's q validation). */
export const MAX_QUERY_LENGTH = 200;
/** Requested result count (server default is 20, max 50). */
export const SEARCH_LIMIT = 20;

/** The two search modes (M12). `music` is the default everywhere. */
export type SearchMode = "music" | "podcast";

/** The mode used when the URL carries none, or carries something unrecognized. */
export const DEFAULT_SEARCH_MODE: SearchMode = "music";

/** The URL parameter the mode travels in, alongside `q`. */
export const SEARCH_MODE_PARAM = "mode";

/** Whether `value` is one of the two modes; anything else falls back to music. */
export function isSearchMode(value: unknown): value is SearchMode {
  return value === "music" || value === "podcast";
}

/**
 * The mode a URL value means. An absent or unrecognized value is music rather
 * than an error: a shared or hand-edited URL must still produce a working
 * search, and failing loudly would be worse than the documented default.
 */
export function searchModeFromParam(value: string | null | undefined): SearchMode {
  return isSearchMode(value) ? value : DEFAULT_SEARCH_MODE;
}

/** Minimal runtime guard for the canonical Track fields results are rendered from. */
function isTrackLike(value: unknown): value is Track {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Track>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.providerId === "string" &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.artists)
  );
}

/**
 * Validate a success body and return its tracks. `diagnostics` is deliberately
 * not read or typed here — only `tracks` may reach the UI.
 */
export function parseSearchResponse(body: unknown): Track[] {
  if (typeof body !== "object" || body === null) {
    throw new Error("Search response was not an object.");
  }
  const tracks = (body as { tracks?: unknown }).tracks;
  if (!Array.isArray(tracks) || !tracks.every(isTrackLike)) {
    throw new Error("Search response did not contain valid tracks.");
  }
  return tracks;
}

/**
 * Issue the remote search for a query. The query is trimmed and bounded here
 * so the request always satisfies the contract; the AbortSignal belongs to the
 * caller so a superseding search can cancel it (design §4).
 *
 * M12: `mode` is the question being asked. The parameter is **omitted for music
 * mode** rather than sent as `category=music`: the server defaults to music, and
 * omitting it keeps every music-mode request byte-identical to the pre-M12 one —
 * the property the `podcasts` scenario "Music mode is unchanged" asks for, and the
 * one the existing request-shape tests assert.
 */
export async function fetchSearchResults(
  query: string,
  signal: AbortSignal,
  mode: SearchMode = DEFAULT_SEARCH_MODE,
): Promise<Track[]> {
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  const category = mode === "podcast" ? "&category=podcast" : "";
  const url = `/api/search?q=${encodeURIComponent(trimmed)}&limit=${SEARCH_LIMIT}${category}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Search request failed with status ${response.status}.`);
  }
  return parseSearchResponse(await response.json());
}
