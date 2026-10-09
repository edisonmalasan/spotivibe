# local-data Specification

## Purpose

Defines Spotivibe's local-first data foundation: IndexedDB-backed, versioned storage behind repository APIs for the supported user datasets, plus the versioned JSON backup export/import mechanism (strict validation, migration, atomic application, deterministic replace/merge modes) and the Settings data controls that expose them.

## Requirements

### Requirement: Versioned IndexedDB storage with durable data

The application SHALL store the listener's data in versioned IndexedDB behind repository interfaces, SHALL migrate existing databases forward when the schema version changes, and SHALL keep the data readable across a failed or partial migration. A stored record SHALL be treated as untrusted data at every read: a record that cannot fill the fields a surface renders SHALL be skipped or defaulted by that surface rather than being allowed to fail the surface. A database that cannot be opened or upgraded SHALL be reported to the listener as a named state that distinguishes a failure from empty data, because an empty library and a broken database look identical from inside the application and do not mean the same thing to the person looking at them.

#### Scenario: Data survives reload

- **WHEN** records are written through a repository and the page is reloaded or the app is reopened
- **THEN** the same records are readable with their stored values

#### Scenario: Opening an older schema runs migrations first

- **WHEN** the stored database schema version is older than the application's current schema version
- **THEN** the registered schema migration steps run in ascending order on open, and repositories become available only after the upgrade completes

#### Scenario: A record that cannot be rendered does not fail the surface

- **WHEN** a stored record is missing or has the wrong shape for a field a surface renders
- **THEN** that record is skipped by the surface or defaulted per field, and the rest of the surface renders normally

#### Scenario: A database that cannot be opened is named, not hidden

- **WHEN** the database cannot be opened, is blocked, or an upgrade fails
- **THEN** the application reports a state that says the local data could not be read, and says the data was not deleted, rather than presenting an empty library

#### Scenario: A failure to read is not a failure to write

- **WHEN** storage is unavailable
- **THEN** the failure is reported for the operation that failed, and no later operation silently reports success as though nothing happened

### Requirement: Repository-mediated access to every dataset

The supported datasets SHALL each be accessed through a repository API: liked tracks; playlists including ordered track membership; listening history; search history; preferences/languages; persisted queue/session; and cached metadata. Components and routes MUST NOT issue IndexedDB operations directly — they depend on repository interfaces only.

#### Scenario: Components are isolated from IndexedDB

- **WHEN** the application components and routes are inspected for data access
- **THEN** none of them open, read from, or write to IndexedDB directly; all persistence goes through repository interfaces

#### Scenario: Each dataset has a working repository surface

- **WHEN** the repositories are exercised
- **THEN** liked tracks, playlists (including add/remove/reorder of ordered tracks), listening history, search history, preferences, session/queue, and cached metadata each support their create/read/update/list/clear operations and return stored records faithfully

### Requirement: Local data never leaves the device

The local-data layer MUST NOT transmit user data over the network, and no server route or remote store SHALL receive it. The database SHALL contain only the supported datasets — no credentials, browser tokens, or service-worker internals.

#### Scenario: Repository operations make no network requests

- **WHEN** repository read/write operations execute
- **THEN** no fetch/XHR/remote persistence call occurs for the operated data

#### Scenario: Only supported datasets are stored

- **WHEN** the database stores are inventoried
- **THEN** they contain only the whitelisted datasets and no secret, token, or service-worker material

### Requirement: Versioned backup export

The application SHALL export its local data as a versioned JSON envelope carrying `format`, `version`, `exportedAt`, and exactly the whitelisted datasets — no cache, secret, or unknown top-level keys. Listening history SHALL be included in the envelope by default, and generated Smart Mixes SHALL be included as an **optional derived dataset** so a named mix the listener can revisit survives an export/import round trip. The envelope SHALL remain importable by a build that predates any dataset it does not know, and a dataset that is absent from an envelope SHALL import as empty rather than failing the import.

#### Scenario: Export produces a well-formed envelope

