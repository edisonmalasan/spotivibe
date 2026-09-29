/**
 * What counts as a play (M11 task 1.1; spec `insights` — "Play classification";
 * design §1).
 *
 * **One documented rule, applied on read.** `classifyPlay` is a pure function
 * over what the recorder already stored — `secondsPlayed`, the track's
 * `durationSeconds` when the provider supplied one, and the recorded
 * `completed`/`skipped` markers — returning exactly one of three verdicts.
 * **No verdict is ever written back.** The thresholds are *policy*, so changing
 * one re-reads the whole history under today's rule instead of migrating a
 * stored column and re-deriving every historical meaning (design §1,
 * "Classification is a read-time policy, not stored data"; spec scenario:
 * "Classification is a read-time policy"). That also makes the two acceptance
 * criteria structural rather than maintained: two devices that hold the same
 * events report the same verdict, and there is no stored aggregate that can
 * disagree with the history it summarizes.
 *
 * Consequently **this module imports nothing at all** — no store, no
 * repository, no clock, no network. `buildStats` is its only consumer, and the
 * only inputs are recorded measurements plus an optional per-call threshold
 * override, which is what lets a test re-classify a frozen event without a
 * write anywhere.
 *
 * The rule, in precedence order (first match wins):
 *
 * 1. `skipped: true` → **skipped**. An explicit marker is the listener's own
 *    verdict and outranks the arithmetic in both directions.
 * 2. `completed: true` → **completed**, likewise.
 * 3. **Fraction rule** — a known duration of which at least
 *    `completedFraction` was played → **completed**.
 * 4. **Seconds rule** — at least `completedMinSeconds` played → **completed**.
 * 5. **Skip rule** — a track longer than `skipMinTrackSeconds` of which no more
 *    than `skipMaxSeconds` was played → **skipped**.
 * 6. Otherwise → **partial**.
 *
 * Three orderings in that list are deliberate:
 *
 * - `skipped` is checked **before** `completed`, so a record carrying both
 *   markers is read as the skip it claims to be. (`tasteProfile.eventWeight`
 *   resolves the same malformed record the other way, as completed, because it
 *   is weighting a signal; here the record is being *reported*, and "this is
 *   the verdict the surface shows" must never contradict a recorded flag. The
 *   disagreement is confined to a record that should not exist.)
 * - The **seconds rule sits above the skip rule**, so a track heard for 40
 *   seconds is a partial-or-completed play and never a skip: with the default
 *   thresholds the two rules cannot both fire, and the band between them
 *   (10 s … 30 s) is exactly what `partial` is for.
 * - The **skip rule is gated on track length**, so 5 seconds of a 40-second
 *   jingle is a *partial* play. The spec defines the skip threshold "of a track
 *   longer than a minute"; a shorter track has too little room for the fraction
 *   rule to distinguish hearing from skipping.
 *
 * An **unknown duration** (`undefined`, non-finite, or non-positive — many
 * provider rows carry no length) simply drops rules 3 and 5, leaving the
 * seconds-only rules 4 and 6. The honest consequence is that a 5-second play of
 * a length-less track is *partial*, not skipped: with nothing to compare against
 * there is no way to know it was not a 6-second song heard to its end.
 */

/** What one recorded listening event amounts to. */
export type PlayVerdict = "completed" | "partial" | "skipped";

/**
 * The policy a classification is read under. Overridable per call, which is the
 * whole point of deciding on read: a test (or a future tuning decision) can
 * re-read existing history under different numbers with no write anywhere.
 */
export interface PlayThresholds {
  /** Fraction of a known duration that counts as a completion (spec: at least half). */
  completedFraction: number;
  /** Seconds that count as a completion when the duration is unknown or very short. */
  completedMinSeconds: number;
  /** Below this many seconds, a track longer than a minute is a skip. */
  skipMaxSeconds: number;
  /** A track must be longer than this to qualify for the skip rule. */
  skipMinTrackSeconds: number;
}

