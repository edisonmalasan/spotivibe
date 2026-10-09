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
  encode,
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
        quickPickPicks: 0,
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

describe("M11: the mixes dataset in the import pipeline", () => {
  it("replace-importing a pre-M11 envelope leaves the mixes dataset empty", async () => {
    // The scenario the optional dataset exists for: an envelope exported before
    // mixes existed carries no such key, and "replace" must mean the dataset is
    // *empty* afterwards — not silently kept, which would make replace-import a
    // partial operation and leave records a replace was asked to wipe.
    const repos = await createRepositories({ name: "apply-pre-m11" });
    try {
      await seedBaseline(repos);
      expect(await repos.mixes.list()).toHaveLength(1);

      const preM11 = JSON.parse(encode(makeEnvelope())) as { data: Record<string, unknown> };
      delete preM11.data.mixes;
      const prepared = prepareImport(encode(preM11));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error(prepared.error.message);

      await repos.applyImport(planReplace(prepared.envelope));

      expect(await repos.mixes.list()).toEqual([]);
      // The other datasets really were replaced, so the run is not a no-op.
      expect((await repos.likedTracks.list()).map((r) => r.trackId)).toEqual(["t2", "t1"]);
    } finally {
      repos.close();
    }
  });

  it("merge-importing a pre-M11 envelope leaves local mixes untouched", async () => {
    // Merge is the opposite promise: an envelope that knows nothing about mixes
    // must not be allowed to delete a mix this device built.
    const repos = await createRepositories({ name: "apply-merge-pre-m11" });
    try {
      await seedBaseline(repos);
      const preM11 = JSON.parse(encode(makeEnvelope())) as { data: Record<string, unknown> };
      delete preM11.data.mixes;
      const prepared = prepareImport(encode(preM11));
      if (!prepared.ok) throw new Error(prepared.error.message);

      const local = await collectLocalData(repos);
      await repos.applyImport(planMerge(prepared.envelope, local));

      expect(await repos.mixes.list()).toHaveLength(1);
    } finally {
      repos.close();
    }
  });

  it("merge-importing a mix with a newer updatedAt overwrites it by identity", async () => {
    const repos = await createRepositories({ name: "apply-merge-mix" });
    try {
      await seedBaseline(repos);
      const newer = makeMix({ name: "Aurora (refreshed)", updatedAt: makeMix().updatedAt + 500 });
      const prepared = prepareImport(encode(makeEnvelope(makeBackupData({ mixes: [newer] }))));
      if (!prepared.ok) throw new Error(prepared.error.message);

      const local = await collectLocalData(repos);
      const plan = planMerge(prepared.envelope, local);
      expect(plan.stats.mixes).toBe(1);
      await repos.applyImport(plan);

      const stored = await repos.mixes.list();
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe("Aurora (refreshed)");

      // A second merge of the same envelope plans nothing: the rules converge.
      const again = planMerge(prepared.envelope, await collectLocalData(repos));
      expect(again.stats.mixes).toBe(0);
    } finally {
      repos.close();
    }
  });

  it("merge-importing an older mix keeps the local one", async () => {
    const repos = await createRepositories({ name: "apply-merge-mix-older" });
    try {
      await seedBaseline(repos);
      const older = makeMix({ name: "Stale", updatedAt: makeMix().updatedAt - 500 });
      const prepared = prepareImport(encode(makeEnvelope(makeBackupData({ mixes: [older] }))));
      if (!prepared.ok) throw new Error(prepared.error.message);

      const plan = planMerge(prepared.envelope, await collectLocalData(repos));
      expect(plan.stats.mixes).toBe(0);
      await repos.applyImport(plan);

      expect((await repos.mixes.list())[0].name).toBe(makeMix().name);
    } finally {
      repos.close();
    }
  });
});

