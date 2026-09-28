import type { Track } from "@/data/repositories";

/**
 * Client side of the M3 search contract (consumed unchanged, design §Context):
 * `GET /api/search?q=<trim 1..200>&limit=<1..50, default 20>` → 200 with a flat
 * `{ tracks, diagnostics }` body. The UI reads only `tracks` — depending on
 * `diagnostics` is forbidden by the `music-provider` spec.
 */

/** Bounded query length (mirrors the server contract's q validation). */
export const MAX_QUERY_LENGTH = 200;
/** Requested result count (server default is 20, max 50). */
export const SEARCH_LIMIT = 20;

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
 */
export async function fetchSearchResults(query: string, signal: AbortSignal): Promise<Track[]> {
  const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
  const url = `/api/search?q=${encodeURIComponent(trimmed)}&limit=${SEARCH_LIMIT}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Search request failed with status ${response.status}.`);
  }
  return parseSearchResponse(await response.json());
}
