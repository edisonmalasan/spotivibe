# The Spotivibe backup format

A backup is a promise to a person about data they cannot get back if the promise is wrong,
so this document states the format precisely enough to decide whether a file can be
restored, and says where the code that holds it honest lives.

The current release writes **`spotivibe-backup` version 1**.

## Where the truth lives

| | |
| --- | --- |
| Constants | `src/data/backup/schema.ts` — `BACKUP_FORMAT`, `CURRENT_BACKUP_VERSION` |
| Validation | `backupEnvelopeSchema`, in the same file — a zod schema every import is parsed with |
| Writing | `src/data/backup/serialize.ts` — `collectLocalData` then `serializeBackup` |
| Reading | `src/data/backup/` — preparation, validation, and migration run *before* any transaction |
| Held honest by | `tests/backup-export.test.ts` (envelope shape), `tests/backup-import.test.ts` (round trip), `tests/import-apply.test.ts` (application), `tests/backup-plan.test.ts` (mode planning) |

If this document and the code ever disagree, the code is right and this document is a bug.

## The envelope

```json
{
  "format": "spotivibe-backup",
  "version": 1,
  "exportedAt": 1759000000000,
  "appVersion": "0.1.0",
  "data": {
    "likedTracks": [],
    "playlists": [],
    "history": [],
    "mixes": [],
    "preferences": {},
    "searchHistory": [],
    "session": null
  }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | `"spotivibe-backup"` | Identifies the file. A file without it is not a backup. |
| `version` | integer | The schema version. This release writes `1`. |
| `exportedAt` | epoch ms | When the export was taken. Used to resolve merge conflicts. |
| `appVersion` | string | The application version that wrote it, for diagnosis. |
| `data` | object | Exactly the seven datasets below — and **only** those. |

### `data`

| Dataset | Holds |
| --- | --- |
| `likedTracks` | the listener's liked tracks, keyed by track ID |
| `playlists` | their playlists, including entry order |
| `history` | their listening history events |
| `mixes` | their generated Smart Mixes |
| `preferences` | their settings, including language choices |
| `searchHistory` | their recent searches |
| `session` | the playback session, so a restore can resume near where they stopped |

`tests/backup-export.test.ts` pins the top-level keys and the `data` keys exactly, so a new
dataset cannot ride along in an export unnoticed — and neither can a stray field.

## Compatibility

- **A file with a `version` this release does not know is refused**, not guessed at. The
  import reports what version it found and what it expected.
- **A file missing `format` is refused.** There is no "looks like a backup" path.
- Every import is validated against `backupEnvelopeSchema` and the prepared plan is shown
  to the listener **before** anything is written, so an incompatible file cannot half-apply.
- Datasets absent from a file are treated as empty rather than as an error, so a file
  written by an older version that predates a dataset still imports.

## Two import modes

| Mode | What it does |
| --- | --- |
| **Merge** (default) | Combines with what is on the device. The same record in both places keeps the newer `updatedAt`. |
| **Replace** | Discards the device's data and takes the file's. Destructive, and confirmed first. |

Merge is the default because it cannot lose data. Replace is offered because someone
restoring onto a new device wants the file to be the truth.

## What a backup never contains

- **No credentials and no server configuration.** The export is produced on the device from
  local datasets; `tests/release-exclusions.test.ts` asserts that no server-side value
  reaches an export, with provider configuration deliberately *set* so the test is not
  passing because the value was absent.
- **No media.** Tracks are stored as identities and metadata — a video ID, a title, an
  artist — pointing at the provider. Nothing is downloaded, so nothing can be exported.
- **No other person's data.** There are no accounts and no shared database, so there is
  nothing to leak sideways.

## Exporting and restoring

**Settings → Data.** Export produces a JSON file through the browser's own download, named
for the date. Import takes a file you choose, validates it, shows the plan, and asks you to
confirm.
