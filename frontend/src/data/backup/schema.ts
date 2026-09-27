import { z } from "zod";

/**
 * `BackupEnvelope` v1 schema (ROADMAP §8.5) and version constants.
 *
 * Strict objects reject unknown keys, so malformed or malicious fields fail
 * during import preparation — before any live mutation. The whitelist is the
 * six exported datasets: caches, secrets, and tokens are structurally
 * impossible to serialize or accept (ROADMAP §13).
 */

export const BACKUP_FORMAT = "spotivibe-backup";
export const CURRENT_BACKUP_VERSION = 1;

const artistSummarySchema = z.strictObject({
  id: z.string().optional(),
  name: z.string(),
});

const albumSummarySchema = z.strictObject({
  id: z.string().optional(),
  title: z.string(),
});

const artworkSchema = z.strictObject({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const trackSchema = z.strictObject({
  id: z.string().min(1),
  source: z.literal("youtube"),
  providerId: z.string().min(1),
  title: z.string(),
  artists: z.array(artistSummarySchema),
  album: albumSummarySchema.optional(),
  artwork: z.array(artworkSchema),
  durationSeconds: z.number().optional(),
  category: z.enum(["music", "podcast"]),
  explicit: z.boolean().optional(),
  qualityScore: z.number().optional(),
  language: z.string().optional(),
  capabilities: z.strictObject({
    stream: z.boolean(),
    offlineDownload: z.boolean(),
  }),
});

const likedTrackSchema = z.strictObject({
  trackId: z.string().min(1),
  track: trackSchema,
  likedAt: z.number(),
});

const playlistSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  artwork: z.array(artworkSchema).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  tracks: z.array(
    z.strictObject({
      track: trackSchema,
      addedAt: z.number(),
    }),
  ),
});

const listeningEventSchema = z.strictObject({
  id: z.string().min(1),
  trackId: z.string().min(1),
  track: trackSchema,
  playedAt: z.number(),
  secondsPlayed: z.number(),
  completed: z.boolean().optional(),
  skipped: z.boolean().optional(),
  context: z.enum([
    "search",
    "home",
    "playlist",
    "album",
    "artist",
    "queue",
    "radio",
    "library",
    "other",
  ]),
});

const searchEntrySchema = z.strictObject({
  query: z.string(),
  normalizedQuery: z.string(),
  searchedAt: z.number(),
});

const preferencesSchema = z.strictObject({
  languages: z.array(z.string()),
  autoplayNext: z.boolean(),
  reduceMotion: z.boolean(),
  onboardingComplete: z.boolean(),
});

const sessionSchema = z.strictObject({
  queue: z.array(trackSchema),
  queueIndex: z.number(),
  positionSeconds: z.number(),
  repeatMode: z.enum(["off", "context", "track"]),
  shuffle: z.boolean(),
  volume: z.number().min(0).max(1),
  updatedAt: z.number(),
});

export const backupEnvelopeSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  version: z.number().int().min(1),
  exportedAt: z.iso.datetime(),
  appVersion: z.string().optional(),
  data: z.strictObject({
    preferences: preferencesSchema,
    likedTracks: z.array(likedTrackSchema),
    playlists: z.array(playlistSchema),
    history: z.array(listeningEventSchema),
    searchHistory: z.array(searchEntrySchema),
    session: sessionSchema.nullable(),
  }),
});

export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;
export type BackupData = BackupEnvelope["data"];
export type BackupSession = NonNullable<BackupData["session"]>;
