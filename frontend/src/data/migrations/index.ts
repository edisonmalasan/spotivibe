import { STORE, STORE_DEFINITIONS } from "@/data/indexeddb/schema";

/**
 * Versioned IndexedDB schema migration registry.
 *
 * One entry per schema version; `openDatabase` runs every step whose target
 * version falls between the stored version and the requested version, in
 * ascending order. Steps are pure schema operations (no data transforms), so
 * a future `version: 2` step only needs to be appended here.
 */

export interface SchemaMigration {
  /** Schema version this step upgrades TO. */
  version: number;
  description: string;
  /** Runs inside `onupgradeneeded` for databases below `version`. */
  run(db: IDBDatabase): void;
}

function createInitialSchema(db: IDBDatabase): void {
  for (const definition of STORE_DEFINITIONS) {
    if (db.objectStoreNames.contains(definition.name)) continue;
    const store = db.createObjectStore(definition.name, definition.options);
    for (const index of definition.indexes ?? []) {
      store.createIndex(index.name, index.keyPath, index.options);
    }
  }
}

/**
 * M11: the Smart Mixes store (ROADMAP "listening history, stats, streaks, and
 * Smart Mixes"). The only addition M11 makes to local storage, and it is derived
 * data — the guard makes an upgrade idempotent, because a database created fresh
 * at version 2 already has it from the initial-schema step.
 */
function addMixesStore(db: IDBDatabase): void {
  if (db.objectStoreNames.contains(STORE.mixes)) return;
  const store = db.createObjectStore(STORE.mixes, { keyPath: "id" });
  store.createIndex("byGeneratedAt", "generatedAt");
}

/**
 * The first-run artist picker store.
 *
 * Idempotent for the same reason `addMixesStore` is: a database created fresh at
 * version 3 already has this store from `createInitialSchema`, and the upgrade
 * handler must not fail trying to add it a second time.
 *
 * Keyed by artist identity rather than by row id, so picking the same artist
 * twice is one record and un-picking is a delete — the `likedTracks` precedent.
 */
function addQuickPickPicksStore(db: IDBDatabase): void {
  if (db.objectStoreNames.contains(STORE.quickPickPicks)) return;
  const store = db.createObjectStore(STORE.quickPickPicks, { keyPath: "artistId" });
  store.createIndex("byPickedAt", "pickedAt");
}

/** Ordered registry of schema migrations (append-only, one per version). */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    description: "Create the initial object stores",
    run: createInitialSchema,
  },
  {
    version: 2,
    description: "Add the Smart Mixes store",
    run: addMixesStore,
  },
  {
    version: 3,
    description: "Add the first-run Quick Picks store",
    run: addQuickPickPicksStore,
  },
];
