import { describe, expect, it } from "vitest";
import type { Track } from "@/data/repositories";
import { interleaveByLanguage } from "@/features/recommendations/interleave";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M8 task 5.2: the pure language-mixing rule behind every multi-language shelf
 * (spec: `discovery` — "Language mixing in multi-language feeds"; design §4).
 * The three properties the spec names are the three that are asserted here: no
 * language monopolizes the rendered order, a single selection keeps provider
 * order, and interleaving is lossless and deterministic.
 */

/** A track with a stable id and an optional language attribution. */
function langTrack(id: string, language?: string): Track {
  return makeTrack({ id: `youtube:${id}`, providerId: id, title: `Song ${id}`, language });
}

/** Consecutive runs of the same language in a rendered order, as run lengths. */
function runLengths(ordered: readonly Track[]): number[] {
  const runs: number[] = [];
  let previous: string | undefined;
  for (const track of ordered) {
    const current = track.language ?? "";
    if (runs.length > 0 && current === previous) {
      runs[runs.length - 1] += 1;
    } else {
      runs.push(1);
    }
    previous = current;
  }
  return runs;
}

/** A pool copy that is emptied only by exact object references. */
function drainInOrder(ordered: readonly Track[], source: readonly Track[]): Track[] {
  const pool = [...source];
  for (const track of ordered) {
    const index = pool.indexOf(track);
    if (index >= 0) pool.splice(index, 1);
  }
  return pool;
}

describe("interleaveByLanguage: multi-language mixing", () => {
  const tracks = [
    langTrack("e1", "en"),
    langTrack("e2", "en"),
    langTrack("s1", "es"),
    langTrack("e3", "en"),
    langTrack("s2", "es"),
    langTrack("e4", "en"),
    langTrack("e5", "en"),
    langTrack("e6", "en"),
  ];

  it("round-robins the selected languages instead of exhausting one first", () => {
    const mixed = interleaveByLanguage(tracks, ["en", "es"]);

    expect(mixed.map((track) => track.id)).toEqual([
      "youtube:e1",
      "youtube:s1",
      "youtube:e2",
      "youtube:s2",
      "youtube:e3",
      "youtube:e4",
      "youtube:e5",
      "youtube:e6",
    ]);
  });

  it("never lets the majority language monopolize a run", () => {
    const mixed = interleaveByLanguage(tracks, ["en", "es"]);
    const runs = runLengths(mixed);

    // The six English results may not appear as one block...
    expect(Math.max(...runs)).toBeLessThan(6);
    // ...and the minority language is not crowded out behind the majority.
    expect(mixed.findIndex((track) => track.language === "es")).toBe(1);
    expect(mixed.findIndex((track) => track.language === "es")).toBeLessThan(6);
  });

  it("follows the order the languages were selected in", () => {
    const spanishFirst = interleaveByLanguage(tracks, ["es", "en"]);

    expect(spanishFirst.map((track) => track.id)).toEqual([
      "youtube:s1",
      "youtube:e1",
      "youtube:s2",
      "youtube:e2",
      "youtube:e3",
      "youtube:e4",
      "youtube:e5",
      "youtube:e6",
    ]);
  });

  it("mixes three selected languages across the whole shelf", () => {
    const three = [
      langTrack("a1", "en"),
      langTrack("b1", "de"),
      langTrack("a2", "en"),
      langTrack("c1", "fr"),
      langTrack("b2", "de"),
      langTrack("a3", "en"),
    ];

    expect(interleaveByLanguage(three, ["en", "de", "fr"]).map((track) => track.id)).toEqual([
      "youtube:a1",
      "youtube:b1",
      "youtube:c1",
      "youtube:a2",
      "youtube:b2",
      "youtube:a3",
    ]);
  });

  it("is a passthrough when no language is selected", () => {
    expect(interleaveByLanguage(tracks, []).map((track) => track.id)).toEqual(
      tracks.map((track) => track.id),
    );
  });
});

describe("interleaveByLanguage: single-language shelf", () => {
  it("keeps the provider order of the one selected language", () => {
    const tracks = [
      langTrack("e1", "en"),
      langTrack("x1"),
      langTrack("e2", "en"),
      langTrack("f1", "fr"),
      langTrack("e3", "en"),
    ];

    expect(interleaveByLanguage(tracks, ["en"]).map((track) => track.id)).toEqual([
      "youtube:e1",
      "youtube:e2",
      "youtube:e3",
      "youtube:x1",
      "youtube:f1",
    ]);
  });

  it("returns nothing for an empty result set", () => {
    expect(interleaveByLanguage([], ["en", "es"])).toEqual([]);
  });
});

describe("interleaveByLanguage: unattributed results", () => {
  it("appends unattributed tracks after the interleaved part, in original order", () => {
    const tracks = [
      langTrack("f1", "fr"),
      langTrack("u1"),
      langTrack("e1", "en"),
      langTrack("f2", "de"),
      langTrack("s1", "es"),
      langTrack("u2"),
    ];

    const ordered = interleaveByLanguage(tracks, ["en", "es"]);

    expect(ordered.map((track) => track.id)).toEqual([
      "youtube:e1",
      "youtube:s1",
      "youtube:f1",
      "youtube:u1",
      "youtube:f2",
      "youtube:u2",
    ]);
  });

  it("does not lose a track whose language is blank or unselected", () => {
    const tracks = [
      langTrack("e1", "en"),
      langTrack("b1", ""),
      langTrack("p1", " en "),
      langTrack("f1", "fr"),
    ];

    expect(interleaveByLanguage(tracks, ["en"]).map((track) => track.id)).toEqual([
      "youtube:e1",
      "youtube:p1",
      "youtube:b1",
      "youtube:f1",
    ]);
  });
});

describe("interleaveByLanguage: lossless and deterministic", () => {
  const tracks = [
    langTrack("e1", "en"),
    langTrack("u1"),
    langTrack("s1", "es"),
    langTrack("e2", "en"),
    langTrack("s2", "es"),
    langTrack("f1", "fr"),
    langTrack("e3", "en"),
  ];

  it("emits every input track exactly once, by identity", () => {
    const ordered = interleaveByLanguage(tracks, ["en", "es"]);

    expect(ordered).toHaveLength(tracks.length);
    expect(drainInOrder(ordered, tracks)).toEqual([]);
    expect(new Set(ordered.map((track) => track.id)).size).toBe(tracks.length);
  });

  it("produces the same order across calls", () => {
    const first = interleaveByLanguage(tracks, ["en", "es"]);
    const second = interleaveByLanguage(tracks, ["en", "es"]);

    expect(second.map((track) => track.id)).toEqual(first.map((track) => track.id));
    second.forEach((track, index) => expect(track).toBe(first[index]));
  });

  it("never mutates its input", () => {
    const before = tracks.map((track) => track.id);
    const snapshot = tracks.map((track) => ({ ...track }));

    interleaveByLanguage(tracks, ["en", "es"]);

    expect(tracks.map((track) => track.id)).toEqual(before);
    expect(tracks.map((track) => ({ ...track }))).toEqual(snapshot);
  });

  it("ignores a repeated or blank selection without duplicating tracks", () => {
    const ordered = interleaveByLanguage(
      [langTrack("e1", "en"), langTrack("e2", "en")],
      ["en", "en", " "],
    );

    expect(ordered.map((track) => track.id)).toEqual(["youtube:e1", "youtube:e2"]);
  });
});
