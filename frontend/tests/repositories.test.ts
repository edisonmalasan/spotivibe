import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createRepositories, type RepositorySet } from "@/data/indexeddb";
import { DEFAULT_PREFERENCES, type Track } from "@/data/repositories";

/**
 * Tasks 3.2/3.3: repository integration tests against a spec-compliant
 * IndexedDB implementation — per-dataset CRUD/list/clear behavior and
 * close/reopen durability (reload survival at the storage layer).
 */

function makeTrack(id: string): Track {
  return {
    id,
    source: "youtube",
    providerId: `yt-${id}`,
    title: `Title ${id}`,
    artists: [{ name: `Artist ${id}` }],
    artwork: [],
    category: "music",
    capabilities: { stream: true, offlineDownload: false },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let open: RepositorySet | undefined;
let nameCounter = 0;

async function freshRepositories(): Promise<RepositorySet> {
  open = await createRepositories({ name: `repo-test-${++nameCounter}` });
  return open;
}

afterEach(() => {
  open?.close();
  open = undefined;
});

describe("LikedTracksRepository", () => {
  it("likes, reads, orders newest-first, dedupes re-likes, unlikes, clears", async () => {
    const repo = (await freshRepositories()).likedTracks;
    await repo.like(makeTrack("a"), 1000);
    await repo.like(makeTrack("b"), 3000);
    await repo.like(makeTrack("c"), 2000);

    expect(await repo.isLiked("a")).toBe(true);
    expect(await repo.isLiked("missing")).toBe(false);
    expect((await repo.get("a"))?.track.title).toBe("Title a");
    expect(await repo.get("missing")).toBeUndefined();
    expect((await repo.list()).map((r) => r.trackId)).toEqual(["b", "c", "a"]);

    await repo.like(makeTrack("a"), 4000);
    const afterRelike = await repo.list();
    expect(afterRelike.map((r) => r.trackId)).toEqual(["a", "b", "c"]);
    expect(afterRelike).toHaveLength(3);

    await repo.unlike("b");
    expect(await repo.isLiked("b")).toBe(false);

    await repo.clear();
    expect(await repo.list()).toEqual([]);
  });
});

describe("PlaylistsRepository", () => {
  it("creates, updates, maintains ordered tracks, and clears playlists", async () => {
    const repo = (await freshRepositories()).playlists;
    const created = await repo.create({ name: "Road Trip", description: "x" });
    expect(created.tracks).toEqual([]);
    expect(created.createdAt).toBe(created.updatedAt);

    await repo.addTrack(created.id, makeTrack("a"));
    await repo.addTrack(created.id, makeTrack("b"));
    await repo.addTrack(created.id, makeTrack("c"), 0);
    expect((await repo.get(created.id))?.tracks.map((e) => e.track.id)).toEqual(["c", "a", "b"]);

    await repo.reorderTrack(created.id, 2, 0);
    expect((await repo.get(created.id))?.tracks.map((e) => e.track.id)).toEqual(["b", "c", "a"]);

    await repo.removeTrack(created.id, "a");
    expect((await repo.get(created.id))?.tracks.map((e) => e.track.id)).toEqual(["b", "c"]);

    await expect(repo.removeTrack(created.id, "a")).rejects.toThrow();
    await expect(repo.reorderTrack(created.id, 0, 5)).rejects.toThrow();
    await expect(repo.reorderTrack(created.id, -1, 0)).rejects.toThrow();

    const updated = await repo.update(created.id, { name: "Renamed" });
    expect(updated.name).toBe("Renamed");
    expect(updated.description).toBe("x");

    await expect(repo.get("missing")).resolves.toBeUndefined();
    await expect(repo.update("missing", { name: "x" })).rejects.toThrow();

    await sleep(3);
    await repo.create({ name: "Older" });
    expect((await repo.list()).map((p) => p.name)).toEqual(["Older", "Renamed"]);

    await repo.remove(created.id);
    expect(await repo.get(created.id)).toBeUndefined();

    await repo.clear();
    expect(await repo.list()).toEqual([]);
  });
});

describe("ListeningHistoryRepository", () => {
  it("records events with generated or provided ids and lists newest-first", async () => {
    const repo = (await freshRepositories()).listeningHistory;
    const first = await repo.record({
      trackId: "a",
      track: makeTrack("a"),
      playedAt: 100,
      secondsPlayed: 30,
      context: "home",
    });
    expect(first.id).toBeTruthy();

    const fixed = await repo.record({
      id: "evt-fixed",
      trackId: "b",
      track: makeTrack("b"),
      playedAt: 200,
      secondsPlayed: 10,
      completed: true,
      context: "search",
    });
    expect(fixed.id).toBe("evt-fixed");

    await repo.record({
      trackId: "c",
      track: makeTrack("c"),
      playedAt: 150,
      secondsPlayed: 5,
      skipped: true,
      context: "playlist",
    });

    expect((await repo.list()).map((e) => e.playedAt)).toEqual([200, 150, 100]);
    expect((await repo.list(2)).map((e) => e.playedAt)).toEqual([200, 150]);

    await repo.clear();
    expect(await repo.list()).toEqual([]);
  });
});

describe("SearchHistoryRepository", () => {
  it("normalizes queries, dedupes by identity, and refreshes recency", async () => {
    const repo = (await freshRepositories()).searchHistory;
    await repo.record("  Beatles  ");
    await sleep(3);
    const second = await repo.record("beatles");
    expect(second.query).toBe("beatles");
    expect(second.normalizedQuery).toBe("beatles");

    const deduped = await repo.list();
    expect(deduped).toHaveLength(1);
    expect(deduped[0].query).toBe("beatles");

    await sleep(3);
    await repo.record("Radiohead");
    expect((await repo.list()).map((e) => e.normalizedQuery)).toEqual(["radiohead", "beatles"]);
    expect(await repo.list(1)).toHaveLength(1);

    await expect(repo.record("   ")).rejects.toThrow();

    await repo.clear();
    expect(await repo.list()).toEqual([]);
  });

  it("removes exactly one entry, is a no-op for unknown or empty queries", async () => {
    const repo = (await freshRepositories()).searchHistory;
    await repo.record("Beatles");
    await sleep(3);
    await repo.record("Radiohead");
    await sleep(3);
    await repo.record("Daft Punk");

    // Raw query in, normalized internally (symmetric with `record`).
    await repo.remove("  beatles ");
    expect((await repo.list()).map((e) => e.normalizedQuery)).toEqual(["daft punk", "radiohead"]); // the others stay newest-first

    await repo.remove("unknown query"); // no-op for an unknown identity
    expect(await repo.list()).toHaveLength(2);

    await repo.remove("   "); // no-op: nothing normalizes to an empty key
    expect(await repo.list()).toHaveLength(2);

    await repo.clear();
    expect(await repo.list()).toEqual([]);
  });
});

describe("PreferencesRepository", () => {
  it("returns defaults and merges patches over stored values", async () => {
    const repo = (await freshRepositories()).preferences;
    expect(await repo.get()).toEqual(DEFAULT_PREFERENCES);

    const afterSet = await repo.set({ languages: ["hi", "ta"] });
    expect(afterSet.languages).toEqual(["hi", "ta"]);
    expect(afterSet.autoplayNext).toBe(DEFAULT_PREFERENCES.autoplayNext);

    const merged = await repo.set({ onboardingComplete: true });
    expect(merged.languages).toEqual(["hi", "ta"]);
    expect(merged.onboardingComplete).toBe(true);
  });
});

describe("SessionRepository", () => {
  it("round-trips the queue snapshot and clears", async () => {
    const repo = (await freshRepositories()).session;
    expect(await repo.get()).toBeNull();

    const saved = await repo.set({
      queue: [makeTrack("a"), makeTrack("b")],
      queueIndex: 1,
      positionSeconds: 42.5,
      repeatMode: "context",
      shuffle: true,
      volume: 0.8,
    });
    expect(saved.id).toBe("app");

    const loaded = await repo.get();
    expect(loaded?.queue.map((t) => t.id)).toEqual(["a", "b"]);
    expect(loaded?.queueIndex).toBe(1);
    expect(loaded?.positionSeconds).toBe(42.5);
    expect(loaded?.updatedAt).toBeGreaterThan(0);

    await repo.clear();
    expect(await repo.get()).toBeNull();
  });
});

describe("MetadataCacheRepository", () => {
  it("stores, reads, batches, and clears cached metadata", async () => {
    const repo = (await freshRepositories()).metadataCache;
    await repo.put(makeTrack("a"));
    await repo.putMany([makeTrack("b"), makeTrack("c")]);

    expect((await repo.get("yt-b"))?.track.title).toBe("Title b");
    expect(await repo.get("yt-missing")).toBeUndefined();
    expect(await repo.list()).toHaveLength(3);

    await repo.clear();
    expect(await repo.list()).toEqual([]);
  });
});

describe("durability", () => {
  it("reads identical values after close and reopen (reload survival)", async () => {
    const name = `durability-${++nameCounter}`;
    const first = await createRepositories({ name });
    await first.preferences.set({ languages: ["hi"] });
    const playlist = await first.playlists.create({ name: "Road Trip" });
    await first.playlists.addTrack(playlist.id, makeTrack("a"));
    await first.likedTracks.like(makeTrack("a"), 777);
    await first.session.set({
      queue: [makeTrack("a")],
      queueIndex: 0,
      positionSeconds: 12,
      repeatMode: "off",
      shuffle: false,
      volume: 0.5,
    });
    first.close();

    const second = await createRepositories({ name });
    open = second;
    expect((await second.preferences.get()).languages).toEqual(["hi"]);
    const playlists = await second.playlists.list();
    expect(playlists.map((p) => p.name)).toEqual(["Road Trip"]);
    expect(playlists[0].tracks.map((e) => e.track.id)).toEqual(["a"]);
    expect(await second.likedTracks.isLiked("a")).toBe(true);
    expect((await second.likedTracks.get("a"))?.likedAt).toBe(777);
    expect((await second.session.get())?.positionSeconds).toBe(12);
  });
});
