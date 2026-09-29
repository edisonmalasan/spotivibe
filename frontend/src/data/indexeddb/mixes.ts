import type { MixRecord, MixesRepository, NewMix } from "@/data/repositories";
import { transactionDone, requestToPromise } from "./idb";
import { STORE } from "./schema";

/**
 * Smart Mix storage (M11).
 *
 * A mix is a *named snapshot*, so the store is keyed by its stable `id` and the
 * generation time is an index rather than the key: a refresh must keep the
 * identity (and therefore the key), so it is a `put` of the same id with a newer
 * `updatedAt` — never a delete-then-create, which would drop the name the
 * listener recognizes.
 */
export function createMixesRepository(db: IDBDatabase): MixesRepository {
  return {
    async create(mix: NewMix): Promise<MixRecord> {
      const record: MixRecord = {
        ...mix,
        id: mix.id ?? crypto.randomUUID(),
        updatedAt: mix.updatedAt ?? mix.generatedAt,
      };
      const tx = db.transaction(STORE.mixes, "readwrite");
      tx.objectStore(STORE.mixes).put(record);
      await transactionDone(tx);
      return record;
    },

    async refresh(
      id: string,
      patch: { tracks: MixRecord["tracks"]; seeds: MixRecord["seeds"]; period: string },
    ): Promise<MixRecord | undefined> {
      const existing = await this.get(id);
      // A refresh of a mix that no longer exists is not a creation: the identity
      // and the name the listener recognized would both be gone.
      if (existing === undefined) return undefined;
      const updated: MixRecord = {
        ...existing,
        tracks: patch.tracks,
        seeds: patch.seeds,
        period: patch.period,
        updatedAt: Date.now(),
      };
      const tx = db.transaction(STORE.mixes, "readwrite");
      tx.objectStore(STORE.mixes).put(updated);
      await transactionDone(tx);
      return updated;
    },

    async get(id: string): Promise<MixRecord | undefined> {
      const tx = db.transaction(STORE.mixes, "readonly");
      return (await requestToPromise(tx.objectStore(STORE.mixes).get(id))) as MixRecord | undefined;
    },

    async list(): Promise<MixRecord[]> {
      const tx = db.transaction(STORE.mixes, "readonly");
      const records = (await requestToPromise(
        tx.objectStore(STORE.mixes).index("byGeneratedAt").getAll(),
      )) as MixRecord[];
      // Newest generation first; the index already orders that way, and reversing
      // keeps the promise explicit rather than index-order-dependent.
      return records.reverse();
    },

    async remove(id: string): Promise<void> {
      const tx = db.transaction(STORE.mixes, "readwrite");
      tx.objectStore(STORE.mixes).delete(id);
      await transactionDone(tx);
    },

    async clear(): Promise<void> {
      const tx = db.transaction(STORE.mixes, "readwrite");
      tx.objectStore(STORE.mixes).clear();
      await transactionDone(tx);
    },
  };
}
