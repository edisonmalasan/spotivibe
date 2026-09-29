# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
