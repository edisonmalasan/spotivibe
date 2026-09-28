import type { SearchEntryRecord, SearchHistoryRepository } from "@/data/repositories";
import { LocalDataError } from "@/data/repositories";
import { requestToPromise, transactionDone } from "./idb";
import { STORE } from "./schema";

export function createSearchHistoryRepository(db: IDBDatabase): SearchHistoryRepository {
  return {
    async record(query: string): Promise<SearchEntryRecord> {
      const trimmed = query.trim();
      if (trimmed === "") {
        throw new LocalDataError("Cannot record an empty search query.");
      }
      const record: SearchEntryRecord = {
        query: trimmed,
        normalizedQuery: trimmed.toLowerCase(),
        searchedAt: Date.now(),
      };
      const tx = db.transaction(STORE.searchHistory, "readwrite");
      tx.objectStore(STORE.searchHistory).put(record);
      await transactionDone(tx);
      return record;
    },

    async list(limit?: number): Promise<SearchEntryRecord[]> {
      const tx = db.transaction(STORE.searchHistory, "readonly");
      const ascending = await requestToPromise(
        tx.objectStore(STORE.searchHistory).index("bySearchedAt").getAll(),
      );
      const newestFirst = ascending.reverse();
      return limit === undefined ? newestFirst : newestFirst.slice(0, limit);
    },

    async clear(): Promise<void> {
      const tx = db.transaction(STORE.searchHistory, "readwrite");
      tx.objectStore(STORE.searchHistory).clear();
      await transactionDone(tx);
    },

    async remove(query: string): Promise<void> {
      const trimmed = query.trim();
      if (trimmed === "") return; // nothing normalizes to an empty key: no-op
      const tx = db.transaction(STORE.searchHistory, "readwrite");
      // keyPath delete on the normalized identity (symmetric with `record`).
      tx.objectStore(STORE.searchHistory).delete(trimmed.toLowerCase());
      await transactionDone(tx);
    },
  };
}
