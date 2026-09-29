import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Track } from "@/data/repositories";
import { buildTasteProfile, type TasteProfile } from "@/features/personalization/tasteProfile";
import {
  ARTIST_AFFINITY_WEIGHT,
  DEFAULT_QUALITY_SCORE,
  GENRE_AFFINITY_WEIGHT,
  LANGUAGE_AFFINITY_WEIGHT,
  QUALITY_WEIGHT,
  RECENCY_PENALTY_COMPLETED,
  RECENCY_PENALTY_SKIPPED,
  type ScoreContext,
  type ScoredTrack,
  scoreCandidates,
} from "@/features/personalization/scoreCandidates";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M10 task 3.2 (spec: `personalization` — "Rule-based candidate scoring"; design
 * §4): every ranking rule, asserted in isolation, plus the two properties the
 * spec makes load-bearing — the order is **deterministic**, and it is a function
 * of *this device's* data alone.
 *
 * The negative cases matter as much as the positive ones: an empty profile must
 * still rank (by the quality floor), a played track must rank last, and nothing
 * in the ranking path may read a clock of its own, a random number, or anything
 * resembling another person.
 *
 * Candidate ids are chosen so a *tie* would order them the other way round: an
 * assertion that survives a broken rule is not an assertion.
 */

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

/** A candidate with a genre-free title unless a test asks for one. */
function candidate(id: string, overrides: Partial<Track> = {}): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Song ${id}`,
    artists: [{ name: `Artist ${id}` }],
    ...overrides,
  });
}

/** The determinism fixture: three identical candidates and one clearly better. */
const TIED_CANDIDATES = [
  candidate("a", { qualityScore: 40 }),
  candidate("b", { qualityScore: 40 }),
  candidate("c", { qualityScore: 40 }),
  candidate("d", { qualityScore: 90 }),
];

/** A profile built from local data only — the sole taste input to the ranking. */
function tasteProfile(overrides: Partial<TasteProfile> = {}): TasteProfile {
  return {
    ...buildTasteProfile({ likedTracks: [], events: [], languages: [], now: NOW }),
    ...overrides,
  };
}

function scoreContext(overrides: Partial<ScoreContext> = {}): ScoreContext {
  return { profile: tasteProfile(), now: NOW, recencyWindowMs: 0, ...overrides };
}

function order<T extends Track>(scored: readonly ScoredTrack<T>[]): string[] {
  return scored.map((entry) => entry.track.id);
}

function scored<T extends Track>(result: readonly ScoredTrack<T>[], id: string): ScoredTrack<T> {
  const found = result.find((entry) => entry.track.id === id);
  if (found === undefined) throw new Error(`${id} was not scored`);
  return found;
}

function scoreOf<T extends Track>(result: readonly ScoredTrack<T>[], id: string): number {
  return scored(result, id).score;
}

function reasonsOf<T extends Track>(result: readonly ScoredTrack<T>[], id: string): string[] {
  return scored(result, id).reasons;
}

describe("scoreCandidates: the quality floor", () => {
  it("ranks an empty profile's candidates by the provider score alone", () => {
    const result = scoreCandidates(
      [
        candidate("c", { qualityScore: 10 }),
        candidate("a", { qualityScore: 90 }),
        candidate("b", { qualityScore: 50 }),
      ],
      scoreContext(),
    );

    expect(order(result)).toEqual(["youtube:a", "youtube:b", "youtube:c"]);
    expect(scoreOf(result, "youtube:a")).toBeCloseTo(0.9 * QUALITY_WEIGHT, 4);
    expect(scoreOf(result, "youtube:c")).toBeCloseTo(0.1 * QUALITY_WEIGHT, 4);
    // The floor is the only rule that can fire without any local signal.
    expect(reasonsOf(result, "youtube:a")).toEqual(["quality"]);
  });

  it("falls back to the documented constant when a row carries no score", () => {
    const result = scoreCandidates(
      [candidate("a", { qualityScore: 90 }), candidate("b")],
      scoreContext(),
    );

    expect(reasonsOf(result, "youtube:b")).toEqual(["quality:default"]);
    expect(scoreOf(result, "youtube:b")).toBeCloseTo(
      (DEFAULT_QUALITY_SCORE / 100) * QUALITY_WEIGHT,
      4,
    );
    // Unknown is not bad, just not good: it still loses to a real 90.
    expect(order(result)).toEqual(["youtube:a", "youtube:b"]);
  });

  it("returns nothing for an empty candidate list", () => {
    expect(scoreCandidates([], scoreContext())).toEqual([]);
  });
});

describe("scoreCandidates: affinity rules", () => {
  it("raises a candidate credited to a highly weighted artist", () => {
    const result = scoreCandidates(
      [
        candidate("a-other", { artists: [{ name: "Beacon" }] }),
        candidate("z-hit", { artists: [{ name: "Aurora" }] }),
      ],
      scoreContext({ profile: tasteProfile({ artists: [{ key: "aurora", weight: 8 }] }) }),
    );

    expect(order(result)).toEqual(["youtube:z-hit", "youtube:a-other"]);
    expect(scoreOf(result, "youtube:z-hit") - scoreOf(result, "youtube:a-other")).toBeCloseTo(
      ARTIST_AFFINITY_WEIGHT,
      4,
    );
    expect(reasonsOf(result, "youtube:a-other")).toEqual(["quality:default"]);
  });

  it("matches an artist by its provider id and credits a collaboration to both", () => {
    const result = scoreCandidates(
      [
        candidate("a-plain", { artists: [{ name: "Beacon" }] }),
        candidate("z-collab", {
          artists: [{ name: "Beacon" }, { id: "UC1", name: "Aurora" }],
        }),
      ],
      scoreContext({ profile: tasteProfile({ artists: [{ key: "UC1", weight: 8 }] }) }),
    );

    expect(order(result)).toEqual(["youtube:z-collab", "youtube:a-plain"]);
    expect(reasonsOf(result, "youtube:z-collab")).toContain("artist");
  });

  it("raises a candidate whose genre the profile weights", () => {
    const result = scoreCandidates(
      [
        candidate("a-plain", { album: { title: "Quiet Evenings" } }),
        candidate("z-hit", { album: { title: "Late Jazz Sessions" } }),
      ],
      scoreContext({ profile: tasteProfile({ genres: [{ key: "jazz", weight: 8 }] }) }),
    );

    expect(order(result)).toEqual(["youtube:z-hit", "youtube:a-plain"]);
    expect(scoreOf(result, "youtube:z-hit") - scoreOf(result, "youtube:a-plain")).toBeCloseTo(
      GENRE_AFFINITY_WEIGHT,
      4,
    );
    expect(reasonsOf(result, "youtube:z-hit")).toContain("genre");
  });

  it("raises a candidate whose language is selected, and never penalizes an absent one", () => {
    const result = scoreCandidates(
      [
        candidate("a-silent"),
        candidate("m-spanish", { language: "es" }),
        candidate("z-french", { language: "fr" }),
      ],
      scoreContext({ profile: tasteProfile({ languages: ["en", "fr"] }) }),
    );

    expect(order(result)).toEqual(["youtube:z-french", "youtube:a-silent", "youtube:m-spanish"]);
    expect(scoreOf(result, "youtube:z-french") - scoreOf(result, "youtube:m-spanish")).toBeCloseTo(
      LANGUAGE_AFFINITY_WEIGHT,
      4,
    );
    // An unknown language is a non-bonus, not a penalty: it ties the mismatched
    // one, which is what a provider row with no language deserves.
    expect(scoreOf(result, "youtube:m-spanish")).toBe(scoreOf(result, "youtube:a-silent"));
  });

  it("reports every rule that fired, in the documented order", () => {
    const result = scoreCandidates(
      [
        candidate("a", {
          artists: [{ name: "Aurora" }],
          album: { title: "Jazz Nights" },
          language: "EN",
          qualityScore: 70,
        }),
      ],
      scoreContext({
        profile: tasteProfile({
          artists: [{ key: "aurora", weight: 8 }],
          genres: [{ key: "jazz", weight: 8 }],
          languages: ["en"],
        }),
      }),
    );

    expect(reasonsOf(result, "youtube:a")).toEqual(["quality", "artist", "genre", "language"]);
  });
});

describe("scoreCandidates: recency and the played set", () => {
  it("ranks a track played inside the window below an otherwise equal one", () => {
    const result = scoreCandidates(
      [candidate("a-recent"), candidate("z-fresh")],
      scoreContext({
        recencyWindowMs: 12 * HOUR,
        playedRecently: new Map([["youtube:a-recent", { playedAt: NOW - HOUR, completed: true }]]),
      }),
    );

    expect(order(result)).toEqual(["youtube:z-fresh", "youtube:a-recent"]);
    // The penalty is graded by freshness (a play one hour into a twelve-hour
    // window is fresher than one at the window's edge), so the assertion is that
    // the recent track sits below the fresh one, inside the documented range.
    const recentPenalty = scoreOf(result, "youtube:z-fresh") - scoreOf(result, "youtube:a-recent");
    expect(recentPenalty).toBeGreaterThan(RECENCY_PENALTY_COMPLETED * 0.5);
    expect(recentPenalty).toBeLessThanOrEqual(RECENCY_PENALTY_COMPLETED);
    expect(reasonsOf(result, "youtube:a-recent")).toEqual(["quality:default", "recency:completed"]);
  });

  it("does not penalize a play that has aged out of the window", () => {
    // The scorer owns the clock: an entry older than the window is not "recent"
    // and takes no penalty, so a caller cannot widen the window by omitting ids.
    const context = { recencyWindowMs: HOUR };
    const never = scoreCandidates([candidate("old")], scoreContext(context));
    const old = scoreCandidates(
      [candidate("old")],
      scoreContext({
        ...context,
        playedRecently: new Map([["youtube:old", { playedAt: NOW - 48 * HOUR, completed: false }]]),
      }),
    );
    expect(scoreOf(old, "youtube:old")).toBe(scoreOf(never, "youtube:old"));
    expect(reasonsOf(old, "youtube:old")).toEqual(["quality:default"]);

    // A future-dated entry is not treated as "just played" either.
    const future = scoreCandidates(
      [candidate("old")],
      scoreContext({
        ...context,
        playedRecently: new Map([["youtube:old", { playedAt: NOW + HOUR, completed: true }]]),
      }),
    );
    expect(scoreOf(future, "youtube:old")).toBe(scoreOf(never, "youtube:old"));
  });

  it("penalizes a completed recent track less than a skipped one", () => {
    const result = scoreCandidates(
      [candidate("completed"), candidate("skipped"), candidate("unplayed")],
      scoreContext({
        recencyWindowMs: 12 * HOUR,
        playedRecently: new Map([
          ["youtube:completed", { playedAt: NOW - HOUR, completed: true }],
          ["youtube:skipped", { playedAt: NOW - HOUR, completed: false }],
        ]),
      }),
    );

    // A tie would have ordered these completed, skipped, unplayed; the two
    // penalties are what move the untouched candidate to the front.
    expect(order(result)).toEqual(["youtube:unplayed", "youtube:completed", "youtube:skipped"]);
    // Both plays are equally fresh here, and each penalty is scaled by the same
    // freshness factor, so the gap is that factor times the gap between the two
    // documented penalties — always at least half of it, never more than all of it.
    const gap = scoreOf(result, "youtube:completed") - scoreOf(result, "youtube:skipped");
    const full = RECENCY_PENALTY_SKIPPED - RECENCY_PENALTY_COMPLETED;
    expect(gap).toBeGreaterThan(full * 0.5);
    expect(gap).toBeLessThanOrEqual(full);
    expect(reasonsOf(result, "youtube:completed")).toEqual([
      "quality:default",
      "recency:completed",
    ]);
    expect(reasonsOf(result, "youtube:skipped")).toEqual(["quality:default", "recency:skipped"]);
    expect(reasonsOf(result, "youtube:unplayed")).toEqual(["quality:default"]);
  });

  it("ranks a played track below every eligible candidate", () => {
    const result = scoreCandidates(
      [candidate("a-played", { qualityScore: 100 }), candidate("z-eligible", { qualityScore: 1 })],
      scoreContext({ playedIds: ["youtube:a-played"] }),
    );

    // Even a perfect quality score cannot outrank the hard repeat penalty.
    expect(order(result)).toEqual(["youtube:z-eligible", "youtube:a-played"]);
    expect(reasonsOf(result, "youtube:a-played")).toEqual(["quality", "played"]);
  });

  it("reports a played track as played only, never as recency-penalized", () => {
    const result = scoreCandidates(
      [candidate("a-played")],
      scoreContext({
        playedIds: ["youtube:a-played"],
        recencyWindowMs: 12 * HOUR,
        playedRecently: new Map([["youtube:a-played", { playedAt: NOW - HOUR, completed: false }]]),
      }),
    );

    expect(reasonsOf(result, "youtube:a-played")).toEqual(["quality:default", "played"]);
  });

  it("applies no recency rule when the caller's window is not positive", () => {
    const result = scoreCandidates(
      [candidate("a-skipped")],
      scoreContext({
        recencyWindowMs: 0,
        playedRecently: new Map([
          ["youtube:a-skipped", { playedAt: NOW - HOUR, completed: false }],
        ]),
      }),
    );

    expect(reasonsOf(result, "youtube:a-skipped")).toEqual(["quality:default"]);
  });
});

describe("scoreCandidates: determinism", () => {
  const candidates = TIED_CANDIDATES;

  it("produces an identical order and identical scores on a second run", () => {
    const first = scoreCandidates(candidates, scoreContext());
    const second = scoreCandidates(candidates, scoreContext());

    expect(order(second)).toEqual(order(first));
    expect(second.map((entry) => entry.score)).toEqual(first.map((entry) => entry.score));
  });

  it("breaks exact ties on the ascending track id, not on arrival order", () => {
    const result = scoreCandidates(candidates, scoreContext());

    // `d` wins on quality; a, b, and c are identical and sort by id.
    expect(order(result)).toEqual(["youtube:d", "youtube:a", "youtube:b", "youtube:c"]);
    expect(scoreCandidates([...candidates].reverse(), scoreContext())).toEqual(result);
  });

  it("reads no clock and no randomness of its own", () => {
    const source = readCode("scoreCandidates.ts");

    expect(source).not.toMatch(/\bMath\.random\b/u);
    expect(source).not.toMatch(/\bDate\.now\b/u);
    expect(source).not.toMatch(/\bnew Date\b/u);
    // The scorer reads the caller's clock but never its own, and with no recent
    // plays recorded a different reference instant cannot reorder anything.
    expect(scoreCandidates(candidates, scoreContext({ now: NOW + HOUR }))).toEqual(
      scoreCandidates(candidates, scoreContext()),
    );
    // With a recent play recorded, moving the clock **does** change the verdict:
    // an age that leaves the window is no longer "recent". That is the rule
    // working, not a clock leak.
    const playedRecently = new Map([["youtube:a", { playedAt: NOW - HOUR, completed: false }]]);
    const near = scoreCandidates(
      candidates,
      scoreContext({ now: NOW, recencyWindowMs: 12 * HOUR, playedRecently }),
    );
    const far = scoreCandidates(
      candidates,
      scoreContext({ now: NOW + 48 * HOUR, recencyWindowMs: 12 * HOUR, playedRecently }),
    );
    expect(reasonsOf(near, "youtube:a")).toContain("recency:skipped");
    expect(reasonsOf(far, "youtube:a")).not.toContain("recency:skipped");
  });
});

describe("scoreCandidates: no cross-user signal", () => {
  it("reads only the local profile, the candidates, and a caller-supplied clock", () => {
    expect(scoreCandidates.length).toBe(2);
    const context: ScoreContext = {
      profile: tasteProfile(),
      now: NOW,
      playedIds: [],
      recencyWindowMs: HOUR,
      playedRecently: new Map(),
    };
    expect(Object.keys(context).sort()).toEqual([
      "now",
      "playedIds",
      "playedRecently",
      "profile",
      "recencyWindowMs",
    ]);
  });

  it("names no other person anywhere in the ranking path", () => {
    for (const name of ["scoreCandidates.ts", "tasteProfile.ts"]) {
      const source = readCode(name);
      expect(source).not.toMatch(/\buser[_-]?id\b/iu);
      expect(source).not.toMatch(/\baccount[_-]?id\b/iu);
      expect(source).not.toMatch(/\bdevice[_-]?id\b/iu);
      expect(source).not.toMatch(/\bsession[_-]?token\b/iu);
      expect(source).not.toMatch(/other[_-]?users?/iu);
      expect(source).not.toMatch(/cross[_-]?user/iu);
      expect(source).not.toMatch(/similar[_-]?users?/iu);
      expect(source).not.toMatch(/collaborative/iu);
      expect(source).not.toMatch(/\bfollowers?\b/iu);
    }
  });
});

/**
 * Read a source file from the module directory the ranking is built in, with
 * its comments removed.
 *
 * The scans below are about *code*, and the documentation of these modules
 * deliberately names the very things the code must not contain — so a comment
 * saying "`Date.now` is never called" is not evidence that it is.
 */
function readCode(name: string): string {
  return readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/features/personalization", name),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:])\/\/[^\n]*/gu, "$1");
}
