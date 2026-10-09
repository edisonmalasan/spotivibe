import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { createRepositories, openDatabase, STORE } from "@/data/indexeddb";
import { STORE_DEFINITIONS } from "@/data/indexeddb/schema";
import { SCHEMA_VERSION } from "@/data/indexeddb/schema";
import type { SchemaMigration } from "@/data/migrations";

/**
 * Task 3.1: migration machinery - a synthetic registry runs in ascending
 * version order, only steps inside the upgrade range run, the real schema
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

it("adds the picks store to a database that predates it", async () => {
  /*
   * A database created *before* this change has no picks store, and that is the
   * upgrade every existing listener performs. `openDatabase({version: 2})` cannot
   * model it: the v1 step is `createInitialSchema`, which builds **every** store
   * in `STORE_DEFINITIONS`, so a "v2" database opened through it already contains
   * the new one. (An earlier draft of this test asserted otherwise and failed —
   * the shape it described cannot exist.)
   *
   * So the older database is built by hand, from the real definitions minus the
   * picks store, and reopened at the shipped version.
   */
  const name = "picks-upgrade-test";
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => {
      for (const definition of STORE_DEFINITIONS) {
        if (definition.name === STORE.quickPickPicks) continue;
        const store = request.result.createObjectStore(definition.name, definition.options);
        for (const index of definition.indexes ?? []) {
          store.createIndex(index.name, index.keyPath, index.options);
        }
      }
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

  const upgraded = await openDatabase({ name });
  try {
    expect(upgraded.version).toBe(SCHEMA_VERSION);
    expect(upgraded.objectStoreNames.contains(STORE.quickPickPicks)).toBe(true);
    // The index the ordering and merge rules rely on must exist, not just the store.
    const store = upgraded
      .transaction(STORE.quickPickPicks, "readonly")
      .objectStore(STORE.quickPickPicks);
    expect([...store.indexNames]).toContain("byPickedAt");
    // And the v3 step must not have disturbed what was already there.
    expect(upgraded.objectStoreNames.contains(STORE.mixes)).toBe(true);
    expect(upgraded.objectStoreNames.contains(STORE.likedTracks)).toBe(true);
  } finally {
    upgraded.close();
  }
});

it("opens a database already at v3 without failing the upgrade", async () => {
  /*
   * The migration guard is what makes this safe: a fresh database is built by
   * `createInitialSchema`, which already creates every store, and the v3 step
   * must therefore be a no-op rather than throwing `ConstraintError` on a store
   * that exists.
   */
  const first = await openDatabase({ name: "picks-idempotent-test" });
  expect(first.objectStoreNames.contains(STORE.quickPickPicks)).toBe(true);
  first.close();

  const second = await openDatabase({ name: "picks-idempotent-test" });
  expect(second.objectStoreNames.contains(STORE.quickPickPicks)).toBe(true);
  second.close();
});

it("closes the connection on versionchange so upgrades are not blocked", async () => {
  const db = await openDatabase({ name: "versionchange-test" });

  // Strictly above the shipped schema: asking for the version we are already at
  // is not an upgrade, so no `versionchange` would ever fire and this would
  // silently stop testing anything (it did exactly that at schema v2).
  const nextVersion = SCHEMA_VERSION + 1;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("versionchange-test", nextVersion);
    request.onupgradeneeded = () => {
      /* no step beyond the shipped schema — the upgrade itself is a no-op */
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
