import type { Track } from "@/data/repositories";

/**
 * Client side of the M7 playlist-import contract (design §9/§10):
 * `GET /api/playlist?src=<ref>` → 200 with `{ playlist: { title, description?,
 * tracks, skipped, truncated? }, diagnostics? }`, or a flat
 * `{ error: "invalid_input" | "playlist_unavailable" | "upstream_unavailable" }`
 * body on 400/404/503.
 *
 * Follows the `searchApi.ts` pattern: the body is validated before use, only
 * provider-agnostic metadata and `Track[]` leave this module, and `diagnostics`
 * is never read (the search safety rule — tier ids/outcomes stay server-side).
 */

/** Mirrors the server contract's `src` bound (design §9: trim, 1..500). */
export const MAX_SRC_LENGTH = 500;

/** Server error codes plus the transport failure only the client can see. */
export type ImportErrorCode =
  "invalid_input" | "playlist_unavailable" | "upstream_unavailable" | "network";

/** A resolved remote playlist — plain metadata plus canonical tracks. */
export interface ResolvedPlaylist {
  title: string;
  description?: string;
  tracks: Track[];
  /** Entries the server skipped (unavailable/unnormalizable), reported. */
  skipped: number;
  /** Set when the source exceeded the 500-entry cap (design §9). */
  truncated?: boolean;
}

/**
 * Import failure carrying the code the dialog maps to a message (design §10).
 * Unexpected HTTP statuses collapse onto `upstream_unavailable` so the UI
 * always speaks one of the four designed messages.
 */
export class PlaylistImportError extends Error {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message = `Playlist import failed (${code}).`) {
    super(message);
    this.name = "PlaylistImportError";
    this.code = code;
  }
}

/** Minimal runtime guard for the canonical Track fields the UI renders from. */
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
 * Validate a success body and return the resolved playlist. `diagnostics` is
 * deliberately not typed here — only the playlist payload may reach the UI.
 */
export function parsePlaylistResponse(body: unknown): ResolvedPlaylist {
  if (typeof body !== "object" || body === null) {
    throw new PlaylistImportError("upstream_unavailable", "Playlist response was not an object.");
  }
  const playlist = (body as { playlist?: unknown }).playlist;
  if (typeof playlist !== "object" || playlist === null) {
    throw new PlaylistImportError("upstream_unavailable", "Playlist response had no playlist.");
  }
  const candidate = playlist as Partial<ResolvedPlaylist>;
  const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
  if (title === "") {
    throw new PlaylistImportError("upstream_unavailable", "Playlist response had no title.");
  }
  if (!Array.isArray(candidate.tracks) || !candidate.tracks.every(isTrackLike)) {
    throw new PlaylistImportError("upstream_unavailable", "Playlist tracks were malformed.");
  }
  if (typeof candidate.skipped !== "number" || candidate.skipped < 0) {
    throw new PlaylistImportError("upstream_unavailable", "Playlist skip count was malformed.");
  }
  if (candidate.description !== undefined && typeof candidate.description !== "string") {
    throw new PlaylistImportError("upstream_unavailable", "Playlist description was malformed.");
  }
  if (candidate.truncated !== undefined && typeof candidate.truncated !== "boolean") {
    throw new PlaylistImportError(
      "upstream_unavailable",
      "Playlist truncation flag was malformed.",
    );
  }
  return {
    title,
    description: candidate.description,
    tracks: candidate.tracks,
    skipped: candidate.skipped,
    truncated: candidate.truncated,
  };
}

/** Map a non-ok response onto its designed error code (status fallback). */
async function toImportError(response: Response): Promise<PlaylistImportError> {
  try {
    const body: unknown = await response.json();
    const code = (body as { error?: unknown }).error;
    if (
      code === "invalid_input" ||
      code === "playlist_unavailable" ||
      code === "upstream_unavailable"
    ) {
      return new PlaylistImportError(code);
    }
  } catch {
    // Non-JSON error body — fall through to the status mapping below.
  }
  if (response.status === 400) return new PlaylistImportError("invalid_input");
  if (response.status === 404) return new PlaylistImportError("playlist_unavailable");
  return new PlaylistImportError("upstream_unavailable");
}

/**
 * Resolve a playlist reference through the local API. The reference is
 * trimmed and bounded here so the request always satisfies the contract; the
 * AbortSignal belongs to the caller so dismissing the dialog cancels it.
 *
 * - empty/out-of-bound input → `invalid_input` without a network call
 * - non-ok response → the server's flat error code (status as fallback)
 * - fetch/network failure → `network` (abort rethrows for the caller)
 * - malformed success body → `upstream_unavailable`
 */
export async function fetchPlaylist(src: string, signal: AbortSignal): Promise<ResolvedPlaylist> {
  const trimmed = src.trim();
  if (trimmed === "" || trimmed.length > MAX_SRC_LENGTH) {
    throw new PlaylistImportError("invalid_input");
  }
  const url = `/api/playlist?src=${encodeURIComponent(trimmed)}`;

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    // A dismissed dialog's abort is not a failure to report.
    if (signal.aborted) throw error;
    throw new PlaylistImportError("network");
  }
  if (!response.ok) {
    throw await toImportError(response);
  }
  try {
    return parsePlaylistResponse(await response.json());
  } catch (error) {
    // Connection cut mid-body re-reads as a transport failure; parse
    // failures already carry their designed code.
    if (signal.aborted) throw error;
    if (error instanceof PlaylistImportError) throw error;
    throw new PlaylistImportError("network");
  }
}
