# Tasks

## 1. Setup and test infrastructure

- [x] 1.1 Add the `fake-indexeddb` dev dependency to `frontend/package.json` and verify a clean `npm ci` succeeds and the existing suite (`npm test`) still passes untouched.
- [x] 1.2 Wire IndexedDB test support into the Vitest environment (import `fake-indexeddb/auto` for data-layer tests) and verify a smoke test that opens a database, creates a store, writes and reads a record passes.

## 2. Domain records and repository interfaces

- [x] 2.1 Define the persisted record types for all datasets (track snapshot, playlist with ordered tracks, listening event, search entry, preferences, session snapshot, cached metadata) in `frontend/src/data/repositories` and verify `npm run typecheck` passes.
- [x] 2.2 Define the repository interfaces for the eight datasets (CRUD/list/clear; playlists include add/remove/reorder; preferences and session single-record get/set) and verify `npm run typecheck` passes with no implementation present yet.

## 3. IndexedDB schema, migrations, and repository implementations

- [ ] 3.1 Implement database open + versioned schema v1 (seven stores, keyPaths/indexes from design Decision 2) and the ordered migration registry with `versionchange` handling; verify an integration test proves a synthetic older registry runs steps in ascending order before repositories serve data.
- [ ] 3.2 Implement the IndexedDB repository implementations for all eight datasets; verify integration tests cover each dataset's create/read/update/list/clear round-trip (and playlist reorder ordering) against the real IndexedDB implementation.
- [ ] 3.3 Verify data durability at the storage layer: write records, close the database, reopen against the same backing store, and read identical values (reload/browser-restart survival at repository level) in an integration test.

## 4. Backup preparation (pure layer)

- [ ] 4.1 Implement the `BackupEnvelope` v1 zod schemas and the export serializer (collect supported datasets from repositories → envelope with `format`/`version`/`exportedAt`/`appVersion`/whitelisted `data`); verify unit tests assert envelope fields, whitelist-only contents (no cache/unknown keys), and export reflecting the latest data.
- [ ] 4.2 Implement the import preparation pipeline — parse, format/version gate, ascending pure migration steps (injectable registry), strict per-record validation; verify unit tests cover malformed JSON, foreign format, newer version rejection before mutation, older-version migration ordering, and input non-mutation (purity).
- [ ] 4.3 Implement the pure `planReplace` and `planMerge` planners with the spec's deterministic dedupe rules per dataset; verify unit tests assert each conflict rule, merge preserving local-only records, and repeated planning of the same envelope producing identical, duplicate-free plans.

## 5. Atomic application and end-to-end backup loop

- [ ] 5.1 Implement the applier that executes a `PreparedImport` in a single IndexedDB transaction with abort-on-error; verify integration tests prove a successful apply commits all stores together and a simulated mid-apply failure rolls back to exact pre-import contents.
- [ ] 5.2 Verify the full acceptance loop in an integration test: export a populated database → reset all datasets → import the exported envelope → datasets are equivalent to the pre-reset state; plus importing the same envelope repeatedly leaves record counts unchanged.

## 6. Settings data controls UI

- [ ] 6.1 Add the `/settings` route with the Data controls section (Export backup download, Import backup file picker with replace/merge mode selection); verify UI tests cover export producing a `spotivibe-backup` JSON download, an invalid file surfacing `role="alert"` error feedback with no data change, and replace mode not executing without confirmation.
- [ ] 6.2 Add Clear listening history, Clear search history, and Reset Spotivibe data with the two-step inline confirmation pattern; verify UI tests assert cancel leaves data intact, confirm executes the scoped clear/reset with `role="status"` feedback, and clears touch only their own dataset.
- [ ] 6.3 Add the settings control to the top bar's right-hand spacer (accessible name, navigates to `/settings`); verify a shell test asserts the control exists with a non-empty accessible name and that existing top-bar/shell tests still pass unchanged in intent.
- [ ] 6.4 Implement busy and result feedback for backup operations (indeterminate busy state, success counts, failure copy stating local data is unchanged); verify UI tests cover successful-import feedback and failed-import "data intact" feedback.

## 7. Architecture invariants and evidence

- [ ] 7.1 Add static architecture tests: components/routes import no `src/data/indexeddb` directly, the data layer imports no `src/server`/performs no `fetch`, and stored/backup datasets stay within the whitelist; verify the suite fails if any invariant is violated (checked against real source files).
- [ ] 7.2 Capture M2 evidence with a dependency-free CDP script against a production build: `/settings` screenshots at 390px and 1280px, plus a scripted import → reload → export round-trip proving data survives reload and export matches; store `evidence/README.md`, machine-readable results, and screenshots in the change directory and verify the report shows zero console errors and a passing round-trip.

## 8. Integration checks and status

- [ ] 8.1 Run the full local gate sequence (`npm run lint`, `format:check`, `typecheck`, `npm test`, `npm run build`) and verify every command exits 0, recording test counts.
- [ ] 8.2 Run `openspec validate add-local-first-data-backup --strict` and verify it reports the change valid.
- [ ] 8.3 Repeat the full gate sequence from a clean checkout of the branch and record the results in the Apply PR description (AGENTS.md verification-evidence rules: distinguish automated/static/browser evidence).
- [ ] 8.4 After verification passes, update `ROADMAP.md` §5 so M2 reads `DONE` and verify no other milestone row changed.
