import type { ListeningEventRecord } from "@/data/repositories";
import { artistKeyOf, genreKeysOf } from "@/features/personalization/tasteProfile";
import { languageName } from "@/lib/languages";
import {
  classifyPlay,
  DEFAULT_PLAY_THRESHOLDS,
  type PlayThresholds,
  type PlayVerdict,
  verdictCounts,
} from "@/features/insights/classifyPlay";

/**
 * Local listening statistics (M11 tasks 2.1–2.3; spec `insights` — "Local
 * listening statistics" and "Listening streaks"; design §2/§3).
 *
 * **A derivation, not an aggregate.** `buildStats` reduces the events it is
 * handed and returns totals, top entries, a metadata breakdown, a verdict tally
 * and both streaks. It reads no store, imports no repository *implementation*,
 * touches no network, and — most importantly — **persists nothing**: there is no
 * second copy of the numbers that could disagree with the history they
 * summarize, so "recomputed from the events" and "deleting history changes them"
 * are true by construction rather than by an invalidation step (design §2,
 * spec scenarios: "Statistics are recomputed from the events", "Deleting
 * history changes the statistics", task 2.3).
 *
 * **The caller hands over the whole dataset, not the in-memory window.**
 * `historyStore` keeps only `RECENT_HISTORY_LIMIT` (50) events in state for the
 * recently-played surfaces, so statistics must be reduced from the full
 * IndexedDB dataset or a listener with 5,000 events would see stats for 50
 * (design §1). This module cannot enforce that — it takes whatever it is given —
 * which is why the argument is the dataset and the JSDoc says so.
 *
 * **The clock is the caller's.** `options.now` is required: there is no
 * `Date.now()` anywhere below, so any local-midnight boundary is evaluable and
 * reproducible (design §3; spec scenario: "The rule is evaluable at any
 * boundary").
 *
 * **What a statistic counts.** Every non-skipped play feeds every total, the
 * top lists, the breakdown, and the streak; a skipped play is counted *as a
 * skip and nothing else* — it appears in `verdicts.skipped` and in `eventCount`,
 * and contributes no seconds, no play, and no listening day. That keeps
 * `totalSeconds` exactly reconcilable with the plays it summarizes (a stat a
 * listener cannot add up is a stat they cannot trust) and keeps a ten-second
 * mis-tap out of a streak.
 *
 * **Metadata that is absent is omitted, never invented.** `languages` carries
 * only tracks whose provider row included a `language`, and `categories` only
 * tracks whose own public text or content type yields a key — both may be
 * empty, and a surface must then say the breakdown is unavailable rather than
 * fill it in (spec scenario: "Metadata that is absent is omitted, not
 * invented"). Note what the canonical `Track` actually offers: it has **no genre
 * field** — only `category: "music" | "podcast"`, which is a content type, not a
 * genre. The category breakdown therefore reuses M10's `genreKeysOf`, the same
 * low-confidence inference the taste profile and the scorer already share, so a
 * breakdown, a profile, and a later mix name can never disagree about what a
 * track is. `category: "music"` is the *absence* of a content-type distinction
 * and contributes no key; a podcast contributes `podcast`.
 *
 * **Deterministic.** No randomness, no system clock, no order-dependent
 * tiebreak: each ranked list is ordered by play count, then by seconds, then by
 * the key, which is a total order because keys are unique in a map. Reordering
 * the same events therefore returns byte-identical statistics (spec scenario:
 * "The same history always reports the same numbers").
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/** Entries kept per ranked list when the caller names no limit. */
export const DEFAULT_STATS_LIMIT = 10;

/** Everything one derivation needs. Only `now` is required. */
export interface StatsOptions {
  /**
   * The instant the streaks are measured against, in epoch milliseconds.
   * Required so one evaluation has exactly one clock: no rule below reads the
   * system time, and every day boundary is reproducible.
   */
  now: number;
  /** Entries kept per ranked list (top tracks/artists/languages/categories). */
  limit?: number;
  /** Classification policy; anything omitted takes {@link DEFAULT_PLAY_THRESHOLDS}. */
  thresholds?: PlayThresholds;
}

