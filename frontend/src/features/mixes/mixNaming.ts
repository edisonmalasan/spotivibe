import type { Track } from "@/data/repositories";
import { genreKeysOf, type TasteProfile } from "@/features/personalization/tasteProfile";

/**
 * Smart Mix naming (M11; spec: `mixes` — "Mix identity and naming", design
 * decision 4).
 *
 * The name states the mix's **strongest local signal** and nothing else: the
 * artist it contains most, else its leading genre, else a neutral local label. It
 * is a label, not a claim — no "top", "best", "essential", or any word that would
 * read as a ranking or an editorial selection, which is the same rule the M9
 * discovery copy follows.
 *
 * Pure and deterministic: the same mix always yields the same name, so a
 * refresh cannot silently rename something the listener has learned to
 * recognize.
 */

/** Neutral, explicitly local label for a mix with no dominant signal. */
export const NEUTRAL_MIX_NAME = "On-device mix";

/** Words a mix name must never contain: they imply a ranking we did not compute. */
const CLAIM_WORDS = [
  "best",
  "top",
  "essential",
  "greatest",
  "all-time",
  "chart",
  // Covers "editorial", "editor's", and "editors" from one root.
  "editor",
  "featured",
  "prime",
] as const;

/** How strongly an artist must lead before the name uses it. */
const ARTIST_NAME_SHARE = 0.5;

export interface NameInput {
  tracks: readonly Track[];
  /** The local profile, for its genre weights when no artist dominates. */
  profile: TasteProfile;
}

/** The artist credited on the most tracks, and its share of the mix. */
function dominantArtist(tracks: readonly Track[]): { name: string; share: number } | null {
  if (tracks.length === 0) return null;
  const counts = new Map<string, { name: string; count: number }>();
  for (const track of tracks) {
    // Only the *first* credit counts: a track's supporting artists would
    // otherwise out-vote the one the listener actually came for.
    const artist = track.artists[0];
    if (artist === undefined || artist.name.trim() === "") continue;
    const existing = counts.get(artist.name);
    if (existing === undefined) {
      counts.set(artist.name, { name: artist.name, count: 1 });
    } else {
      existing.count += 1;
    }
  }
  let best: { name: string; count: number } | null = null;
  for (const entry of counts.values()) {
    // Ties break on name so two equally-present artists always name the same mix.
    if (
      best === null ||
      entry.count > best.count ||
      (entry.count === best.count && entry.name < best.name)
    ) {
      best = entry;
    }
  }
  if (best === null) return null;
  return { name: best.name, share: best.count / tracks.length };
}

/** The profile's leading genre that the mix's own tracks actually support. */
function leadingGenre(tracks: readonly Track[], profile: TasteProfile): string | null {
  if (tracks.length === 0) return null;
  const weights = new Map(profile.genres.map((entry) => [entry.key, entry.weight]));
  const present = new Map<string, number>();
  for (const track of tracks) {
    for (const key of genreKeysOf(track)) {
      present.set(key, (present.get(key) ?? 0) + 1);
    }
  }
  let best: { key: string; score: number } | null = null;
  for (const [key, count] of present) {
    // A genre the listener is known to like outranks one that merely appears
    // often; a genre they have no signal for can still name a mix.
    const score = count * (1 + (weights.get(key) ?? 0));
    if (best === null || score > best.score || (score === best.score && key < best.key)) {
      best = { key, score };
    }
  }
  return best === null ? null : titleCase(best.key);
}

/**
 * A readable label for a lowercase lexicon key: `"k-pop"` → `"K-Pop"`,
 * `"neon soul"` → `"Neon Soul"`. Only the first letter of each space/hyphen
 * segment is touched, so acronyms and symbol-bearing keys (`"r&b"`) survive
 * instead of being reshaped into something the lexicon never said.
 */
function titleCase(key: string): string {
  return key.replace(/(^|[\s-])([a-z])/gu, (_match, separator: string, letter: string) => {
    return separator + letter.toUpperCase();
  });
}

/**
 * Whether a name is honest for a locally generated mix: non-empty and free of
 * any ranking or editorial claim.
 */
export function isHonestMixName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === "") return false;
  const haystack = trimmed.toLowerCase();
  return !CLAIM_WORDS.some((word) => haystack.includes(word));
}

/** The mix's name, from its strongest local signal. */
export function deriveMixName(input: NameInput): string {
  const artist = dominantArtist(input.tracks);
  if (artist !== null && artist.share >= ARTIST_NAME_SHARE) {
    return isHonestMixName(artist.name) ? artist.name : NEUTRAL_MIX_NAME;
  }
  const genre = leadingGenre(input.tracks, input.profile);
  if (genre !== null && isHonestMixName(genre)) {
    return `${genre} mix`;
  }
  return NEUTRAL_MIX_NAME;
}