/**
 * The documented default thresholds.
 *
 * Each number is a product decision, unit-tested at its own boundary:
 *
 * - `completedFraction: 0.5` is the spec's own wording — "at least half of a
 *   known duration". Half is also where the fraction rule and the seconds rule
 *   stop meaning different things: below ~60 s a track's second half is under
 *   30 s, so the two rules agree instead of competing.
 * - `completedMinSeconds: 30` is the "one recognizable phrase of a song"
 *   threshold, and it is the floor that lets a length-less track still be
 *   judged on evidence. It sits comfortably above `skipMaxSeconds` so the band
 *   between them is a real band rather than a hairline.
 * - `skipMaxSeconds: 10` is "long enough to have been a decision". Under ten
 *   seconds a play is a mis-tap or a queue advance, not a hearing, and the
 *   listener has not spent enough time for the time to count as listening.
 * - `skipMinTrackSeconds: 60` is the spec's own boundary ("a track longer than
 *   a minute") and the point below which a short track's fraction rule is
 *   meaningless.
 */
export const DEFAULT_PLAY_THRESHOLDS: PlayThresholds = {
  completedFraction: 0.5,
  completedMinSeconds: 30,
  skipMaxSeconds: 10,
  skipMinTrackSeconds: 60,
};

/**
 * The recorded measurements a verdict is derived from — a structural subset of
 * `ListeningEventRecord`, so a caller reads an event without the derivation
 * needing to import the record type (and so a projection of an event into this
 * shape is the *only* coupling between the two).
 */
export interface PlaySignal {
  /** Seconds actually played, as recorded. */
  secondsPlayed: number;
  /** The track's known length; absent when the provider supplied none. */
  durationSeconds?: number;
  /** The recorder's own completion marker, when it recorded one. */
  completed?: boolean;
  /** The recorder's own skip marker, when it recorded one. */
  skipped?: boolean;
}

/** Recorded seconds as a usable non-negative number; junk reads as no listening. */
function playedSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** A usable known duration, or `null` for "the provider told us no length". */
function knownDuration(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Classify one recorded play. See the module header for the rule and its
 * precedence; the thresholds default to {@link DEFAULT_PLAY_THRESHOLDS} and are
 * overridable per call.
 */
export function classifyPlay(
  signal: PlaySignal,
  thresholds: PlayThresholds = DEFAULT_PLAY_THRESHOLDS,
): PlayVerdict {
  const played = playedSeconds(signal.secondsPlayed);

  // 1. A recorded skip marker outranks everything, including a recorded
  //    completion marker on the same malformed record.
  if (signal.skipped === true) return "skipped";
  // 2. A recorded completion marker outranks the arithmetic.
  if (signal.completed === true) return "completed";

  // 3. Fraction rule, only when a length is known.
  const duration = knownDuration(signal.durationSeconds);
  if (duration !== null && played >= thresholds.completedFraction * duration) return "completed";
  // 4. Seconds rule — the only completion rule available for a length-less
  //    track, and the reason a track shorter than a minute can complete at all.
  if (played >= thresholds.completedMinSeconds) return "completed";
  // 5. Skip rule, only for a track long enough for the fraction rule to mean
  //    anything, and only below the skip threshold itself.
  if (
    duration !== null &&
    duration > thresholds.skipMinTrackSeconds &&
    played <= thresholds.skipMaxSeconds
  ) {
    return "skipped";
  }
  // 6. Everything else: heard for something, not enough to count as a finish.
  return "partial";
}

/**
 * Tally a list of verdicts — the same three counts `buildStats` reports, for a
 * caller that already holds verdicts (the History surface's per-day groups, for
 * instance). A verdict outside the union is ignored rather than invented into
 * one of the three buckets.
 */
export function verdictCounts(verdicts: readonly PlayVerdict[]): {
  completed: number;
  partial: number;
  skipped: number;
} {
  const counts = { completed: 0, partial: 0, skipped: 0 };
  for (const verdict of verdicts) {
    // An exhaustive dispatch rather than a keyed increment: a value outside the
    // union cannot be produced by `classifyPlay`, and a caller who supplies one
    // from untyped data should be ignored rather than folded into a bucket.
    switch (verdict) {
      case "completed":
        counts.completed += 1;
        break;
      case "partial":
        counts.partial += 1;
        break;
      case "skipped":
        counts.skipped += 1;
        break;
    }
  }
  return counts;
}
