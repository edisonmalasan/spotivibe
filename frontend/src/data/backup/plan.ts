import type {
  LikedTrackRecord,
  ListeningEventRecord,
  MixRecord,
  PlaylistRecord,
  Preferences,
  SearchEntryRecord,
} from "@/data/repositories";
import type { BackupData, BackupEnvelope, BackupSession } from "./schema";

/**
 * Pure import planners (design Decision 6): turn a validated envelope plus an
 * optional local snapshot into a deterministic `PreparedImport`. Nothing here
 * touches storage — the applier executes the plan in one transaction.
 *
 * Merge conflict rules (local-data spec "Deterministic import modes"):
 * liked tracks by track ID (newer `likedAt` wins), playlists by playlist ID
 * (newer `updatedAt` wins), history by event ID (local wins), search history
 * by normalized query (more recent wins), preferences per field (backup wins),
 * session taken from the backup when present and different. Ties keep the
 * local record. Records are only written when the rule selects a change, so a
 * repeated import plans zero writes.
 */

export type ImportMode = "replace" | "merge";

export interface ImportStats {
  likedTracks: number;
  playlists: number;
  history: number;
  searchHistory: number;
  /** M11: generated mixes written (0 when the envelope carries none). */
  mixes: number;
  /** 0 or 1 — whether the preferences record will be written. */
  preferences: number;
  /** 0 or 1 — whether the session record will be written. */
  session: number;
}

export interface PreparedImport {
  mode: ImportMode;
  /** Replace clears the supported datasets before writing (merge never does). */
  clearFirst: boolean;
  writes: {
    /** `undefined` leaves stored preferences untouched. */
    preferences: Preferences | undefined;
    likedTracks: LikedTrackRecord[];
    playlists: PlaylistRecord[];
    history: ListeningEventRecord[];
    searchHistory: SearchEntryRecord[];
    /**
     * M11: generated mixes. An **empty** array under `"replace"` means the
     * dataset was cleared and the envelope had none to write back; `[]` under
     * `"merge"` means the backup carried no mixes (a pre-M11 envelope) and the
     * local ones are left alone.
     */
    mixes: MixRecord[];
    /** `undefined` leaves the session untouched; `null` clears it. */
    session: BackupSession | null | undefined;
  };
  stats: ImportStats;
}

function sameLanguages(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((language, i) => language === b[i]);
}

function sameSession(a: BackupSession, b: BackupSession): boolean {
  return (
    a.queueIndex === b.queueIndex &&
    a.positionSeconds === b.positionSeconds &&
    a.repeatMode === b.repeatMode &&
    a.shuffle === b.shuffle &&
    a.volume === b.volume &&
    a.updatedAt === b.updatedAt &&
    a.queue.length === b.queue.length &&
    a.queue.every((track, i) => track.id === b.queue[i]?.id)
  );
}

function countWrites(writes: PreparedImport["writes"]): ImportStats {
  return {
    likedTracks: writes.likedTracks.length,
    playlists: writes.playlists.length,
    history: writes.history.length,
    searchHistory: writes.searchHistory.length,
    mixes: writes.mixes.length,
    preferences: writes.preferences === undefined ? 0 : 1,
    session: writes.session === null || writes.session === undefined ? 0 : 1,
  };
}

/** Replace: clear every supported dataset, then write the backup's data. */
export function planReplace(envelope: BackupEnvelope): PreparedImport {
  const writes: PreparedImport["writes"] = {
    preferences: envelope.data.preferences,
    likedTracks: [...envelope.data.likedTracks],
    playlists: [...envelope.data.playlists],
    history: [...envelope.data.history],
    searchHistory: [...envelope.data.searchHistory],
    // M11: a pre-M11 envelope carries no mixes, and importing it must succeed
    // with the dataset empty rather than fail.
    mixes: [...(envelope.data.mixes ?? [])],
    session: envelope.data.session,
  };
  return {
    mode: "replace",
    clearFirst: true,
    writes,
    stats: countWrites(writes),
  };
}

/** Merge: union backup records into the local snapshot by the dedupe rules. */
export function planMerge(envelope: BackupEnvelope, local: BackupData): PreparedImport {
  const localLiked = new Map(local.likedTracks.map((record) => [record.trackId, record]));
  const localPlaylists = new Map(local.playlists.map((record) => [record.id, record]));
  const localHistoryIds = new Set(local.history.map((record) => record.id));
  const localSearch = new Map(
    local.searchHistory.map((record) => [record.normalizedQuery, record]),
  );
  // M11: mixes merge by identity with the newest `updatedAt` winning — the same
  // rule as playlists, because a mix is a named record the listener recognizes.
  const localMixes = new Map((local.mixes ?? []).map((record) => [record.id, record]));

  const likedTracks = envelope.data.likedTracks.filter((record) => {
    const existing = localLiked.get(record.trackId);
    return existing === undefined || record.likedAt > existing.likedAt;
  });

  const playlists = envelope.data.playlists.filter((record) => {
    const existing = localPlaylists.get(record.id);
    return existing === undefined || record.updatedAt > existing.updatedAt;
  });

  const history = envelope.data.history.filter((record) => !localHistoryIds.has(record.id));

  const searchHistory = envelope.data.searchHistory.filter((record) => {
    const existing = localSearch.get(record.normalizedQuery);
    return existing === undefined || record.searchedAt > existing.searchedAt;
  });

  const mixes = (envelope.data.mixes ?? []).filter((record) => {
    const existing = localMixes.get(record.id);
    return existing === undefined || record.updatedAt > existing.updatedAt;
  });

  const backupPreferences = envelope.data.preferences;
  const preferencesUnchanged =
    sameLanguages(backupPreferences.languages, local.preferences.languages) &&
    backupPreferences.autoplayNext === local.preferences.autoplayNext &&
    backupPreferences.reduceMotion === local.preferences.reduceMotion &&
    backupPreferences.onboardingComplete === local.preferences.onboardingComplete &&
    // M10: the comparison covers *every* preference field — a field missing
    // here would silently drop a toggle difference on merge, since "unchanged"
    // is what suppresses the whole preferences write.
    backupPreferences.autofillQueue === local.preferences.autofillQueue;

  const backupSession = envelope.data.session;
  let session: BackupSession | null | undefined;
  if (backupSession === null) {
    session = undefined; // Backup recorded no session — keep the local one.
  } else if (local.session === null) {
    session = backupSession;
  } else if (sameSession(backupSession, local.session)) {
    session = undefined;
  } else {
    session = backupSession;
  }

  const writes: PreparedImport["writes"] = {
    preferences: preferencesUnchanged ? undefined : backupPreferences,
    likedTracks,
    playlists,
    history,
    searchHistory,
    mixes,
    session,
  };

  return {
    mode: "merge",
    clearFirst: false,
    writes,
    stats: countWrites(writes),
  };
}
