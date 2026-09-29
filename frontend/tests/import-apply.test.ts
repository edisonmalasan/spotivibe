import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  collectLocalData,
  planMerge,
  planReplace,
  prepareImport,
  serializeBackup,
} from "@/data/backup";
import { createRepositories, type RepositorySet } from "@/data/indexeddb";
import { DEFAULT_PREFERENCES, type ListeningEventRecord } from "@/data/repositories";
import {
  FIXED_EXPORTED_AT,
  makeBackupData,
  makeEnvelope,
  makeMix,
  makeTrack,
} from "./helpers/backup-fixtures";

/**
 * Tasks 5.1/5.2: atomic application and the acceptance loop —
 * export → reset → import restores equivalent data, a mid-apply failure rolls
 * back to the pre-import contents, and repeated imports converge.
 */

async function seedBaseline(repos: RepositorySet): Promise<void> {
  await repos.preferences.set({
    languages: ["ja"],
    autoplayNext: false,
    onboardingComplete: false,
  });
  await repos.likedTracks.like(makeTrack("base-1"), 10);
  await repos.likedTracks.like(makeTrack("base-2"), 20);
  const playlist = await repos.playlists.create({ name: "Baseline" });
  await repos.playlists.addTrack(playlist.id, makeTrack("base-1"));
  await repos.listeningHistory.record({
    trackId: "base-1",
    track: makeTrack("base-1"),
    playedAt: 1,
    secondsPlayed: 5,
    context: "home",
  });
  await repos.searchHistory.record("baseline query");
  await repos.mixes.create(makeMix());
  await repos.session.set({
    queue: [makeTrack("base-1")],
    queueIndex: 0,
    positionSeconds: 3,
    repeatMode: "off",
    shuffle: false,
    volume: 0.1,
  });
  await repos.metadataCache.put(makeTrack("base-1"));
}

describe("applyImport", () => {
  it("commits every supported store together on success", async () => {
    const repos = await createRepositories({ name: "apply-success" });
    try {
      await seedBaseline(repos);
      const envelope = makeEnvelope(makeBackupData({ mixes: [makeMix()] }));

      await repos.applyImport(planReplace(envelope));

      const restored = await collectLocalData(repos);
      expect(restored.preferences).toEqual(envelope.data.preferences);
      // list() returns newest-like first, so t2 (likedAt 2000) precedes t1.
      expect(restored.likedTracks.map((r) => r.trackId)).toEqual(["t2", "t1"]);
      expect(restored.playlists.map((p) => p.id)).toEqual(["p1"]);
      expect(restored.history.map((e) => e.id)).toEqual(["e1"]);
      expect(restored.searchHistory.map((e) => e.normalizedQuery)).toEqual(["beatles"]);
      // M11: the backup's mix replaces the baseline one, by identity.
      expect(restored.mixes?.map((m) => m.id)).toEqual([makeMix().id]);
      expect(restored.session).toEqual(envelope.data.session);
      // Derived caches are outside the supported dataset set — untouched.
      expect((await repos.metadataCache.list()).map((c) => c.providerId)).toEqual(["yt-base-1"]);
    } finally {
      repos.close();
    }
  });

  it("rolls back to exact pre-import contents when a write fails mid-apply", async () => {
    const repos = await createRepositories({ name: "apply-rollback" });
    try {
      await seedBaseline(repos);
      const before = {
        data: await collectLocalData(repos),
        cache: await repos.metadataCache.list(),
      };

      const plan = planReplace(makeEnvelope());
      // Poison a record written after clears and earlier puts have run:
      // missing its keyPath property, IndexedDB rejects it with DataError.
      plan.writes.history.push({} as unknown as ListeningEventRecord);
      await expect(repos.applyImport(plan)).rejects.toThrow();

      expect(await collectLocalData(repos)).toEqual(before.data);
      expect(await repos.metadataCache.list()).toEqual(before.cache);
    } finally {
      repos.close();
    }
  });
});

describe("export → reset → import", () => {
  it("restores equivalent data and repeated imports leave counts unchanged", async () => {
    const repos = await createRepositories({ name: "roundtrip" });
    try {
      await seedBaseline(repos);

      const envelope = serializeBackup(await collectLocalData(repos), {
        exportedAt: FIXED_EXPORTED_AT,
        appVersion: "0.1.0",
      });
      const json = JSON.stringify(envelope);

      await repos.resetAll();
      expect(await repos.likedTracks.list()).toEqual([]);
      expect(await repos.playlists.list()).toEqual([]);
      expect(await repos.listeningHistory.list()).toEqual([]);
      expect(await repos.searchHistory.list()).toEqual([]);
      expect(await repos.mixes.list()).toEqual([]);
      expect(await repos.preferences.get()).toEqual(DEFAULT_PREFERENCES);
      expect(await repos.session.get()).toBeNull();
      expect(await repos.metadataCache.list()).toEqual([]);

      const prepared = prepareImport(json);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error(prepared.error.message);
      await repos.applyImport(planReplace(prepared.envelope));

      const restored = await collectLocalData(repos);
      expect(restored).toEqual(envelope.data);

      // Repeated imports converge: merge plans zero writes after the restore.
      const counts = async () => ({
        liked: (await repos.likedTracks.list()).length,
        playlists: (await repos.playlists.list()).length,
        history: (await repos.listeningHistory.list()).length,
        search: (await repos.searchHistory.list()).length,
        mixes: (await repos.mixes.list()).length,
      });
      const beforeCounts = await counts();
      expect(beforeCounts).toEqual({
        liked: 2,
        playlists: 1,
        history: 1,
        search: 1,
        // M11: the mix the baseline seeded survives the round trip.
        mixes: 1,
      });

      const mergePlan = planMerge(prepared.envelope, restored);
      expect(mergePlan.stats).toEqual({
        likedTracks: 0,
        playlists: 0,
        history: 0,
        searchHistory: 0,
        mixes: 0,
        preferences: 0,
        session: 0,
      });
      await repos.applyImport(mergePlan);
      expect(await counts()).toEqual(beforeCounts);

      // Replace is idempotent by construction: same envelope, same result.
      await repos.applyImport(planReplace(prepared.envelope));
      expect(await counts()).toEqual(beforeCounts);
      expect(await collectLocalData(repos)).toEqual(envelope.data);
    } finally {
      repos.close();
    }
  });
});
