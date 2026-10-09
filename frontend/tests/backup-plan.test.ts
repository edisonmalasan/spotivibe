import { describe, expect, it } from "vitest";
import {
  planMerge,
  planReplace,
  type BackupData,
  type ImportStats,
  type PreparedImport,
} from "@/data/backup";
import { makeBackupData, makeEnvelope } from "./helpers/backup-fixtures";

/**
 * Task 4.3: pure import planners — replace plans clear-then-write; merge
 * follows the deterministic dedupe rules, keeps local-only records, and
 * converges to zero writes on a repeated pass.
 */

function planOf(backup: BackupData, local: BackupData = makeBackupData()): PreparedImport {
  return planMerge(makeEnvelope(backup), local);
}

/** Local state that differs from `makeBackupData()` in every dataset. */
function makeDivergedLocal(): BackupData {
  const base = makeBackupData();
  return makeBackupData({
    likedTracks: [
      { trackId: "t1", track: base.likedTracks[0].track, likedAt: 500 },
      {
        trackId: "local-only",
        track: { ...base.likedTracks[0].track, id: "local-only" },
        likedAt: 4000,
      },
    ],
    playlists: [{ ...base.playlists[0], name: "Local older", updatedAt: 100 }],
    history: [],
    searchHistory: [{ query: "localq", normalizedQuery: "localq", searchedAt: 100 }],
    preferences: {
      languages: [],
      autoplayNext: true,
      reduceMotion: false,
      onboardingComplete: false,
      autofillQueue: false,
    },
    session: null,
  });
}

const ZERO_STATS: ImportStats = {
  likedTracks: 0,
  playlists: 0,
  history: 0,
  searchHistory: 0,
  mixes: 0,
  quickPickPicks: 0,
  preferences: 0,
  session: 0,
};

describe("planReplace", () => {
  it("plans a clear-then-write of every supported dataset", () => {
    const envelope = makeEnvelope();
    const plan = planReplace(envelope);
    expect(plan.mode).toBe("replace");
    expect(plan.clearFirst).toBe(true);
    expect(plan.writes.preferences).toEqual(envelope.data.preferences);
    expect(plan.writes.likedTracks).toHaveLength(2);
    expect(plan.writes.playlists).toHaveLength(1);
    expect(plan.writes.history).toHaveLength(1);
    expect(plan.writes.searchHistory).toHaveLength(1);
    expect(plan.writes.session).toEqual(envelope.data.session);
    expect(plan.stats).toEqual({
      likedTracks: 2,
      playlists: 1,
      history: 1,
      searchHistory: 1,
      // M11: a pre-M11 envelope carries no mixes, so it plans none.
      mixes: 0,
      quickPickPicks: 0,
      preferences: 1,
      session: 1,
    });
  });

  it("treats a null session as nothing to write", () => {
    const plan = planReplace(makeEnvelope(makeBackupData({ session: null })));
    expect(plan.writes.session).toBeNull();
    expect(plan.stats.session).toBe(0);
  });
});

