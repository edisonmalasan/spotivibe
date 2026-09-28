import { create } from "zustand";
import { getLocalData } from "@/data/localData";
import { LocalDataError, type PlaylistRecord, type Track } from "@/data/repositories";

/**
 * `libraryStore` (ROADMAP M7, design §1): the single library state authority
 * — liked ids, playlist records, and the hydration flag that drives every
 * library surface (sidebar, `/library`, Liked Songs, playlist detail, the
 * search picker, and Now Playing).
 *
 * Layering: components → libraryStore → repository interfaces. Actions are
 * repository-first — the write is awaited before state updates, so a failed
 * write leaves the UI exactly as it was (no optimistic rollback to
 * reconcile) and failures reject for the surface to report. This module
 * never imports `playerStore` (architecture-tested): library edits cannot
 * touch transport by construction, and the duplicate rule for playlist
 * additions lives here as the one enforcement point.
 */

export interface CreatePlaylistInput {
  name: string;
  description?: string;
}

export interface CreateFromResolvedInput extends CreatePlaylistInput {
  /** Source-ordered tracks (an imported playlist's resolved entries). */
  tracks: Track[];
}

export interface LibraryState {
  /** Liked track ids (canonical `Track.id`), for cheap cross-surface checks. */
  likedIds: ReadonlySet<string>;
  /** All playlists (repository order: most recently updated first). */
  playlists: PlaylistRecord[];
  /** True once the first successful read has settled. */
  hydrated: boolean;

  /**
   * Read both collections from the repositories. Idempotent: concurrent
   * callers share one in-flight read, repeated calls re-read rather than
   * append (bulk writes — Settings reset, backup import — re-call it so the
   * store never diverges from the database).
   */
  hydrate(): Promise<void>;
  /** Like/unlike `track`, persisting first, then reflecting the outcome. */
  toggleLike(track: Track): Promise<void>;
  /** Create a playlist; resolves with the persisted record (immutable id). */
  createPlaylist(input: CreatePlaylistInput): Promise<PlaylistRecord>;
  /** Rename/edit description; id, tracks, and order are untouched. */
  updatePlaylist(
    id: string,
    patch: { name?: string; description?: string },
  ): Promise<PlaylistRecord>;
  /** Delete a playlist and drop it from state. */
  deletePlaylist(id: string): Promise<void>;
  /**
   * Append `track` to `playlistId` unless it is already a member — the
   * duplicate rule's single enforcement point (design §1). `"duplicate"`
   * leaves the playlist untouched.
   */
  addTrackToPlaylist(playlistId: string, track: Track): Promise<"added" | "duplicate">;
  /** Remove the first entry matching `trackId` from the playlist. */
  removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<void>;
  /** Move the entry at `fromIndex` to `toIndex`; array order is the order. */
  reorderPlaylistTrack(playlistId: string, fromIndex: number, toIndex: number): Promise<void>;
  /**
   * Create a playlist and append `tracks` sequentially (array order = source
   * order). A mid-sequence write failure rolls the partial playlist back
   * before rejecting, so a failed import leaves nothing behind (design §9).
   */
  createPlaylistFromResolved(input: CreateFromResolvedInput): Promise<PlaylistRecord>;
}

function emptyLikedIds(): ReadonlySet<string> {
  return new Set<string>();
}

export const initialLibraryState = {
  likedIds: emptyLikedIds(),
  playlists: [] as PlaylistRecord[],
  hydrated: false,
};

/** Reset library data — test isolation and hot-reload hygiene. */
export function resetLibraryStore(): void {
  hydrateInFlight = null;
  playlistRefresh = 0;
  likedRefresh = 0;
  useLibraryStore.setState({
    likedIds: emptyLikedIds(),
    playlists: [],
    hydrated: false,
  });
}

let hydrateInFlight: Promise<void> | null = null;
/** Monotonic tokens so a slow stale read can never overwrite a newer one. */
let playlistRefresh = 0;
let likedRefresh = 0;

