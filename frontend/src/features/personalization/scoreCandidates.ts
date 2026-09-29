import type { Track } from "@/data/repositories";
import {
  artistKeyOf,
  genreKeysOf,
  LIKE_WEIGHT,
  type TasteProfile,
} from "@/features/personalization/tasteProfile";

/**
 * Deterministic local ranking (M10 task 3.2; spec: `personalization` — "Rule-based
 * candidate scoring"; design §4).
 *
 * Every rule is an explicit, independently testable function of **this device's**
 * profile, the candidate's own public metadata, and the provider's own quality
 * score. There is no randomness (`Math.random` never appears), no remote model,
 * and no other user's data anywhere in the signature or the body — the ranking
 * cannot compare the listener with a stranger because it has no access to one
 * (spec scenario: "No cross-user signal exists").
 *
 * Rules, in the canonical order they are reported in `reasons`:
 *
 * 1. **quality** — the provider's own 0–100 `qualityScore` as a floor, or a
 *    documented constant when the row carries none. Affinity can lift a track,
 *    never bury it: the floor is the only rule that applies to a cold device.
 * 2. **artist** — affinity with the profile's weighted artists, saturating at
 *    the weight of a single like.
 * 3. **genre** — affinity with the profile's weighted genres/categories, the
 *    best-matching key only (a track credited to four genres is not four times
 *    the taste).
 * 4. **language** — the selected languages from preferences. An absent language
 *    is a *non-bonus*, never a penalty: many provider rows carry none.
 * 5. **recency** — a penalty for a track the caller reports inside the recency
 *    window, weaker when the user completed it than when they skipped it.
 * 6. **played** — a hard penalty that ranks a track this radio already played
 *    below every eligible candidate.
 *
 * Determinism: no `Math.random` and no clock of its own (the instant arrives as
 * `now`, and what counts as recent is the caller's windowed verdict rather than
 * a re-read of the system time), scores rounded to four decimals, and ties
 * broken by ascending `track.id` — a total order, so the result depends on the
 * *set* of candidates rather than on the order they happened to arrive in.
 */

/** Points the provider's own quality score can contribute. */
export const QUALITY_WEIGHT = 40;

/**
 * The quality score assumed for a track that carries none. The provider's floor
 * (`server/music/score.ts` starts a surviving track at 40 and never returns less
 * than 0) is 0–100, so a middling 50 is the honest "unknown" value: a track with
 * no score is neither promoted nor buried, it simply cannot win on quality.
 *
 * Defined locally on purpose — this is client code and must not import
 * `@/server` (architecture rule), so it mirrors the server's range rather than
 * depending on it.
 */
export const DEFAULT_QUALITY_SCORE = 50;

/** Points the strongest possible artist affinity can contribute. */
export const ARTIST_AFFINITY_WEIGHT = 30;

/** Points the strongest possible genre/category affinity can contribute. */
export const GENRE_AFFINITY_WEIGHT = 12;

/** Points for a candidate whose language is one of the selected ones. */
export const LANGUAGE_AFFINITY_WEIGHT = 10;

/** Recency penalty for a track the user skipped inside the window. */
export const RECENCY_PENALTY_SKIPPED = 25;

/** Recency penalty for a track the user completed inside the window. */
export const RECENCY_PENALTY_COMPLETED = 8;

/** Recency penalty for a track played inside the window with no verdict recorded. */
export const RECENCY_PENALTY_UNKNOWN = 16;

/**
 * Hard penalty for a track this radio has already played. Sized well past the
 * whole achievable range (quality 40 + artist 30 + genre 12 + language 10 = 92
 * at most) so "played" is last place by construction rather than by a margin
 * that some future rule could outgrow.
 */
export const REPEAT_PENALTY = 1000;

/** Everything a ranking needs — all of it already on this device. */
export interface ScoreContext {
  /** The derived local profile. */
  profile: TasteProfile;
  /**
   * The ranking's reference instant, in epoch milliseconds. Required so one
   * evaluation has exactly one clock: no rule here reads the system clock, and
   * every age is measured from this instant.
   */
  now: number;
  /** Ids already played by this radio: a hard penalty, ranked last. */
  playedIds?: readonly string[];
  /**
   * How far back a play still counts as recent, in milliseconds. A non-positive
   * window disables the recency rule entirely.
   */
  recencyWindowMs: number;
  /**
   * The listener's recent plays, keyed by track id, with the instant of the play
   * and whether it was completed (`true`), skipped (`false`), or left unrecorded.
   *
   * The **timestamps** matter as much as the ids: recency is measured here, from
   * {@link ScoreContext.now}, so a caller cannot widen the window by leaving an
   * entry out, and a play older than the window takes no penalty at all rather
   * than an ungraded one.
   */
  playedRecently?: ReadonlyMap<string, { playedAt: number; completed?: boolean }>;
}

/** One ranked candidate: the track, its score, and the rules that fired. */
export interface ScoredTrack<T = Track> {
  track: T;
  score: number;
  /** Rule names, in the canonical order above (e.g. `"recency:completed"`). */
  reasons: string[];
}

/** Saturated affinity: one like's weight is full affinity; twice it is no more. */
function affinityOf(weight: number | undefined): number {
  if (weight === undefined || !Number.isFinite(weight) || weight <= 0) return 0;
  return Math.min(1, weight / LIKE_WEIGHT);
}

