import type { CachedMetadataRecord, MetadataCacheRepository, Track } from "@/data/repositories";
import { requestToPromise, transactionDone } from "./idb";
import { STORE } from "./schema";

export function createMetadataCacheRepository(db: IDBDatabase): MetadataCacheRepository {
  return {
    async get(providerId: string): Promise<CachedMetadataRecord | undefined> {
      const tx = db.transaction(STORE.metadataCache, "readonly");
      return requestToPromise(tx.objectStore(STORE.metadataCache).get(providerId));
    },

    async put(track: Track): Promise<void> {
      const record: CachedMetadataRecord = {
        providerId: track.providerId,
        track,
        cachedAt: Date.now(),
      };
      const tx = db.transaction(STORE.metadataCache, "readwrite");
      tx.objectStore(STORE.metadataCache).put(record);
      await transactionDone(tx);
    },

    async putMany(tracks: Track[]): Promise<void> {
      const tx = db.transaction(STORE.metadataCache, "readwrite");
      const store = tx.objectStore(STORE.metadataCache);
      const cachedAt = Date.now();
      for (const track of tracks) {
        store.put({ providerId: track.providerId, track, cachedAt });
      }
      await transactionDone(tx);
    },

    async list(): Promise<CachedMetadataRecord[]> {
      const tx = db.transaction(STORE.metadataCache, "readonly");
      return requestToPromise(tx.objectStore(STORE.metadataCache).getAll());
    },

    async clear(): Promise<void> {
      const tx = db.transaction(STORE.metadataCache, "readwrite");
      tx.objectStore(STORE.metadataCache).clear();
      await transactionDone(tx);
    },
  };
}
