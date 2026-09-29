import type { ListeningEventRecord, Track } from "@/data/repositories";
import { MAX_DISCOVERY_SEEDS, MAX_SEED_LENGTH } from "@/features/home/discoveryApi";

/**
 * Local taste seeds for the locally informed Home shelves (spec: `discovery` —
 * "Local-only personalization inputs"; design §2/§8).
 *
 * The derived value is a short list of *artist names* — the only taste signal a
 * discovery request is allowed to carry (design §2: the request carries the feed
 * kind, the selected language codes, and short seed terms, nothing else). No
 * track object, track id, like, playlist, or history row is ever returned here,
 * so there is nothing for a caller to leak into a request by accident.
 *
 * Pure and deterministic: likes and plays are counted per artist identity (the
 * provider id when present, else the normalized name — the same identity rule
 * `features/recommendations/artists` uses), ties break on first appearance, and
 * the inputs are never mutated.
 */

/** How recently-played cards a shelf shows by default. */
export const RECENT_LIMIT = 10;

/** How many artist names a seed list may carry (the endpoint's own cap). */
export const MAX_SEED_TERMS = MAX_DISCOVERY_SEEDS;

/** Per-term length cap, mirroring the discovery endpoint's bound. */
export const MAX_TERM_LENGTH = MAX_SEED_LENGTH;

/** Local listening/like inputs a seed list is derived from. */
export interface LocalTaste {
  /** Liked tracks, newest-first (as `libraryStore` exposes them). */
  readonly likedTracks: readonly Track[];
  /** Listening events, newest-first (as `historyStore` exposes them). */
  readonly events: readonly ListeningEventRecord[];
}

/** One artist with the local signal that earned it a place in the seeds. */
interface ArtistSignal {
  /** Stable derived identity: provider artist id, else the normalized name. */
  readonly identity: string;
  /** Display name as the provider spelled it the first time. */
  readonly name: string;
  /** Liked tracks by this artist. */
  likes: number;
  /** Listening events for this artist's tracks. */
  plays: number;
  /** Index of this artist's first appearance — the deterministic tiebreak. */
  firstSeen: number;
}

/** Identity fallback for a provider artist with no id: trimmed, lowercased. */
function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Count the local signal per artist. The first artist summary of each track is
 * the artist, matching the grouping rule the Popular Artists shelf uses, so the
 * same track can never be credited to two identities.
 */
function collectSignals(taste: LocalTaste): Map<string, ArtistSignal> {
  const byIdentity = new Map<string, ArtistSignal>();
  let order = 0;

  function record(track: Track, kind: "like" | "play"): void {
    const artist = track.artists[0];
    if (artist === undefined) return;
    const identity = artist.id ?? normalizedName(artist.name);
    // A blank name and no id is no artist metadata, not an artist called "".
    if (identity.trim() === "") return;

    const existing = byIdentity.get(identity);
    if (existing === undefined) {
      byIdentity.set(identity, {
        identity,
        name: artist.name,
        likes: kind === "like" ? 1 : 0,
        plays: kind === "play" ? 1 : 0,
        firstSeen: order++,
      });
      return;
    }
    if (kind === "like") existing.likes += 1;
    else existing.plays += 1;
  }

  for (const track of taste.likedTracks) record(track, "like");
  for (const event of taste.events) record(event.track, "play");

  return byIdentity;
}

/**
 * Rank the locally known artists by total local signal (likes + plays),
 * strongest first, ties broken by first appearance so the order is stable
 * across renders for the same local data.
 */
function rankedArtists(taste: LocalTaste): ArtistSignal[] {
  return [...collectSignals(taste).values()].sort(
    (a, b) => b.likes + b.plays - (a.likes + a.plays) || a.firstSeen - b.firstSeen,
  );
}

/**
 * Derive the short taste terms a locally informed shelf seeds from.
 *
 * Returns at most {@link MAX_SEED_TERMS} artist *names*, each trimmed and capped
 * at {@link MAX_TERM_LENGTH} characters, deduped case-insensitively and
 * therefore never containing a track id, a like, a playlist, or a history row.
 * The strongest signal comes first; a name that would be blank after trimming
 * is skipped rather than sent as an empty term.
 */
export function deriveSeedTerms(taste: LocalTaste): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const artist of rankedArtists(taste)) {
    if (terms.length === MAX_SEED_TERMS) break;
    const term = artist.name.trim().slice(0, MAX_TERM_LENGTH);
    const identity = normalizedName(term);
    if (term === "" || seen.has(identity)) continue;
    seen.add(identity);
    terms.push(term);
  }

  return terms;
}

/**
 * How many distinct artists the local data knows about. This is the Smart Mixes
 * gate (design §9: a mix shelf needs at least three distinct locally known
 * artists), and it is the honest "is there any local signal at all" question.
 */
export function countLocalArtists(taste: LocalTaste): number {
  return collectSignals(taste).size;
}

/**
 * Recently played tracks, newest-first and deduped by `trackId`: the first
 * (newest) event for a track wins, so replaying a track moves it to the front
 * rather than listing it twice. Capped at `limit`; the input is not mutated.
 */
export function recentlyPlayedTracks(
  events: readonly ListeningEventRecord[],
  limit = RECENT_LIMIT,
): Track[] {
  const seen = new Set<string>();
  const tracks: Track[] = [];

  for (const event of events) {
    if (tracks.length === limit) break;
    if (seen.has(event.trackId)) continue;
    seen.add(event.trackId);
    tracks.push(event.track);
  }

  return tracks;
}
