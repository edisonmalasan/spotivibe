import type { ArtistSummary, ListeningEventRecord, Track } from "@/data/repositories";

/**
 * The local taste profile (M10 task 3.1; spec: `personalization` — "Local taste
 * profile"; design §4/§7).
 *
 * A **pure derivation** over the datasets the app already owns on the device:
 * the liked tracks (M7), the listening events including their completion and
 * skip flags (M8), and the selected languages (M8 preferences). It imports no
 * store, touches no network, and persists nothing: there is no second copy of
 * the data to keep in sync, so clearing a dataset changes the next profile by
 * construction (design §7) and "delete the data" is literally "delete the data"
 * (design §4).
 *
 * **Nothing here may leave the device.** The derived value is weights and public
 * text, and the only consumer is the **local** ranker: a radio or autofill request
 * carries the seed identity, the rotation index, the limit, and the exclusion list
 * — never a weight, a track id, a like, a history row, or a word derived from any
 * of them (spec `personalization` — "Ephemeral personalization, never a profile on
 * the wire").
 *
 * Pure and deterministic: the clock arrives as `now`, ties break on first
 * appearance, and the inputs are never mutated. Two runs over the same inputs
 * produce the same profile, which is what makes the ranking on top of it
 * reproducible.
 */

/** Weight of a like — the strongest single local signal. */
export const LIKE_WEIGHT = 8;
/** Weight of a play that ran to the end of the track. */
export const COMPLETED_PLAY_WEIGHT = 3;
/** Weight of a play that was neither completed nor explicitly skipped. */
export const PLAY_WEIGHT = 1;
/** Weight of a play the user skipped — a signal, but the weakest one. */
export const SKIP_WEIGHT = 0.25;

/**
 * Age at which a play counts half as much as the same play today. Two weeks
 * matches the unit the product already reasons in (a listening "session"), so a
 * track heard this morning outweighs one heard last month.
 */
export const RECENCY_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Floor of the recency decay. Old history is damped, never erased: a track from
 * last year still says something about taste, and a weight of exactly zero
 * would make a cleared-but-not-yet-damped entry indistinguishable from no
 * signal at all.
 */
export const RECENCY_DECAY_FLOOR = 0.25;

/** Per-term length cap on a seed term (mirrors the discovery bound). */
export const MAX_SEED_TERM_LENGTH = 60;

/** Bounds applied to a derived profile; overridable per call for tests. */
export interface TasteProfileLimits {
  /** Weighted artists kept, strongest first. */
  artists: number;
  /** Weighted genres/categories kept, strongest first. */
  genres: number;
  /** Recently played track ids kept, newest first. */
  recentTracks: number;
  /** Ephemeral seed terms kept. */
  seedTerms: number;
}

/**
 * The default bounds. Every one of them is a *local* bound: the profile is
 * derived from an in-memory store cap (`RECENT_HISTORY_LIMIT`) on every side,
 * so there is no scan growth and nothing to persist.
 */
export const TASTE_LIMITS: TasteProfileLimits = {
  artists: 10,
  genres: 8,
  recentTracks: 20,
  seedTerms: 4,
};

/** One weighted taste key: an artist identity or a genre name. */
export interface WeightedEntry {
  /** Stable key — an artist identity (see {@link artistKeyOf}) or a genre name. */
  key: string;
  /** Accumulated, recency-damped weight. Higher is stronger taste. */
  weight: number;
}

/** The derived profile: local taste as weights, ids, and a few text terms. */
export interface TasteProfile {
  /** Weighted artists, descending weight, ties on first appearance. */
  artists: WeightedEntry[];
  /** Weighted genres/categories, descending weight, ties on first appearance. */
  genres: WeightedEntry[];
  /** The selected language codes, normalized. */
  languages: string[];
  /** Recently played track ids, most recent first, bounded. */
  recentTrackIds: string[];
  /**
   * Ephemeral seed terms: public artist names and genre words, bounded and
   * derived. Text only — never uploaded as-is, never persisted, never joined to
   * a persistent identifier (spec: "Ephemeral seed terms").
   */
  seedTerms: string[];
  /**
   * False on a cold device: no liked track, no listening event, hence nothing to
   * personalize with. Languages are a *preference*, not a taste signal — a fresh
   * install already reads one default language, so counting them would make
   * `hasSignal` true for a device that has never played anything.
   */
  hasSignal: boolean;
}

/** Everything one derivation reads. All of it is already on the device. */
export interface TasteProfileInput {
  /** Liked tracks, newest-first (as `libraryStore` exposes them). */
  likedTracks: readonly Track[];
  /** Listening events, newest-first (as `historyStore` exposes them). */
  events: readonly ListeningEventRecord[];
  /** The selected language codes (as `preferencesStore` exposes them). */
  languages: readonly string[];
  /** Epoch milliseconds the recency decay is measured against. */
  now: number;
  /** Per-call bound overrides; anything omitted takes {@link TASTE_LIMITS}. */
  limits?: Partial<TasteProfileLimits>;
}

