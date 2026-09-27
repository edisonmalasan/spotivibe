import type { PlaylistRecord, PlaylistTrackEntry, PlaylistsRepository } from "@/data/repositories";
import { LocalDataError } from "@/data/repositories";
import { requestToPromise, transactionDone } from "./idb";
import { STORE } from "./schema";

async function getOrThrow(db: IDBDatabase, id: string): Promise<PlaylistRecord> {
  const tx = db.transaction(STORE.playlists, "readonly");
  const playlist = await requestToPromise<PlaylistRecord | undefined>(
    tx.objectStore(STORE.playlists).get(id),
  );
  if (!playlist) {
    throw new LocalDataError(`Playlist ${id} does not exist.`);
  }
  return playlist;
}

async function putPlaylist(db: IDBDatabase, playlist: PlaylistRecord): Promise<PlaylistRecord> {
  const tx = db.transaction(STORE.playlists, "readwrite");
  tx.objectStore(STORE.playlists).put(playlist);
  await transactionDone(tx);
  return playlist;
}

export function createPlaylistsRepository(db: IDBDatabase): PlaylistsRepository {
  return {
    async create(input): Promise<PlaylistRecord> {
      const now = Date.now();
      const playlist: PlaylistRecord = {
        id: crypto.randomUUID(),
        name: input.name,
        description: input.description,
        artwork: input.artwork,
        createdAt: now,
        updatedAt: now,
        tracks: [],
      };
      return putPlaylist(db, playlist);
    },

    async update(id, patch): Promise<PlaylistRecord> {
      const playlist = await getOrThrow(db, id);
      const next: PlaylistRecord = {
        ...playlist,
        name: patch.name ?? playlist.name,
        description: patch.description ?? playlist.description,
        updatedAt: Date.now(),
      };
      return putPlaylist(db, next);
    },

    async remove(id: string): Promise<void> {
      const tx = db.transaction(STORE.playlists, "readwrite");
      tx.objectStore(STORE.playlists).delete(id);
      await transactionDone(tx);
    },

    async get(id: string): Promise<PlaylistRecord | undefined> {
      const tx = db.transaction(STORE.playlists, "readonly");
      return requestToPromise(tx.objectStore(STORE.playlists).get(id));
    },

    async list(): Promise<PlaylistRecord[]> {
      const tx = db.transaction(STORE.playlists, "readonly");
      const records = await requestToPromise(tx.objectStore(STORE.playlists).getAll());
      return records.sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async addTrack(playlistId, track, position): Promise<PlaylistRecord> {
      const playlist = await getOrThrow(db, playlistId);
      const entry: PlaylistTrackEntry = { track, addedAt: Date.now() };
      const tracks = [...playlist.tracks];
      if (position === undefined) {
        tracks.push(entry);
      } else {
        const index = Math.max(0, Math.min(position, tracks.length));
        tracks.splice(index, 0, entry);
      }
      return putPlaylist(db, { ...playlist, tracks, updatedAt: Date.now() });
    },

    async removeTrack(playlistId, trackId): Promise<PlaylistRecord> {
      const playlist = await getOrThrow(db, playlistId);
      const index = playlist.tracks.findIndex((entry) => entry.track.id === trackId);
      if (index === -1) {
        throw new LocalDataError(`Track ${trackId} is not in playlist ${playlistId}.`);
      }
      const tracks = [...playlist.tracks];
      tracks.splice(index, 1);
      return putPlaylist(db, { ...playlist, tracks, updatedAt: Date.now() });
    },

    async reorderTrack(playlistId, fromIndex, toIndex): Promise<PlaylistRecord> {
      const playlist = await getOrThrow(db, playlistId);
      const { length } = playlist.tracks;
      if (fromIndex < 0 || fromIndex >= length || toIndex < 0 || toIndex >= length) {
        throw new LocalDataError(
          `Cannot move index ${fromIndex} to ${toIndex} in playlist ${playlistId} (size ${length}).`,
        );
      }
      const tracks = [...playlist.tracks];
      const [entry] = tracks.splice(fromIndex, 1);
      tracks.splice(toIndex, 0, entry);
      return putPlaylist(db, { ...playlist, tracks, updatedAt: Date.now() });
    },

    async clear(): Promise<void> {
      const tx = db.transaction(STORE.playlists, "readwrite");
      tx.objectStore(STORE.playlists).clear();
      await transactionDone(tx);
    },
  };
}
