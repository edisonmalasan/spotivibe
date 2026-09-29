import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ListeningEventRecord, Track } from "@/data/repositories";
import {
  classifyPlay,
  DEFAULT_PLAY_THRESHOLDS,
  type PlaySignal,
  type PlayThresholds,
  type PlayVerdict,
  verdictCounts,
} from "@/features/insights/classifyPlay";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M11 task 1.1/1.2 (spec: `insights` — "Play classification"; design §1): the
 * rule every surface reports a verdict with.
 *
 * Two claims are load-bearing and are asserted here from both sides. The first
 * is **precedence** — a recorded marker outranks the arithmetic, the seconds
 * rule outranks the skip rule, and the skip rule only applies to a track longer
 * than a minute — each proven at the boundary value itself, since an off-by-one
 * in `>=` versus `>` is exactly the bug this file exists to catch. The second
 * is that classification is a **read-time policy**: thresholds are overridable
 * per call, so the same recorded event reads as a different verdict under a
 * different rule with no write to the dataset and no change to the event.
 */

const DAY_SECONDS = 24 * 60 * 60;

// Keep the literal in a variable — Vite rewrites new URL("<literal>", import.meta.url).
const classifyPlayRel = "../src/features/insights/classifyPlay.ts";

/** Read the module's own source, for the import-shape assertions at the bottom. */
function classifyPlaySource(): string {
  return readFileSync(fileURLToPath(new URL(classifyPlayRel, import.meta.url)), "utf8");
}

/** A recorded signal; `duration` is omitted unless a test asks for a length. */
function signal(overrides: Partial<PlaySignal> = {}): PlaySignal {
  return { secondsPlayed: 120, ...overrides };
}

/** The signal a recorded event projects to — the only coupling to the record. */
function signalOf(event: ListeningEventRecord): PlaySignal {
  return {
    secondsPlayed: event.secondsPlayed,
    durationSeconds: event.track.durationSeconds,
    completed: event.completed,
    skipped: event.skipped,
  };
}

/** Classify a list of signals, as `buildStats` does for a whole history. */
function classifyAll(signals: readonly PlaySignal[]): PlayVerdict[] {
  return signals.map((entry) => classifyPlay(entry));
}

describe("classifyPlay: the completion rules", () => {
  it("completes a play that reached at least half of a known duration", () => {
    expect(classifyPlay(signal({ secondsPlayed: 130, durationSeconds: 240 }))).toBe("completed");
  });

  it("completes at exactly the fraction, and not one second before it", () => {
    // 0.5 * 40 = 20 exactly. The boundary is `>=`, so 20 s of a 40 s track is a
    // completion; 19 s is not — and because the track is under a minute the skip
    // rule cannot catch it either, so it is a partial play.
    expect(classifyPlay(signal({ secondsPlayed: 20, durationSeconds: 40 }))).toBe("completed");
    expect(classifyPlay(signal({ secondsPlayed: 19.999, durationSeconds: 40 }))).toBe("partial");
  });

  it("completes at exactly the minimum seconds, and not one second before it", () => {
    expect(classifyPlay(signal({ secondsPlayed: 30 }))).toBe("completed");
    expect(classifyPlay(signal({ secondsPlayed: 29.999 }))).toBe("partial");
  });

  it("completes a long track on the fraction alone, with the seconds rule out of reach", () => {
    // The same fraction rule, isolated: the seconds rule is pushed past the
    // track's length, so only the fraction can produce "completed".
    const fractionOnly: PlayThresholds = {
      completedFraction: 0.5,
      completedMinSeconds: 1000,
      skipMaxSeconds: 0,
      skipMinTrackSeconds: 60,
    };
    expect(classifyPlay(signal({ secondsPlayed: 120, durationSeconds: 240 }), fractionOnly)).toBe(
      "completed",
    );
    expect(classifyPlay(signal({ secondsPlayed: 119, durationSeconds: 240 }), fractionOnly)).toBe(
      "partial",
    );
  });

  it("completes a short track that clears the fraction even when it is under the minimum", () => {
    // A 20-second jingle heard to the end clears half of it; the 30-second
    // minimum cannot, so this also proves the fraction rule is not shadowed by
    // the seconds rule for short tracks.
    expect(classifyPlay(signal({ secondsPlayed: 20, durationSeconds: 20 }))).toBe("completed");
  });
});

