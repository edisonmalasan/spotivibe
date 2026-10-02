import { describe, expect, it } from "vitest";
import {
  activeLineIndex,
  parseLrc,
  parseLyricsPayload,
  type LyricLine,
} from "@/features/lyrics/lyricsTiming";

/** A realistic LRC excerpt, including a metadata header and an instrumental gap. */
const REAL_LRC = [
  "[ar:Some Artist]",
  "[ti:Some Song]",
  "[length:03:21]",
  "[00:12.00]First line of the song",
  "[00:15.50]Second line",
  "[00:15.50]Duplicate timestamp line",
  "[00:20]",
  "[00:23.250]Third line with three-digit fraction",
].join("\n");

const at = (time: number, text: string): LyricLine => ({ time, text });

/** The text of each line, for asserting *which* line a selector chose. */
const textOf = (parsed: readonly LyricLine[]): string[] => parsed.map((line) => line.text);

describe("parseLrc (spec lyrics — Timed lyrics are parsed into ordered lines)", () => {
  it("parses all three timestamp precisions to the right seconds", () => {
    // The precision rule is the whole reason a fraction is captured rather than coerced: a naive
    // `parseInt("5") / 1000` turns 12.5 into 12.005.
    expect(parseLrc("[00:12]a\n[01:02.50]b\n[02:03.250]c").map((line) => line.time)).toEqual([
      12, 62.5, 123.25,
    ]);
  });

  it("ignores metadata tags, including one that looks like a timestamp", () => {
    const lines = parseLrc("[ar:Artist]\n[length:03:21]\n[00:30]only lyric");
    expect(lines).toEqual([at(30, "only lyric")]);
  });

  it("ignores unparsable lines without discarding the valid ones around them", () => {
    const lines = parseLrc("a bare lyric line\n[00:10]real\n[broken\n[00:20]also real");
    expect(lines.map((line) => line.text)).toEqual(["real", "also real"]);
  });

  it("sorts out-of-order lines by time", () => {
    const lines = parseLrc("[00:30]later\n[00:10]earlier\n[00:20]middle");
    expect(lines.map((line) => line.text)).toEqual(["earlier", "middle", "later"]);
  });

  it("drops a timestamped line with no text, so a gap is never an active line", () => {
    // An instrumental gap is marked `[00:20]` with nothing after it. Rendering it would put an
    // empty row in the panel that then becomes the highlighted lyric.
    const lines = parseLrc(REAL_LRC);
    expect(lines.map((line) => line.text)).not.toContain("");
    expect(lines.every((line) => line.text.length > 0)).toBe(true);
  });

  it("keeps two lines that share a timestamp, in source order", () => {
    const lines = parseLrc(REAL_LRC);
    const duplicates = lines.filter((line) => line.time === 15.5);
    expect(duplicates.map((line) => line.text)).toEqual([
      "Second line",
      "Duplicate timestamp line",
    ]);
  });

  it("yields zero lines when nothing is timestamped, rather than a line at time zero", () => {
    // A "first line" that is really a parse failure would highlight the wrong lyric from the
    // first second of playback.
    expect(parseLrc("just\nsome\nplain text")).toEqual([]);
    expect(parseLrc("")).toEqual([]);
    expect(parseLrc("[ar:only metadata]")).toEqual([]);
  });

  it("handles CRLF line endings and leading whitespace", () => {
    expect(parseLrc("  [00:10]indented\r\n[00:20]next\r\n").map((line) => line.text)).toEqual([
      "indented",
      "next",
    ]);
  });

  it("accepts a minute field of more than two digits", () => {
    // `[100:00]` is 100 minutes. The regex allows 1-3 digits of minutes, so this parses; the
    // assertion is on the value, not on source order.
    expect(parseLrc("[100:00]long")[0].time).toBe(6000);
  });

  it("reads a seconds field of two digits as seconds, not as a fraction", () => {
    // `[00:90]` is 90 seconds by the format, even though a clock would never write it. The
    // parser is a text transform and does not second-guess the source.
    const wide = parseLrc("[00:90]wide");
    expect(wide[0].time).toBe(90);
  });
});

