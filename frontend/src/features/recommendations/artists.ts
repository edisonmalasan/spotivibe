import type { Artwork, Track } from "@/data/repositories";

/**
 * Artist grouping for the Popular Artists shelf (spec: `discovery` — "Popular
 * artists shelf"; design §7).
 *
 * Providers expose no artist endpoint, so the shelf is derived from the same
 * discovery results the square shelves render: group by canonical artist
 * identity, one entry per artist, in first-appearance order. Pure data in, pure
 * entries out — no repository, no network, and no knowledge of how the feed was
 * fetched.
 */

/** How many artists a shelf shows when the caller does not say (spec default). */
const DEFAULT_ARTIST_LIMIT = 10;

/**
 * One artist on the Popular Artists shelf. Activating an entry refines search
 * to `name` — M8 has no artist route (M9 owns artist pages).
 */
export interface ArtistEntry {
  /** Stable derived identity: the artist id when present, else the normalized name. */
  id: string;
  /** Display name as the provider spelled it on the artist's first track. */
  name: string;
  /** Best available artwork across this artist's tracks, if any track has one. */
  artworkUrl?: string;
  /** How many of the grouped tracks belong to this artist. */
  trackCount: number;
  /** The artist's first track by appearance — the entry's representative result. */
  sampleTrack: Track;
}

/** Identity fallback for a provider artist with no id: trimmed, lowercased. */
function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Best-resolution artwork entry (largest known width wins; the earliest entry
 * wins ties) — the same rule as `lib/playlistPresentation.ts`, reimplemented
 * here so a client feature never reaches into server code for a pure selection.
 */
function bestArtworkEntry(artwork: readonly Artwork[]): Artwork | undefined {
  let best: Artwork | undefined;
  for (const entry of artwork) {
    if (best === undefined || (entry.width ?? 0) > (best.width ?? 0)) {
      best = entry;
    }
  }
  return best;
}

/** An artist's first credited entry, or `undefined` when the track has no artist. */
function firstArtist(track: Track): { id: string; name: string } | undefined {
  const artist = track.artists[0];
  if (artist === undefined) return undefined;
  const id = artist.id ?? normalizedName(artist.name);
  // A blank name and no id is no artist metadata, not an artist called "".
  if (id === "") return undefined;
  return { id, name: artist.name };
}

/**
 * Derive one Popular Artists entry per artist from a shelf's tracks.
 *
 * Identity is the first `ArtistSummary` of each track: its provider id when it
 * has one, else its normalized name, so the same artist is listed once even
 * when many of the results are by them. Entries keep the order the artist first
 * appeared in the results, which makes the shelf deterministic and independent
 * of any scoring; `trackCount` counts that artist's tracks; and the artwork is
 * the best cover any of them offers, so an early track without artwork does not
 * cost the artist their picture.
 *
 * Tracks with no artist metadata are skipped, and `limit` (default 10) caps the
 * result. The input is never mutated.
 */
export function groupArtistsByIdentity(
  tracks: readonly Track[],
  limit = DEFAULT_ARTIST_LIMIT,
): ArtistEntry[] {
  const byIdentity = new Map<string, ArtistEntry>();
  // Running maximum of the known artwork width per artist, kept beside the
  // entry so "largest wins, earliest wins ties" can be evaluated against what
  // has been seen so far rather than against the sample track.
  const bestWidth = new Map<string, number>();

  for (const track of tracks) {
    const artist = firstArtist(track);
    if (artist === undefined) continue;

    const artwork = bestArtworkEntry(track.artwork);
    const width = artwork?.width ?? 0;
    const existing = byIdentity.get(artist.id);

    if (existing === undefined) {
      byIdentity.set(artist.id, {
        id: artist.id,
        name: artist.name,
        artworkUrl: artwork?.url,
        trackCount: 1,
        sampleTrack: track,
      });
      bestWidth.set(artist.id, width);
      continue;
    }

    existing.trackCount += 1;
    if (artwork !== undefined && width > (bestWidth.get(artist.id) ?? 0)) {
      existing.artworkUrl = artwork.url;
      bestWidth.set(artist.id, width);
    }
  }

  return [...byIdentity.values()].slice(0, limit);
}
