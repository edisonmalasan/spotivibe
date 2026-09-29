import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  collectLocalData,
  planMerge,
  planReplace,
  prepareImport,
  serializeBackup,
} from "@/data/backup";
import { createRepositories } from "@/data/indexeddb";
import { encode, makeMix } from "./helpers/backup-fixtures";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * The M11 verification pass found a **pre-existing** import bug through the new
 * mixes cases, so it is pinned here rather than left as an anecdote.
 *
 * `applyImport` opened every object store unconditionally while adding only the
 * stores that actually had writes to the transaction. Opening a store the
 * transaction does not span is a `NotFoundError`, so any import that wrote only
 * *some* datasets aborted the whole transaction and rolled back. Every pre-M11
 * test and the M2 evidence run imported envelopes that wrote every dataset, which
 * is why it survived: a merge import with nothing new to merge for likes and
 * playlists never happened in those fixtures.
 *
 * These cases use the shape the real product produces — an export of a device
 * that has a mix and a session but no likes and no playlists — because that is the
 * shape that failed.
 */
describe("an import that writes only some datasets still applies", () => {
  it("merges an envelope whose writes skip likes and playlists", async () => {
    const repos = await createRepositories({ name: "partial-write-merge" });
    try {
      const twenty = Array.from({ length: 20 }, (_unused, index) =>
        makeTrack({
          id: `youtube:live${index}`,
          providerId: `live${index}`,
          title: `Live Song ${index}`,
          artists: [{ name: `Artist ${index % 5}` }],
          language: index % 2 === 0 ? "en" : "ja",
          album: { id: `MPREb_album${index % 3}`, title: `Album ${index % 3}` },
        }),
      );
      // A device with a mix, a played track, a search, and a session — and no
      // likes and no playlists at all.
      await repos.mixes.create({ ...makeMix(), tracks: twenty });
      await repos.listeningHistory.record({
        trackId: twenty[0].id,
        track: twenty[0],
        playedAt: 1,
        secondsPlayed: 13,
        context: "search",
      });
      await repos.searchHistory.record("queen");
      await repos.session.set({
        queue: [twenty[0]],
        queueIndex: 0,
        positionSeconds: 3,
        repeatMode: "off",
        shuffle: false,
        volume: 0.5,
      });

      const envelope = serializeBackup(await collectLocalData(repos));
      await repos.resetAll();
      const local = await collectLocalData(repos);
      expect(local.mixes).toEqual([]);

      const prepared = prepareImport(encode(envelope));
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) throw new Error(prepared.error.message);

      const plan = planMerge(prepared.envelope, local);
      // The shape that used to throw: several datasets have nothing to write.
      expect(plan.writes.likedTracks).toEqual([]);
      expect(plan.writes.playlists).toEqual([]);
      expect(plan.writes.mixes).toHaveLength(1);
      expect(plan.writes.history).toHaveLength(1);

      await repos.applyImport(plan);

      const restored = await collectLocalData(repos);
      expect(restored.mixes).toHaveLength(1);
      expect(restored.mixes?.[0].tracks).toHaveLength(20);
      expect(restored.history).toHaveLength(1);
      expect(restored.session?.queue).toHaveLength(1);
    } finally {
      repos.close();
    }
  });

  it("merges an envelope that writes nothing at all without touching anything", async () => {
    const repos = await createRepositories({ name: "empty-write-merge" });
    try {
      await repos.likedTracks.like(
        makeTrack({ id: "youtube:kept", providerId: "kept", title: "Kept" }),
        10,
      );
      const envelope = serializeBackup(await collectLocalData(repos));
      const local = await collectLocalData(repos);

      const prepared = prepareImport(encode(envelope));
      if (!prepared.ok) throw new Error(prepared.error.message);
      const plan = planMerge(prepared.envelope, local);
      // Converged: nothing differs, so the plan writes nothing at all.
      expect(Object.values(plan.stats).every((count) => count === 0)).toBe(true);

      await repos.applyImport(plan);
      expect((await repos.likedTracks.list()).map((record) => record.trackId)).toEqual([
        "youtube:kept",
      ]);
    } finally {
      repos.close();
    }
  });

  it("replaces with an envelope that carries an empty dataset set", async () => {
    const repos = await createRepositories({ name: "partial-write-replace" });
    try {
      await repos.mixes.create({
        ...makeMix(),
        tracks: [makeTrack({ id: "t1", providerId: "t1", title: "Song One" })],
      });
      await repos.likedTracks.like(
        makeTrack({ id: "youtube:gone", providerId: "gone", title: "Gone" }),
        10,
      );
      const envelope = serializeBackup(await collectLocalData(repos));
      await repos.resetAll();

      const prepared = prepareImport(encode(envelope));
      if (!prepared.ok) {
        throw new Error(
          `${prepared.error.message} :: ${JSON.stringify(prepared.error).slice(0, 600)}`,
        );
      }
      await repos.applyImport(planReplace(prepared.envelope));

      expect(await repos.mixes.list()).toHaveLength(1);
    } finally {
      repos.close();
    }
  });
});