describe("parseLyricsPayload", () => {
  it("returns timed lines when the provider supplied them", () => {
    const parsed = parseLyricsPayload({ syncedLyrics: "[00:10]hi", plainLyrics: "hi" });
    expect(parsed.lines).toEqual([at(10, "hi")]);
  });

  it("returns no timed lines when only plain lyrics exist", () => {
    // This is the branch that decides between the following view and the plain view, so it is
    // asserted directly rather than inferred.
    const parsed = parseLyricsPayload({ syncedLyrics: null, plainLyrics: "just words" });
    expect(parsed.lines).toEqual([]);
    expect(parsed.plain).toBe("just words");
  });

  it("treats whitespace-only plain lyrics as absent", () => {
    expect(parseLyricsPayload({ syncedLyrics: null, plainLyrics: "   " }).plain).toBeNull();
  });

  it("prefers timed lines when a payload carries both", () => {
    const parsed = parseLyricsPayload({ syncedLyrics: "[00:05]timed", plainLyrics: "plain" });
    expect(parsed.lines).toEqual([at(5, "timed")]);
  });
});

describe("activeLineIndex (spec lyrics — The active line is selected from playback position)", () => {
  const lines = [at(10, "a"), at(20, "b"), at(30, "c")];

  it("activates the line at a position exactly on its timestamp", () => {
    expect(activeLineIndex(lines, 20)).toBe(1);
  });

  it("keeps the earlier line active between timestamps", () => {
    expect(activeLineIndex(lines, 19.9)).toBe(0);
    expect(activeLineIndex(lines, 25)).toBe(1);
  });

  it("has no active line before the first", () => {
    expect(activeLineIndex(lines, 3)).toBe(-1);
    expect(activeLineIndex(lines, 0)).toBe(-1);
  });

  it("keeps the last line active beyond the end", () => {
    // The lyric on screen is still the last one; dropping to -1 would blank the panel at the end
    // of a track.
    expect(activeLineIndex(lines, 600)).toBe(2);
  });

  it("has no active line for an empty list", () => {
    expect(activeLineIndex([], 10)).toBe(-1);
  });

  it("activates the later of two lines that share a timestamp", () => {
    // The boundary `design.md` names explicitly, and the semantics are "the last line at or before the
    // position", so for two lines at the same time the *second* wins. A first draft of this test
    // asserted the opposite — the earlier one — and was wrong: the implementation returns the last
    // index whose time is `<= position`, which is also the behaviour a listener expects when two
    // lines share a start time, since the later line is the one being sung.
    //
    // Asserting the specific index (not merely "one of them") is what pins the comparator direction.
    const duplicates = [at(10, "first"), at(10, "second"), at(20, "third")];
    expect(activeLineIndex(duplicates, 10)).toBe(1);
    expect(textOf(duplicates)[activeLineIndex(duplicates, 10)]).toBe("second");

    // And just below the shared time, neither duplicate has started.
    expect(activeLineIndex(duplicates, 9.9)).toBe(-1);
  });

  it("activates the first line at its own timestamp", () => {
    expect(activeLineIndex([at(0, "first")], 0)).toBe(0);
  });

  it("is pure: the same inputs give the same answer regardless of call order", () => {
    // The reset-on-track-change guarantee rests on this being a function of its arguments and
    // nothing else — no cursor, no elapsed time, no memory of a previous call.
    const first = activeLineIndex(lines, 22);
    activeLineIndex(lines, 0);
    activeLineIndex([at(1, "other")], 99);
    expect(activeLineIndex(lines, 22)).toBe(first);
  });

  it("does not read a clock, so it cannot flake under load", () => {
    // The defect this repository already carries is a wall-clock budget standing in for
    // synchronization. This does **not** read the source file at runtime: the verification pass
    // on the parked player showed that a detector reading another file's *text* is the fragile
    // kind, and a first draft of this very test failed in the test environment for that reason.
    // Instead the *behaviour* is pinned — the same inputs separated by real elapsed time give
    // the same answer, which is what "no hidden clock" actually means.
    const lines = [at(10, "a"), at(20, "b")];
    const before = activeLineIndex(lines, 15);
    const started = Date.now();
    while (Date.now() - started < 5) {
      /* burn a few milliseconds of wall clock */
    }
    expect(activeLineIndex(lines, 15), "elapsed time must not affect selection").toBe(before);
  });
});
