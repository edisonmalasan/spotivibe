import type { ListeningEventRecord, Track } from "@/data/repositories";
import { deriveSeedTerms, MAX_SEED_TERMS, type LocalTaste } from "@/features/home/localSeeds";
import {
  buildTasteProfile,
  genreKeysOf,
  type TasteProfile,
} from "@/features/personalization/tasteProfile";

/**
 * Time-of-day bands for Home (M17; spec: `home-mixes` — "The local clock selects
 * a time-of-day band"; design decision 3).
 *
 * A band is a **local signal with exactly one job**: it chooses seed terms and
 * the material those terms select. It is never persisted, never sent, and never
 * combined with stored listening data into anything else. Those terms do reach a
 * real request — {@link bandTasteProfile} hands them to the one mix generator on
 * activation — but what leaves the device is still a list of public words, so
 * "it selects a seed set and query construction only" holds for the query as
 * well as for the shelf.
 *
 * The hour is an injectable function, so band selection is a pure function of an
 * hour and a test never has to read the wall clock — this repository already
 * carries one flake caused by a wall-clock budget standing in for
 * synchronization (`podcast-playback-history`), and a second one is not worth a
 * feature.
 *
 * Boundaries are **half-open** and ordered, so a boundary hour belongs to the
 * band that starts there: 05:00 is morning, 12:00 is afternoon, 17:00 is evening,
 * 22:00 is late night, and no hour is claimed twice or left unclaimed. Late night
 * appears twice in the table because it wraps midnight; a table cannot express
 * that wrap as one interval, and splitting it is what keeps every hour inside
 * exactly one half-open range.
 *
 * Pure and deterministic: the same hour always yields the same band, at any
 * instant, and no input is mutated.
 */

/** The four bands, in the order a day runs. */
export const TIME_BANDS = ["morning", "afternoon", "evening", "late-night"] as const;

export type TimeBand = (typeof TIME_BANDS)[number];

/** Whether `value` names one of the four bands. */
export function isTimeBand(value: unknown): value is TimeBand {
  return typeof value === "string" && (TIME_BANDS as readonly string[]).includes(value);
}

/** One half-open local-hour range `[from, to)` owned by one band. */
export interface TimeBandBound {
  readonly band: TimeBand;
  /** Inclusive local hour the range starts at (0..23). */
  readonly from: number;
  /** Exclusive local hour the range ends at (1..24). */
  readonly to: number;
}

/**
 * The hour table: contiguous, half-open, covering every hour 0..23 exactly once.
 * It is exported rather than inlined so the boundaries are *data* — a test reads
 * the same numbers the implementation does instead of re-typing them.
 */
export const TIME_BAND_BOUNDS: readonly TimeBandBound[] = [
  { band: "late-night", from: 0, to: 5 },
  { band: "morning", from: 5, to: 12 },
  { band: "afternoon", from: 12, to: 17 },
  { band: "evening", from: 17, to: 22 },
  { band: "late-night", from: 22, to: 24 },
];

/**
 * The band a local hour falls into.
 *
 * The hour is normalized first (`((h % 24) + 24) % 24`), so 24 and -1 are
 * answered as 0 and 23 rather than falling off the table; a non-finite hour is a
 * caller bug and throws rather than silently yielding a band that the shelf
 * would then label with a time nobody reported.
 */
export function bandForHour(hour: number): TimeBand {
  if (!Number.isFinite(hour)) {
    throw new Error("bandForHour requires a finite hour.");
  }
  const local = ((Math.trunc(hour) % 24) + 24) % 24;
  const bound = TIME_BAND_BOUNDS.find((entry) => local >= entry.from && local < entry.to);
  // Unreachable while the table covers 0..23, and kept as a throw rather than an
  // `undefined` band: a shelf with no label is a worse failure than a loud one.
  if (bound === undefined) throw new Error(`No time band covers hour ${local}.`);
  return bound.band;
}

/**
 * An injectable clock, in epoch milliseconds.
 *
 * A function rather than a value so a test passes one that answers a fixed
 * instant, which is the only reason this feature is testable at all.
 */
export type Clock = () => number;

/**
 * The system clock, held as a **reference** rather than a call.
 *
 * `Date.now` itself is the default value (design decision 3), so production code
 * needs no argument; the point of naming it once here is that it is the *only*
 * place the wall clock enters the feature, and `tests/home-time-bands.test.ts`
 * enforces that by rule rather than by review.
 */
export const systemClock: Clock = Date.now;

/**
 * The listener's local hour for a supplied instant.
 *
 * The one `Date` construction in `features/home`, and it is applied to a
 * *parameter* — `new Date(epochMs)`, never the argument-less form that reads the
 * wall clock. That distinction is the difference between an injectable clock and
 * a clock hidden inside a helper.
 */
export function localHourOf(epochMs: number): number {
  return new Date(epochMs).getHours();
}

/**
 * The band for "now", read through an injectable clock.
 *
 * The default is {@link systemClock}, so a surface may call `bandForNow()` with
 * no arguments in production and `bandForNow(() => FIXED)` in a test — and the
 * two produce identical answers for identical instants, which is the whole
 * property the scenario "band selection is a pure function of the hour" asks for.
 */
export function bandForNow(clock: Clock = systemClock): TimeBand {
  return bandForHour(localHourOf(clock()));
}

/**
 * Display label per band: a part of the day, never a clock reading.
 *
 * A label that formatted the time ("20:14") would assert an instant the shelf
 * was never told, and a reader would take it as a timestamp rather than as the
 * reason these results are on screen.
 */
