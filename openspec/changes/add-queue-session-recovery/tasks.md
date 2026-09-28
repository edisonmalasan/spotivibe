# Tasks

## 1. Queue store foundation

- [ ] 1.1 Create `frontend/src/stores/queueStore.ts` holding `{ queue, queueIndex, playOrder, history, source, shuffle, repeatMode }` with `resetQueueStore()`, `setContext(track, context, source)` (adopt by id, append-if-missing preserved), relocated pure traversal helpers (`buildPlayOrder`, `findNextUnfailed`, `findPreviousUnfailed`), and `sameQueueIdentity` (id, or source+providerId) — verify: unit tests cover initial state, context adoption pointing the index at the activated track, the identity matrix, and reset isolation (`npm test`).
- [ ] 1.2 Move shuffle/repeat state and their actions (`toggleShuffle`, `cycleRepeat`) out of `playerStore` into `queueStore`, removing `queue`, `queueIndex`, `playOrder`, `history`, `shuffle`, `repeatMode` from `PlayerState` — verify: the existing shuffle/repeat behavior tests pass with assertions relocated to read `queueStore`, and `initialPlayerState` no longer contains those keys (`npm test`).

## 2. Player store orchestration split

- [ ] 2.1 Make `playTrack(track, context?, source?)` delegate context adoption to `queueStore.setContext` (default source `unknown`) and have `SearchView` pass `search` — verify: playTrack test asserts `queueStore` holds the adopted context + source while `playerStore` holds only transport fields, and the search playback test still passes with the source recorded (`npm test`).
- [ ] 2.2 Reimplement `next()`, `previous()`, `_onEnded()`, `_advanceAfterFailure()` to orchestrate through `queueStore` traversal resolution while issuing `loadRequest` from `playerStore` — verify: the pre-existing behavior tests (repeat modes, failed skipping, end-of-list settle, engine ended handling) pass with their assertions unchanged (access paths only) (`npm test`).
- [ ] 2.3 Point shuffle/repeat consumers at `queueStore` (`ShuffleToggle`, `RepeatToggle`, `PlayerBar`, `MiniPlayer`, `/now-playing`) — verify: component tests toggle each control and assert the flag lives in `queueStore` with the UI reflecting it across both stores (`npm test`).

## 3. Queue management operations

- [ ] 3.1 Implement `enqueue(track)` with duplicate protection (reject when identity exists in `queue[queueIndex…]`; append to array end and `playOrder` tail when shuffle is on; never touch transport) — verify: matrix tests cover duplicate-current rejected, duplicate-upcoming rejected, double activation adds one, already-played-only accepted, and transport fields unchanged after each call (`npm test`).
- [ ] 3.2 Implement `remove(index)` with pointer integrity (after current → splice only; before current → index shift; current → orchestrate next-track load or clean idle stop when empty) — verify: table-driven tests cover all three cases plus last-entry removal ending `idle` with no error and no autoplay, with `playOrder` reindexed and the current-by-identity invariant asserted after every mutation (`npm test`).
- [ ] 3.3 Implement `reorder(from, to)` over the displayed upcoming sequence (rewrite queue positions after current, rebuild `playOrder` consistently under both shuffle states) — verify: store tests assert the current track/status/position are unchanged, the new next entry matches the moved order, and shuffle-on remains pointer-consistent (`npm test`).

## 4. History bookkeeping and history-aware previous

- [ ] 4.1 Record finished tracks onto `history` on every successful advance (not on repeat-`track` replay), bounded to `HISTORY_LIMIT = 50` with oldest dropped — verify: tests cover each advance source recording once, the repeat-`track` exclusion, and the bound enforcement (`npm test`).
- [ ] 4.2 Implement `previous()` history semantics (restart when >3 s; otherwise scan queue backwards from the current position for the newest history identity, popping entries — dropped when the track no longer exists; fall back to context step-back, then restart) — verify: a test matrix covers all four branches plus the history pop after a history jump (`npm test`).

## 5. Session persistence extension

- [ ] 5.1 Extend `SessionSnapshot` with optional `history`, `playOrder`, `source` and mirror them as optional fields in the backup zod schema; `snapshotOf`/`restoreSession` write and reapply them with validation (non-permutation `playOrder` falls back to `buildPlayOrder`) — verify: round-trip test, an old-shape fixture restoring with empty history/derived order/`unknown` source and no error, and the backup export/import suites passing unchanged (`npm test`).
- [ ] 5.2 Subscribe persistence to both stores so queue edits flush (debounce and hidden/pagehide flush unchanged) — verify: persistence tests assert a queue mutation triggers the debounced write and that pagehide captures queue edits (`npm test`).