- **WHEN** export runs against a populated database
- **THEN** the downloaded JSON parses to an envelope carrying `format`, `version`, `exportedAt`, and exactly the whitelisted datasets — no cache, secret, or unknown top-level keys

#### Scenario: Export reflects the latest data

- **WHEN** a dataset changes and export is then run
- **THEN** the envelope contains the current values for that dataset

#### Scenario: Listening history is exported by default

- **WHEN** export runs with listening history present
- **THEN** the envelope carries the listening history without the user having to opt in

#### Scenario: Generated mixes travel as optional derived data

- **WHEN** export runs with generated Smart Mixes present
- **THEN** the envelope carries those mixes — with their identities, names, periods, and tracks — as a dataset marked optional and derived

#### Scenario: An envelope without the mixes dataset still imports

- **WHEN** an envelope produced before mixes existed is imported
- **THEN** the import succeeds and the mixes dataset ends up empty rather than absent from the database
### Requirement: Import preparation, validation, and migration

An import SHALL be fully prepared before any live mutation: parse the file, verify `format` and `version`, run pure migration steps in ascending version order for older supported versions, and validate every record against the current schema. Malformed JSON, an unrecognized `format`, an unsupported (newer) `version`, or any invalid record SHALL reject the import with user-visible feedback before the database is touched. Migration steps SHALL be pure functions.

#### Scenario: Malformed or foreign input is rejected untouched

- **WHEN** a file that is not valid JSON, is not a Spotivibe backup envelope, or contains records violating the schema is imported
- **THEN** the import is rejected with visible error feedback and the live database is not modified

#### Scenario: Unsupported newer version is rejected

- **WHEN** an envelope whose `version` is greater than the application's supported backup version is imported
- **THEN** the import is rejected before any mutation with feedback naming the version problem

#### Scenario: Older supported versions are migrated before validation

- **WHEN** an envelope with a `version` older than current is prepared and migration steps exist for the intervening versions
- **THEN** the steps run in ascending order, and validation is applied to the migrated result before it can be applied

### Requirement: Atomic import application

A prepared import SHALL be applied only through a single transaction spanning the affected stores; if any write fails, the transaction aborts and every dataset MUST equal its pre-import content. Import failure leaves the pre-import database intact.

#### Scenario: Mid-apply failure rolls back completely

- **WHEN** a write fails while an import is being applied (simulated)
- **THEN** the transaction aborts and all datasets read back exactly their pre-import contents

#### Scenario: Successful apply commits all datasets together

- **WHEN** an import applies without error
- **THEN** all targeted stores reflect the imported data from the same committed transaction

### Requirement: Deterministic import modes

Two import modes SHALL exist. **Replace local data** clears the supported datasets and writes the backup's data, and MUST require explicit user confirmation before execution. **Merge local data** combines backup records with local records using deterministic dedupe rules: liked tracks dedupe by track ID with the newer like timestamp winning; playlists dedupe by playlist ID with the newer update timestamp winning; history events dedupe by event ID with the local record winning; search history dedupe by normalized query with the more recent search winning; preferences merge per field with the backup's value winning for fields the backup defines; the session snapshot is taken from the backup when the backup contains one, while a backup with a `null` session snapshot leaves the local session untouched. Importing the same envelope repeatedly SHALL converge — the first import applies the deltas and subsequent imports create no additional duplicates.

#### Scenario: Replace requires confirmation

- **WHEN** the user selects replace mode for an import
- **THEN** the import executes only after explicit confirmation; canceling changes nothing

#### Scenario: Repeated import converges

- **WHEN** the same valid envelope is imported (merge or replace) multiple times
- **THEN** record counts and contents stabilize after the first import — no uncontrolled duplicates accumulate

#### Scenario: Merge keeps local-only records

- **WHEN** local datasets contain records absent from the backup and a merge import runs
- **THEN** those local records remain and backup-only records are added

### Requirement: Settings data controls

