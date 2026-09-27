import type { SessionRecord, SessionRepository, SessionSnapshot } from "@/data/repositories";
import { requestToPromise, transactionDone } from "./idb";
import { STORE } from "./schema";

const SESSION_ID = "app";

export function createSessionRepository(db: IDBDatabase): SessionRepository {
  return {
    async get(): Promise<SessionRecord | null> {
      const tx = db.transaction(STORE.session, "readonly");
      const record = await requestToPromise<SessionRecord | undefined>(
        tx.objectStore(STORE.session).get(SESSION_ID),
      );
      return record ?? null;
    },

    async set(snapshot: SessionSnapshot): Promise<SessionRecord> {
      const record: SessionRecord = {
        id: SESSION_ID,
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
      tx.objectStore(STORE.session).delete(SESSION_ID);
      await transactionDone(tx);
    },
  };
}
