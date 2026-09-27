import type { Repositories } from "@/data/repositories";
import { createLikedTracksRepository } from "./likedTracks";
import { createListeningHistoryRepository } from "./listeningHistory";
import { createMetadataCacheRepository } from "./metadataCache";
import { createPlaylistsRepository } from "./playlists";
import { createPreferencesRepository } from "./preferences";
import { openDatabase, type OpenDatabaseOptions } from "./open";
import { createSearchHistoryRepository } from "./searchHistory";
import { createSessionRepository } from "./session";

export interface RepositorySet extends Repositories {
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
    close: () => db.close(),
  };
}

export { openDatabase, type OpenDatabaseOptions } from "./open";
export { DATABASE_NAME, SCHEMA_VERSION, STORE } from "./schema";
