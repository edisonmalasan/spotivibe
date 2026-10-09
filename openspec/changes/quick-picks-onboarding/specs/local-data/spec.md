## ADDED Requirements

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