describe("the first-run picks dataset in the import pipeline", () => {
  const pick = (artistId: string, name: string, pickedAt: number) => ({
    artistId,
    name,
    pickedAt,
  });

  it("round-trips a selection through export and replace-import", async () => {
    const repos = await createRepositories({ name: "apply-picks-round-trip" });
    try {
      const envelope = JSON.parse(
        encode(
          makeEnvelope(makeBackupData({ quickPickPicks: [pick("UC_a", "Aurora Vale", 1_000)] })),
        ),
      );
      const prepared = prepareImport(encode(envelope));
      expect(prepared.ok, "an envelope carrying picks validates").toBe(true);
      if (!prepared.ok) throw new Error(prepared.error.message);

      await repos.applyImport(planReplace(prepared.envelope));

      const stored = await repos.quickPickPicks.list();
      expect(stored).toHaveLength(1);
      // The *name* survives, not just the identity: a restore that kept only the id
      // would put `UC_a` where the rail shows an artist's name.
      expect(stored[0].name).toBe("Aurora Vale");
    } finally {
      repos.close();
    }
  });

  it("replace-importing a pre-picks envelope leaves the dataset empty", async () => {
    /*
     * The same promise `mixes` gets, and it is the reason the field is optional rather
     * than required: an envelope exported before first-run picking existed carries no
     * such key, and "replace" must mean empty rather than silently kept.
     */
    const repos = await createRepositories({ name: "apply-pre-picks" });
    try {
      await repos.quickPickPicks.replaceAll([{ artistId: "UC_local", name: "Local Pick" }]);

      const prePicks = JSON.parse(encode(makeEnvelope())) as { data: Record<string, unknown> };
      expect(prePicks.data.quickPickPicks, "the fixture starts without picks").toBeUndefined();
      const prepared = prepareImport(encode(prePicks));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error(prepared.error.message);

      await repos.applyImport(planReplace(prepared.envelope));

      expect(await repos.quickPickPicks.list()).toEqual([]);
    } finally {
      repos.close();
    }
  });

  it("merge-importing a pre-picks envelope leaves local picks untouched", async () => {
    // Merge is the opposite promise: a backup that knows nothing about picks must not
    // be allowed to delete the artist's own stated choices.
    const repos = await createRepositories({ name: "apply-merge-pre-picks" });
    try {
      await repos.quickPickPicks.replaceAll([{ artistId: "UC_local", name: "Local Pick" }]);

      const prePicks = JSON.parse(encode(makeEnvelope())) as { data: Record<string, unknown> };
      const prepared = prepareImport(encode(prePicks));
      if (!prepared.ok) throw new Error(prepared.error.message);

      await repos.applyImport(planMerge(prepared.envelope, await collectLocalData(repos)));

      expect(await repos.quickPickPicks.list()).toHaveLength(1);
    } finally {
      repos.close();
    }
  });

  it("merge-imports picks by artist identity, newest pickedAt winning", async () => {
    const repos = await createRepositories({ name: "apply-merge-picks" });
    try {
      /*
       * Seeded with `pick` and an explicit timestamp rather than `replaceAll`, and
       * that distinction is the whole test. `replaceAll` stamps `Date.now()`, so a
       * local row written that way is newer than any timestamp a fixture can invent —
       * the merge would correctly keep it and the incoming row would be planned
       * nowhere, which reads as "merge is broken" rather than "the fixture is dated".
       */
      await repos.quickPickPicks.pick("UC_a", "Stale Local", 1_000);
      const incoming = makeBackupData({
        quickPickPicks: [pick("UC_a", "Fresh From Backup", 9_000), pick("UC_b", "New Pick", 8_000)],
      });
      const prepared = prepareImport(encode(makeEnvelope(incoming)));
      if (!prepared.ok) throw new Error(prepared.error.message);

      const plan = planMerge(prepared.envelope, await collectLocalData(repos));
      expect(plan.stats.quickPickPicks).toBe(2);
      await repos.applyImport(plan);

      const byArtist = new Map(
        (await repos.quickPickPicks.list()).map((record) => [record.artistId, record.name]),
      );
      expect(byArtist.get("UC_a")).toBe("Fresh From Backup");
      expect(byArtist.get("UC_b")).toBe("New Pick");

      // The rules converge: re-merging the same envelope plans nothing.
      expect(planMerge(prepared.envelope, await collectLocalData(repos)).stats.quickPickPicks).toBe(
        0,
      );
    } finally {
      repos.close();
    }
  });

  it("keeps the local pick when the backup's copy is older", async () => {
    const repos = await createRepositories({ name: "apply-merge-picks-older" });
    try {
      await repos.quickPickPicks.pick("UC_a", "Newer Local", 9_000);
      const incoming = makeBackupData({ quickPickPicks: [pick("UC_a", "Stale Backup", 1)] });
      const prepared = prepareImport(encode(makeEnvelope(incoming)));
      if (!prepared.ok) throw new Error(prepared.error.message);

      const plan = planMerge(prepared.envelope, await collectLocalData(repos));
      expect(plan.stats.quickPickPicks).toBe(0);
      await repos.applyImport(plan);

      expect((await repos.quickPickPicks.list())[0].name).toBe("Newer Local");
    } finally {
      repos.close();
    }
  });
});
