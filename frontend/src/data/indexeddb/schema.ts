/**
 * IndexedDB schema constants and store definitions (schema version 1).
 *
 * Store keys double as merge dedupe keys for backup import (design
 * Decision 2): liked tracks by track ID, playlists by playlist ID,
 * history events by event UUID, search history by normalized query,
 * preferences/session as single records, cache by provider ID.
 */

export const DATABASE_NAME = "spotivibe";
export const SCHEMA_VERSION = 1;

/** Store key for the single-record stores (preferences, session). */
export const SINGLE_RECORD_KEY = "app";

export const STORE = {
  likedTracks: "likedTracks",
  playlists: "playlists",
  listeningHistory: "listeningHistory",
  searchHistory: "searchHistory",
  preferences: "preferences",
  session: "session",
  metadataCache: "metadataCache",
} as const;

export interface StoreIndexDefinition {
  name: string;
  keyPath: string;
  options?: IDBIndexParameters;
}

export interface StoreDefinition {
  name: string;
  options: IDBObjectStoreParameters;
  indexes?: StoreIndexDefinition[];
}

export const STORE_DEFINITIONS: readonly StoreDefinition[] = [
  { name: STORE.likedTracks, options: { keyPath: "trackId" } },
  { name: STORE.playlists, options: { keyPath: "id" } },
  {
    name: STORE.listeningHistory,
    options: { keyPath: "id" },
    indexes: [{ name: "byPlayedAt", keyPath: "playedAt" }],
  },
  {
    name: STORE.searchHistory,
    options: { keyPath: "normalizedQuery" },
    indexes: [{ name: "bySearchedAt", keyPath: "searchedAt" }],
  },
  { name: STORE.preferences, options: { keyPath: "id" } },
  { name: STORE.session, options: { keyPath: "id" } },
  { name: STORE.metadataCache, options: { keyPath: "providerId" } },
];