/** One ranked entry of a breakdown: a key, its display label, and its weight. */
export interface WeightedStat {
  /** Stable identity of the key: a track id, an artist identity, a language code, a genre. */
  key: string;
  /** Public text to show for it (a track title, an artist name, a language name). */
  label: string;
  /** Non-skipped plays of it. */
  count: number;
  /** Seconds heard across those plays. */
  totalSeconds: number;
}

/** The derived statistics, plus the streaks that are part of the same read. */
export interface ListeningStats {
  /** Seconds heard across every non-skipped play. */
  totalSeconds: number;
  /** Non-skipped plays (a completed or a partial play both count once). */
  playCount: number;
  /** Every event, including skips. */
  eventCount: number;
  /** Most-played tracks, by count then seconds then id. */
  topTracks: WeightedStat[];
  /** Most-played artists, by count then seconds then key. */
  topArtists: WeightedStat[];
  /** Plays by `track.language`, only for tracks that carry one. */
  languages: WeightedStat[];
  /**
   * Plays by genre/category, only for tracks whose recorded metadata supports
   * a key. Empty when no played track does — which is the honest answer, not a
   * breakdown to fill in (see the module header).
   */
  categories: WeightedStat[];
  /** How plays ended, as `classifyPlay` read them. */
  verdicts: { completed: number; partial: number; skipped: number };
  /** The listening-day runs (design §3). */
  streak: { current: number; longest: number; lastListeningDay: string | null };
  /** At least one non-skipped play exists — the same meaning M10's profile gives it. */
  hasSignal: boolean;
}

/** Recorded seconds as a usable non-negative number. */
function playedSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** A running total for one key. */
interface Accumulator {
  key: string;
  label: string;
  count: number;
  totalSeconds: number;
}

/**
 * Fold one play into a key. A key with no usable identity (`""`) is dropped:
 * that is missing metadata, not an entity called nothing.
 *
 * The label is the **lexicographically first** spelling seen for a key, not the
 * first-arrived one, so a key spelled two ways in the history ("Aurora" and
 * "aurora") reports the same text whichever order the events arrived in.
 */
function credit(map: Map<string, Accumulator>, key: string, label: string, seconds: number): void {
  if (key === "") return;
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, { key, label, count: 1, totalSeconds: seconds });
    return;
  }
  existing.count += 1;
  existing.totalSeconds += seconds;
  if (label < existing.label) existing.label = label;
}

/** Rank an accumulator map into a bounded breakdown. */
function ranked(map: Map<string, Accumulator>, limit: number): WeightedStat[] {
  return [...map.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.totalSeconds - a.totalSeconds ||
        (a.key === b.key ? 0 : a.key < b.key ? -1 : 1),
    )
    .slice(0, Math.max(0, limit))
    .map(({ key, label, count, totalSeconds }) => ({ key, label, count, totalSeconds }));
}

/** Zero-pad a two-digit calendar field. */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The listener's **local** calendar day for an instant, as `YYYY-MM-DD`.
 *
 * Local time, because a server has no notion of the listener's midnight: a
 * UTC-day streak breaks at the wrong moment and is irreproducible (design §3).
 * `timeZoneOffsetMinutes` follows the `Date.getTimezoneOffset()` convention
 * (minutes to **add** to local time to reach UTC) and is overridable so any
 * boundary — including a negative offset and a month or year rollover — can be
 * evaluated in a test without depending on the machine running it.
 */
