import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ListeningEventRecord, Track } from "@/data/repositories";
import {
  buildStats,
  DEFAULT_STATS_LIMIT,
  localDayKey,
  type ListeningStats,
  type StatsOptions,
} from "@/features/insights/buildStats";
import { classifyPlay } from "@/features/insights/classifyPlay";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M11 tasks 2.1–2.3 (spec `insights` — "Local listening statistics" and
 * "Listening streaks"; design §2/§3): the only place the app's local numbers
 * come from.
 *
 * The claims under test are structural rather than cosmetic. There is **no
 * stored aggregate** to keep in sync, so "the statistics are recomputed from the
 * events" and "deleting history changes them" are proven by reconciling every
 * reported total against the events and then removing events and re-reading.
 * There is **no clock of the derivation's own**, so every streak boundary is a
 * function of `(events, now)` and the local-midnight cases below are reproducible
 * on any machine. And there is **no metadata invention**: a track with no
 * language or no inferable genre is left out of the breakdown rather than given
 * a made-up value.
 */

// Keep the literal in a variable — Vite rewrites new URL("<literal>", import.meta.url).
const buildStatsRel = "../src/features/insights/buildStats.ts";
const classifyPlayRel = "../src/features/insights/classifyPlay.ts";

/** The anchor "today" for the relative streak cases: one fixed local date. */
const ANCHOR = new Date();

/** Local wall clock `days` before the anchor date, at `hour` local time. */
function daysAgo(days: number, hour = 12): number {
  return new Date(
    ANCHOR.getFullYear(),
    ANCHOR.getMonth(),
    ANCHOR.getDate() - days,
    hour,
    0,
    0,
    0,
  ).getTime();
}

/** The reference instant for the relative streak cases: noon on the anchor day. */
const NOW = daysAgo(0);

/** The last and first second of a local day, `days` before the anchor date. */
function localDayEdges(days: number): { lastSecond: number; firstSecond: number } {
  const year = ANCHOR.getFullYear();
  const month = ANCHOR.getMonth();
  const date = ANCHOR.getDate() - days;
  return {
    lastSecond: new Date(year, month, date, 23, 59, 59, 0).getTime(),
    firstSecond: new Date(year, month, date + 1, 0, 0, 1, 0).getTime(),
  };
}