export const TIME_BAND_LABELS: Record<TimeBand, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  "late-night": "Late night",
};

/**
 * The one taste word each band selects for.
 *
 * All four are keys of the **shared** genre lexicon in
 * `features/personalization/tasteProfile`, so no second mood vocabulary is
 * invented here and a track matches a band through the same derivation every
 * other part of the app already uses. The choice within that lexicon is
 * deliberately broad and non-exclusive: a band picks a mood to *ask for*, and the
 * mix or shelf it selects from still answers with the listener's own material.
 */
export const TIME_BAND_TERMS: Record<TimeBand, string> = {
  morning: "pop",
  afternoon: "funk",
  evening: "soul",
  "late-night": "ambient",
};

/**
 * The seed terms a band selects: its own mood word first, then the listener's
 * derived terms, bounded at the discovery endpoint's own cap.
 *
 * The mood word **leads** rather than trails so the band always has an effect: a
 * listener whose taste already fills the term bound would otherwise have the
 * band's own word trimmed away, and "the band influences the seeds" would become
 * true only for listeners with few local artists. Local taste still follows, so a
 * band widens what is asked for rather than replacing what the listener likes.
 */
export function seedTermsForBand(band: TimeBand, taste: LocalTaste): string[] {
  const mood = TIME_BAND_TERMS[band];
  const terms: string[] = [mood];
  const seen = new Set<string>([mood]);
  for (const term of deriveSeedTerms(taste)) {
    if (terms.length === MAX_SEED_TERMS) break;
    const identity = term.trim().toLowerCase();
    if (identity === "" || seen.has(identity)) continue;
    seen.add(identity);
    terms.push(term);
  }
  return terms;
}

/**
 * Whether a track carries a band's mood word, judged by the shared lexicon
 * rather than by a second text matcher.
 *
 * This is the band's only *local* effect: it *selects* material from what the
 * device already holds. It cannot invent material, cannot reorder the stored
 * history, and cannot reach a provider.
 */
export function bandSelectsTrack(band: TimeBand, track: Track): boolean {
  return genreKeysOf(track).includes(TIME_BAND_TERMS[band]);
}

/**
 * How many seed terms one band's request may carry.
 *
 * {@link seedTermsForBand} bounds its own list at the discovery endpoint's cap of
 * eight, while `generateMix` reads `profile.seedTerms.slice(0, 4)`. Handing the
 * generator eight terms and letting it discover the ceiling would make the
 * agreement between the two bounds accidental rather than declared — and because
 * the mood word *leads*, the four it keeps happen to be the four that matter,
 * which is exactly the kind of coincidence that stops being one. Four is named
 * here so the strategy and the generator state the same number in the same place.
 */
export const MAX_BAND_QUERY_SEEDS = 4;

/** Everything one band's profile derivation reads. All of it is already local. */
export interface BandProfileInput {
  /** Liked tracks, newest-first (as `libraryStore` exposes them). */
  readonly likedTracks: readonly Track[];
  /** Listening events, newest-first (as `historyStore` exposes them). */
  readonly events: readonly ListeningEventRecord[];
  /** The selected catalog language codes (as `preferencesStore` exposes them). */
  readonly languages: readonly string[];
  /** Epoch milliseconds the recency decay is measured against. */
  readonly now: number;
}

/**
 * The profile a band's request is composed from.
 *
 * The listener's own local taste, with the band's seed terms in front of it, and
 * **nothing else changed**. That last clause is the whole contract, and it is
 * what makes "the band influences only seed selection" true of the composed
 * *query* and not only of the shelf: `hasSignal`, the weights, the genre order,
 * and the recent ids all come from `buildTasteProfile` untouched, so a cold
 * device still answers "no signal", and a mix's stored name still comes from the
 * listener's own genre weights rather than from a clock.
 *
 * There is deliberately no second composer and no band-aware variant of
 * `generateMix`: this function produces the profile the *one* shared generator
 * already accepts, which is what stops "seed selection only" from becoming a
 * second place a request shape is decided.
 *
 * Pure and deterministic: the same input always yields the same profile, the band
 * reaches the result only through the term list, and no input is mutated.
 */
export function bandTasteProfile(band: TimeBand, input: BandProfileInput): TasteProfile {
  const base = buildTasteProfile({ ...input, limits: { seedTerms: MAX_BAND_QUERY_SEEDS } });
  return { ...base, seedTerms: seedTermsForBand(band, input).slice(0, MAX_BAND_QUERY_SEEDS) };
}

/** How many tracks the time-aware shelf offers by default. */
export const TIME_SHELF_LIMIT = 10;

/**
 * The tracks a band selects out of material the device already holds, first
 * match order, deduped by track id and capped at `limit`.
 *
 * Returns `[]` rather than a fallback when nothing matches: a band that silently
 * substituted unrelated tracks would be showing results it cannot explain, and
 * the shelf's empty state is the honest rendering of "this mood is not in what
 * you have here yet".
 */
export function selectBandTracks(
  band: TimeBand,
  tracks: readonly Track[],
  limit: number = TIME_SHELF_LIMIT,
): Track[] {
  const seen = new Set<string>();
  const selected: Track[] = [];
  for (const track of tracks) {
    if (selected.length === Math.max(0, limit)) break;
    if (seen.has(track.id) || !bandSelectsTrack(band, track)) continue;
    seen.add(track.id);
    selected.push(track);
  }
  return selected;
}
