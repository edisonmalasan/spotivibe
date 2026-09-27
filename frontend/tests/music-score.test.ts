import { describe, expect, it } from "vitest";
import {
  dedupeTracks,
  nearDuplicateKey,
  qualityScore,
  scoreTracks,
  sortTracks,
} from "@/server/music/score";
import { makeTrack } from "./helpers/music-fixtures";

describe("qualityScore", () => {
  it("is deterministic and bounded to 0–100", () => {
    const strong = makeTrack({ title: "Get Lucky", durationSeconds: 249 });
    const weak = makeTrack({
      title: "Obscurity",
      durationSeconds: undefined,
      artwork: [],
      artists: [{ name: "Nobody" }],
    });
    expect(qualityScore(strong, "get lucky")).toBe(qualityScore(strong, "get lucky"));
    for (const track of [strong, weak]) {
      for (const query of ["get lucky", "unrelated query", ""]) {
        const score = qualityScore(track, query);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("rewards query-token overlap", () => {
    const track = makeTrack({ title: "Get Lucky" });
    expect(qualityScore(track, "get lucky")).toBeGreaterThan(qualityScore(track, "zzz qqq"));
    expect(qualityScore(track, "get lucky")).toBe(qualityScore(track, "lucky get")); // token set
  });

  it("penalizes a missing duration relative to a present one", () => {
    const withDuration = makeTrack({ durationSeconds: 300 });
    const withoutDuration = makeTrack({ durationSeconds: undefined });
    expect(qualityScore(withoutDuration, "get lucky")).toBeLessThan(
      qualityScore(withDuration, "get lucky"),
    );
  });

  it("adds points per metadata signal present", () => {
    const full = makeTrack();
    const noArtwork = makeTrack({ artwork: [] });
    expect(qualityScore(full, "q")).toBeGreaterThan(qualityScore(noArtwork, "q"));
  });
});

describe("dedupeTracks", () => {
  it("collapses exact duplicates by providerId", () => {
    const first = makeTrack({ qualityScore: 90 });
    const again = makeTrack({ providerId: "vid000001", qualityScore: 50 });
    expect(dedupeTracks([first, again])).toEqual([first]);
  });

  it("collapses near-duplicates by normalized title and first artist", () => {
    const original = makeTrack({ qualityScore: 90 });
    const nearDuplicate = makeTrack({
      providerId: "vidOTHER1",
      title: "get-lucky!",
      qualityScore: 50,
    });
    expect(dedupeTracks([original, nearDuplicate])).toEqual([original]);
    expect(nearDuplicateKey(original)).toBe(nearDuplicateKey(nearDuplicate));
  });

  it("keeps distinct tracks apart", () => {
    const differentArtist = makeTrack({ providerId: "vidOTHER1", artists: [{ name: "Other" }] });
    const differentTitle = makeTrack({ providerId: "vidOTHER2", title: "Instant Crush" });
    expect(dedupeTracks([makeTrack(), differentArtist, differentTitle])).toHaveLength(3);
  });

  it("keeps the higher-scoring representative when input is score-ordered", () => {
    const best = makeTrack({ qualityScore: 90, durationSeconds: 249 });
    const worse = makeTrack({
      providerId: "vidOTHER1",
      qualityScore: 30,
      durationSeconds: undefined,
    });
    // Near-duplicate titles/artists, different provider ids, score-descending input.
    expect(dedupeTracks([best, worse])).toEqual([best]);
    expect(dedupeTracks([worse, best])).toEqual([worse]); // first occurrence wins
  });
});

describe("sortTracks", () => {
  it("orders by descending qualityScore and keeps ties stable", () => {
    const low = makeTrack({ qualityScore: 20 });
    const highA = makeTrack({ qualityScore: 90, providerId: "vidA" });
    const highB = makeTrack({ qualityScore: 90, providerId: "vidB" });
    expect(sortTracks([low, highA, highB]).map((track) => track.providerId)).toEqual([
      "vidA",
      "vidB",
      "vid000001",
    ]);
  });

  it("treats unscored tracks as zero", () => {
    const unscored = makeTrack({ providerId: "vidUNSCR", qualityScore: undefined });
    const scored = makeTrack({ providerId: "vidSCORED", qualityScore: 10 });
    expect(sortTracks([unscored, scored]).map((track) => track.providerId)).toEqual([
      "vidSCORED",
      "vidUNSCR",
    ]);
    expect(sortTracks([scored, unscored]).map((track) => track.providerId)).toEqual([
      "vidSCORED",
      "vidUNSCR",
    ]);
  });
});

describe("score → sort → dedupe pipeline", () => {
  it("scores, orders, and keeps the best duplicate representative", () => {
    const original = makeTrack({ providerId: "vidBEST01", durationSeconds: 249 });
    const reupload = makeTrack({ providerId: "vidREUP1", durationSeconds: undefined, artwork: [] });

    const pipeline = dedupeTracks(sortTracks(scoreTracks([reupload, original], "get lucky")));
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0]?.providerId).toBe("vidBEST01"); // higher score survives regardless of input order
    expect(pipeline[0]?.qualityScore).toBeGreaterThan(0);
  });
});
