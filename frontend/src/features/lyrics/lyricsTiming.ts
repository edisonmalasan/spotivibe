/**
 * Timed-lyrics parsing and active-line selection (ROADMAP M16, spec `lyrics`).
 *
 * Both are **pure functions over text and a number**. They read no clock, start no timer, and
 * hold no state — which is the whole design decision here, and it is testable:
 *
 * - **Reset-on-track-change holds by construction.** A new track brings new `lines`, and a
 *   position before its first timestamp yields `-1` with no special case. There is no cursor to
 *   forget to reset, which is where a change like this normally goes wrong.
 * - **Nothing here can flake.** This repository already carries one intermittent failure caused by
 *   a wall-clock budget standing in for synchronization (`podcast-playback-history`). A selector
 *   that derived "the current line" from elapsed time would be the same defect wearing different
 *   clothes, so selection is a function of the *reported* position and nothing else.
 *
 * Lyrix's `SyncedLyrics.tsx` carries equivalents of both functions; the behaviour is what is
 * worth taking, and the Zustand-coupled inline component around them is not (design decision 1).
 */

/** One timed lyric line: the seconds at which it starts, and its text. */
export interface LyricLine {
  /** Start time in seconds. Always finite and non-negative. */
  time: number;
  text: string;
}

/**
 * An LRC timestamp, capturing its precision: `[mm:ss]`, `[mm:ss.xx]`, or `[mm:ss.xxx]`.
 *
 * The fraction is captured rather than coerced at match time because `[00:12.5]` is 12.5s and
 * `[00:12.50]` is also 12.5s, while a naive `parseInt("5") / 1000` would make the first 5ms. The
 * fraction is therefore right-padded to milliseconds before it is divided.
 */
const TIMESTAMP = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;

/**
 * A metadata tag carrying no lyric text: `[ar:...]`, `[ti:...]`, `[al:...]`, `[length:...]`.
 *
 * These are matched explicitly rather than relying on the absence of a timestamp. `[length:03:21]`
 * contains something that *looks* like a timestamp to a loose reader, so a metadata line is dropped
 * rather than parsed.
 *
 * `[offset:...]` is deliberately **dropped and not applied**, and that is a stated limit rather than
 * an oversight. The field shifts every line, and applying it wrongly is worse than not applying it:
 * an unshifted lyric is at most a fraction of a second out, whereas a mis-parsed offset moves the
 * whole song. LRCLIB's own output is not offset, and the LRC files that carry it are rare. Applying it
 * properly is a small follow-up; mis-stating the comment as if it were applied would not be.
 */
const METADATA_TAG = /^\[[a-z]+:[^\]]*\]\s*$/i;

export interface ParsedLyrics {
  /** Time-ordered, non-empty timed lines. Empty when the source had none. */
  lines: LyricLine[];
  /** Plain text accompanying the timed lines, if any. */
  plain: string | null;
}

/**
 * Parse LRC-formatted lyrics into ordered timed lines.
 *
 * Handles the three timestamp precisions, ignores metadata and unparsable lines, sorts by time
 * regardless of source order, and drops a line whose text is empty so no blank row is ever
 * highlighted. A source with no parseable timestamped line yields **zero** lines rather than one
 * line at time zero — a "first line" that is really a parse failure would highlight the wrong
 * lyric from the first second of playback.
 */
export function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const source of raw.split(/\r?\n/)) {
    const trimmed = source.trim();
    if (trimmed === "" || METADATA_TAG.test(trimmed)) continue;

    const match = TIMESTAMP.exec(trimmed);
    if (match === null) continue; // unparsable line: a bare lyric or a stray tag

    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const fraction = match[3] === undefined ? "" : match[3].padEnd(3, "0");
    const time = minutes * 60 + seconds + (fraction === "" ? 0 : Number(fraction) / 1000);
    const text = trimmed.slice(match[0].length).trim();

    // A timestamped line with no text is a gap marker, not a lyric. Rendering it would put an
    // empty row in the panel that then becomes the "active line" during an instrumental break.
    if (text === "") continue;

    lines.push({ time, text });
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Parse a provider payload that may carry timed lyrics, untimed lyrics, or both.
 *
 * Kept separate from {@link parseLrc} so the parser stays a single-concern text transform, and so
 * the "do timed lines exist" question — which decides between the following view and the plain view
 * — is answered in one place.
 */
export function parseLyricsPayload(payload: {
  syncedLyrics: string | null;
  plainLyrics: string | null;
}): ParsedLyrics {
  const lines = payload.syncedLyrics === null ? [] : parseLrc(payload.syncedLyrics);
  const plain = payload.plainLyrics?.trim() || null;
  // Both are returned independently: the caller chooses. Timed lines are preferred for *display*,
  // but the plain text is not discarded, so a caller can still fall back to it.
  return { lines, plain };
}

/**
 * The index of the active line for `positionSeconds`, or `-1` when the position precedes the
 * first line.
 *
 * A binary search: this runs on every position update, roughly once per second per playing track,
 * over a list that is routinely a hundred lines or more. The return is "the last line at or before
 * the position", which is what makes a position *exactly* on a timestamp select that line rather
 * than the previous one.
 *
 * Positions beyond the last line return the last line: the lyric is still what is on screen.
 */
export function activeLineIndex(lines: readonly LyricLine[], positionSeconds: number): number {
  if (lines.length === 0) return -1;
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].time <= positionSeconds) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
