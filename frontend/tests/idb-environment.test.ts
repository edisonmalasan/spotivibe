import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";

/**
 * Test-infrastructure smoke test (M2 task 1.2): jsdom ships no IndexedDB, so
 * data-layer tests import `fake-indexeddb/auto`. This proves the environment
 * can open a database, create a store, write a record, and read it back —
 * the exact primitives every M2 repository integration test depends on.
 */

const DB_NAME = "spotivibe-smoke";

interface SmokeRecord {
  id: string;
  value: number;
}

function openSmokeDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("items", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putRecord(db: IDBDatabase, record: SmokeRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readwrite");
    tx.objectStore("items").put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function getRecord(db: IDBDatabase, id: string): Promise<SmokeRecord> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readonly");
    const request = tx.objectStore("items").get(id);
    request.onsuccess = () => resolve(request.result as SmokeRecord);
    request.onerror = () => reject(request.error);
  });
}

function deleteSmokeDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

afterEach(async () => {
  await deleteSmokeDb();
});

it("opens a database, creates a store, writes and reads a record", async () => {
  const db = await openSmokeDb();
  try {
    await putRecord(db, { id: "track-1", value: 42 });
    const read = await getRecord(db, "track-1");
    expect(read).toEqual({ id: "track-1", value: 42 });
  } finally {
    db.close();
  }
});
