import type { ListeningEventRecord, ListeningHistoryRepository } from "@/data/repositories";
import { transactionDone, requestToPromise } from "./idb";
import { STORE } from "./schema";

export function createListeningHistoryRepository(db: IDBDatabase): ListeningHistoryRepository {
  return {
    async record(event): Promise<ListeningEventRecord> {
      const record: ListeningEventRecord = {
        ...event,
        id: event.id ?? crypto.randomUUID(),
      };
      const tx = db.transaction(STORE.listeningHistory, "readwrite");
      tx.objectStore(STORE.listeningHistory).put(record);
      await transactionDone(tx);
      return record;
    },

    async list(limit?: number): Promise<ListeningEventRecord[]> {
      const tx = db.transaction(STORE.listeningHistory, "readonly");
      const ascending = await requestToPromise(
        tx.objectStore(STORE.listeningHistory).index("byPlayedAt").getAll(),
      );
      const newestFirst = ascending.reverse();
      return limit === undefined ? newestFirst : newestFirst.slice(0, limit);
    },

    async clear(): Promise<void> {
      const tx = db.transaction(STORE.listeningHistory, "readwrite");
      tx.objectStore(STORE.listeningHistory).clear();
      await transactionDone(tx);
    },
  };
}
