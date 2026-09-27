import type {
  CachedMetadataRecord,
  LikedTrackRecord,
  ListeningEventRecord,
  NewListeningEvent,
  PlaylistRecord,
  Preferences,
  SearchEntryRecord,
  SessionRecord,
  SessionSnapshot,
  Track,
  Artwork,
} from "./types";

/**
 * Repository interfaces — the only data-access surface feature code may use.
 * Components and routes never touch IndexedDB directly; the IndexedDB
 * implementation lives behind these contracts (AGENTS.md architecture rules).
 */

/** Liked tracks (ROADMAP M2 dataset 1). */
export interface LikedTracksRepository {
  /** Like a track; re-liking an already-liked track refreshes `likedAt`. */
  like(track: Track, likedAt?: number): Promise<LikedTrackRecord>;
  unlike(trackId: string): Promise<void>;
  isLiked(trackId: string): Promise<boolean>;
  get(trackId: string): Promise<LikedTrackRecord | undefined>;
  /** All liked records, most recently liked first. */
  list(): Promise<LikedTrackRecord[]>;
  clear(): Promise<void>;
}

/** Playlists including ordered track membership (M2 datasets 2 + 3). */
export interface PlaylistsRepository {
  create(input: {
    name: string;
    description?: string;
    artwork?: Artwork[];
  }): Promise<PlaylistRecord>;
  update(id: string, patch: { name?: string; description?: string }): Promise<PlaylistRecord>;
  remove(id: string): Promise<void>;
  get(id: string): Promise<PlaylistRecord | undefined>;
  /** All playlists, most recently updated first. */
  list(): Promise<PlaylistRecord[]>;
  /** Append (default) or insert at `position`; bumps `updatedAt`. */
  addTrack(playlistId: string, track: Track, position?: number): Promise<PlaylistRecord>;
  /** Remove the first entry matching `trackId`; bumps `updatedAt`. */
  removeTrack(playlistId: string, trackId: string): Promise<PlaylistRecord>;
  /** Move the entry at `fromIndex` to `toIndex`; bumps `updatedAt`. */
  reorderTrack(playlistId: string, fromIndex: number, toIndex: number): Promise<PlaylistRecord>;
  clear(): Promise<void>;
}

/** Listening history (M2 dataset 4). */
export interface ListeningHistoryRepository {
  /** Record an event; generates the event UUID when `id` is not provided. */
  record(event: NewListeningEvent): Promise<ListeningEventRecord>;
  /** Events newest-first; `limit` caps the number returned. */
  list(limit?: number): Promise<ListeningEventRecord[]>;
  clear(): Promise<void>;
}

/** Search history (M2 dataset 5). */
export interface SearchHistoryRepository {
  /** Record a query; re-searching the same normalized query refreshes its time. */
  record(query: string): Promise<SearchEntryRecord>;
  /** Entries newest-first; `limit` caps the number returned. */
  list(limit?: number): Promise<SearchEntryRecord[]>;
  clear(): Promise<void>;
}

/** Preferences/languages (M2 dataset 6); `get` merges stored values over defaults. */
export interface PreferencesRepository {
  get(): Promise<Preferences>;
  /** Shallow-merge a patch over the stored preferences. */
  set(patch: Partial<Preferences>): Promise<Preferences>;
}

/** Persisted queue/session (M2 dataset 7); consumed by M6. */
export interface SessionRepository {
  /** `null` when no session has been persisted yet. */
  get(): Promise<SessionRecord | null>;
  /** Persist the snapshot; the repository stamps `id` and `updatedAt`. */
  set(snapshot: SessionSnapshot): Promise<SessionRecord>;
  clear(): Promise<void>;
}

/** Cached metadata (M2 dataset 8); derived data, excluded from backups. */
export interface MetadataCacheRepository {
  get(providerId: string): Promise<CachedMetadataRecord | undefined>;
  put(track: Track): Promise<void>;
  putMany(tracks: Track[]): Promise<void>;
  list(): Promise<CachedMetadataRecord[]>;
  clear(): Promise<void>;
}

/** Every repository the data layer exposes, grouped for one-stop access. */
export interface Repositories {
  likedTracks: LikedTracksRepository;
  playlists: PlaylistsRepository;
  listeningHistory: ListeningHistoryRepository;
  searchHistory: SearchHistoryRepository;
  preferences: PreferencesRepository;
  session: SessionRepository;
  metadataCache: MetadataCacheRepository;
}

export * from "./types";
export * from "./errors";
