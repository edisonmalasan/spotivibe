import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  CURRENT_BACKUP_VERSION,
  backupEnvelopeSchema,
  collectLocalData,
  serializeBackup,
} from "@/data/backup";
import { createRepositories } from "@/data/indexeddb";
import { FIXED_EXPORTED_AT, makeBackupData, makeTrack } from "./helpers/backup-fixtures";

/**
 * Task 4.1: export serializer — envelope fields, whitelist-only contents,
 * schema validity, and collection that reflects the latest repository data.
 */

describe("serializeBackup", () => {
  it("produces a well-formed envelope with exactly the whitelisted keys", () => {
    const envelope = serializeBackup(makeBackupData(), {
      exportedAt: FIXED_EXPORTED_AT,
      appVersion: "0.1.0",
    });

    expect(Object.keys(envelope).sort()).toEqual([
      "appVersion",
      "data",
      "exportedAt",
      "format",
      "version",
    ]);
    expect(Object.keys(envelope.data).sort()).toEqual([
      "history",
      "likedTracks",
      "playlists",
      "preferences",
      "searchHistory",
      "session",
    ]);
    expect(envelope.format).toBe(BACKUP_FORMAT);
    expect(envelope.version).toBe(CURRENT_BACKUP_VERSION);
    expect(envelope.exportedAt).toBe(FIXED_EXPORTED_AT);
    expect(() => backupEnvelopeSchema.parse(envelope)).not.toThrow();
  });

  it("defaults exportedAt to a current ISO-8601 timestamp", () => {
    const envelope = serializeBackup(makeBackupData());
    expect(new Date(envelope.exportedAt).toISOString()).toBe(envelope.exportedAt);
    expect(envelope.appVersion).toBeUndefined();
  });
});

describe("collectLocalData", () => {
  it("reads the latest data through repositories and strips store bookkeeping", async () => {
    const repos = await createRepositories({ name: "export-collect-test" });
    try {
      await repos.preferences.set({ languages: ["ta"] });
      await repos.likedTracks.like(makeTrack("a"), 1234);
      await repos.playlists.create({ name: "Mix" });
      await repos.listeningHistory.record({
        trackId: "a",
        track: makeTrack("a"),
        playedAt: 111,
        secondsPlayed: 10,
        context: "home",
      });
      await repos.searchHistory.record("radiohead");

      const first = await collectLocalData(repos);
      expect(first.preferences.languages).toEqual(["ta"]);
      expect(first.preferences).not.toHaveProperty("id");
      expect(first.likedTracks.map((r) => r.trackId)).toEqual(["a"]);
      expect(first.playlists).toHaveLength(1);
      expect(first.history).toHaveLength(1);
      expect(first.searchHistory.map((e) => e.normalizedQuery)).toEqual(["radiohead"]);
      expect(first.session).toBeNull();

      // Export reflects the latest data after a change.
      await repos.likedTracks.unlike("a");
      await repos.searchHistory.record("beatles");
      const second = await collectLocalData(repos);
      expect(second.likedTracks).toHaveLength(0);
      expect(second.searchHistory.map((e) => e.normalizedQuery)).toEqual(["beatles", "radiohead"]);
      expect(second.history).toHaveLength(1);
    } finally {
      repos.close();
    }
  });
});
