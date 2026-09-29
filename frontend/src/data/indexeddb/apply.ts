import type { PreparedImport } from "@/data/backup";
import { transactionDone } from "./idb";
import { SINGLE_RECORD_KEY, STORE } from "./schema";

/**
 * Atomic execution of import plans (local-data spec "Atomic import
 * application"): a plan is applied in ONE transaction spanning the affected
 * stores — any thrown error or request failure aborts the transaction, which
 * rolls back every clear and write in the plan. Failure leaves the pre-import
 * database byte-for-byte intact.
 */

const SUPPORTED_DATASETS = [
  STORE.likedTracks,
  STORE.playlists,
  STORE.listeningHistory,
  STORE.searchHistory,
  STORE.preferences,
  STORE.session,
  // M11: mixes are a supported dataset, so `"replace"` clears them like every
  // other one. Importing a pre-M11 envelope — which carries no mixes — must leave
  // the dataset *empty*, not untouched (spec `local-data`, "An envelope without
  // the mixes dataset still imports").
  STORE.mixes,
] as const;

export function applyImport(db: IDBDatabase, plan: PreparedImport): Promise<void> {
  const stores = new Set<string>();
  if (plan.clearFirst) {
    for (const name of SUPPORTED_DATASETS) stores.add(name);
  }
  if (plan.writes.likedTracks.length > 0) stores.add(STORE.likedTracks);
  if (plan.writes.playlists.length > 0) stores.add(STORE.playlists);
  if (plan.writes.history.length > 0) stores.add(STORE.listeningHistory);
  if (plan.writes.searchHistory.length > 0) stores.add(STORE.searchHistory);
  if (plan.writes.mixes.length > 0) stores.add(STORE.mixes);
  if (plan.writes.preferences !== undefined) stores.add(STORE.preferences);
  if (plan.writes.session !== null && plan.writes.session !== undefined) {
    stores.add(STORE.session);
  }
  if (stores.size === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([...stores], "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Import transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("Import transaction aborted"));

    try {
      if (plan.clearFirst) {
        for (const name of SUPPORTED_DATASETS) {
          tx.objectStore(name).clear();
        }
      }
      const liked = tx.objectStore(STORE.likedTracks);
      for (const record of plan.writes.likedTracks) liked.put(record);
      const playlists = tx.objectStore(STORE.playlists);
      for (const record of plan.writes.playlists) playlists.put(record);
      const history = tx.objectStore(STORE.listeningHistory);
      for (const record of plan.writes.history) history.put(record);
      const search = tx.objectStore(STORE.searchHistory);
      for (const record of plan.writes.searchHistory) search.put(record);
      // M11: mixes are written by identity, so a refresh in the backup overwrites
      // the local record of the same mix rather than creating a second one.
      if (plan.writes.mixes.length > 0) {
        const mixes = tx.objectStore(STORE.mixes);
        for (const record of plan.writes.mixes) mixes.put(record);
      }
      if (plan.writes.preferences !== undefined) {
        tx.objectStore(STORE.preferences).put({
          id: SINGLE_RECORD_KEY,
          ...plan.writes.preferences,
        });
      }
      if (plan.writes.session !== null && plan.writes.session !== undefined) {
        tx.objectStore(STORE.session).put({
          id: SINGLE_RECORD_KEY,
          ...plan.writes.session,
        });
      }
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* already settled — the rejection below is what matters */
      }
      reject(error);
    }
  });
}

/** Reset: clear every store (including derived caches) in one transaction. */
export async function resetStores(db: IDBDatabase): Promise<void> {
  const stores = Object.values(STORE);
  const tx = db.transaction(stores, "readwrite");
  for (const name of stores) {
    tx.objectStore(name).clear();
  }
  await transactionDone(tx);
}
