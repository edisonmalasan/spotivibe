# Tasks

## 1. Query foundation (store, input wiring, URL sync)

- [x] 1.1 Add `frontend/src/stores/searchStore.ts` holding only `{ query, setQuery }` — verify: unit test covers initial empty query, update round-trip, and absence of result/status state in the store (`npm test`).
- [x] 1.2 Wire the top-bar `SearchInput` in `frontend/src/components/layout/TopBar.tsx` to the store with debounced `router.replace("/search?q=...")` navigation when on another route (compare-first, `replace` never `push`) — verify: component test asserts typing from a non-search route navigates to `/search` with the encoded query, the input keeps its value, and no navigation occurs when the param already matches (`npm test`).
- [x] 1.3 Implement two-way URL sync in the search page host (adopt `?q=` on mount/back/forward/deep-link into the store; debounced guarded `replace` when the store query differs from the param) — verify: component test covers deep-link seeding, back/forward adopting a previous query, clearing to the no-`q` browse state, and no replace-loop (`npm test`).
- [x] 1.4 Update the intentional placeholder assertions in `frontend/tests/routes.test.tsx` (the Search route is no longer an empty placeholder) — verify: the rewritten assertions pass and remain at least as strict (browse state with no query still renders no play controls) (`npm test`).

## 2. Request orchestration and search states

- [x] 2.1 Implement the search controller (300 ms debounce, monotonically increasing request sequence, `AbortController` per request; render only when `seq` is latest and not aborted) — verify: unit tests with stubbed `fetch` + fake timers assert one request per settled query, the superseded request's `signal.aborted` flips, a late stale response is discarded, and rapid typing ends with only the final query's results (`npm test`).
- [x] 2.2 Implement the state model and loading surface (idle/browse, loading skeletons shaped like result rows, results, empty, error, fallback branches per design §5) — verify: component test shows skeletons while pending and the correct section after resolution, with no blank region in any state (`npm test`).
- [x] 2.3 Add offline detection (`navigator.onLine` at request time plus `online`/`offline` listeners while the Search route is mounted, re-running the current query on change) — verify: component test with `navigator.onLine = false` asserts no `fetch` occurs and the offline notice renders, and that regaining connectivity re-runs the query (`npm test`).

## 3. Results derivation and rendering