async function readLibrary(): Promise<{
  likedIds: ReadonlySet<string>;
  playlists: PlaylistRecord[];
}> {
  const data = await getLocalData();
  const [liked, playlists] = await Promise.all([data.likedTracks.list(), data.playlists.list()]);
  return { likedIds: new Set(liked.map((record) => record.trackId)), playlists };
}

export const useLibraryStore = create<LibraryState>()((set) => ({
  ...initialLibraryState,

  hydrate() {
    if (!hydrateInFlight) {
      hydrateInFlight = readLibrary()
        .then((next) => {
          set({ ...next, hydrated: true });
        })
        .finally(() => {
          hydrateInFlight = null;
        });
    }
    return hydrateInFlight;
  },

  async toggleLike(track) {
    const data = await getLocalData();
    const liked = await data.likedTracks.isLiked(track.id);
    if (liked) {
      await data.likedTracks.unlike(track.id);
    } else {
      await data.likedTracks.like(track);
    }
    // Repository first, UI second — re-read so concurrent toggles converge.
    const token = ++likedRefresh;
    const records = await data.likedTracks.list();
    if (token === likedRefresh)
      set({ likedIds: new Set(records.map((r) => r.trackId)), hydrated: true });
  },

  async createPlaylist(input) {
    const data = await getLocalData();
    const created = await data.playlists.create(input);
    await refreshPlaylists();
    return created;
  },

  async updatePlaylist(id, patch) {
    const data = await getLocalData();
    const updated = await data.playlists.update(id, patch);
    await refreshPlaylists();
    return updated;
  },

  async deletePlaylist(id) {
    const data = await getLocalData();
    await data.playlists.remove(id);
    await refreshPlaylists();
  },

  async addTrackToPlaylist(playlistId, track) {
    const data = await getLocalData();
    const playlist = await data.playlists.get(playlistId);
    if (!playlist) {
      throw new LocalDataError(`Playlist ${playlistId} does not exist.`);
    }
    // Membership check against the persisted record — one enforcement point.
    if (playlist.tracks.some((entry) => entry.track.id === track.id)) return "duplicate";
    await data.playlists.addTrack(playlistId, track);
    await refreshPlaylists();
    return "added";
  },

  async removeTrackFromPlaylist(playlistId, trackId) {
    const data = await getLocalData();
    await data.playlists.removeTrack(playlistId, trackId);
    await refreshPlaylists();
  },

  async reorderPlaylistTrack(playlistId, fromIndex, toIndex) {
    const data = await getLocalData();
    await data.playlists.reorderTrack(playlistId, fromIndex, toIndex);
    await refreshPlaylists();
  },

  async createPlaylistFromResolved({ name, description, tracks }) {
    const data = await getLocalData();
    const created = await data.playlists.create({ name, description });
    try {
      // Sequential ordered writes: array order is the resolved source order.
      for (const track of tracks) {
        await data.playlists.addTrack(created.id, track);
      }
    } catch (error) {
      try {
        await data.playlists.remove(created.id);
      } catch (rollbackError) {
        // Never swallow: surface both the failed import and the failed
        // rollback, then resync state so the UI matches what storage holds.
        console.warn(
          "[library] playlist import rollback failed:",
          rollbackError,
          "original error:",
          error,
        );
        await refreshPlaylists().catch((refreshError: unknown) => {
          console.warn("[library] playlist resync after failed rollback:", refreshError);
        });
      }
      throw error;
    }
    await refreshPlaylists();
    const persisted = await data.playlists.get(created.id);
    return persisted ?? created;
  },
}));

/** Re-read playlists into state; a stale slow read never wins (design §1). */
async function refreshPlaylists(): Promise<void> {
  const token = ++playlistRefresh;
  const data = await getLocalData();
  const playlists = await data.playlists.list();
  if (token === playlistRefresh) setPlaylists(playlists);
}

function setPlaylists(playlists: PlaylistRecord[]): void {
  useLibraryStore.setState({ playlists, hydrated: true });
}
