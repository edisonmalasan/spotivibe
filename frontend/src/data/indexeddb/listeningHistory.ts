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

    async update(
      id: string,
      patch: { secondsPlayed?: number; completed?: boolean },
    ): Promise<ListeningEventRecord | undefined> {
      const tx = db.transaction(STORE.listeningHistory, "readwrite");
      const store = tx.objectStore(STORE.listeningHistory);
      const existing = (await requestToPromise(store.get(id))) as ListeningEventRecord | undefined;
      // An unknown id is not an error: a step can end after its event was
      // cleared (History → Clear history), and a measurement for a row that no
      // longer exists has nothing to attach to.
      if (existing === undefined) return undefined;
      const updated: ListeningEventRecord = { ...existing, ...patch };
      store.put(updated);
      await transactionDone(tx);
      return updated;
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
