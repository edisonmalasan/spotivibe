# Spec Delta

## MODIFIED Requirements

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
