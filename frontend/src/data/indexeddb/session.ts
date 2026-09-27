import type { SessionRecord, SessionRepository, SessionSnapshot } from "@/data/repositories";
import { requestToPromise, transactionDone } from "./idb";
import { SINGLE_RECORD_KEY, STORE } from "./schema";

export function createSessionRepository(db: IDBDatabase): SessionRepository {
  return {
    async get(): Promise<SessionRecord | null> {
      const tx = db.transaction(STORE.session, "readonly");
      const record = await requestToPromise<SessionRecord | undefined>(
        tx.objectStore(STORE.session).get(SINGLE_RECORD_KEY),
      );
      return record ?? null;
    },

    async set(snapshot: SessionSnapshot): Promise<SessionRecord> {
      const record: SessionRecord = {
        id: SINGLE_RECORD_KEY,
        ...snapshot,
        updatedAt: Date.now(),
      };
      const tx = db.transaction(STORE.session, "readwrite");
      tx.objectStore(STORE.session).put(record);
      await transactionDone(tx);
      return record;
    },

    async clear(): Promise<void> {
      const tx = db.transaction(STORE.session, "readwrite");
      tx.objectStore(STORE.session).delete(SINGLE_RECORD_KEY);
      await transactionDone(tx);
    },
  };
}
