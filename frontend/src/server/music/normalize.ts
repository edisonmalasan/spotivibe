import type { AlbumSummary, Artwork, ArtistSummary, Track } from "@/data/repositories";
import type { ArtworkCandidate, PlaylistEntry, ProviderCandidate } from "./types";

/**
 * Shared normalization stage (design decision 1): every tier's candidates go
 * through the same conversions so behavior is identical regardless of tier.
 */

/** Source-scoped identity prefix: `Track.id = "youtube:<videoId>"` (ROADMAP §8.1). */
export const TRACK_ID_PREFIX = "youtube:";

/** Above this many seconds, a candidate without an explicit marker is a podcast. */
export const PODCAST_DURATION_THRESHOLD_S = 1200;

/**
 * Parse a clock-style duration text into seconds.
 *
 * @returns whole seconds for `M:SS` / `H:MM:SS`, or `0` when the text is not
 * a parsable duration. `0` means "the tier presented a duration but it is
 * invalid" — distinct from an absent duration (`undefined`), which the filter
 * stage treats more leniently (design decision 9).
 */
export function parseDurationText(text: string): number {
  const parts = text.trim().split(":").map(Number);
  if (parts.length !== 2 && parts.length !== 3) return 0;
  if (!parts.every((part) => Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

function area(candidate: ArtworkCandidate): number {
  return (candidate.width ?? 0) * (candidate.height ?? 0);
}

/**
 * Normalize artwork: dedupe by URL, largest first (source order for ties),
 * with the always-available `hqdefault` thumbnail as the documented fallback
 * when a tier provided none (reference parity: Lyrix's ytimg fallback).
 */
export function pickArtwork(candidates: ArtworkCandidate[], videoId: string): Artwork[] {
  const valid = candidates.filter((candidate) => candidate.url.length > 0);
  if (valid.length === 0) {
    return [{ url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }];
  }
  const sorted = [...valid].sort((a, b) => area(b) - area(a)); // stable: ties keep source order
  const seen = new Set<string>();
  const artwork: Artwork[] = [];
  for (const candidate of sorted) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    artwork.push({
      url: candidate.url,
      ...(candidate.width !== undefined ? { width: candidate.width } : {}),
      ...(candidate.height !== undefined ? { height: candidate.height } : {}),
    });
  }
  return artwork;
}

/**
 * Split a tier's artist text into artist summaries. Separators are `,`, `&`,
 * and `•` (the three the captured fixtures use); the channel id, when the
 * tier provided a single one, attaches to the first artist.
 */
export function splitArtists(artistText?: string, artistId?: string): ArtistSummary[] {
  if (!artistText) return [];
  const names = artistText
    .split(/[,&•]/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return names.map((name, index) =>
    index === 0 && artistId !== undefined ? { name, id: artistId } : { name },
  );
}

/**
 * Resolve the category: an explicit provider marker always wins; otherwise
 * the documented duration heuristic `> 1200s → podcast` (reference parity).
 * The heuristic can misclassify long music as podcast — accepted trade-off
 * recorded in design.md (category affects presentation, not playability).
 */
export function resolveCategory(
  hint: ProviderCandidate["categoryHint"],
  durationSeconds: number | undefined,
): Track["category"] {
  if (hint) return hint;
  if (durationSeconds !== undefined && durationSeconds > PODCAST_DURATION_THRESHOLD_S) {
    return "podcast";
  }
  return "music";
}

/**
 * Convert one candidate into the canonical `Track` shape (ROADMAP §8.1).
 *
 * `qualityScore` is intentionally left unset — it is assigned by the scoring
 * stage, which sees the whole result set plus the query.
 */
export function candidateToTrack(candidate: ProviderCandidate): Track {
  const album: AlbumSummary | undefined = candidate.albumTitle
    ? {
        ...(candidate.albumId !== undefined ? { id: candidate.albumId } : {}),
        title: candidate.albumTitle,
      }
    : undefined;

  return {
    id: `${TRACK_ID_PREFIX}${candidate.videoId}`,
    source: "youtube",
    providerId: candidate.videoId,
    title: candidate.title,
    artists: splitArtists(candidate.artistText, candidate.artistId),
    ...(album !== undefined ? { album } : {}),
    artwork: pickArtwork(candidate.artwork, candidate.videoId),
    durationSeconds: candidate.durationSeconds,
    category: resolveCategory(candidate.categoryHint, candidate.durationSeconds),
    capabilities: { stream: true, offlineDownload: false },
  };
}

/** Canonical tracks plus the count of source entries that could not become one. */
export interface FinalizedPlaylist {
  tracks: Track[];
  skipped: number;
}

/**
 * Canonicalize playlist entries (design decision 9) — deliberately NOT the
 * search pipeline: no junk filtering, no relevance scoring, no re-sorting.
 * An import must reproduce its source (user-chosen content), so:
 *
 * - `null` entries (unavailable/unnormalizable rows) are skipped **and
 *   counted**;
 * - duplicates by `providerId` keep the **first** occurrence (counted in
 *   neither direction — they resolved fine);
 * - source order is preserved exactly.
 */
export function finalizePlaylistEntries(entries: readonly PlaylistEntry[]): FinalizedPlaylist {
  let skipped = 0;
  const tracks: Track[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (entry === null) {
      skipped += 1;
      continue;
    }
    const track = candidateToTrack(entry);
    // Defensive: a candidate that cannot yield a resolvable track is skipped
    // and counted, never emitted half-formed.
    if (track.providerId.length === 0 || track.title.length === 0) {
      skipped += 1;
      continue;
    }
    if (seen.has(track.providerId)) continue;
    seen.add(track.providerId);
    tracks.push(track);
  }

  return { tracks, skipped };
}