- [x] 3.1 Implement pure derivation (`features/search/derive.ts`): song dedupe by `id`/`providerId` preserving order, artist dedupe by normalized name, album dedupe by normalized title+artist gated on metadata, exact-match Top Result rule (artist > album > #1 track title) — verify: unit tests cover each dedupe, metadata gating (no album without `track.album`), Top Result present on exact match, and absent otherwise (`npm test`).
- [x] 3.2 Build the result surfaces (`SearchResults`, `SongRow`, `TopResultCard`, `ArtistTile`, `AlbumTile`) using design tokens/`SectionHeader`, desktop two-column + compact stacked layout — verify: component tests assert songs render canonical title/artist/duration/artwork in API order, duplicate videos appear once in the DOM, and derived sections appear only when derivation yields entries (`npm test`).
- [x] 3.3 Add empty and error states (empty names the query; failure with no local matches shows `ErrorState` with a retry control) — verify: component tests assert both states render the expected copy and the retry control triggers a re-search (`npm test`).

## 4. Playback affordance

- [x] 4.1 Activate song results via `playerStore.playTrack(track, resultsAsContext)` — verify: component test clicks a row and asserts `currentTrack`/`status` in the store plus the player region showing the track, with the full result set as queue context (`npm test`).
- [x] 4.2 Guard against any automatic playback from the search surface — verify: test renders results and completes all controllers/effects and asserts the store status never leaves idle and no bridge load request is emitted (`npm test`).

## 5. Context actions

- [x] 5.1 Build `ResultMenu` (IconButton trigger with `aria-haspopup`/`aria-expanded`, `role="menu"` items in DOM order, Escape + outside-click close, visible focus) — verify: component tests assert accessible names, keyboard open/close, item activation dispatch, and no menu left open after outside click (`npm test`).
- [x] 5.2 Wire like/unlike through `likedTracks` (read `list()` on render → `Set` state; toggle awaits the repository before updating) — verify: component test with fake-indexeddb toggles state, persists across a fresh read, and unlikes back to baseline (`npm test`).
- [x] 5.3 Build the playlist picker dialog (lists `playlists.list()`, select → `addTrack`; inline create → `create` then `addTrack`; Escape/close with focus return) — verify: component tests cover add-to-existing, create-and-add, empty-playlist-library hint, and dialog dismissal semantics (`npm test`).
- [x] 5.4 Wire "go to artist"/"go to album" to refined-search navigation (`setQuery(name)`) — verify: component test activates each item and asserts the store query and results request update to that name (`npm test`).

## 6. Local-first search history

- [x] 6.1 Add `remove(query: string)` to `SearchHistoryRepository` (raw query in, normalized internally) in `frontend/src/data/repositories/index.ts` and `frontend/src/data/indexeddb/searchHistory.ts` — verify: repository test removes exactly one entry, leaves others newest-first, is a no-op for unknown queries, and the backup export/import suites still pass unchanged (`npm test`).
- [x] 6.2 Implement settle recording (result set rendered for the current query → 1.5 s settle timer → `searchHistory.record(query)`; cancelled on query change and route unmount; errors/fallbacks do not record) — verify: unit tests with fake timers assert recording after settle, cancellation when the query changes first, no recording on error state, and dedupe (re-search refreshes, not duplicates) (`npm test`).
- [x] 6.3 Build the Recent Searches browse surface (newest-first list, per-entry remove, clear-all, empty state when none) — verify: component tests with fake-indexeddb cover list rendering, remove-one leaving the rest, clear-all emptying, and state surviving a simulated reload (fresh repository read) (`npm test`).

## 7. Local library fallback

- [x] 7.1 Implement `features/search/localSearch.ts` (liked tracks + playlist tracks + bounded history, dedupe by track id, case-insensitive title/artist substring match) — verify: unit tests cover match/no-match, case-insensitivity, cross-source dedupe, and no history entries leaking duplicates (`npm test`).
- [x] 7.2 Wire fallback branches (remote failure → local matches + notice + retry; remote failure with no local matches → error state; offline → local only) — verify: component tests stub `fetch` to fail and assert fallback rendering, retry behavior, and that the failure request carried only `q`/`limit` parameters (`npm test`).

## 8. Integration verification and release evidence

- [x] 8.1 Extend `frontend/tests/architecture.test.ts` with positive/negative checks: `features/search` must not import `@/server/*`, raw provider shapes, or IndexedDB directly (repository-mediated only) — verify: both negative assertions fail when the rule is violated and pass on the clean tree (self-test pattern from M4) (`npm test`).
- [x] 8.2 Run the full quality gates from the repository root (`cd frontend && npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`) — verify: every command exits `0`.
- [x] 8.3 Produce CDP browser evidence against a production server (`npm run build` + `npm run start`): type in the top bar from Home (focus retained, URL updates, no stale results), click a result → real playback persisting across Home/Search/Library/Now Playing navigation, settle-recorded recent search with remove-one and clear-all, empty state, offline local fallback, single connected iframe throughout, zero console errors — verify: `results.json` reports `"pass": true` with screenshots and a reproduce-path README archived under the change's `evidence/`.
- [x] 8.4 Update `ROADMAP.md`: M5 status row → `DONE`; tick §11 Search/Discovery items delivered by this change (local library fallback/search, debounce + abort stale requests, search history); leave artist/album navigation and podcast items unticked — verify: `git diff` shows only those lines plus the status cell (no scope/status changes for other milestones).
- [x] 8.5 Re-verify the quality gates from a clean clone of the branch head — verify: all six commands exit `0` in the fresh clone (proves no uncommitted-file dependency).
