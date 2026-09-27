# Design

## Context

M1 shipped the shell and design system; `frontend/src/data/{backup,indexeddb,migrations,repositories}` and `frontend/src/features/backup` exist only as `.gitkeep` scaffolds. The roadmap mandates IndexedDB as the canonical user store with versioned JSON export/import as the ownership/transfer mechanism (`ROADMAP.md` §8, §13, M2). Constraints that shape this design: the product is accountless (no server-side user store may exist), components must stay isolated from storage details (AGENTS.md architecture rules), zod is already a runtime dependency, the test stack is Vitest + jsdom (no IndexedDB in jsdom), and DESIGN.md contains no modal/dialog pattern to reuse.

## Goals / Non-Goals

**Goals:**

- A versioned IndexedDB schema with an ordered migration registry that later milestones (M6 queue, M7 library, M11 history) extend without rework.
- Repository interfaces that fully cover the eight M2 datasets and are the only data access path for UI code.
- A `BackupEnvelope` v1 serializer/validator/migrator whose preparation phase is pure and whose apply phase is atomic.
- Deterministic, idempotent replace/merge import semantics proven by tests.
- Settings → Data controls with confirmation gates on every destructive operation.

**Non-Goals:**

- Any feature UI that *produces* the data (likes, playlists, history writes arrive with M4–M7); M2 ships the storage, the Settings controls, and the tests.
- Streaming/chunked import progress, multi-tab coordination, encryption at rest, or backup file compression.
- Exporting cached metadata or any derived cache (§13 bans caches from backups).

## Decisions

1. **One database, seven object stores, version 1.** `spotivibe` DB with stores: `likedTracks`, `playlists`, `listeningHistory`, `searchHistory`, `preferences`, `session`, `metadataCache`. *Alternative:* a store per record type with normalized `playlistTracks` — rejected: playlist reorder/read would span stores and lose single-transaction simplicity for a dataset that is local-scale (hundreds–thousands of rows). Playlist tracks live as an ordered array inside the playlist record, matching §8.2's "ordered track references/snapshots".

2. **Store keys double as dedupe keys** (this is what makes merge deterministic for free):
   - `likedTracks` keyPath `trackId` (conflict rule applied at merge: newer `likedAt`);
   - `playlists` keyPath `id` (merge: newer `updatedAt`);
   - `listeningHistory` keyPath `id` (event UUID; index on `playedAt`; merge: local wins);
   - `searchHistory` keyPath `normalizedQuery`, storing original text + `searchedAt` (merge: more recent wins);
   - `preferences` and `session` single records keyed `app` (preferences merge: backup wins per defined field; session: backup replaces);
   - `metadataCache` keyPath `providerId`.

3. **Layering** (AGENTS.md boundaries): `src/data/repositories` = interfaces + record types only; `src/data/indexeddb` = open/schema/implementation (implements the interfaces); `src/data/migrations` = ordered `upgradefn` steps keyed by target version; `src/data/backup` = pure preparation (zod schemas, serializer, version check, migration pipeline, envelope validator) + the atomic applier; `src/features/backup` = the only module importing both the backup services and repositories (hooks + DataControls UI). A static test asserts components/routes never import `src/data/indexeddb` and the data layer never imports `src/server` or performs `fetch`.

4. **zod for envelope validation** (already a dependency, no new runtime deps). Envelope objects use strict schemas: unknown keys and wrong types reject the whole import during preparation — before any store is touched. `version > CURRENT_BACKUP_VERSION` rejects with a distinct "created by a newer version" error; `version < CURRENT` routes through the migration pipeline (registry is empty at v1; the pipeline accepts an injected registry so ordering/purity are unit-testable with synthetic steps before a real v2 exists).

5. **Atomic apply = one IndexedDB transaction** across all affected stores. Preparation output is fully materialized in memory first; the apply callback performs clear+put operations and relies on transaction abort for rollback (any thrown error aborts; `abort()` on explicit failure). *Trade-off:* one large transaction means indeterminate busy feedback instead of a percentage bar — chosen deliberately because §13 ranks "failure leaves the pre-import database intact" above granular progress, and browsers give no reliable progress events for a single transaction. The Settings UI shows a busy state and the operation-feedback requirement covers it.

6. **Import modes as pure planning + shared applier.** `planReplace(envelope)` and `planMerge(envelope, localSnapshot)` return a `PreparedImport` (per-store put/delete lists) — pure, deterministic, unit-testable — and a single applier executes it atomically. Merge conflict rules are implemented in `planMerge` exactly as specified in the local-data delta.

7. **`fake-indexeddb` as a dev dependency** — spec-compliant IndexedDB for Vitest/jsdom; required by the roadmap's integration-test mandate ("IndexedDB repositories", "export → reset → import"). Test-only; production uses native IndexedDB. Integration tests open the DB twice (close → reopen against the same backing) to prove reload durability without a browser.

8. **Confirmation UX without a modal:** DESIGN.md has no dialog pattern, so destructive actions use a two-step inline confirmation in the Data controls section — activating a destructive control reveals a confirmation row (`role="status"` explanatory copy + Cancel / Confirm buttons); only Confirm executes. Focus stays on the new control; feedback uses the M1 `role="status"`/`role="alert"` pattern. Replace-mode import adds the same confirmation after file validation, before apply.

9. **Export transport:** serialize → `Blob` → temporary anchor click → `spotivibe-backup-YYYY-MM-DD.json`. Import transport: `<input type="file" accept=".json,application/json">` → `file.text()` → preparation. Both client-side; nothing touches the network. `appVersion` comes from `frontend/package.json` (single source), included as the optional envelope field.

10. **Settings entry = one icon control in the top bar's existing right spacer** (`aria-label="Settings"` gear). TopBar renders in both shell variants, so one control covers all viewports; `BottomNav` stays a three-destination content nav. This is the app-shell R2 amendment in this change.

11. **Backup v1 `data` contents:** `preferences`, `likedTracks`, `playlists`, `history`, `searchHistory`, `session`. `metadataCache` excluded (cache). This set is frozen for v1; adding datasets later increments `version`.

## Risks / Trade-offs

- [IndexedDB unavailable (storage disabled/private mode)] → repository open fails explicitly; Settings surfaces an error state instead of silently losing operations.
- [Single-transaction apply on very large backups hits browser limits] → transaction aborts; pre-import state intact (the acceptance criterion holds by construction); busy feedback + error copy tell the user.
- [Huge history in one `JSON.stringify`] → acceptable at M2 scale; noted as a future streaming concern, not a v1 blocker.
- [Two version axes (DB schema vs backup format) drift] → documented: DB version bumps for store-shape changes, backup version bumps for envelope/dataset changes; they evolve independently.
- [Multi-tab writes during import] → M2 assumes single-tab use (pre-release, no queue features yet); IDB's own transaction locking prevents torn state; `versionchange` handling closes the connection so future upgrades are not blocked.
- [Static architecture tests are grep-level and can be evaded by dynamic imports] → tests use static import inspection of real source; adequate for discipline, not a security boundary (stated honestly).

## Migration Plan

No deployed users exist: schema v1 is created on first open; the migration registry pattern (`v1 → v2 → …` steps) is proven by unit tests with synthetic steps. Rollback strategy for a bad future upgrade is out-of-band (the Reset control or deleting site data); M2 introduces no data shape that a rollback must preserve. Backup format changes increment `BackupEnvelope.version` and add a pure migration step before release.

## Open Questions

None — export dataset set (Decision 11), merge conflict rules, confirmation pattern, and the Settings entry point are all resolved above.
