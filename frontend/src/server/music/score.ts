import type { Track } from "@/data/repositories";

/**
 * Quality scoring, duplicate collapse, and ordering (spec: centralized
 * filtering and quality scoring).
 *
 * The score is a deterministic 0–100 function of the track and the query —
 * no randomness, no per-tier branches, unit-testable in isolation (design
 * decision 9). Same rules for every tier.
 */

/** Base points every surviving track earns. */
const BASE_SCORE = 40;
/** Maximum points for query-token overlap. */
const QUERY_OVERLAP_MAX = 30;
/** Points per metadata signal present (duration / artwork / artist). */
const METADATA_POINTS = 10;
/** Points when the duration sits in the typical-song window (reference: 120–480s). */
const PLAUSIBLE_SONG_MAX = 15;
/** Points for a long-but-plausible duration (reference: up to 1h). */
const PLAUSIBLE_LONG = 8;
/** Penalty when no duration is available (design decision 9). */
const MISSING_DURATION_PENALTY = 20;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/** Normalize text for duplicate keys: lowercase, punctuation-stripped. */
export function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Deterministic 0–100 quality score: query-token overlap + metadata
 * completeness + duration plausibility, minus the missing-duration penalty.
 */
export function qualityScore(track: Track, query: string): number {
  let score = BASE_SCORE;

  const queryTokens = tokenize(query);
  if (queryTokens.length > 0) {
    const haystack = new Set(
      tokenize(`${track.title} ${track.artists.map((artist) => artist.name).join(" ")}`),
    );
    const matched = new Set(queryTokens.filter((token) => haystack.has(token)));
    score += Math.round((matched.size / queryTokens.length) * QUERY_OVERLAP_MAX);
  }

  const duration = track.durationSeconds;
  if (duration !== undefined) {
    score += METADATA_POINTS;
    if (duration >= 120 && duration <= 480) score += PLAUSIBLE_SONG_MAX;
    else if (duration > 480 && duration <= 3600) score += PLAUSIBLE_LONG;
  } else {
    score -= MISSING_DURATION_PENALTY;
  }
  if (track.artwork.length > 0) score += METADATA_POINTS;
  if (track.artists.length > 0) score += METADATA_POINTS;

  return Math.max(0, Math.min(100, score));
}

/** Assign `qualityScore` to every track (query-aware). */
export function scoreTracks(tracks: Track[], query: string): Track[] {
  return tracks.map((track) => ({ ...track, qualityScore: qualityScore(track, query) }));
}

/**
 * Duplicate key: normalized title + normalized first artist (spec: exact
 * duplicates collapse by video id; near-duplicates by normalized title plus
 * artist).
 */
export function nearDuplicateKey(track: Track): string {
  const firstArtist = track.artists[0]?.name ?? "";
  return `${normalizeForDedupe(track.title)}|${normalizeForDedupe(firstArtist)}`;
}

/**
 * Collapse exact duplicates (same `providerId`) and near-duplicates (same
 * normalized title + first artist). The first occurrence wins — callers pass
 * score-descending input so the best-scoring representative is kept. Order of
 * the survivors is unchanged.
 */
export function dedupeTracks(tracks: Track[]): Track[] {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const result: Track[] = [];
  for (const track of tracks) {
    if (seenIds.has(track.providerId)) continue;
    const key = nearDuplicateKey(track);
    if (seenKeys.has(key)) continue;
    seenIds.add(track.providerId);
    seenKeys.add(key);
    result.push(track);
  }
  return result;
}

/**
 * Stable descending sort by `qualityScore` (ties keep their input order —
 * JS `Array.prototype.sort` is stable).
 */
export function sortTracks(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));
}
