import type { PreparedImport } from "@/data/backup";
import type { Repositories } from "@/data/repositories";
import { applyImport as runImport, resetStores } from "./apply";
import { createLikedTracksRepository } from "./likedTracks";
import { createListeningHistoryRepository } from "./listeningHistory";
import { createMetadataCacheRepository } from "./metadataCache";
import { createMixesRepository } from "./mixes";
import { createPlaylistsRepository } from "./playlists";
import { createPreferencesRepository } from "./preferences";
import { openDatabase, type OpenDatabaseOptions } from "./open";
import { createSearchHistoryRepository } from "./searchHistory";
import { createSessionRepository } from "./session";

export interface RepositorySet extends Repositories {
  /** Apply a prepared import plan in one atomic transaction. */
  applyImport(plan: PreparedImport): Promise<void>;
  /** Clear every store, including derived caches (Reset Spotivibe data). */
  resetAll(): Promise<void>;
  /** Release the shared database connection (shutdown/tests). */
  close(): void;
}

/**
 * Open the database (running migrations first) and build every repository on
 * one shared connection. Feature code consumes `Repositories`; only this
 * module and the backup applier touch IndexedDB directly.
 */
export async function createRepositories(
  options: OpenDatabaseOptions = {},
): Promise<RepositorySet> {
  const db = await openDatabase(options);
  return {
    likedTracks: createLikedTracksRepository(db),
    playlists: createPlaylistsRepository(db),
    listeningHistory: createListeningHistoryRepository(db),
    searchHistory: createSearchHistoryRepository(db),
    preferences: createPreferencesRepository(db),
    session: createSessionRepository(db),
    metadataCache: createMetadataCacheRepository(db),
    mixes: createMixesRepository(db),
    applyImport: (plan) => runImport(db, plan),
    resetAll: () => resetStores(db),
    close: () => db.close(),
  };
}

export { openDatabase, type OpenDatabaseOptions } from "./open";
export { DATABASE_NAME, SCHEMA_VERSION, SINGLE_RECORD_KEY, STORE } from "./schema";