/**
 * Genre lexicon.
 *
 * YouTube Music normalization exposes no genre field (the canonical `Track` has
 * `category: "music" | "podcast"` and nothing else), so a genre is *inferred*
 * from a track's own public text — its title and album title — against this
 * small, explicit list. That is a low-confidence signal by construction, which
 * is exactly why the scorer weights it far below artist affinity and why a miss
 * costs nothing (the rules are additive).
 *
 * Kept deliberately short and readable: this is a taste hint, not a classifier.
 */
const GENRE_TERMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bhip[\s-]?hop\b|\brap\b/, "hip-hop"],
  [/\br\s*&\s*b\b|\br\s?n\s*b\b/, "r&b"],
  [/\bneon[\s-]?soul\b/, "neon soul"],
  [/\bsoul\b/, "soul"],
  [/\bfunk\b/, "funk"],
  [/\bdisco\b/, "disco"],
  [/\bjazz\b/, "jazz"],
  [/\bblues\b|\bbluegrass\b/, "blues"],
  [/\bclassic[\s-]?rock\b|\bhard[\s-]?rock\b/, "classic rock"],
  [/\bheavy[\s-]?metal\b|\bdeath[\s-]?metal\b|\bthrash[\s-]?metal\b/, "metal"],
  [/\bmetal\b/, "metal"],
  [/\bpunk\b/, "punk"],
  [/\bindie\b|\bindie[\s-]?rock\b/, "indie"],
  [/\balternative\b|\balt[\s-]?rock\b/, "alternative"],
  [/\bpop\b/, "pop"],
  [/\belectronic\b|\bedm\b|\btechno\b|\bsynthwave\b/, "electronic"],
  [/\bhouse\b/, "house"],
  [/\btrance\b/, "trance"],
  [/\bdubstep\b/, "dubstep"],
  [/\bambient\b/, "ambient"],
  [/\bclassical\b|\borchestra\b|\bsymphony\b/, "classical"],
  [/\bopera\b/, "opera"],
  [/\bcountry\b/, "country"],
  [/\bfolk\b/, "folk"],
  [/\breggae\b/, "reggae"],
  [/\blatin\b|\bsalsa\b|\bbachata\b|\bcumbia\b/, "latin"],
  [/\bafrobeat/, "afrobeats"],
  [/\bgospel\b/, "gospel"],
  [/\bk[\s-]?pop\b/, "k-pop"],
  [/\bnew[\s-]?age\b/, "new age"],
  [/\bworld[\s-]?(?:music|beat)\b/, "world"],
];

/** The single category that is itself a taste key. */
const PODCAST_CATEGORY = "podcast";

/** Identity fallback for an artist with no provider id: trimmed, lowercased. */
function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The stable key an artist is weighted and looked up under: the provider artist
 * id when present, else the normalized name. The same rule `features/home/
 * localSeeds` and `features/recommendations/artists` use, so a track is never
 * credited to two identities because one source had an id and another did not.
 */
export function artistKeyOf(artist: ArtistSummary): string {
  const id = artist.id?.trim();
  if (id !== undefined && id.length > 0) return id;
  return normalizedName(artist.name);
}

/** Text a genre is read out of: the track's own public metadata. */
function genreSourceText(track: Track): string {
  return `${track.title} ${track.album?.title ?? ""}`.toLowerCase().replace(/\s+/gu, " ");
}

/**
 * The genre keys a track belongs to, derived from its own text plus its
 * category. Exported because the scorer infers the *same* keys on the candidate
 * side — one derivation, two directions, so a profile key can never miss its
 * own candidate. Order is stable (lexicon order, category last) and deduped.
 */
export function genreKeysOf(track: Track): string[] {
  const text = genreSourceText(track);
  const keys: string[] = [];
  for (const [pattern, key] of GENRE_TERMS) {
    if (!keys.includes(key) && pattern.test(text)) keys.push(key);
  }
  if (track.category === PODCAST_CATEGORY && !keys.includes(PODCAST_CATEGORY)) {
    keys.push(PODCAST_CATEGORY);
  }
  return keys;
}

/** A running total for one taste key. */
interface Accumulator {
  /** The key itself: an artist identity or a genre name. */
  key: string;
  weight: number;
  /** Signals folded in so far — the divisor of the diminishing return. */
  count: number;
  /** Index of the key's first appearance; the deterministic tiebreak. */
  order: number;
  /** Public text as the source first spelled it (an artist name). */
  label: string;
}

/**
 * Fold one signal into a key.
 *
 * Accumulation is **sub-linear**: the nth signal for the same key contributes
 * `weight / n`. Without it, a listener's 30 plays of one artist would
 * permanently outweigh the like that says more about them, and the profile
 * would track listening volume instead of taste.
 */
function accumulate(
  map: Map<string, Accumulator>,
  key: string,
  label: string,
  weight: number,
): void {
  const existing = map.get(key);
  if (existing === undefined) {
    map.set(key, { key, weight, count: 1, order: map.size, label });
    return;
  }
  existing.weight += weight / (existing.count + 1);
  existing.count += 1;
}

