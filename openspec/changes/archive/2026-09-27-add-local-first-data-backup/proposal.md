# Proposal

## Why

M1 delivered the shell, but Spotivibe still has no storage foundation: every future milestone (queue/session M6, library M7, personalization M10–M11, offline metadata M13) depends on the local-first data layer that `ROADMAP.md` mandates as a prerequisite (M2 → M6/M7/M10/M11/M13). Local data ownership is the product's substitute for accounts — IndexedDB repositories plus the versioned JSON backup must exist and be trustworthy (validated, atomic, deterministic) **before** features start writing user data.

## What Changes

- **IndexedDB database, schema version 1, with versioned migration machinery**, covering the eight `ROADMAP.md` M2 datasets: liked tracks; playlists (including ordered playlist tracks); listening history; search history; preferences/languages; persisted queue/session; cached metadata.
- **Repository APIs** for all eight datasets. UI/feature code reaches data only through repository interfaces — components never touch IndexedDB directly, and the data layer never reaches the network (no remote user database).
- **Backup foundation** per `ROADMAP.md` §8.5/§13:
  - serializer to `BackupEnvelope` v1 (`format`, `version`, `exportedAt`, `appVersion?`, whitelisted `data` — no secrets/caches/tokens);
  - strict zod-based validator — imports never trust types/IDs from JSON;
  - pure, testable backup migration pipeline (prepare → migrate → validate, all before any live mutation);
  - two import modes: **Replace local data** (confirmation required) and **Merge local data** with deterministic dedupe keys; imports apply in a single atomic IndexedDB transaction so failure leaves the pre-import database intact; repeated import of the same backup must not create uncontrolled duplicates.
- **Settings → Data controls** on a new `/settings` route: export backup (file download), import backup (file picker → validate → mode choice → confirmation), clear listening history, clear search history, reset Spotivibe data — every destructive operation gated by an explicit confirmation step with clear copy.
- **Settings entry point**: a settings control in the top navigation bar (present in both shell variants), which is a spec-level amendment to the desktop top-bar enumeration in the `app-shell` capability.
- **Verification**: unit tests (serialization, validation, migration, merge/replace determinism), integration tests against a real IndexedDB implementation (`fake-indexeddb`, new dev dependency — required by the roadmap's "integration tests: IndexedDB repositories; export → reset → import"), static architecture tests (component isolation; no network in the data layer), and Settings UI tests (confirmations, error feedback).

Out of scope (later milestones): playback and queue features (M4/M6 — only the session persistence repository lands now), search and search-history *UI* (M5), library/liked/playlists *UI* (M7), personalization and stats (M10/M11), PWA/service-worker (M13), provider work (M3), accounts/auth (permanently excluded).

## Capabilities

### New Capabilities

- `local-data`: local-first IndexedDB storage — schema/versioning, repository APIs for the eight datasets, versioned `BackupEnvelope` export, validated/migrated/atomic import with replace and merge modes, Settings data controls with destructive-operation safeguards, and the isolation guarantees (no direct IndexedDB in components, no remote user database).

### Modified Capabilities

- `app-shell`: the desktop-shell requirement's top-bar enumeration gains a settings control (the branding area, search input, back/forward arrows, **and a settings control** opening Settings). The accountless exclusions and all other requirements/scenarios are unchanged.

## Impact

- **New code**: `frontend/src/data/` (schema, migrations, repositories, backup serializer/validator/importers), `frontend/src/features/backup/` (data-controls feature), `frontend/src/app/settings/page.tsx`.
- **Modified code**: `frontend/src/components/layout/TopBar.tsx` (settings control), `frontend/tests/` (new suites; existing shell/top-bar assertions extended, not weakened).
- **Dependencies**: new dev dependency `fake-indexeddb` (test-only; production uses the browser's native IndexedDB). Runtime dependency set unchanged except zod, which is already present and is used for backup validation.
- **No server/API changes**: no route handlers added; the data layer is client-side only. No behavior change to Home/Search/Library/Now Playing rendering beyond the added top-bar control.
- **Docs**: `ROADMAP.md` milestone status moves to `IN PROGRESS`; the archived change records gate/verification results.