A Settings surface SHALL expose the data controls: Export backup; Import backup; Clear listening history; Clear search history; Reset Spotivibe data. Each destructive control (clear history, clear search history, reset, replace-mode import) SHALL require explicit confirmation, operate only on its own target scope (reset covers all supported datasets; each clear covers exactly its dataset), and report its outcome with user-visible feedback. The Settings surface SHALL be reachable from the top-bar settings control on every viewport.

#### Scenario: Export downloads a backup file

- **WHEN** the user activates Export backup
- **THEN** a `.json` backup file downloads containing the current envelope

#### Scenario: Clear listening history is confirmed and scoped

- **WHEN** the user activates Clear listening history and confirms
- **THEN** listening history becomes empty, other datasets are unchanged, and success feedback is shown; canceling leaves history intact

#### Scenario: Reset canceled changes nothing

- **WHEN** the user activates Reset Spotivibe data and cancels the confirmation
- **THEN** no dataset is modified

#### Scenario: Reset confirmed clears every dataset

- **WHEN** the user activates Reset Spotivibe data and confirms
- **THEN** all supported datasets are empty and feedback reports the reset

#### Scenario: Invalid import file surfaces an error

- **WHEN** the user picks an invalid file through Import backup
- **THEN** visible error feedback appears and no dataset changes

### Requirement: Backup operation feedback

Long-running backup operations (export, import, clears, reset) SHALL show busy feedback while executing and a success or failure result afterward; failure feedback SHALL state that local data was not changed when the operation aborted before or during mutation.

#### Scenario: Import success reports the outcome

- **WHEN** an import completes successfully
- **THEN** feedback reports the applied mode and counts of imported records

#### Scenario: Failed import reports data intact

- **WHEN** an import fails during validation or application
- **THEN** failure feedback appears and states that existing local data is unchanged

### Requirement: Local insights are as local as their inputs

Data the application derives from local datasets SHALL stay on the device exactly like the datasets themselves. This includes listening statistics, listening streaks, generated Smart Mixes with their names and seeds, and the local taste profile. Deriving them SHALL NOT cause any of them to be transmitted, and no diagnostic or error report SHALL include a track list, a mix's contents, or a history summary. Sharing SHALL be an explicit, per-item user action, and sharing SHALL leave the device's own copy unchanged.

#### Scenario: Derived insights are never transmitted

- **WHEN** statistics, streaks, or Smart Mixes are computed
- **THEN** they are produced and kept on the device, exactly like the events and likes they came from, and no request carries them

#### Scenario: Diagnostics carry no listening content

- **WHEN** an error or diagnostic is recorded
- **THEN** it contains no track list, mix contents, history summary, or other listening detail from local data

#### Scenario: Sharing is explicit and non-destructive

- **WHEN** the user shares an item with history or an insight
- **THEN** the act is a deliberate action for that item, and the device's own local record is unchanged by it

### Requirement: Picked artists are a stored, backed-up dataset

Artists selected during first-run onboarding SHALL be stored in IndexedDB as a dataset keyed by
canonical artist identity, and SHALL be included in the versioned JSON backup envelope.

The envelope dataset SHALL be **optional**, so that a backup exported before first-run artist
selection existed continues to validate and import. Importing such an envelope SHALL succeed and
SHALL leave the dataset empty rather than absent from the database — the same guarantee the mixes
dataset carries, and for the same reason: a dataset that only appears in new exports must not become
a reason an old file cannot be restored.

Merge and replace import SHALL both cover the dataset. An export that carries picks but an import path
that ignores them would produce a file which looks restorable and silently drops the listener's only
stated preference.

#### Scenario: An envelope without the picks dataset still imports

- **WHEN** a backup envelope exported before first-run artist selection is imported
- **THEN** the import succeeds and the picks dataset ends up empty rather than absent from the database

#### Scenario: Picks survive export and import

- **WHEN** picks exist, the data is exported, and the envelope is imported into a fresh database
- **THEN** the imported database holds the same picked artists

#### Scenario: Replace import does not leave orphaned picks

- **WHEN** a replace-mode import writes an envelope whose picks list is empty
- **THEN** the previously stored picks are cleared rather than retained alongside the import
