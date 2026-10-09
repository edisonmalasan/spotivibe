import type { QuickPickPickRecord, QuickPickPicksRepository } from "@/data/repositories";
import { requestToPromise, transactionDone } from "./idb";
import { STORE } from "./schema";

/**
 * Artists picked during first-run onboarding.
 *
 * `replaceAll` is one transaction rather than a delete-then-insert loop: a
 * partially written selection would leave the rail showing artists the listener
 * had just unticked, and onboarding is exactly the moment where that would be
 * visible and wrong.
 */
export function createQuickPickPicksRepository(db: IDBDatabase): QuickPickPicksRepository {
  return {
    async pick(artistId, name, pickedAt = Date.now()): Promise<QuickPickPickRecord> {
      const record: QuickPickPickRecord = { artistId, name, pickedAt };
      const tx = db.transaction(STORE.quickPickPicks, "readwrite");
      tx.objectStore(STORE.quickPickPicks).put(record);
      await transactionDone(tx);
      return record;
    },

    async unpick(artistId: string): Promise<void> {
      const tx = db.transaction(STORE.quickPickPicks, "readwrite");
      tx.objectStore(STORE.quickPickPicks).delete(artistId);
      await transactionDone(tx);
    },

    async replaceAll(entries: readonly { artistId: string; name: string }[]): Promise<void> {
      const tx = db.transaction(STORE.quickPickPicks, "readwrite");
      const store = tx.objectStore(STORE.quickPickPicks);
      store.clear();
      // One timestamp for the whole selection, so the listed order is the
      // listener's own order rather than an artefact of per-row write timing.
      const pickedAt = Date.now();
      for (const entry of entries) {
        store.put({ artistId: entry.artistId, name: entry.name, pickedAt });
      }
      await transactionDone(tx);
    },

    async has(artistId: string): Promise<boolean> {
      const tx = db.transaction(STORE.quickPickPicks, "readonly");
      const value = await requestToPromise(tx.objectStore(STORE.quickPickPicks).get(artistId));
      return value !== undefined;
    },

    async list(): Promise<QuickPickPickRecord[]> {
      const tx = db.transaction(STORE.quickPickPicks, "readonly");
      const records = await requestToPromise(tx.objectStore(STORE.quickPickPicks).getAll());
      return records.sort((a, b) => b.pickedAt - a.pickedAt);
    },

    async clear(): Promise<void> {
      const tx = db.transaction(STORE.quickPickPicks, "readwrite");
      tx.objectStore(STORE.quickPickPicks).clear();
      await transactionDone(tx);
    },
  };
}