/** An absolute instant, so a fixed-date case does not move with the clock. */
function localAt(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

/** An absolute UTC instant, for the `localDayKey` cases with an explicit offset. */
function utcAt(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
}

/** A recorded event as `historyStore` holds one; measurements are explicit. */
function event(
  id: string,
  playedAt: number,
  overrides: {
    secondsPlayed?: number;
    completed?: boolean;
    skipped?: boolean;
    track?: Partial<Track>;
  } = {},
): ListeningEventRecord {
  const { track: trackOverrides, ...record } = overrides;
  const track = makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Track ${id}`,
    ...trackOverrides,
  });
  return {
    id: `event-${id}`,
    trackId: track.id,
    track,
    playedAt,
    // The default is a finished play of the 249-second fixture track: past half
    // of it, so `partial`/`skip` cases must ask for their own measurements.
    secondsPlayed: 200,
    context: "home",
    ...record,
  };
}

/** Statistics over `events` at the default reference instant. */
function statsFor(events: readonly ListeningEventRecord[], options: Partial<StatsOptions> = {}) {
  return buildStats(events, { now: NOW, ...options });
}

/** The keys of a ranked list, in the order the derivation reported them. */
function keys(entries: readonly { key: string }[]): string[] {
  return entries.map((entry) => entry.key);
}

/** Verdicts read one event at a time, for reconciling against the tallies. */
function verdictsOf(events: readonly ListeningEventRecord[]): string[] {
  return events.map((entry) =>
    classifyPlay({
      secondsPlayed: entry.secondsPlayed,
      durationSeconds: entry.track.durationSeconds,
      completed: entry.completed,
      skipped: entry.skipped,
    }),
  );
}

describe("buildStats: an empty history reports nothing rather than zeroes", () => {
  const cold = statsFor([]);

  it("reports no listening time, no plays, and no entries", () => {
    expect(cold.totalSeconds).toBe(0);
    expect(cold.playCount).toBe(0);
    expect(cold.eventCount).toBe(0);
    expect(cold.topTracks).toEqual([]);
    expect(cold.topArtists).toEqual([]);
    expect(cold.languages).toEqual([]);
    expect(cold.categories).toEqual([]);
    expect(cold.verdicts).toEqual({ completed: 0, partial: 0, skipped: 0 });
    expect(cold.streak).toEqual({ current: 0, longest: 0, lastListeningDay: null });
  });

  it("reports no signal, so a surface knows to explain itself", () => {
    // The same meaning M10 gives `hasSignal`: a default language is a
    // preference, not taste, and a device that has played nothing has no local
    // signal to report.
    expect(cold.hasSignal).toBe(false);
  });

  it("exposes exactly the documented field set", () => {
    expect(Object.keys(cold).sort()).toEqual([
      "categories",
      "eventCount",
      "hasSignal",
      "languages",
      "playCount",
      "streak",
      "topArtists",
      "topTracks",
      "totalSeconds",
      "verdicts",
    ]);
    expect(Object.keys(cold.streak).sort()).toEqual(["current", "lastListeningDay", "longest"]);
  });
});

describe("buildStats: the totals reconcile with the events they summarize", () => {
  const events = [
    event("a", daysAgo(3), { secondsPlayed: 249 }),
    event("b", daysAgo(3), { secondsPlayed: 120, track: { title: "Track b" } }),
    event("c", daysAgo(2), { secondsPlayed: 20 }),
    event("d", daysAgo(2), { skipped: true, secondsPlayed: 4 }),
    event("e", daysAgo(1), { skipped: true, secondsPlayed: 9 }),
    event("f", daysAgo(0), { completed: true, secondsPlayed: 249 }),
  ];

  it("counts every event, but only the non-skipped ones as plays", () => {
    const stats = statsFor(events);
    expect(stats.eventCount).toBe(events.length);
    expect(stats.playCount).toBe(4);
    expect(stats.hasSignal).toBe(true);
  });

  it("sums the seconds of the non-skipped plays and nothing else", () => {
    // A skip is a skip and nothing else: it appears in `verdicts` and in
    // `eventCount`, and contributes no seconds, no play, and no listening day.
    const stats = statsFor(events);
    const nonSkipped = events.filter((entry) => verdictsOf([entry])[0] !== "skipped");
    expect(stats.totalSeconds).toBe(
      nonSkipped.reduce((sum, entry) => sum + entry.secondsPlayed, 0),
    );
    expect(stats.totalSeconds).toBe(249 + 120 + 20 + 249);
  });

  it("tallies the verdicts exactly as the shared rule reads each event", () => {
    const verdicts = verdictsOf(events);
    const stats = statsFor(events);
    expect(stats.verdicts).toEqual({
      completed: verdicts.filter((verdict) => verdict === "completed").length,
      partial: verdicts.filter((verdict) => verdict === "partial").length,
      skipped: verdicts.filter((verdict) => verdict === "skipped").length,
    });
    // All three verdicts appear, so this fixture really does exercise the whole
    // rule rather than one branch of it.
    expect(verdicts).toEqual([
      "completed",
      "completed",
      "partial",
      "skipped",
      "skipped",
      "completed",
    ]);
    // The only reconciliation that matters: every event got exactly one verdict
    // and no event was lost.
    expect(stats.verdicts.completed + stats.verdicts.partial + stats.verdicts.skipped).toBe(
      stats.eventCount,
    );
  });

  it("reads a whole dataset, not the in-memory window a store keeps", () => {
    // Design §1: `historyStore` holds only `RECENT_HISTORY_LIMIT` (50) events in
    // state for the recently-played surfaces, so statistics must reduce the full
    // dataset — a listener with 120 plays must not see stats for 50.
    const many = Array.from({ length: 120 }, (_, index) =>
      event(`m${String(index).padStart(3, "0")}`, daysAgo(1, 8 + (index % 12)), {
        secondsPlayed: 100,
      }),
    );
    const stats = statsFor(many);
    expect(stats.eventCount).toBe(120);
    expect(stats.playCount).toBe(120);
    expect(stats.totalSeconds).toBe(12_000);
  });

  it("never mutates the events it reads", () => {
    const snapshot = JSON.stringify(events);
    statsFor(events);
    expect(JSON.stringify(events)).toBe(snapshot);
  });

  it("re-reads under different thresholds with no write anywhere", () => {
    // The same six events plus an eighth-second-of-a-song play: 8 seconds is a
    // skip by the default rule, a completion under a lenient one, and a partial
    // play under a strict one — the band between the two thresholds.
    const policyEvents = [...events, event("g", daysAgo(0), { secondsPlayed: 8 })];

    const byDefault = statsFor(policyEvents);
    const lenient = statsFor(policyEvents, {
      thresholds: {
        completedFraction: 0.1,
        completedMinSeconds: 5,
        skipMaxSeconds: 30,
        skipMinTrackSeconds: 60,
      },
    });
    const strict = statsFor(policyEvents, {
      thresholds: {
        completedFraction: 0.9,
        completedMinSeconds: 200,
        skipMaxSeconds: 1,
        skipMinTrackSeconds: 60,
      },
    });

    expect(byDefault.verdicts).toEqual({ completed: 3, partial: 1, skipped: 3 });
    expect(lenient.verdicts).toEqual({ completed: 5, partial: 0, skipped: 2 });
    expect(strict.verdicts).toEqual({ completed: 2, partial: 3, skipped: 2 });
    // The 8-second play crosses the skip boundary, so the policy changes the
    // reported play count and time as well as the verdicts.
    expect(byDefault.playCount).toBe(4);
    expect(lenient.playCount).toBe(5);
    expect(lenient.totalSeconds).toBe(249 + 120 + 20 + 249 + 8);
    expect(byDefault.totalSeconds).toBe(249 + 120 + 20 + 249);
    // A recorded marker is not policy: the two marked skips stay skipped under
    // every rule, and there is no stored verdict anywhere to rewrite.
    expect(lenient.verdicts.skipped).toBe(2);
    expect(strict.verdicts.skipped).toBe(2);
  });
});

describe("buildStats: top tracks", () => {
  it("ranks by play count, then by seconds, then by key", () => {
    const stats = statsFor([
      // Two plays, more seconds.
      event("aaa", daysAgo(2), { secondsPlayed: 200 }),
      event("aaa2", daysAgo(1), { secondsPlayed: 200, track: { id: "youtube:aaa" } }),
      // Two plays, fewer seconds — same count, so seconds break the tie.
      event("bbb", daysAgo(2), { secondsPlayed: 40 }),
      event("bbb2", daysAgo(1), { secondsPlayed: 40, track: { id: "youtube:bbb" } }),
      // Three plays, fewer seconds: count still outranks seconds.
      event("ccc", daysAgo(3), { secondsPlayed: 40 }),
      event("ccc2", daysAgo(2), { secondsPlayed: 40, track: { id: "youtube:ccc" } }),
      event("ccc3", daysAgo(1), { secondsPlayed: 40, track: { id: "youtube:ccc" } }),
      // One play, an exact tie with `ddd` on both count and seconds.
      event("ddd", daysAgo(1), { secondsPlayed: 200 }),
      event("zzz", daysAgo(1), { secondsPlayed: 200 }),
    ]);

    expect(keys(stats.topTracks)).toEqual([
      "youtube:ccc",
      "youtube:aaa",
      "youtube:bbb",
      "youtube:ddd",
      "youtube:zzz",
    ]);
    expect(stats.topTracks[0]).toEqual({
      key: "youtube:ccc",
      label: "Track ccc",
      count: 3,
      totalSeconds: 120,
    });
    expect(stats.topTracks[1]?.totalSeconds).toBe(400);
    expect(stats.topTracks[3]?.totalSeconds).toBe(200);
  });

  it("reports the recorded title as the label and the canonical id as the key", () => {
    const stats = statsFor([event("one", daysAgo(1), { track: { title: "  Get Lucky  " } })]);
    expect(stats.topTracks[0]?.key).toBe("youtube:one");
    expect(stats.topTracks[0]?.label).toBe("Get Lucky");
  });

  it("does not credit a skipped play to any track", () => {
    const stats = statsFor([event("one", daysAgo(1), { skipped: true, secondsPlayed: 4 })]);
    expect(stats.topTracks).toEqual([]);
    expect(stats.hasSignal).toBe(false);
  });

  it("bounds every ranked list, with a documented default and a per-call override", () => {
    const many = Array.from({ length: DEFAULT_STATS_LIMIT + 4 }, (_, index) =>
      event(`t${String(index).padStart(2, "0")}`, daysAgo(1, 8 + (index % 12)), {
        secondsPlayed: 100,
      }),
    );
    expect(statsFor(many).topTracks).toHaveLength(DEFAULT_STATS_LIMIT);
    expect(statsFor(many, { limit: 3 }).topTracks).toHaveLength(3);
    expect(statsFor(many, { limit: 0 }).topTracks).toEqual([]);
    // Per-track detail is the same list with a wider bound, not a second API.
    expect(statsFor(many, { limit: many.length }).topTracks).toHaveLength(many.length);
  });
});

describe("buildStats: top artists", () => {
  it("credits every artist of a collaboration, under the shared identity rule", () => {
    const stats = statsFor([
      event("one", daysAgo(1), {
        secondsPlayed: 200,
        track: {
          artists: [
            { id: "UC1", name: "Aurora" },
            { id: "UC2", name: "Beacon" },
          ],
        },
      }),
    ]);

    expect(keys(stats.topArtists)).toEqual(["UC1", "UC2"]);
    expect(stats.topArtists[0]).toEqual({
      key: "UC1",
      label: "Aurora",
      count: 1,
      totalSeconds: 200,
    });
  });

  it("falls back to the normalized name when the provider gave no artist id", () => {
    const stats = statsFor([
      event("one", daysAgo(1), {
        secondsPlayed: 200,
        track: { artists: [{ name: "  NEON WAVES  " }] },
      }),
      event("two", daysAgo(1), {
        secondsPlayed: 200,
        track: { artists: [{ name: "neon waves" }] },
      }),
    ]);

    // Both spellings fold to one identity, and the report is independent of the
    // order they arrived in: the label is the lexicographically first spelling.
    expect(keys(stats.topArtists)).toEqual(["neon waves"]);
    expect(stats.topArtists[0]?.count).toBe(2);
    expect(stats.topArtists[0]?.totalSeconds).toBe(400);
    expect(stats.topTracks).toHaveLength(2);
  });

  it("counts a repeated credit of one artist in a single event once", () => {
    const stats = statsFor([
      event("one", daysAgo(1), {
        secondsPlayed: 200,
        track: {
          artists: [
            { id: "UC1", name: "Aurora" },
            { id: "UC1", name: "Aurora" },
          ],
        },
      }),
    ]);

    expect(stats.topArtists[0]?.count).toBe(1);
  });

  it("ignores an artist credit with neither an id nor a usable name", () => {
    const stats = statsFor([
      event("one", daysAgo(1), { secondsPlayed: 200, track: { artists: [{ name: "   " }] } }),
    ]);
    expect(stats.topArtists).toEqual([]);
    // The play itself still counts: an unreadable artist credit is missing
    // metadata, not a reason to drop the event.
    expect(stats.playCount).toBe(1);
  });

  it("accumulates an artist across tracks and ranks by their total", () => {
    const stats = statsFor([
      event("one", daysAgo(2), { secondsPlayed: 200, track: { artists: [{ name: "Aurora" }] } }),
      event("two", daysAgo(1), { secondsPlayed: 200, track: { artists: [{ name: "Aurora" }] } }),
      event("three", daysAgo(1), { secondsPlayed: 200, track: { artists: [{ name: "Beacon" }] } }),
    ]);

    expect(keys(stats.topArtists)).toEqual(["aurora", "beacon"]);
    expect(stats.topArtists[0]?.count).toBe(2);
    expect(stats.topArtists[0]?.totalSeconds).toBe(400);
  });
});

describe("buildStats: the metadata breakdowns omit what is absent", () => {
  it("breaks plays down by language, and leaves a track with no language out", () => {
    const stats = statsFor([
      event("en", daysAgo(1), { secondsPlayed: 200, track: { language: "en" } }),
      event("fr", daysAgo(1), { secondsPlayed: 200, track: { language: "fr" } }),
      event("unknown", daysAgo(1), { secondsPlayed: 200 }),
    ]);

    expect(keys(stats.languages)).toEqual(["en", "fr"]);
    expect(stats.languages[0]).toEqual({
      key: "en",
      label: "English",
      count: 1,
      totalSeconds: 200,
    });
    // Three plays, two languages: the language-less track is counted in the
    // totals and absent from the breakdown rather than assigned a value.
    expect(stats.playCount).toBe(3);
    expect(stats.languages).toHaveLength(2);
  });

  it("folds casing and padding into one language key", () => {
    const stats = statsFor([
      event("one", daysAgo(1), { secondsPlayed: 200, track: { language: "en" } }),
      event("two", daysAgo(1), { secondsPlayed: 200, track: { language: "  en  " } }),
    ]);

    expect(stats.languages).toHaveLength(1);
    expect(stats.languages[0]?.count).toBe(2);
    expect(stats.languages[0]?.label).toBe("English");
  });

  it("reports an upper-case provider code as itself, and still keys it canonically", () => {
    // The shared language catalog is keyed by its own spelling, so a provider
    // row that records `EN` is folded to the same key as `en` and labelled with
    // the code rather than with a name the catalog does not carry.
    const stats = statsFor([
      event("one", daysAgo(1), { secondsPlayed: 200, track: { language: "EN" } }),
    ]);
    expect(stats.languages[0]?.key).toBe("en");
    expect(stats.languages[0]?.label).toBe("EN");
  });

  it("leaves a blank language out rather than reporting an empty code", () => {
    const stats = statsFor([
      event("one", daysAgo(1), { secondsPlayed: 200, track: { language: "   " } }),
    ]);
    expect(stats.languages).toEqual([]);
    expect(stats.playCount).toBe(1);
  });

  it("reports no language breakdown at all when nothing carries one", () => {
    // The honest "not available" answer: an empty list, which a surface must
    // present as an unavailable breakdown, not as "no languages".
    const stats = statsFor([event("one", daysAgo(1), { secondsPlayed: 200 })]);
    expect(stats.languages).toEqual([]);
  });

  it("breaks plays down by the genre and category a track's own metadata supports", () => {
    // The canonical `Track` has no genre field: `category` is the content type
    // ("music" | "podcast"). The breakdown therefore reuses M10's `genreKeysOf`
    // inference, so the statistics, the taste profile, and a mix name can never
    // disagree about what a track is.
    const stats = statsFor([
      event("jazz", daysAgo(1), { secondsPlayed: 200, track: { title: "Late Jazz Sessions" } }),
      event("podcast", daysAgo(1), { secondsPlayed: 200, track: { category: "podcast" } }),
      event("plain", daysAgo(1), { secondsPlayed: 200, track: { title: "Song plain" } }),
    ]);

    expect(keys(stats.categories).sort()).toEqual(["jazz", "podcast"]);
    expect(stats.categories.find((entry) => entry.key === "jazz")).toEqual({
      key: "jazz",
      label: "jazz",
      count: 1,
      totalSeconds: 200,
    });
    // `category: "music"` is the absence of a content-type distinction, so it
    // contributes no key of its own.
    expect(keys(stats.categories)).not.toContain("music");
    expect(stats.playCount).toBe(3);
  });

  it("reports no category breakdown at all when no played track supports one", () => {
    const stats = statsFor([
      event("one", daysAgo(1), { secondsPlayed: 200, track: { title: "Song one" } }),
    ]);
    expect(stats.categories).toEqual([]);
  });

  it("bounds the breakdowns with the same limit as the top lists", () => {
    const many = Array.from({ length: DEFAULT_STATS_LIMIT + 3 }, (_, index) =>
      event(`l${index}`, daysAgo(1, 8 + (index % 12)), {
        secondsPlayed: 200,
        track: { language: `l${index}` },
      }),
    );
    expect(statsFor(many).languages).toHaveLength(DEFAULT_STATS_LIMIT);
    expect(statsFor(many, { limit: 2 }).languages).toHaveLength(2);
    expect(statsFor(many, { limit: 0 }).languages).toEqual([]);
  });
});

describe("buildStats: streaks are runs of local listening days", () => {
  it("counts three consecutive listening days as a three-day streak", () => {
    const stats = statsFor([
      event("a", daysAgo(2)),
      event("b", daysAgo(1)),
      event("c", daysAgo(0)),
    ]);

    expect(stats.streak.current).toBe(3);
    expect(stats.streak.longest).toBe(3);
    expect(stats.streak.lastListeningDay).toBe(localDayKey(daysAgo(0)));
  });

  it("keeps a streak alive when the last play was yesterday", () => {
    // A streak is not broken until a whole local day has passed with no play,
    // so opening the app in the evening must not show a broken streak.
    const stats = statsFor([event("a", daysAgo(1)), event("b", daysAgo(2))]);
    expect(stats.streak.current).toBe(2);
    expect(stats.streak.lastListeningDay).toBe(localDayKey(daysAgo(1)));
  });

  it("breaks the current streak after a whole missed day, and still reports the longest", () => {
    const stats = statsFor([
      event("a", daysAgo(5)),
      event("b", daysAgo(4)),
      event("c", daysAgo(3)),
      event("d", daysAgo(2)),
    ]);
    expect(stats.streak.current).toBe(0);
    expect(stats.streak.longest).toBe(4);
    expect(stats.streak.lastListeningDay).toBe(localDayKey(daysAgo(2)));
  });

  it("reports the longest run anywhere in the history, not the current one", () => {
    const stats = statsFor([
      event("a", daysAgo(9)),
      event("b", daysAgo(8)),
      event("c", daysAgo(7)),
      event("d", daysAgo(1)),
      event("e", daysAgo(0)),
    ]);

    // The older run is the longer one, and the report says so.
    expect(stats.streak.current).toBe(2);
    expect(stats.streak.longest).toBe(3);
  });

  it("stops the current run at the first gap even when an older run is longer", () => {
    const stats = statsFor([
      event("a", daysAgo(9)),
      event("b", daysAgo(8)),
      event("c", daysAgo(7)),
      event("d", daysAgo(1)),
    ]);

    expect(stats.streak.current).toBe(1);
    expect(stats.streak.longest).toBe(3);
  });

  it("does not let a skip-only day extend a streak or start one", () => {
    const stats = statsFor([
      event("heard", daysAgo(2)),
      event("skipped", daysAgo(1), { skipped: true, secondsPlayed: 3 }),
    ]);

    expect(stats.streak.current).toBe(0);
    expect(stats.streak.longest).toBe(1);
    // The skipped day is not a listening day at all, so it is not reported as
    // the last one either.
    expect(stats.streak.lastListeningDay).toBe(localDayKey(daysAgo(2)));
  });

  it("counts a day once however many plays it holds", () => {
    const stats = statsFor([
      event("a", daysAgo(1, 9)),
      event("b", daysAgo(1, 11)),
      event("c", daysAgo(0, 9)),
    ]);

    expect(stats.streak.current).toBe(2);
    expect(stats.streak.longest).toBe(2);
  });

  it("reports no streak and no listening day for a skip-only history", () => {
    const stats = statsFor([event("a", daysAgo(0), { skipped: true, secondsPlayed: 2 })]);
    expect(stats.streak).toEqual({ current: 0, longest: 0, lastListeningDay: null });
    expect(stats.hasSignal).toBe(false);
    expect(stats.totalSeconds).toBe(0);
  });
});

describe("buildStats: streaks are evaluated at the listener's own midnight", () => {
  it("separates 23:59:59 from 00:00:00 as two listening days", () => {
    const edges = localDayEdges(1);
    const stats = statsFor([event("a", edges.lastSecond), event("b", edges.firstSecond)], {
      now: NOW,
    });

    expect(stats.streak.current).toBe(2);
    expect(stats.streak.longest).toBe(2);
    expect(stats.streak.lastListeningDay).toBe(localDayKey(edges.firstSecond));
  });

  it("runs a streak across a month boundary", () => {
    const lastOfJanuary = localAt(2026, 1, 31, 23, 40);
    const firstOfFebruary = localAt(2026, 2, 1, 0, 20);
    const stats = statsFor([event("a", lastOfJanuary), event("b", firstOfFebruary)], {
      now: localAt(2026, 2, 1, 21, 0),
    });

    expect(stats.streak.current).toBe(2);
    expect(stats.streak.longest).toBe(2);
  });

  it("runs a streak across a year boundary", () => {
    const stats = statsFor(
      [event("a", localAt(2026, 12, 31, 22, 0)), event("b", localAt(2027, 1, 1, 8, 0))],
      { now: localAt(2027, 1, 1, 19, 0) },
    );

    expect(stats.streak.current).toBe(2);
  });

  it("runs a streak across a leap day", () => {
    const stats = statsFor(
      [
        event("a", localAt(2028, 2, 28, 23, 0)),
        event("b", localAt(2028, 2, 29, 0, 30)),
        event("c", localAt(2028, 3, 1, 12, 0)),
      ],
      { now: localAt(2028, 3, 1, 18, 0) },
    );

    expect(stats.streak.current).toBe(3);
    expect(stats.streak.longest).toBe(3);
  });

  it("is a function of the events and the supplied instant alone", () => {
    // No system clock of its own: the same events read one day later report a
    // broken current streak, with the longest run unchanged.
    const events = [event("a", daysAgo(3)), event("b", daysAgo(2)), event("c", daysAgo(1))];
    const today = statsFor(events, { now: daysAgo(0) });
    const tomorrow = statsFor(events, { now: daysAgo(-1) });

    // Today: the newest listening day is yesterday, so the run is still alive.
    expect(today.streak.current).toBe(3);
    // Tomorrow: the newest listening day is now two days back, so a whole day
    // has passed with no play and the current streak is over — the longest run
    // is untouched.
    expect(tomorrow.streak.current).toBe(0);
    expect(tomorrow.streak.longest).toBe(3);
    // Nothing outside the streak depends on the instant at all.
    expect({ ...tomorrow, streak: today.streak }).toEqual(today);
  });
});

describe("localDayKey", () => {
  it("pads a two-digit year, month, and day", () => {
    expect(localDayKey(utcAt(2026, 9, 5), 0)).toBe("2026-09-05");
  });

  it("changes day exactly at local midnight", () => {
    expect(localDayKey(utcAt(2026, 3, 10, 23, 59), 0)).toBe("2026-03-10");
    expect(localDayKey(utcAt(2026, 3, 11, 0, 0), 0)).toBe("2026-03-11");
  });

  it("rolls over a month and a year", () => {
    expect(localDayKey(utcAt(2026, 1, 31, 23, 59), 0)).toBe("2026-01-31");
    expect(localDayKey(utcAt(2026, 2, 1, 0, 0), 0)).toBe("2026-02-01");
    expect(localDayKey(utcAt(2026, 12, 31, 23, 59), 0)).toBe("2026-12-31");
    expect(localDayKey(utcAt(2027, 1, 1, 0, 0), 0)).toBe("2027-01-01");
    expect(localDayKey(utcAt(2028, 2, 28, 12, 0), 0)).toBe("2028-02-28");
    expect(localDayKey(utcAt(2028, 2, 29, 12, 0), 0)).toBe("2028-02-29");
    expect(localDayKey(utcAt(2028, 3, 1, 0, 0), 0)).toBe("2028-03-01");
  });

  it("uses the supplied offset instead of UTC, in the Date convention", () => {
    // 02:30 UTC on 1 February is still 31 January in New York (UTC-5, so
    // `getTimezoneOffset()` is +300).
    expect(localDayKey(utcAt(2026, 2, 1, 2, 30), 300)).toBe("2026-01-31");
    // 20:00 UTC on 31 January is already 1 February in Kolkata (UTC+5:30, so
    // the offset is -330).
    expect(localDayKey(utcAt(2026, 1, 31, 20, 0), -330)).toBe("2026-02-01");
    // 18:29 UTC is 23:59 on 31 January there, and two minutes later it is not.
    expect(localDayKey(utcAt(2026, 1, 31, 18, 29), -330)).toBe("2026-01-31");
    expect(localDayKey(utcAt(2026, 1, 31, 18, 31), -330)).toBe("2026-02-01");
  });

  it("defaults to the machine's own local offset", () => {
    const instant = localAt(2026, 6, 4, 13, 30);
    expect(localDayKey(instant)).toBe(localDayKey(instant, new Date(instant).getTimezoneOffset()));
    expect(localDayKey(instant)).toBe("2026-06-04");
  });

  it("sorts chronologically as plain ascending text", () => {
    // Streak arithmetic depends on this: the keys are compared and walked as
    // strings, so they must be in calendar order lexicographically.
    const keys = [
      localDayKey(utcAt(2026, 12, 31), 0),
      localDayKey(utcAt(2026, 1, 2), 0),
      localDayKey(utcAt(2027, 1, 1), 0),
      localDayKey(utcAt(2026, 1, 10), 0),
    ];
    expect([...keys].sort()).toEqual(["2026-01-02", "2026-01-10", "2026-12-31", "2027-01-01"]);
  });
});

describe("buildStats: the same history always reports the same numbers", () => {
  const events = [
    event("a", daysAgo(3), {
      secondsPlayed: 200,
      track: { language: "en", title: "Late Jazz Sessions" },
    }),
    event("b", daysAgo(2), { secondsPlayed: 45, track: { language: "en" } }),
    event("c", daysAgo(2), { secondsPlayed: 4, skipped: true }),
    event("d", daysAgo(1), {
      secondsPlayed: 200,
      track: { language: "fr", artists: [{ name: "Aurora" }] },
    }),
    event("e", daysAgo(0), { secondsPlayed: 249, track: { category: "podcast" } }),
  ];

  it("returns identical statistics for identical inputs, twice over", () => {
    expect(statsFor(events)).toEqual(statsFor(events));
  });

  it("does not depend on the order the events arrived in", () => {
    const forwards = statsFor(events);
    const backwards = statsFor([...events].reverse());
    // Deterministic tie-breaking: count, then seconds, then key — a total order,
    // so the result is a function of the event *set*.
    expect(backwards).toEqual(forwards);
  });

  it("does not depend on a stable sort having been given a stable input", () => {
    const tied = [
      event("m", daysAgo(1), { secondsPlayed: 200, track: { artists: [{ name: "Same" }] } }),
      event("n", daysAgo(1), { secondsPlayed: 200, track: { artists: [{ name: "Same" }] } }),
      event("o", daysAgo(1), { secondsPlayed: 200, track: { artists: [{ name: "Same" }] } }),
    ];
    const forwards = statsFor(tied);

    // Three tracks and one artist, all tied on both count and seconds: the key
    // decides, so the order is the same whichever way the events arrived.
    expect(keys(forwards.topTracks)).toEqual(["youtube:m", "youtube:n", "youtube:o"]);
    expect(statsFor([...tied].reverse()).topTracks).toEqual(forwards.topTracks);
    expect(forwards.topArtists).toEqual([
      { key: "same", label: "Same", count: 3, totalSeconds: 600 },
    ]);
  });
});

describe("clearing local data changes the numbers (design §2, task 2.3)", () => {
  it("reports only the surviving events after a deletion, with no invalidation step", () => {
    const all = [
      event("a", daysAgo(2), { secondsPlayed: 200, track: { language: "en" } }),
      event("b", daysAgo(1), { secondsPlayed: 200, track: { language: "en" } }),
      event("c", daysAgo(0), { secondsPlayed: 200, track: { language: "en" } }),
    ];
    const before = statsFor(all);

    // "Clear history" is literally deleting the events: the next read sees
    // fewer of them, and there is no stored aggregate to repair.
    const after = statsFor(all.slice(1));

    expect(before.totalSeconds).toBe(600);
    expect(after.totalSeconds).toBe(400);
    expect(after.eventCount).toBe(2);
    expect(keys(after.topTracks)).toEqual(["youtube:b", "youtube:c"]);
    expect(after.topArtists).toEqual([
      { key: "daft punk", label: "Daft Punk", count: 2, totalSeconds: 400 },
    ]);
    expect(after.languages[0]?.count).toBe(2);
    expect(after.languages[0]?.totalSeconds).toBe(400);
  });

  it("resets the current streak when the newest listening day is deleted, and keeps the longest", () => {
    // Two runs: a five-day one a fortnight ago and a four-day one ending today.
    const all = [
      ...[12, 11, 10, 9, 8].map((days) => event(`old${days}`, daysAgo(days))),
      ...[3, 2, 1, 0].map((days) => event(`new${days}`, daysAgo(days))),
    ];
    expect(statsFor(all).streak).toEqual({
      current: 4,
      longest: 5,
      lastListeningDay: localDayKey(daysAgo(0)),
    });

    // Deleting today's only event ends the current run — yesterday's day is the
    // newest left — while the longer, older run is still reported, because it is
    // re-read from the surviving events rather than remembered.
    const after = statsFor(all.slice(0, all.length - 1));
    expect(after.streak.current).toBe(3);
    expect(after.streak.longest).toBe(5);
    expect(after.streak.lastListeningDay).toBe(localDayKey(daysAgo(1)));
  });

  it("reports nothing at all once every event is cleared", () => {
    const after = statsFor([]);
    expect(after).toEqual(statsFor([]));
    expect(after.totalSeconds).toBe(0);
    expect(after.playCount).toBe(0);
    expect(after.topTracks).toEqual([]);
    expect(after.streak).toEqual({ current: 0, longest: 0, lastListeningDay: null });
    expect(after.hasSignal).toBe(false);
  });
});

describe("the derivation is pure (architecture: no store, repository, or network)", () => {
  /** Source with comments removed, so prose cannot be read as an import. */
  function code(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/^\s*\/\/.*$/gmu, " ");
  }

  function readOwnSource(relativePath: string): string {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
  }

  const classifySource = code(readOwnSource(classifyPlayRel));
  const statsSource = code(readOwnSource(buildStatsRel));

  /** Every import a source makes, tagged with whether it is type-only. */
  function imports(source: string): { typeOnly: boolean; specifier: string }[] {
    return [...source.matchAll(/import\s+(type\s+)?[\s\S]*?from\s*["']([^"']+)["']/gu)].map(
      (match) => ({ typeOnly: match[1] !== undefined, specifier: match[2] ?? "" }),
    );
  }

  it("reads the classifier without importing a store, a repository, or the server", () => {
    // The strongest form of the purity claim: a module that imports nothing
    // cannot reach a store, a repository, or a network at all.
    expect(imports(classifySource)).toEqual([]);
  });

  it("imports only the three pure modules it needs, plus a type-only record", () => {
    // Value imports are the shared classification rule, the shared identity and
    // genre derivation, and the shared language catalog — all pure. The single
    // type import is the record *type*, erased at compile time; the architecture
    // suite already allows interface imports from the repository contracts and
    // flags only the IndexedDB implementation.
    expect(
      imports(statsSource)
        .filter((entry) => !entry.typeOnly)
        .map((entry) => entry.specifier)
        .sort(),
    ).toEqual([
      "@/features/insights/classifyPlay",
      "@/features/personalization/tasteProfile",
      "@/lib/languages",
    ]);
    expect(
      imports(statsSource)
        .filter((entry) => entry.typeOnly)
        .map((entry) => entry.specifier),
    ).toEqual(["@/data/repositories"]);
  });

  it("has no side-effect or dynamic import that could smuggle one in", () => {
    for (const source of [classifySource, statsSource]) {
      expect(source).not.toMatch(/import\s*["']/u);
      expect(source).not.toMatch(/import\s*\(/u);
    }
  });

  it("reaches no store, no IndexedDB implementation, and no network from either module", () => {
    for (const source of [classifySource, statsSource]) {
      expect(source).not.toMatch(/Store/u);
      expect(source).not.toMatch(/@\/server/u);
      expect(source).not.toMatch(/data\/indexeddb|data\/localData|getLocalData/u);
      expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/u);
      expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|navigator\./u);
    }
  });

  it("reads no system clock and no randomness", () => {
    for (const source of [classifySource, statsSource]) {
      expect(source).not.toMatch(/Date\.now\s*\(/u);
      // `new Date(<instant>)` is fine — the instant is the caller's. A bare
      // `new Date()` would be the derivation taking its own clock.
      expect(source).not.toMatch(/new Date\s*\(\s*\)/u);
      expect(source).not.toMatch(/Math\.random\s*\(|performance\.now\s*\(/u);
    }
    // The clock is an explicit argument, never a default.
    expect(buildStats.length).toBe(2);
  });

  it("exposes exactly the documented surface", () => {
    const exported = (source: string): string[] =>
      [...source.matchAll(/export\s+(?:const|function|type|interface)\s+(\w+)/gu)].map(
        (match) => match[1] ?? "",
      );
    expect(exported(classifySource).sort()).toEqual([
      "DEFAULT_PLAY_THRESHOLDS",
      "PlaySignal",
      "PlayThresholds",
      "PlayVerdict",
      "classifyPlay",
      "verdictCounts",
    ]);
    expect(exported(statsSource).sort()).toEqual([
      "DEFAULT_STATS_LIMIT",
      "ListeningStats",
      "StatsOptions",
      "WeightedStat",
      "buildStats",
      "localDayKey",
    ]);
  });

  it("takes the dataset and an instant, and nothing else", () => {
    const options: StatsOptions = { now: NOW };
    expect(Object.keys(options).sort()).toEqual(["now"]);
    const stats: ListeningStats = statsFor([event("a", daysAgo(0))]);
    expect(stats.playCount).toBe(1);
    // `limit` and `thresholds` are the only optional inputs: a caller that wants
    // every top entry rather than a ranked few widens the bound, and a caller
    // that wants a different policy names the thresholds. There is no other
    // knob, and no hidden source of data.
    expect(DEFAULT_STATS_LIMIT).toBe(10);
  });
});
