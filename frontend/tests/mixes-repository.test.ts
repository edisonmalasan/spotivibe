import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, STORE, type RepositorySet } from "@/data/indexeddb";
import { SCHEMA_VERSION, STORE_DEFINITIONS } from "@/data/indexeddb/schema";
import { getLocalData } from "@/data/localData";
import { resetMixStore, useMixStore } from "@/stores/mixStore";
import type { MixRecord, Track } from "@/data/repositories";

/**
 * M11 task 3.1/3.2: mix storage and the mix store.
 *
 * A mix is the only derived dataset Spotivibe persists, and it persists because
 * it is *user-visible derived data* — a name the listener recognizes. So the
 * properties pinned here are the ones that make that name trustworthy: the record
 * survives a reopen, a refresh keeps the identity **and** the name, and the store
 * mirrors the repository rather than becoming a second source of truth.
 */

let open: RepositorySet | undefined;
let nameCounter = 0;

async function freshRepositories(): Promise<RepositorySet> {
  open = await createRepositories({ name: `mix-repo-test-${++nameCounter}` });
  return open;
}

function track(id: string, artist = "Aurora"): Track {
  return {
    id: `youtube:${id}`,
    source: "youtube",
    providerId: id,
    title: `Song ${id}`,
    artists: [{ name: artist }],
    artwork: [],
    category: "music",
    capabilities: { stream: true, offlineDownload: false },
  };
}