describe("classifyPlay: the skip rule and its gates", () => {
  it("skips a brief touch of a track longer than a minute", () => {
    expect(classifyPlay(signal({ secondsPlayed: 3, durationSeconds: 240 }))).toBe("skipped");
  });

  it("skips below the skip threshold, and calls the threshold itself a partial play", () => {
    // The requirement's wording is "fewer than the documented skip threshold", so
    // the boundary is exclusive: 9.999 s of a long track is a decision to skip and
    // 10 s — exactly the threshold — is a play that stopped.
    expect(classifyPlay(signal({ secondsPlayed: 9.999, durationSeconds: 240 }))).toBe("skipped");
    expect(classifyPlay(signal({ secondsPlayed: 10, durationSeconds: 240 }))).toBe("partial");
  });

  it("gates the skip rule on track length: a minute exactly is not longer", () => {
    // `duration > skipMinTrackSeconds` is strict, so a 60-second track touched
    // for five seconds is a partial play, not a skip.
    expect(classifyPlay(signal({ secondsPlayed: 5, durationSeconds: 60 }))).toBe("partial");
    expect(classifyPlay(signal({ secondsPlayed: 5, durationSeconds: 60.001 }))).toBe("skipped");
  });

  it("never calls a play of forty seconds a skip, however long the track", () => {
    // The seconds rule is checked before the skip rule: 40 s is over the 30 s
    // completion minimum, so it is a completed play and not a skip.
    expect(classifyPlay(signal({ secondsPlayed: 40, durationSeconds: 240 }))).toBe("completed");
    expect(classifyPlay(signal({ secondsPlayed: 20, durationSeconds: 240 }))).toBe("partial");
  });

  it("skips a play of nothing at all on a long track", () => {
    expect(classifyPlay(signal({ secondsPlayed: 0, durationSeconds: 240 }))).toBe("skipped");
  });
});