/**
 * How much of its original weight a play from `playedAt` still carries, given
 * the profile's `now`. Exponential half-life decay, floored: recent plays count
 * in full, old ones count for {@link RECENCY_DECAY_FLOOR} of themselves.
 */
export function recencyDecay(playedAt: number, now: number): number {
  const age = now - playedAt;
  if (!Number.isFinite(age) || age <= 0) return 1;
  return Math.max(RECENCY_DECAY_FLOOR, 0.5 ** (age / RECENCY_HALF_LIFE_MS));
}

/**
 * The weight one listening event earns. `completed` is checked first: a record
 * carrying both flags is malformed, and "played to the end" is the better
 * reading of it.
 */
export function eventWeight(event: ListeningEventRecord): number {
  if (event.completed === true) return COMPLETED_PLAY_WEIGHT;
  if (event.skipped === true) return SKIP_WEIGHT;
  return PLAY_WEIGHT;
}

/** Credit one track's artists and genres with `weight`. */
function credit(
  track: Track,
  weight: number,
  artists: Map<string, Accumulator>,
  genres: Map<string, Accumulator>,
): void {
  for (const artist of track.artists) {
    const key = artistKeyOf(artist);
    // A blank name and no id is missing metadata, not an artist called "".
    if (key.trim() === "") continue;
    accumulate(artists, key, artist.name.trim(), weight);
  }
  for (const key of genreKeysOf(track)) accumulate(genres, key, key, weight);
}

/** An accumulator map in rank order: strongest first, ties on first appearance. */
function byStrength(map: Map<string, Accumulator>): Accumulator[] {
  return [...map.values()].sort((a, b) => b.weight - a.weight || a.order - b.order);
}

/** The bounded, ranked view of an accumulator map. */
function ranked(map: Map<string, Accumulator>, limit: number): WeightedEntry[] {
  return byStrength(map)
    .slice(0, Math.max(0, limit))
    .map((entry) => ({ key: entry.key, weight: entry.weight }));
}

/** Language codes as the profile stores them: trimmed, lowercased, deduped. */
function normalizedLanguages(codes: readonly string[]): string[] {
  const result: string[] = [];
  for (const code of codes) {
    const value = normalizedName(code);
    if (value === "" || result.includes(value)) continue;
    result.push(value);
  }
  return result;
}

/** Trim, cap, and drop a term that would be blank — public text only. */
function usableTerm(raw: string): string | null {
  const term = raw.trim().slice(0, MAX_SEED_TERM_LENGTH).trim();
  return term === "" ? null : term;
}

/**
 * Derive the profile from the local datasets.
 *
 * Likes are credited in full (a like has no recency term in this contract: the
 * caller hands over `Track[]`, not `LikedTrackRecord[]`, so there is no
 * `likedAt` to decay against and inventing one would be a guess). Plays are
 * credited at {@link eventWeight} × {@link recencyDecay}. Everything is
 * returned bounded, ranked, and newest-first where recency is the point.
 */
export function buildTasteProfile(input: TasteProfileInput): TasteProfile {
  const limits = { ...TASTE_LIMITS, ...input.limits };
  const artists = new Map<string, Accumulator>();
  const genres = new Map<string, Accumulator>();

  for (const track of input.likedTracks) credit(track, LIKE_WEIGHT, artists, genres);
  for (const event of input.events) {
    credit(
      event.track,
      eventWeight(event) * recencyDecay(event.playedAt, input.now),
      artists,
      genres,
    );
  }

  // Most recent first; an exact timestamp tie breaks on the event id so the
  // order never depends on the order the repository happened to return.
  const ordered = [...input.events].sort(
    (a, b) => b.playedAt - a.playedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const recentTrackIds: string[] = [];
  const seenTrackIds = new Set<string>();
  for (const event of ordered) {
    if (recentTrackIds.length >= Math.max(0, limits.recentTracks)) break;
    if (seenTrackIds.has(event.trackId)) continue;
    seenTrackIds.add(event.trackId);
    recentTrackIds.push(event.trackId);
  }

  // Public text only, strongest signal first. The labels are what a request may
  // carry, so a term is trimmed, length-capped, and deduped here once.
  const seedTerms: string[] = [];
  const seenTerms = new Set<string>();
  const termSources: Accumulator[] = [...byStrength(artists), ...byStrength(genres)];
  for (const source of termSources) {
    if (seedTerms.length >= Math.max(0, limits.seedTerms)) break;
    const term = usableTerm(source.label);
    if (term === null) continue;
    const fold = normalizedName(term);
    if (seenTerms.has(fold)) continue;
    seenTerms.add(fold);
    seedTerms.push(term);
  }

  return {
    artists: ranked(artists, limits.artists),
    genres: ranked(genres, limits.genres),
    languages: normalizedLanguages(input.languages),
    recentTrackIds,
    seedTerms,
    hasSignal: artists.size > 0 || genres.size > 0 || recentTrackIds.length > 0,
  };
}
