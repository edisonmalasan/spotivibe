/**
 * Persisted record types for Spotivibe's local-first data layer.
 *
 * Shapes follow ROADMAP.md §8 (Canonical Data Models): Track §8.1, Playlist
 * §8.2, ListeningEvent §8.3, Preferences §8.4. All timestamps are epoch
 * milliseconds (number). These types are the contract shared by the IndexedDB
 * implementation, the backup serializer/validator, and feature code — nothing
 * here imports storage or framework concerns.
 */

/** Only YouTube exists as a provider today (ROADMAP §8.1). */
export type TrackSource = "youtube";

export interface ArtistSummary {
  id?: string;
  name: string;
}

export interface AlbumSummary {
  id?: string;
  title: string;
}

export interface Artwork {
  url: string;
  width?: number;
  height?: number;
}

export interface TrackCapabilities {
  stream: boolean;
  /** Must remain false for YouTube-sourced tracks (ROADMAP §8.1 rules). */
  offlineDownload: boolean;
}

/** Canonical Track (ROADMAP §8.1) as stored inside local datasets. */
export interface Track {
  /** Stable Spotivibe/provider-scoped ID; the identity used for dedupe. */
  id: string;
  source: TrackSource;
  /** Playback identifier — the YouTube video ID. */
  providerId: string;
  title: string;
  artists: ArtistSummary[];
  album?: AlbumSummary;
  artwork: Artwork[];
  durationSeconds?: number;
  category: "music" | "podcast";
  explicit?: boolean;
  qualityScore?: number;
  language?: string;
  capabilities: TrackCapabilities;
}

/** Liked-track record; `trackId` is the store key and merge dedupe key. */
export interface LikedTrackRecord {
  trackId: string;
  track: Track;
  /** When the track was liked (newer timestamp wins on merge conflict). */
  likedAt: number;
}

/** One entry of a playlist's ordered track list; array order IS the order. */
export interface PlaylistTrackEntry {
  track: Track;
  addedAt: number;
}

/** Local-only playlist (ROADMAP §8.2). */
export interface PlaylistRecord {
  id: string;
  name: string;
  description?: string;
  artwork?: Artwork[];
  createdAt: number;
  /** Bumped on any change; newer timestamp wins on merge conflict. */
  updatedAt: number;
  tracks: PlaylistTrackEntry[];
}

/** Where a listening event originated (ROADMAP §8.3 "source context"). */
export type ListeningContext =
  "search" | "home" | "playlist" | "album" | "artist" | "queue" | "radio" | "library" | "other";

/** Listening-history event (ROADMAP §8.3). `id` is the merge dedupe key. */
export interface ListeningEventRecord {
  /** Event UUID — stable across export/import so merges converge. */
  id: string;
  trackId: string;
  track: Track;
  playedAt: number;
  secondsPlayed: number;
  completed?: boolean;
  skipped?: boolean;
  context: ListeningContext;
}

/** Input for creating a history event; the repository assigns `id` if absent. */
export type NewListeningEvent = Omit<ListeningEventRecord, "id"> & {
  id?: string;
};

/** Search-history entry; `normalizedQuery` is the store key and dedupe key. */
export interface SearchEntryRecord {
  /** Original query text as typed. */
  query: string;
  /** Trimmed + lowercased form used as the identity key. */
  normalizedQuery: string;
  /** Most recent search time wins on merge conflict. */
  searchedAt: number;
}

/** Local-only preferences (ROADMAP §8.4). */
export interface Preferences {
  /** Selected content languages. */
  languages: string[];
  /** Playback preference: advance to the next track automatically. */
  autoplayNext: boolean;
  /** UI/accessibility preference: honor reduced-motion requests. */
  reduceMotion: boolean;
  /** Onboarding completion flag. */
  onboardingComplete: boolean;
  /**
   * Playback preference (M10, spec `radio` — "Queue autofill"; design §6): let
   * an ordinary queue be topped up with more tracks before it runs out.
   *
   * **Default on**, and the only setting radio behaviour has: autofill spends
   * provider requests on the user's behalf, so it must be switchable; a radio
   * only ever starts from an explicit "Start … radio" gesture, so it is never
   * automatic and needs no opt-out.
   */
  autofillQueue: boolean;
}

/** Preferences store record (keyPath `id`). */
export interface PreferencesRecord extends Preferences {
  id: "app";
}

export const DEFAULT_PREFERENCES: Preferences = {
  languages: [],
  autoplayNext: true,
  reduceMotion: false,
  onboardingComplete: false,
  autofillQueue: true,
};

export type RepeatMode = "off" | "context" | "track";

/**
 * Where the current queue context came from (M6 queue surface label).
 *
 * `radio` (M10) is a *mode of the one queue* (design §1), not a second player:
 * the tracks live in this same store, so an existing entry and a radio-refilled
 * one are the same kind of thing and every queue surface works on day one.
 */
export type QueueSource = "search" | "browse" | "library" | "queue" | "radio" | "unknown";

/** One played entry on the bounded queue-history stack (M6 bookkeeping). */
export interface QueueHistoryEntry {
  track: Track;
  /** Epoch milliseconds when the entry finished (or was skipped). */
  playedAt: number;
}

/** Queue/session fields persisted without the single-record bookkeeping. */
export interface SessionSnapshot {
  queue: Track[];
  /** Index of the current track within `queue` (-1 when the queue is empty). */
  queueIndex: number;
  /** Playback position inside the current track, in seconds. */
  positionSeconds: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  /** 0..1 */
  volume: number;
  /** Bounded played-history stack (optional — pre-M6 snapshots omit it). */
  history?: QueueHistoryEntry[];
  /** Traversal order over `queue` indices (optional — pre-M6 snapshots omit it). */
  playOrder?: number[];
  /** Queue source label (optional - pre-M6 snapshots omit it). */
  source?: QueueSource;
  /**
   * The active radio's identity and rotation counter (optional - pre-M10
   * snapshots omit it).
   *
   * A radio is a *mode of this queue*, so its identity has to travel with the
   * queue: without it a reload brings back a queue still labelled "From radio"
   * while nothing knows which radio it is, and the next refill quietly degrades
   * to ordinary autofill. A track radio persists only the seed's id — the track
   * itself is already in `queue`, so a second copy would be a second copy of
   * data the app owns.
   */
  radio?: RadioSnapshot;
}

/**
 * A radio identity in the shape it can be **persisted** in.
 *
 * A track radio persists the seed's *id*, not the whole track: the queue is
 * already persisted, so the seed can be resolved back out of it on load, and
 * storing a second copy of a track would be a second copy of data the app owns.
 */
export type RadioSeedSnapshot =
  | { kind: "track"; trackId: string; title: string; artist?: string }
  | { kind: "artist"; id?: string; name: string };

/** A persistable radio: who it is, and how far its seed rotation has got. */
export interface RadioSnapshot {
  seed: RadioSeedSnapshot;
  variant: number;
}

/** Persisted queue/session record (keyPath `id`); consumed by M6. */
export interface SessionRecord extends SessionSnapshot {
  id: "app";
  updatedAt: number;
}

/** Cached track metadata (keyPath `providerId`); derived data, never exported. */
export interface CachedMetadataRecord {
  providerId: string;
  track: Track;
  cachedAt: number;
}