describe("classifyPlay: an unknown duration falls back to the seconds rules", () => {
  it("completes a length-less play past the minimum seconds", () => {
    expect(classifyPlay(signal({ secondsPlayed: 45 }))).toBe("completed");
  });

  it("gives a length-less brief play a partial verdict, not a skip", () => {
    // The honest consequence of the seconds-only fallback: with no length there
    // is nothing to compare a few seconds against, and the event still gets
    // exactly one verdict.
    expect(classifyPlay(signal({ secondsPlayed: 5 }))).toBe("partial");
    expect(classifyPlay(signal({ secondsPlayed: 0 }))).toBe("partial");
  });

  it("treats a zero, negative, or non-finite length as unknown", () => {
    for (const durationSeconds of [0, -240, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(classifyPlay(signal({ secondsPlayed: 5, durationSeconds }))).toBe("partial");
    }
  });

  it("reads junk seconds as no listening rather than a negative play", () => {
    expect(classifyPlay(signal({ secondsPlayed: Number.NaN, durationSeconds: 240 }))).toBe(
      "skipped",
    );
    expect(classifyPlay(signal({ secondsPlayed: -30, durationSeconds: 240 }))).toBe("skipped");
  });
});

describe("classifyPlay: recorded markers outrank the arithmetic", () => {
  it("completes a play marked completed even when the numbers say skip", () => {
    // Five seconds of a four-minute track is a skip by arithmetic, so the
    // recorded marker is the only reason this is a completion.
    expect(classifyPlay(signal({ secondsPlayed: 5, durationSeconds: 240, completed: true }))).toBe(
      "completed",
    );
  });

  it("skips a play marked skipped even when the numbers say completed", () => {
    expect(classifyPlay(signal({ secondsPlayed: 240, durationSeconds: 240, skipped: true }))).toBe(
      "skipped",
    );
  });

  it("reads a record carrying both markers as the skip it claims to be", () => {
    expect(
      classifyPlay(
        signal({ secondsPlayed: 200, durationSeconds: 240, completed: true, skipped: true }),
      ),
    ).toBe("skipped");
  });

  it("ignores a marker that is explicitly false", () => {
    expect(
      classifyPlay(
        signal({ secondsPlayed: 3, durationSeconds: 240, completed: false, skipped: false }),
      ),
    ).toBe("skipped");
  });
});

describe("classifyPlay: classification is a read-time policy (design §1, task 1.2)", () => {
  const frozen: PlaySignal = Object.freeze({ secondsPlayed: 45, durationSeconds: 240 });
  const snapshot = JSON.stringify(frozen);

  it("re-classifies the same signal under a different rule with no write anywhere", () => {
    expect(classifyPlay(frozen)).toBe("completed");

    // Same event, same measurements, a stricter policy: forty-five seconds is no
    // longer a completion, and under a 90-second skip threshold it is a skip.
    const strict: PlayThresholds = {
      completedFraction: 0.9,
      completedMinSeconds: 60,
      skipMaxSeconds: 90,
      skipMinTrackSeconds: 60,
    };
    expect(classifyPlay(frozen, strict)).toBe("skipped");

    const lenient: PlayThresholds = {
      completedFraction: 0.1,
      completedMinSeconds: 5,
      skipMaxSeconds: 1,
      skipMinTrackSeconds: 60,
    };
    expect(classifyPlay(frozen, lenient)).toBe("completed");
  });

  it("leaves the signal it reads exactly as it found it", () => {
    classifyPlay(frozen, DEFAULT_PLAY_THRESHOLDS);
    classifyPlay(frozen, { ...DEFAULT_PLAY_THRESHOLDS, completedMinSeconds: 3 });
    expect(JSON.stringify(frozen)).toBe(snapshot);
    // Frozen: an in-place write would have thrown in strict mode instead.
    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it("classifies one recorded event identically however many times it is read", () => {
    const track: Track = makeTrack({ id: "youtube:vid000009", providerId: "vid000009" });
    const event: ListeningEventRecord = {
      id: "event-9",
      trackId: track.id,
      track,
      playedAt: 1_700_000_000_000,
      secondsPlayed: 12,
      context: "home",
    };
    const recorded = JSON.stringify(event);

    const first = classifyPlay(signalOf(event));
    const second = classifyPlay(signalOf(event));
    const third = classifyPlay(signalOf(event));

    expect(first).toBe("partial");
    expect(second).toBe(first);
    expect(third).toBe(first);
    // The read is a projection: no verdict is added to the record, and nothing
    // in it is rewritten — the recorder keeps storing raw measurements only.
    expect(Object.keys(event)).not.toContain("verdict");
    expect(Object.keys(event).sort()).toEqual([
      "context",
      "id",
      "playedAt",
      "secondsPlayed",
      "track",
      "trackId",
    ]);
    expect(JSON.stringify(event)).toBe(recorded);
  });
});

describe("verdictCounts", () => {
  it("counts each verdict and totals the list it was given", () => {
    const verdicts = classifyAll([
      { secondsPlayed: 240, durationSeconds: 240 },
      { secondsPlayed: 20, durationSeconds: 240 },
      { secondsPlayed: 20, durationSeconds: 40 },
      { secondsPlayed: 3, durationSeconds: 240 },
      { secondsPlayed: 240, durationSeconds: 240, skipped: true },
    ]);

    expect(verdicts).toEqual(["completed", "partial", "completed", "skipped", "skipped"]);
    expect(verdictCounts(verdicts)).toEqual({ completed: 2, partial: 1, skipped: 2 });
  });

  it("reports zeroes for no verdicts rather than omitting the fields", () => {
    expect(verdictCounts([])).toEqual({ completed: 0, partial: 0, skipped: 0 });
  });

  it("is a function of the verdicts alone", () => {
    expect(verdictCounts(["completed", "completed", "skipped"])).toEqual(
      verdictCounts(["skipped", "completed", "completed"]),
    );
  });
});

describe("the rule lives in one pure module (architecture: no store, repository, or clock)", () => {
  it("imports nothing at all", () => {
    // The strongest possible form of the purity claim: a module that imports
    // nothing cannot reach a store, a repository, or a network, so the
    // architecture suite can prove the rule on the tree as well.
    const specifiers = [
      ...classifyPlaySource().matchAll(/(?:import|export)[^'"]*from\s*["']([^"']+)["']/g),
    ].map((match) => match[1]);
    expect(specifiers).toEqual([]);
  });

  it("reads no clock, no randomness, and no globals", () => {
    const source = classifyPlaySource();
    expect(source).not.toMatch(/Date\.now\(/u);
    expect(source).not.toMatch(/Math\.random\(/u);
    expect(source).not.toMatch(/performance\.now\(/u);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/localStorage|indexedDB/u);
  });

  it("exposes exactly the documented surface", () => {
    const source = classifyPlaySource();
    const exported = [
      ...source.matchAll(/export\s+(?:const|function|type|interface)\s+(\w+)/g),
    ].map((match) => match[1]);
    expect(exported.sort()).toEqual([
      "DEFAULT_PLAY_THRESHOLDS",
      "PlaySignal",
      "PlayThresholds",
      "PlayVerdict",
      "classifyPlay",
      "verdictCounts",
    ]);
  });

  it("documents the four thresholds as the spec's own numbers", () => {
    expect(DEFAULT_PLAY_THRESHOLDS).toEqual({
      completedFraction: 0.5,
      completedMinSeconds: 30,
      skipMaxSeconds: 10,
      skipMinTrackSeconds: 60,
    });
    // The bands the rule creates, stated as inequalities so a future constant
    // change that collapses them fails here rather than silently changing which
    // verdict a middle-length play receives.
    expect(DEFAULT_PLAY_THRESHOLDS.skipMaxSeconds).toBeLessThan(
      DEFAULT_PLAY_THRESHOLDS.completedMinSeconds,
    );
    expect(DEFAULT_PLAY_THRESHOLDS.completedMinSeconds).toBeLessThan(
      DEFAULT_PLAY_THRESHOLDS.skipMinTrackSeconds,
    );
    expect(DEFAULT_PLAY_THRESHOLDS.completedFraction).toBe(0.5);
    // The skip gate is the spec's own boundary: "a track longer than a minute".
    expect(DEFAULT_PLAY_THRESHOLDS.skipMinTrackSeconds).toBe(60);
    expect(DEFAULT_PLAY_THRESHOLDS.skipMinTrackSeconds).toBeLessThan(DAY_SECONDS);
  });
});