describe("planMerge", () => {
  it("liked tracks: newer like wins, older loses, unknown tracks are added", () => {
    const local = makeBackupData();
    const backup = makeBackupData({
      likedTracks: [
        { trackId: "t1", track: local.likedTracks[0].track, likedAt: 1500 },
        { trackId: "t2", track: local.likedTracks[1].track, likedAt: 500 },
        {
          trackId: "t3",
          track: { ...local.likedTracks[0].track, id: "t3", providerId: "yt-t3" },
          likedAt: 100,
        },
      ],
    });
    const plan = planOf(backup, local);
    expect(plan.writes.likedTracks.map((r) => r.trackId)).toEqual(["t1", "t3"]);
    expect(plan.stats.likedTracks).toBe(2);
  });

  it("playlists: newer update wins, older or equal keeps the local record", () => {
    const local = makeBackupData();
    const backup = makeBackupData({
      playlists: [
        { ...local.playlists[0], name: "Newer", updatedAt: 700 },
        { id: "p2", name: "Backup only", createdAt: 1, updatedAt: 2, tracks: [] },
      ],
    });
    const plan = planOf(backup, local);
    expect(plan.writes.playlists.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(plan.writes.playlists[0].name).toBe("Newer");

    // Equal timestamps → tie keeps local (no write).
    const tied = planOf(makeBackupData({ playlists: [{ ...local.playlists[0] }] }), local);
    expect(tied.writes.playlists).toEqual([]);
  });

  it("history: local records win on id collision, only new ids are added", () => {
    const local = makeBackupData();
    const backup = makeBackupData({
      history: [
        { ...local.history[0], secondsPlayed: 999, playedAt: 999999 },
        {
          id: "e2",
          trackId: "t2",
          track: local.history[0].track,
          playedAt: 750,
          secondsPlayed: 12,
          context: "search",
        },
      ],
    });
    const plan = planOf(backup, local);
    expect(plan.writes.history.map((e) => e.id)).toEqual(["e2"]);
    expect(plan.stats.history).toBe(1);
  });

  it("search history: more recent search wins, older loses", () => {
    const local = makeBackupData();
    const backup = makeBackupData({
      searchHistory: [
        { query: "Beatles", normalizedQuery: "beatles", searchedAt: 999 },
        { query: "radiohead", normalizedQuery: "radiohead", searchedAt: 900 },
      ],
    });
    const plan = planOf(backup, local);
    expect(plan.writes.searchHistory.map((e) => e.normalizedQuery)).toEqual([
      "beatles",
      "radiohead",
    ]);

    const older = planOf(
      makeBackupData({
        searchHistory: [{ query: "beatles", normalizedQuery: "beatles", searchedAt: 100 }],
      }),
      local,
    );
    expect(older.writes.searchHistory).toEqual([]);
  });

  it("preferences: backup wins per defined field; identical values skip the write", () => {
    const local = makeBackupData();
    const backup = makeBackupData({
      preferences: {
        languages: ["ta", "te"],
        autoplayNext: false,
        reduceMotion: true,
        onboardingComplete: false,
        autofillQueue: false,
      },
    });
    const plan = planOf(backup, local);
    expect(plan.writes.preferences).toEqual(backup.preferences);
    expect(plan.stats.preferences).toBe(1);

    const same = planOf(makeBackupData(), local);
    expect(same.writes.preferences).toBeUndefined();
    expect(same.stats.preferences).toBe(0);
  });

  it("preferences: M10's autofillQueue alone still counts as a difference", () => {
    // The write is suppressed by an "unchanged" verdict over the whole record, so
    // a field missing from that comparison would silently drop a toggled setting
    // on every merge import.
    const local = makeBackupData();
    const backup = makeBackupData({
      preferences: { ...local.preferences, autofillQueue: false },
    });

    const plan = planOf(backup, local);
    expect(plan.writes.preferences?.autofillQueue).toBe(false);
    expect(plan.stats.preferences).toBe(1);
  });

  it("session: backup wins when present and different, null keeps local", () => {
    const local = makeBackupData();
    const backupSession = {
      queue: local.session?.queue ?? [],
      queueIndex: 1,
      positionSeconds: 55,
      repeatMode: "track" as const,
      shuffle: true,
      volume: 0.3,
      updatedAt: 1200,
    };

    const changed = planOf(makeBackupData({ session: backupSession }), local);
    expect(changed.writes.session).toEqual(backupSession);
    expect(changed.stats.session).toBe(1);

    const identical = planOf(makeBackupData(), local);
    expect(identical.writes.session).toBeUndefined();
    expect(identical.stats.session).toBe(0);

    const nullBackup = planOf(makeBackupData({ session: null }), local);
    expect(nullBackup.writes.session).toBeUndefined();

    const localNone = planOf(
      makeBackupData({ session: backupSession }),
      makeBackupData({ session: null }),
    );
    expect(localNone.writes.session).toEqual(backupSession);
  });

  it("never plans removals and never duplicates existing records", () => {
    const plan = planOf(makeBackupData(), makeDivergedLocal());
    expect(plan.clearFirst).toBe(false);
    // The local-only liked record is untouched: merge has no removal channel.
    expect(plan.writes.likedTracks.some((r) => r.trackId === "local-only")).toBe(false);
    const ids = plan.writes.likedTracks.map((r) => r.trackId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("planning the same envelope twice produces identical output", () => {
    const envelope = makeEnvelope();
    const local = makeDivergedLocal();
    expect(planMerge(envelope, local)).toEqual(planMerge(envelope, local));
  });

  it("a second pass after applying the first plans zero writes (convergence)", () => {
    const envelope = makeEnvelope();
    const local = makeDivergedLocal();
    const first = planMerge(envelope, local);
    // The diverged local must actually produce work on the first pass.
    expect(first.stats).toEqual({
      likedTracks: 2,
      playlists: 1,
      history: 1,
      searchHistory: 1,
      mixes: 0,
      quickPickPicks: 0,
      preferences: 1,
      session: 1,
    });

    // Simulate applying plan one to the local snapshot.
    const after = makeBackupData({
      likedTracks: [
        ...local.likedTracks.filter(
          (r) => !first.writes.likedTracks.some((w) => w.trackId === r.trackId),
        ),
        ...first.writes.likedTracks,
      ],
      playlists: [
        ...local.playlists.filter((r) => !first.writes.playlists.some((w) => w.id === r.id)),
        ...first.writes.playlists,
      ],
      history: [
        ...local.history.filter((r) => !first.writes.history.some((w) => w.id === r.id)),
        ...first.writes.history,
      ],
      searchHistory: [
        ...local.searchHistory.filter(
          (r) => !first.writes.searchHistory.some((w) => w.normalizedQuery === r.normalizedQuery),
        ),
        ...first.writes.searchHistory,
      ],
      preferences: first.writes.preferences ?? local.preferences,
      session: first.writes.session ?? local.session,
    });

    const second = planMerge(envelope, after);
    expect(second.stats).toEqual(ZERO_STATS);
    expect(second.writes.preferences).toBeUndefined();
    expect(second.writes.session).toBeUndefined();
  });
});