/** The provider's 0–100 score, clamped, or the documented default. */
function qualityOf(track: Track): { value: number; defaulted: boolean } {
  const raw = track.qualityScore;
  if (raw === undefined || !Number.isFinite(raw)) {
    return { value: DEFAULT_QUALITY_SCORE, defaulted: true };
  }
  return { value: Math.min(100, Math.max(0, raw)), defaulted: false };
}

/** Language code in the same normalized form the profile stores. */
function normalizedLanguage(track: Track): string | null {
  const value = track.language?.trim().toLowerCase();
  return value === undefined || value === "" ? null : value;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Affinity summed over this track's artist credits, capped at full affinity. */
function artistAffinity(track: Track, profile: TasteProfile): number {
  let total = 0;
  for (const artist of track.artists) {
    const key = artistKeyOf(artist);
    if (key === "") continue;
    const entry = profile.artists.find((candidate) => candidate.key === key);
    if (entry !== undefined) total += affinityOf(entry.weight);
  }
  return Math.min(1, total);
}

/** Strongest affinity among this track's inferred genre/category keys. */
function genreAffinity(track: Track, profile: TasteProfile): number {
  let best = 0;
  for (const key of genreKeysOf(track)) {
    const entry = profile.genres.find((candidate) => candidate.key === key);
    if (entry !== undefined) best = Math.max(best, affinityOf(entry.weight));
  }
  return best;
}

/**
 * Score one candidate. Rules are applied in the canonical order so the reported
 * `reasons` list is itself a stable, testable artifact for a future explainable
 * UI — and so a failed ranking can be read back rule by rule.
 */
function scoreOne(track: Track, context: ScoreContext, played: ReadonlySet<string>): ScoredTrack {
  const reasons: string[] = [];
  let score = 0;

  // 1. Quality floor — the only rule that fires for a track the profile knows
  //    nothing about, which is what keeps a cold device ranking sensibly.
  const quality = qualityOf(track);
  score += (quality.value / 100) * QUALITY_WEIGHT;
  reasons.push(quality.defaulted ? "quality:default" : "quality");

  // 2. Artist affinity — summed over the credits (a collaboration earns credit
  //    for both artists), capped at full affinity.
  const artists = artistAffinity(track, context.profile);
  if (artists > 0) {
    score += artists * ARTIST_AFFINITY_WEIGHT;
    reasons.push("artist");
  }

  // 3. Genre/category affinity.
  const genres = genreAffinity(track, context.profile);
  if (genres > 0) {
    score += genres * GENRE_AFFINITY_WEIGHT;
    reasons.push("genre");
  }

  // 4. Language affinity from the selected languages.
  const language = normalizedLanguage(track);
  if (language !== null && context.profile.languages.includes(language)) {
    score += LANGUAGE_AFFINITY_WEIGHT;
    reasons.push("language");
  }

  // 5/6. Recency, then the hard repeat penalty. A track this radio already
  //    played is reported as played only: the recency verdict is implied by the
  //    radio having played it at all.
  if (played.has(track.id)) {
    score -= REPEAT_PENALTY;
    reasons.push("played");
  } else if (context.recencyWindowMs > 0) {
    const playedRecently = context.playedRecently;
    if (playedRecently !== undefined) {
      const lastPlayed = playedRecently.get(track.id);
      if (lastPlayed !== undefined) {
        // The clock belongs to the scorer, not the caller: a play is "recent"
        // when it falls inside the window measured from this evaluation, so a
        // caller cannot widen the window by omitting an entry.
        const age = context.now - lastPlayed.playedAt;
        if (age >= 0 && age < context.recencyWindowMs) {
          // A completed play is penalized less than a skipped one, and the
          // penalty fades as the play ages toward the window's edge.
          const base =
            lastPlayed.completed === true
              ? RECENCY_PENALTY_COMPLETED
              : lastPlayed.completed === false
                ? RECENCY_PENALTY_SKIPPED
                : RECENCY_PENALTY_UNKNOWN;
          const freshness = 1 - age / context.recencyWindowMs;
          score -= round4(base * (0.5 + 0.5 * freshness));
          reasons.push(
            lastPlayed.completed === true
              ? "recency:completed"
              : lastPlayed.completed === false
                ? "recency:skipped"
                : "recency:unknown",
          );
        }
      }
    }
  }

  return { track, score: round4(score), reasons };
}

/**
 * Rank `candidates` against the local profile.
 *
 * The same candidates, profile, and clock always produce the same order. A
 * candidate already played is still *returned* — ranked last — so the caller
 * decides whether to drop it (the refill engine does, and re-filters whatever
 * the provider returned regardless; design §3).
 */
export function scoreCandidates<T extends Track>(
  candidates: readonly T[],
  context: ScoreContext,
): ScoredTrack<T>[] {
  const played = new Set(context.playedIds ?? []);
  const scored = candidates.map((track) => scoreOne(track, context, played) as ScoredTrack<T>);
  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Total order: identical scores fall back to the canonical id, so the result
    // is a function of the candidate set and not of the order it arrived in.
    if (a.track.id === b.track.id) return 0;
    return a.track.id < b.track.id ? -1 : 1;
  });
}
