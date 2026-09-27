import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { createRepositories, openDatabase, STORE } from "@/data/indexeddb";
import type { SchemaMigration } from "@/data/migrations";

/**
 * Task 3.1: migration machinery — a synthetic registry runs in ascending
 * version order, only steps inside the upgrade range run, real schema v1
 * creates every store before repositories are served, and `versionchange`
 * closes our connections so future upgrades are never blocked.
 */

it("runs a shuffled synthetic registry in ascending version order", async () => {
  const runOrder: number[] = [];
  const synthetic = [3, 1, 2].map<SchemaMigration>((version) => ({
    version,
    description: `synthetic step ${version}`,
    run: (db: IDBDatabase) => {
      runOrder.push(version);
      db.createObjectStore(`synthetic-v${version}`, { keyPath: "id" });
    },
  }));

  const db = await openDatabase({
    name: "migrate-order-test",
    version: 3,
    migrations: synthetic,
  });
  try {
    expect(runOrder).toEqual([1, 2, 3]);
    expect([...db.objectStoreNames].sort()).toEqual([
      "synthetic-v1",
      "synthetic-v2",
      "synthetic-v3",
    ]);
  } finally {
    db.close();
  }
});

it("runs only the steps inside the upgrade range", async () => {
  const firstRun: number[] = [];
  const stepOne = [1].map<SchemaMigration>((version) => ({
    version,
    description: "step 1",
    run: (db: IDBDatabase) => {
      firstRun.push(version);
      db.createObjectStore("v1-store", { keyPath: "id" });
    },
  }));
  const dbOne = await openDatabase({
    name: "migrate-range-test",
    version: 1,
    migrations: stepOne,
  });
  dbOne.close();
  expect(firstRun).toEqual([1]);

  const secondRun: number[] = [];
  const stepsOneThroughThree = [3, 1, 2].map<SchemaMigration>((version) => ({
    version,
    description: `step ${version}`,
    run: (db: IDBDatabase) => {
      secondRun.push(version);
      if (version === 2) db.createObjectStore("v2-store", { keyPath: "id" });
      if (version === 3) db.createObjectStore("v3-store", { keyPath: "id" });
    },
  }));
  const dbTwo = await openDatabase({
    name: "migrate-range-test",
    version: 3,
    migrations: stepsOneThroughThree,
  });
  try {
    // The database is already at v1, so step 1 must not run again.
    expect(secondRun).toEqual([2, 3]);
    expect([...dbTwo.objectStoreNames].sort()).toEqual(["v1-store", "v2-store", "v3-store"]);
  } finally {
    dbTwo.close();
  }
});

it("creates every schema v1 store before repositories are served", async () => {
  const db = await openDatabase({ name: "schema-v1-test" });
  expect([...db.objectStoreNames].sort()).toEqual([...Object.values(STORE)].sort());
  db.close();

  const repos = await createRepositories({ name: "schema-v1-test" });
  expect(typeof repos.playlists.create).toBe("function");
  expect(typeof repos.likedTracks.like).toBe("function");
  repos.close();
});

it("closes the connection on versionchange so upgrades are not blocked", async () => {
  const db = await openDatabase({ name: "versionchange-test" });

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("versionchange-test", 2);
    request.onupgradeneeded = () => {
      /* schema v1 registry has no v2 step yet — upgrade is a no-op */
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

  // The original connection received versionchange and closed itself.
  expect(() => db.transaction(STORE.preferences)).toThrow();
});
