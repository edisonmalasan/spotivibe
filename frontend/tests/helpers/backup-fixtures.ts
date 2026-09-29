import {
  BACKUP_FORMAT,
  CURRENT_BACKUP_VERSION,
  type BackupData,
  type BackupEnvelope,
} from "@/data/backup";
import type { Track } from "@/data/repositories";

/** Shared fixtures for backup export/import/plan tests (not collected by Vitest). */

export function makeTrack(id: string): Track {
  return {
    id,
    source: "youtube",
    providerId: `yt-${id}`,
    title: `Title ${id}`,
    artists: [{ name: `Artist ${id}` }],
    artwork: [],
    category: "music",
    capabilities: { stream: true, offlineDownload: false },
  };
}

export function makeBackupData(overrides: Partial<BackupData> = {}): BackupData {
  const base: BackupData = {
    preferences: {
      languages: ["hi"],
      autoplayNext: true,
      reduceMotion: false,
      onboardingComplete: true,
      autofillQueue: true,
    },
    likedTracks: [
      { trackId: "t1", track: makeTrack("t1"), likedAt: 1000 },
      { trackId: "t2", track: makeTrack("t2"), likedAt: 2000 },
    ],
    playlists: [
      {
        id: "p1",
        name: "Road Trip",
        createdAt: 500,
        updatedAt: 600,
        tracks: [{ track: makeTrack("t1"), addedAt: 550 }],
      },
    ],
    history: [
      {
        id: "e1",
        trackId: "t1",
        track: makeTrack("t1"),
        playedAt: 700,
        secondsPlayed: 30,
        completed: true,
        context: "home",
      },
    ],
    searchHistory: [{ query: "beatles", normalizedQuery: "beatles", searchedAt: 800 }],
    session: {
      queue: [makeTrack("t1")],
      queueIndex: 0,
      positionSeconds: 10,
      repeatMode: "off",
      shuffle: false,
      volume: 0.5,
      updatedAt: 900,
    },
  };
  return { ...base, ...overrides };
}

export const FIXED_EXPORTED_AT = "2026-09-27T12:00:00.000Z";

export function makeEnvelope(data: BackupData = makeBackupData()): BackupEnvelope {
  return {
    format: BACKUP_FORMAT,
    version: CURRENT_BACKUP_VERSION,
    exportedAt: FIXED_EXPORTED_AT,
    appVersion: "0.1.0",
    data,
  };
}

export function encode(value: unknown): string {
  return JSON.stringify(value);
}
