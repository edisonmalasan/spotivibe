# Tasks

## 1. Play classification

- [ ] 1.1 Add `src/features/insights/classifyPlay.ts`: a pure rule over the recorded event (`secondsPlayed`, `durationSeconds`, `completed`, `skipped`) returning `completed | partial | skipped`, with documented threshold constants and a seconds-only fallback for an unknown duration — verify: unit tests cover every branch (marked completed, fraction rule, seconds rule, marked skipped, skip threshold, the boundary values themselves, unknown duration) and that a real recorded event classifies identically no matter how many times it is read.
- [ ] 1.2 Assert classification is a **read-time** policy: the recorder must keep storing only raw measurements, and the thresholds must be overridable per call so a changed rule re-reads history without a migration — verify: a test changes the thresholds and re-classifies the same event to a different verdict with no write to the history dataset, and the recorder's event shape is unchanged.

## 2. Local statistics and streaks

- [ ] 2.1 Add `src/features/insights/buildStats.ts`: a pure derivation over the **whole** history dataset (not the in-memory window) returning total listening time, non-skipped play count, top tracks, top artists, a language and genre/category breakdown where metadata exists, completion/skip counts, and per-artist/per-track detail — verify: unit tests cover each statistic, its omission when the metadata is absent, deterministic ordering including ties, and that totals reconcile with the events they summarize.
- [ ] 2.2 Add streaks to the same derivation: local-calendar-day runs, `current` alive until a whole day passes, `longest` over all history, skipped plays not counting, computed from `(events, now)` with no system clock of its own — verify: unit tests cover consecutive days, a streak alive from yesterday, a streak broken by a missed day, the longest streak, skip-only days, and specific local-midnight boundaries (including a month and year rollover).
- [ ] 2.3 Assert the derivation is the *only* source: no aggregate is stored, so clearing history changes the numbers with no invalidation step — verify: a test deletes history and re-reads the statistics and streaks, asserting the reported values come only from what remains, and an architecture rule proves no module persists an aggregate of listening events.

## 3. Mix generation and storage

- [ ] 3.1 Add the mix domain record and its local storage: a stable `id`, a generated `name`, the generation period, the profile terms it was built from, its ordered tracks, and a derived flag — verify: store/repository tests cover create, read, list, replace-on-refresh, and that a mix keeps its identity and name across a reload.
- [ ] 3.2 Add `src/features/mixes/generateMix.ts`: compose the **existing** discovery `mix` feed across a bounded number of profile-derived seed rounds, dedupe against the mix's own tracks and the local played recency window, follow the selected languages, and stop at the documented 20+ target or when no new material arrives — verify: tests with a stubbed feed cover reaching the target, the no-duplicate guarantee, the played-track exclusion, language spanning, the short-mix case, and that the round count is bounded.
- [ ] 3.3 Add `src/features/mixes/mixNaming.ts`: derive the mix name from its strongest local signal (top artist, else leading genre, else a neutral local label), deterministically and with no chart/editorial claim — verify: unit tests cover each branch, the same mix always yielding the same name, and names containing no claim words.
- [ ] 3.4 Add mix refresh: re-derive contents from the current profile and feed while keeping the identity and name, honoring the same dedupe/exclusion bounds, and stopping without looping when no new material arrives — verify: tests cover a refresh that changes contents but not identity, a refresh that adds nothing, and the bound.
- [ ] 3.5 Generate nothing without signal: with no taste signal, no mix is generated and the surface says so — verify: a test asserts no mix is created for an empty profile and that the reason is the missing signal, not a provider failure.

## 4. History and mixes surfaces

- [ ] 4.1 Add `src/app/history/page.tsx` + `src/features/history/HistoryView.tsx`: local events most recent first, grouped by local day, each showing track, artists, time, and the classification verdict, with artist/album links to the M9 surfaces, an explanatory empty state, and a clear-history action — verify: component tests cover grouping, the verdict shown, navigation targets, the empty state, and that clearing empties the list.
- [ ] 4.2 Add the statistics surface: total time, plays, top tracks, top artists, the language/genre breakdown, completion/skip summary, and both streaks, each labelled as derived from local history, with an explanatory empty state for a fresh install — verify: component tests cover every statistic, the empty state, and that clearing history updates the rendered numbers.
- [ ] 4.3 Add the mix surface: the listener's mixes by name with their track counts, an action to play a mix, and a refresh action; plus the Home Smart Mixes section listing them by name (replacing the signal-presence placeholder) — verify: component tests cover listing, playing, refreshing, the section appearing only when a mix exists, and no autoplay on open.

## 5. Backup and local-data integration

- [ ] 5.1 Add the mixes dataset to the backup envelope as an **optional derived** dataset: schema, serializer, merge plan, and the export/import round trip, with listening history confirmed as included by default — verify: round-trip tests for both import modes, an envelope **without** the dataset importing as empty, and a pre-M11 envelope still validating.
- [ ] 5.2 Assert the new dataset is the only storage addition and that no aggregate is persisted — verify: the architecture suite's dataset whitelist is extended (not loosened), and a rule proves no module writes derived statistics or streaks to storage.

## 6. Architecture and route contracts

- [ ] 6.1 Extend `tests/architecture.test.ts`: the new `features/insights` and `features/mixes` surfaces stay repository-mediated (no `data/indexeddb`, no `@/server`, no provider shapes); `features/insights/buildStats` and `classifyPlay` stay pure (no store, repository, or network imports); no request path imports the profile's weights or a history store for a payload; the history route is a thin wrapper — verify: each rule is proven against a violating snippet and passes on the clean tree.
- [ ] 6.2 Update `tests/routes.test.tsx` for `/history` and reset the new stores in `beforeEach` — verify: the route shell renders its `h1` with the client view mounted, and cases stay isolated.

## 7. Integration verification and release evidence

- [ ] 7.1 Run the full quality gates from the repository root (`cd frontend && npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`) — verify: every command exits `0`.
- [ ] 7.2 Produce CDP browser evidence against a production server: playing several tracks records history; the History page lists them by day with verdicts and navigates to an artist; the statistics page reports time, plays, top tracks/artists, the breakdown, and a streak; clearing history empties both pages and resets the statistics; a Smart Mix is generated from the local profile, appears on Home by name, plays, and refreshes without changing its identity; the mixes dataset survives an export/import round trip; no request ever carried profile, history, or mix data; exactly one player iframe/API script; zero console errors with disclosed deliberate windows — verify: `results.json` reports `"pass": true` with screenshots and a reproduce-path README (disclosing live-run deviations) under the change's `evidence/`.
- [ ] 7.3 Update `ROADMAP.md`: M11 status row → `DONE`; tick the §11 items M11 delivers (History/Stats, Smart Mixes, Listening stats, Listening streaks) — verify: `git diff` shows only those lines plus the status cell.
- [ ] 7.4 Re-verify the quality gates from a clean clone of the branch head — verify: all six commands exit `0` in the fresh clone.