## 6. Queue surface

- [ ] 6.1 Add `frontend/src/app/queue/page.tsx` + `frontend/src/features/queue/QueueView` with Now playing / Next & upcoming (traversal order) / Recently played sections, source label, and the empty state — verify: a `/queue` case in `tests/routes.test.tsx` plus component tests for section order, canonical row metadata, source-label presence/absence, and the empty state (`npm test`).
- [ ] 6.2 Add row affordances: remove, `Move up`/`Move down` keyboard controls, and native HTML5 drag wiring on upcoming rows — verify: component tests assert removal updates the list, move controls produce the same store operation as drag, accessible names exist, and focus is visible/keyboard-operable (`npm test`).
- [ ] 6.3 Enable the Queue controls: `PlayerBar` (accessible name `Queue, N upcoming` / `Queue, empty`) and `/now-playing` navigate to `/queue` — verify: component tests assert navigation and the dynamic accessible name, with the existing playerBar/now-playing suites updated and passing (`npm test`).

## 7. Add to queue from search

- [ ] 7.1 Add the "Add to queue" item to `features/search/ResultMenu.tsx`, appending via `queueStore.enqueue` and closing the menu — verify: component test asserts one appended entry (duplicate protection), unchanged current track/status/position, and the menu closing (`npm test`).

## 8. Network state, banner, and recovery

- [ ] 8.1 Create `frontend/src/stores/networkStore.ts` (`connection: online|degraded|offline`, `lastChangedAt`, `resetNetworkStore()`) and idempotent `initNetworkMonitor()` with the derivation priority offline > degraded (saveData or slow-2g/2g via Network Information) > online — verify: unit tests cover the derivation matrix with the API present/absent, event-driven transitions, and double-init not adding listeners (`npm test`).
- [ ] 8.2 Build `ConnectionBanner` mounted in `AppShell` (`role="status"`, offline/degraded variants, clears on online, token-only styling, fixed clear of the player region) — verify: component tests assert copy per state, disappearance on reconnect, presence across routes, and that it renders outside the player viewport area (`npm test`).
- [ ] 8.3 Suppress failure consumption while offline in `playerStore` (`_markFailed`/`_advanceAfterFailure` park without growing `failedTrackIds` or advancing, with offline-specific error copy) — verify: tests assert no failed-set growth and no advance while offline, while the existing online skip/settle tests still pass unchanged (`npm test`).
- [ ] 8.4 Implement reconnect recovery (`initNetworkRecovery`: on transition to online, one `loadRequest` at `positionSeconds` for `status ∈ {error, loading, buffering}` with a current track; no action for paused/idle/playing; failed retry settles via the normal error path) — verify: tests assert the exact retry matrix — one reload at position, zero calls from paused/idle, and no retry loop (`npm test`).
- [ ] 8.5 Wire monitor/recovery init + cleanup into `PlayerHost` alongside session persistence — verify: playerHost test asserts both initialize once on mount and listeners are removed on unmount (`npm test`).

## 9. Integration verification and release evidence

- [ ] 9.1 Extend `frontend/tests/architecture.test.ts` with positive/negative self-tested rules: `queueStore` must not import `playerStore` or the engine, and `initialPlayerState` must not contain queue membership fields — verify: both rules fail on violating input and pass on the clean tree (M4 self-test pattern) (`npm test`).
- [ ] 9.2 Run the full quality gates from the repository root (`cd frontend && npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`) — verify: every command exits `0`.
- [ ] 9.3 Produce CDP browser evidence against a production server (`npm run build` + `npm run start`): enqueue from search, reorder/remove in `/queue` while playing with the current track untouched, reload restoring queue/history/source at position with no autoplay, offline mid-playback showing the banner with queue/position byte-identical and no failed-set growth or advance, reconnect issuing a single retry at position and clearing the banner, one iframe/one API script with the banner never covering the player, zero console errors — verify: `results.json` reports `"pass": true` with screenshots and a reproduce-path README archived under the change's `evidence/`.
- [ ] 9.4 Update `ROADMAP.md`: M6 status row → `DONE`; tick §11 Queue/Radio items (add/remove/reorder, current/next/upcoming/history, duplicate protection, auto-advance) and §11 Local-First/PWA `Online/offline indicators`; leave `Pre-cue next where safe` and all M10/M11/M13 items (queue autofill, radios, refill, played-dedupe, offline shell items) unticked — verify: `git diff` shows only those lines plus the status cell (no scope/status changes for other milestones).
- [ ] 9.5 Re-verify the quality gates from a clean clone of the branch head — verify: all six commands exit `0` in the fresh clone (proves no uncommitted-file dependency).
