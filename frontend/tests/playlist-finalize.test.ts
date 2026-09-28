import { describe, expect, it } from "vitest";
import { finalizePlaylistEntries } from "@/server/music/normalize";
import type { PlaylistEntry } from "@/server/music/types";
import { makeCandidate } from "./helpers/music-fixtures";

/**
 * `finalizePlaylistEntries` is the playlist-specific finalization (design
 * decision 9): canonicalize, skip-and-count unresolvable rows, dedupe by
 * `providerId` keep-first, and preserve source order — no junk filtering, no
 * relevance scoring, no re-sorting (unlike the search pipeline).
 */

/** Canonical Track fields a playlist import may emit. */
const CANONICAL_TRACK_KEYS = new Set([
  "id",
  "source",
  "providerId",
  "title",
  "artists",
  "album",
  "artwork",
  "durationSeconds",
  "category",
  "explicit",
  "language",
  "capabilities",
]);

describe("finalizePlaylistEntries", () => {
  it("emits canonical tracks only — no provider or scoring fields", () => {
    const { tracks, skipped } = finalizePlaylistEntries([makeCandidate()]);
    expect(skipped).toBe(0);
    expect(tracks).toHaveLength(1);
    for (const key of Object.keys(tracks[0]!)) expect(CANONICAL_TRACK_KEYS.has(key)).toBe(true);
    expect(tracks[0]).toMatchObject({
      id: "youtube:vid000001",
      source: "youtube",
      providerId: "vid000001",
    });
    expect(JSON.stringify(tracks)).not.toContain("qualityScore");
    expect(JSON.stringify(tracks)).not.toContain("flexColumns");
  });

  it("skips null entries and counts them as skipped", () => {
    const entries: PlaylistEntry[] = [
      makeCandidate({ videoId: "vidA", title: "Song A" }),
      null,
      makeCandidate({ videoId: "vidB", title: "Song B" }),
      null,
      null,
    ];

    const { tracks, skipped } = finalizePlaylistEntries(entries);
    expect(skipped).toBe(3);
    expect(tracks.map((track) => track.providerId)).toEqual(["vidA", "vidB"]);
  });

  it("skips and counts candidates that cannot become tracks", () => {
    const entries: PlaylistEntry[] = [
      makeCandidate({ videoId: "", title: "No id" }),
      makeCandidate({ videoId: "vidA", title: "" }),
      makeCandidate({ videoId: "vidB", title: "Kept" }),
    ];

    const { tracks, skipped } = finalizePlaylistEntries(entries);
    expect(skipped).toBe(2);
    expect(tracks.map((track) => track.providerId)).toEqual(["vidB"]);
  });

  it("dedupes by providerId keeping the first occurrence, counting neither", () => {
    const entries: PlaylistEntry[] = [
      makeCandidate({ videoId: "vidA", title: "Original title" }),
      makeCandidate({ videoId: "vidB", title: "Song B" }),
      makeCandidate({ videoId: "vidA", title: "Duplicate title" }),
      makeCandidate({ videoId: "vidA", title: "Duplicate title again" }),
    ];

    const { tracks, skipped } = finalizePlaylistEntries(entries);
    expect(skipped).toBe(0);
    expect(tracks.map((track) => track.providerId)).toEqual(["vidA", "vidB"]);
    expect(tracks[0]?.title).toBe("Original title");
  });

  it("preserves source order — an import is never re-scored or re-sorted", () => {
    // Deliberately "low quality" order: short/junk-looking titles first,
    // long music titles last — search's scoring pipeline would invert this.
    const entries: PlaylistEntry[] = [
      makeCandidate({ videoId: "vidShort", title: "ad", durationSeconds: 15 }),
      makeCandidate({ videoId: "vidTalk", title: "Artist Interview" }),
      makeCandidate({ videoId: "vidSong", title: "Get Lucky", durationSeconds: 249 }),
    ];

    const { tracks } = finalizePlaylistEntries(entries);
    expect(tracks.map((track) => track.providerId)).toEqual(["vidShort", "vidTalk", "vidSong"]);
    for (const track of tracks) expect(track).not.toHaveProperty("qualityScore");
  });

  it("handles an empty listing", () => {
    expect(finalizePlaylistEntries([])).toEqual({ tracks: [], skipped: 0 });
  });
});
