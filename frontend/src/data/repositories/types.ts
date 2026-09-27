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
};

export type RepeatMode = "off" | "context" | "track";

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