function mix(overrides: Partial<MixRecord> = {}): MixRecord {
  return {
    id: "mix:2026-09-30:aurora",
    name: "Aurora",
    generatedAt: 1_700_000_000_000,
    period: "2026-09-30",
    seeds: ["Aurora"],
    tracks: [track("a"), track("b")],
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

afterEach(() => {
  open?.close();
  open = undefined;
  resetMixStore();
});

describe("MixesRepository", () => {
  it("creates a mix and reads it back by id", async () => {
    const repos = await freshRepositories();
    const created = await repos.mixes.create(mix());
    expect(created.id).toBe("mix:2026-09-30:aurora");
    expect(await repos.mixes.get(created.id)).toEqual(created);
  });

  it("stamps an id when the caller supplies none", async () => {
    const repos = await freshRepositories();
    const withoutId: Omit<MixRecord, "id"> = {
      name: "Aurora",
      generatedAt: 1_700_000_000_000,
      period: "2026-09-30",
      seeds: ["Aurora"],
      tracks: [track("a")],
      updatedAt: 1_700_000_000_000,
    };
    const created = await repos.mixes.create(withoutId);
    expect(created.id).not.toBe("");
    expect(await repos.mixes.get(created.id)).toBeDefined();
  });

  it("lists mixes newest-generation first", async () => {
    const repos = await freshRepositories();
    await repos.mixes.create(mix({ id: "mix:old", generatedAt: 1_000, updatedAt: 1_000 }));
    await repos.mixes.create(mix({ id: "mix:new", generatedAt: 3_000, updatedAt: 3_000 }));
    await repos.mixes.create(mix({ id: "mix:mid", generatedAt: 2_000, updatedAt: 2_000 }));
    expect((await repos.mixes.list()).map((entry) => entry.id)).toEqual([
      "mix:new",
      "mix:mid",
      "mix:old",
    ]);
  });

  it("refreshes the contents while keeping the identity and the name", async () => {
    const repos = await freshRepositories();
    await repos.mixes.create(mix());
    const refreshed = await repos.mixes.refresh("mix:2026-09-30:aurora", {
      tracks: [track("z")],
      seeds: ["Aurora", "Jazz"],
      period: "2026-09-01",
    });

    expect(refreshed?.id).toBe("mix:2026-09-30:aurora");
    expect(refreshed?.name).toBe("Aurora");
    expect(refreshed?.generatedAt).toBe(1_700_000_000_000);
    expect(refreshed?.tracks.map((entry) => entry.id)).toEqual(["youtube:z"]);
    expect(refreshed?.seeds).toEqual(["Aurora", "Jazz"]);
    // A refresh is a write to the same key, so the mix count must not change.
    expect(await repos.mixes.list()).toHaveLength(1);
  });

  it("bumps updatedAt on refresh, so merge conflict rules can order them", async () => {
    const repos = await freshRepositories();
    await repos.mixes.create(mix());
    const refreshed = await repos.mixes.refresh("mix:2026-09-30:aurora", {
      tracks: [track("z")],
      seeds: ["Aurora"],
      period: "2026-09-30",
    });
    expect(refreshed?.updatedAt).toBeGreaterThan(mix().updatedAt);
  });

  it("does not create a mix that was never there", async () => {
    const repos = await freshRepositories();
    expect(
      await repos.mixes.refresh("mix:missing", {
        tracks: [track("z")],
        seeds: ["Aurora"],
        period: "2026-09-30",
      }),
    ).toBeUndefined();
    expect(await repos.mixes.list()).toEqual([]);
  });

  it("removes and clears", async () => {
    const repos = await freshRepositories();
    await repos.mixes.create(mix({ id: "mix:a" }));
    await repos.mixes.create(mix({ id: "mix:b" }));

    await repos.mixes.remove("mix:a");
    expect((await repos.mixes.list()).map((entry) => entry.id)).toEqual(["mix:b"]);

    await repos.mixes.clear();
    expect(await repos.mixes.list()).toEqual([]);
  });

  it("survives close and reopen", async () => {
    const name = `mix-reopen-test-${++nameCounter}`;
    const first = await createRepositories({ name });
    await first.mixes.create(mix());
    first.close();

    // Same database, new connection — what a page reload actually does.
    const second = await createRepositories({ name });
    open = second;
    const list = await second.mixes.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Aurora");
  });
});

describe("mix store", () => {
  // The store talks to the app-wide shared connection, so these cases use it
  // directly instead of the isolated repositories above.
  beforeEach(async () => {
    await (await getLocalData()).mixes.clear();
    resetMixStore();
  });

  it("hydrates from the repository and upserts newest-first", async () => {
    await (
      await getLocalData()
    ).mixes.create(mix({ id: "mix:old", generatedAt: 1_000, updatedAt: 1_000 }));

    await useMixStore.getState().hydrate();
    expect(useMixStore.getState().mixes.map((entry) => entry.id)).toEqual(["mix:old"]);

    useMixStore.getState().upsert(mix({ id: "mix:new", generatedAt: 2_000, updatedAt: 2_000 }));
    expect(useMixStore.getState().mixes.map((entry) => entry.id)).toEqual(["mix:new", "mix:old"]);
    expect(useMixStore.getState().status).toBe("ready");
    expect(useMixStore.getState().error).toBeNull();
  });

  it("upsert replaces in place rather than duplicating a refreshed mix", async () => {
    useMixStore.getState().upsert(mix());
    useMixStore.getState().upsert(mix({ name: "Aurora (June)", updatedAt: 2_000 }));

    const mixes = useMixStore.getState().mixes;
    expect(mixes).toHaveLength(1);
    expect(mixes[0].name).toBe("Aurora (June)");
  });

  it("removes through the repository, not only from memory", async () => {
    const data = await getLocalData();
    await data.mixes.create(mix({ id: "mix:a" }));
    await useMixStore.getState().hydrate();

    await useMixStore.getState().remove("mix:a");
    expect(useMixStore.getState().mixes).toEqual([]);
    expect(await data.mixes.list()).toEqual([]);
  });

  it("always carries a readable message with an error status", async () => {
    useMixStore.getState().setStatus("generating");
    expect(useMixStore.getState().error).toBeNull();

    useMixStore.getState().setStatus("error");
    expect(useMixStore.getState().error).toBeTruthy();

    // Clearing the status clears the stale message with it.
    useMixStore.getState().setStatus("ready");
    expect(useMixStore.getState().error).toBeNull();
    expect(useMixStore.getState().activeId).toBeNull();
  });
});

describe("schema version 2 adds the mixes store", () => {
  it("targets version 2 and defines the store with its index", () => {
    expect(SCHEMA_VERSION).toBe(2);
    const definition = STORE_DEFINITIONS.find((entry) => entry.name === STORE.mixes);
    expect(definition?.options.keyPath).toBe("id");
    expect(definition?.indexes?.map((index) => index.name)).toEqual(["byGeneratedAt"]);
  });

  it("upgrades a version 1 database in place, keeping existing data", async () => {
    // A database created by the shipped v1 schema: no mixes store at all.
    const v1 = await openDatabase({
      name: "mix-migration-test",
      version: 1,
      migrations: [
        {
          version: 1,
          description: "v1 stores only",
          run: (db) => {
            db.createObjectStore(STORE.playlists, { keyPath: "id" });
          },
        },
      ],
    });
    const tx = v1.transaction(STORE.playlists, "readwrite");
    tx.objectStore(STORE.playlists).put({
      id: "p1",
      name: "Kept",
      createdAt: 1,
      updatedAt: 1,
      tracks: [],
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    v1.close();

    // Reopening at the real target version runs the shipped v2 step.
    const upgraded = await openDatabase({ name: "mix-migration-test" });
    try {
      expect([...upgraded.objectStoreNames]).toContain(STORE.mixes);
      expect(upgraded.objectStoreNames.contains(STORE.mixes)).toBe(true);

      const read = await new Promise<unknown>((resolve, reject) => {
        const readTx = upgraded.transaction(STORE.playlists, "readonly");
        const request = readTx.objectStore(STORE.playlists).get("p1");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      expect(read).toMatchObject({ id: "p1", name: "Kept" });
    } finally {
      upgraded.close();
    }
  });

  it("is idempotent for a database already created at the current version", async () => {
    const db = await openDatabase({ name: "mix-migration-idempotent" });
    try {
      expect(db.objectStoreNames.contains(STORE.mixes)).toBe(true);
    } finally {
      db.close();
    }
  });
});