export function localDayKey(epochMs: number, timeZoneOffsetMinutes?: number): string {
  const offset = timeZoneOffsetMinutes ?? new Date(epochMs).getTimezoneOffset();
  const shifted = new Date(epochMs - offset * MS_PER_MINUTE);
  const year = String(shifted.getUTCFullYear()).padStart(4, "0");
  return `${year}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/**
 * Days since the epoch for a `YYYY-MM-DD` key. Working in *day* space rather
 * than milliseconds is what makes a run of listening days survive a daylight
 * saving shift: consecutive keys differ by exactly 1, never by 23 or 25 hours.
 */
function dayIndexOf(key: string): number {
  // Only ever called with a key `localDayKey` produced, so the shape is known.
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/** Both streaks, from the set of listening-day keys and today's key. */
function streakFrom(days: readonly string[], todayKey: string): ListeningStats["streak"] {
  if (days.length === 0) return { current: 0, longest: 0, lastListeningDay: null };

  // Ascending ISO keys sort chronologically, so the order below is the order the
  // days happened in — independent of the order the events arrived in.
  const sorted = [...days].sort();
  const indexes = sorted.map(dayIndexOf);

  let longest = 1;
  let run = 1;
  for (let index = 1; index < indexes.length; index += 1) {
    run = indexes[index] - indexes[index - 1] === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  // "Today or yesterday keeps a streak alive" (design §3): a streak is not
  // broken until a whole local day has passed with no play, so opening the app
  // in the evening does not show a broken streak. A run ending today or
  // yesterday is therefore the current one, measured backwards from the newest
  // listening day; anything older is zero. (A future-dated event — a clock
  // change, malformed data — is not evidence of a current streak.)
  const newest = indexes[indexes.length - 1];
  const today = dayIndexOf(todayKey);
  let current = 0;
  if (newest === today || newest === today - 1) {
    current = 1;
    for (let index = indexes.length - 1; index > 0; index -= 1) {
      if (indexes[index] - indexes[index - 1] !== 1) break;
      current += 1;
    }
  }

  return { current, longest, lastListeningDay: sorted[sorted.length - 1] };
}

/**
 * Derive every local statistic from the listening events.
 *
 * @param events **The whole listening-history dataset**, not an in-memory
 * window (see the module header). Read-only; never mutated.
 * @param options The caller's clock, plus optional bound and policy overrides.
 */
export function buildStats(
  events: readonly ListeningEventRecord[],
  options: StatsOptions,
): ListeningStats {
  const thresholds = options.thresholds ?? DEFAULT_PLAY_THRESHOLDS;
  const limit = options.limit ?? DEFAULT_STATS_LIMIT;

  const verdicts: PlayVerdict[] = [];
  const tracks = new Map<string, Accumulator>();
  const artists = new Map<string, Accumulator>();
  const languages = new Map<string, Accumulator>();
  const categories = new Map<string, Accumulator>();
  const listeningDays = new Set<string>();
  let totalSeconds = 0;
  let playCount = 0;

  for (const event of events) {
    const track = event.track;
    // The one place a verdict is decided: every surface reads the same rule over
    // the same recorded measurements (spec: "every surface reports the same
    // verdict for the same event").
    const verdict = classifyPlay(
      {
        secondsPlayed: event.secondsPlayed,
        durationSeconds: track.durationSeconds,
        completed: event.completed,
        skipped: event.skipped,
      },
      thresholds,
    );
    verdicts.push(verdict);
    // A skip is counted as a skip and nothing else.
    if (verdict === "skipped") continue;

    const seconds = playedSeconds(event.secondsPlayed);
    playCount += 1;
    totalSeconds += seconds;
    listeningDays.add(localDayKey(event.playedAt));

    credit(tracks, track.id, track.title.trim(), seconds);

    // A collaboration is credited to each of its artists, but a track that
    // repeats the same artist twice is not two plays of that artist.
    const credited = new Set<string>();
    for (const artist of track.artists) {
      const key = artistKeyOf(artist);
      if (credited.has(key)) continue;
      credited.add(key);
      credit(artists, key, artist.name.trim(), seconds);
    }

    const language = track.language?.trim() ?? "";
    if (language !== "") credit(languages, language.toLowerCase(), languageName(language), seconds);

    for (const key of genreKeysOf(track)) credit(categories, key, key, seconds);
  }

  return {
    totalSeconds,
    playCount,
    eventCount: events.length,
    topTracks: ranked(tracks, limit),
    topArtists: ranked(artists, limit),
    languages: ranked(languages, limit),
    categories: ranked(categories, limit),
    verdicts: verdictCounts(verdicts),
    streak: streakFrom([...listeningDays], localDayKey(options.now)),
    hasSignal: playCount > 0,
  };
}
