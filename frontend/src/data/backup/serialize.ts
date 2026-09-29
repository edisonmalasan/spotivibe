import type { Repositories } from "@/data/repositories";
import {
  BACKUP_FORMAT,
  CURRENT_BACKUP_VERSION,
  type BackupData,
  type BackupEnvelope,
} from "./schema";

/**
 * Export side: collect the whitelisted datasets from the repository
 * interfaces and serialize them into a `BackupEnvelope`. Pure from the
 * caller's perspective — no storage detail leaks past `Repositories`.
 */

export interface SerializeOptions {
  /** ISO-8601 timestamp; defaults to now (tests pass fixed values). */
  exportedAt?: string;
  appVersion?: string;
}

/** Read every exported dataset through the repository interfaces. */
export async function collectLocalData(repos: Repositories): Promise<BackupData> {
  const [preferences, likedTracks, playlists, history, searchHistory, session] = await Promise.all([
    repos.preferences.get(),
    repos.likedTracks.list(),
    repos.playlists.list(),
    repos.listeningHistory.list(),
    repos.searchHistory.list(),
    repos.session.get(),
  ]);

  return {
    // Strip store bookkeeping (the single-record `id`) — backups carry
    // domain data only. `session.updatedAt` is kept because the schema
    // requires it and merge conflict rules compare it.
    preferences: {
      languages: preferences.languages,
      autoplayNext: preferences.autoplayNext,
      reduceMotion: preferences.reduceMotion,
      onboardingComplete: preferences.onboardingComplete,
      // M10: the queue-autofill setting is part of the same preferences dataset,
      // so a backup restores it like every other toggle.
      autofillQueue: preferences.autofillQueue,
    },
    likedTracks,
    playlists,
    history,
    searchHistory,
    session: session
      ? {
          queue: session.queue,
          queueIndex: session.queueIndex,
          positionSeconds: session.positionSeconds,
          repeatMode: session.repeatMode,
          shuffle: session.shuffle,
          volume: session.volume,
          updatedAt: session.updatedAt,
          // M6 additions (optional in the schema — absent when the stored
          // record predates them).
          ...(session.history ? { history: session.history } : {}),
          ...(session.playOrder ? { playOrder: session.playOrder } : {}),
          ...(session.source ? { source: session.source } : {}),
        }
      : null,
  };
}

/** Wrap collected data in a v1 `BackupEnvelope`. */
export function serializeBackup(data: BackupData, options: SerializeOptions = {}): BackupEnvelope {
  const envelope: BackupEnvelope = {
    format: BACKUP_FORMAT,
    version: CURRENT_BACKUP_VERSION,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    data,
  };
  if (options.appVersion !== undefined) {
    envelope.appVersion = options.appVersion;
  }
  return envelope;
}
