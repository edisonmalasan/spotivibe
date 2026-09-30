import type {
  Artwork,
  CachedMetadataRecord,
  LikedTrackRecord,
  ListeningEventRecord,
  MixRecord,
  NewListeningEvent,
  NewMix,
  PlaylistRecord,
  Preferences,
  SearchEntryRecord,
  SessionRecord,
  SessionSnapshot,
  Track,
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
  /**
   * M11: write the *measurements* of an already-recorded event — the seconds it
   * actually played for and whether the engine reported it ended.
   *
   * A patch, not a verdict: classification is a read-time policy over these raw
   * numbers, so the recorder can fill them in when a track step ends without any
   * stored interpretation of them. An unknown id resolves to `undefined`.
   */
  update(
    id: string,
    patch: { secondsPlayed?: number; completed?: boolean },
  ): Promise<ListeningEventRecord | undefined>;
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
  /** Remove one entry by raw query (normalized internally); unknown/empty is a no-op. */
  remove(query: string): Promise<void>;
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

/**
 * Locally generated Smart Mixes (M11 dataset 8).
 *
 * A mix is derived data, but it is *user-visible derived data* — a name the
 * listener recognizes — so it is persisted and exported like a playlist, and can
 * always be regenerated from the profile if the listener would rather drop it.
 */
export interface MixesRepository {
  /** Create a mix; re-creating an existing `id` replaces it. */
  create(mix: NewMix): Promise<MixRecord>;
  /** Replace a mix's contents, keeping its identity and name; bumps `updatedAt`. */
  refresh(
    id: string,
    patch: { tracks: Track[]; seeds: string[]; period: string },
  ): Promise<MixRecord | undefined>;
  get(id: string): Promise<MixRecord | undefined>;
  /** Mixes newest-generation first. */
  list(): Promise<MixRecord[]>;
  remove(id: string): Promise<void>;
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
  mixes: MixesRepository;
}

export * from "./types";
export * from "./errors";
export * from "./renderable";
