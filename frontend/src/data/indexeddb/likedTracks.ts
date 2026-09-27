import type { LikedTrackRecord, LikedTracksRepository, Track } from "@/data/repositories";
import { requestToPromise, transactionDone } from "./idb";
import { STORE } from "./schema";

export function createLikedTracksRepository(db: IDBDatabase): LikedTracksRepository {
  return {
    async like(track: Track, likedAt = Date.now()): Promise<LikedTrackRecord> {
      const record: LikedTrackRecord = {
        trackId: track.id,
        track,
        likedAt,
      };
      const tx = db.transaction(STORE.likedTracks, "readwrite");
      tx.objectStore(STORE.likedTracks).put(record);
      await transactionDone(tx);
      return record;
    },

    async unlike(trackId: string): Promise<void> {
      const tx = db.transaction(STORE.likedTracks, "readwrite");
      tx.objectStore(STORE.likedTracks).delete(trackId);
      await transactionDone(tx);
    },

    async isLiked(trackId: string): Promise<boolean> {
      const tx = db.transaction(STORE.likedTracks, "readonly");
      const value = await requestToPromise(tx.objectStore(STORE.likedTracks).get(trackId));
      return value !== undefined;
    },

    async get(trackId: string): Promise<LikedTrackRecord | undefined> {
      const tx = db.transaction(STORE.likedTracks, "readonly");
      return requestToPromise(tx.objectStore(STORE.likedTracks).get(trackId));
    },

    async list(): Promise<LikedTrackRecord[]> {
      const tx = db.transaction(STORE.likedTracks, "readonly");
      const records = await requestToPromise(tx.objectStore(STORE.likedTracks).getAll());
      return records.sort((a, b) => b.likedAt - a.likedAt);
    },

    async clear(): Promise<void> {
      const tx = db.transaction(STORE.likedTracks, "readwrite");
      tx.objectStore(STORE.likedTracks).clear();
      await transactionDone(tx);
    },
  };
}
