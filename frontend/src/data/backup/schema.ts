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
    // ROADMAP §8.1: YouTube-sourced tracks must never claim offline download.
    // Imported backups are untrusted input, so enforce it at the boundary.
    offlineDownload: z.boolean().refine((value) => value === false, {
      message: "offlineDownload must remain false for YouTube-sourced tracks (ROADMAP §8.1)",
    }),
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
  // M10's `autofillQueue` (design §6). Additive with a default rather than a
  // required field: a v1 envelope exported before M10 carries no such key, and
  // it must still validate and import — with the documented default the user
  // would have had. The *output* type is a plain `boolean`, so everything
  // downstream (the plan, the applier, the store) sees a required value.
  autofillQueue: z.boolean().default(true),
});

const sessionSchema = z.strictObject({
  queue: z.array(trackSchema),
  queueIndex: z.number(),
  positionSeconds: z.number(),
  repeatMode: z.enum(["off", "context", "track"]),
  shuffle: z.boolean(),
  volume: z.number().min(0).max(1),
  updatedAt: z.number(),
  // M6 queue/session extension — optional so pre-M6 exports validate
  // unchanged (design §6; no new dataset, so whitelists stay valid).
  history: z.array(z.strictObject({ track: trackSchema, playedAt: z.number() })).optional(),
  playOrder: z.array(z.number()).optional(),
  // M10: the `radio` source (a radio is a mode of this one queue, design §1), so
  // a session captured mid-radio exports and imports back as the same queue
  // rather than failing validation or losing its label.
  source: z.enum(["search", "browse", "library", "queue", "radio", "unknown"]).optional(),
  // M10: the radio's identity, so an exported session comes back as the same
  // radio rather than a queue labelled "From radio" that nothing can refill.
  // Optional so a pre-M10 export still validates, and a track radio persists
  // only the seed's id (the track itself already travels in `queue`).
  radio: z
    .strictObject({
      seed: z.union([
        z.strictObject({
          kind: z.literal("track"),
          trackId: z.string().min(1).max(200),
          title: z.string().min(1).max(200),
          artist: z.string().min(1).max(200).optional(),
        }),
        z.strictObject({
          kind: z.literal("artist"),
          id: z.string().min(1).max(200).optional(),
          name: z.string().min(1).max(200),
        }),
      ]),
      variant: z.number().int().min(0).max(999),
    })
    .optional(),
});

/**
 * M11: a locally generated Smart Mix.
 *
 * Optional in the envelope: a v1 envelope exported before mixes existed carries
 * no such key, and that must keep importing cleanly (spec `local-data` — "An
 * envelope without the mixes dataset still imports"). Its tracks are ordinary
 * `Track` records, so a restored mix needs no new parsing rules.
 */
const mixSchema = z.strictObject({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  generatedAt: z.number().int().min(0),
  period: z.string().min(1).max(20),
  seeds: z.array(z.string().min(1).max(200)).max(20),
  tracks: z.array(trackSchema).max(200),
  updatedAt: z.number().int().min(0),
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
    // M11: derived data, optional so a pre-M11 envelope still validates and
    // imports with the dataset empty.
    mixes: z.array(mixSchema).optional(),
    session: sessionSchema.nullable(),
  }),
});

export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;
export type BackupData = BackupEnvelope["data"];
export type BackupSession = NonNullable<BackupData["session"]>;
