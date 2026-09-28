# Design

Binding technical decisions for `add-queue-session-recovery`. Requirements come from the four spec deltas; this document fixes *how* they are implemented. Where ROADMAP and DESIGN.md are silent (queue surface, banner visuals — DESIGN.md contains no queue/banner/player-bar design), this document is the visual/behavioral authority, using design tokens only (app-shell token rule).

## 1. Two-store split

- **`frontend/src/stores/queueStore.ts`** (new) owns queue state: `queue: Track[]`, `queueIndex: number`, `playOrder: number[]`, `history: QueueHistoryEntry[]`, `source: QueueSource`, `shuffle: boolean`, `repeatMode: RepeatMode`, plus management actions (below) and a `resetQueueStore()` test helper mirroring `resetPlayerStore()`.
- **`frontend/src/stores/playerStore.ts`** keeps transport only: `currentTrack`, `status`, `positionSeconds`, `durationSeconds`, `volume`, `muted`, `errorMessage`, `failedTrackIds`, `loadRequest` — and keeps `next()` / `previous()` / `_onEnded()` / `_advanceAfterFailure()` / `playTrack()` / `restoreSession()` as the **orchestration façade** the engine and controls already use: each asks `queueStore` to resolve/mutate, then issues its own `loadRequest`. The engine keeps importing only `playerStore`.
- **Dependency rule:** `queueStore` must never import `playerStore` (or the engine); `playerStore` → `queueStore` is the only direction. Enforced by an architecture test (§10).
- Field migration: `queue`, `queueIndex`, `playOrder`, `history`, `shuffle`, `repeatMode` are removed from `PlayerState`; `ShuffleToggle`, `RepeatToggle`, `PlayerBar`, `MiniPlayer`, and `/now-playing` read shuffle/repeat from `queueStore`. `playTrack(track, context?, source?)` delegates context adoption to `queueStore.setContext(...)`.
- `QueueSource = "search" | "browse" | "library" | "queue" | "unknown"` with display labels ("From search" …); `search` is the only M6 producer (passed by `SearchView`), others are inert enum values for later milestones. `QueueHistoryEntry = { track: Track; playedAt: number }`.

## 2. Model mapping (ROADMAP nouns → fields)

- **current** = `playerStore.currentTrack`, pointed at by `queueStore.queueIndex`.
- **next** = the entry after `queueIndex` in traversal order (`playOrder` successor; list successor when shuffle off).
- **upcoming** = the traversal sequence after the current entry (this is what `/queue` lists).
- **history** = `history` stack (bounded `HISTORY_LIMIT = 50`, oldest dropped on overflow) — session playback bookkeeping only; it is *not* the `listeningHistory` dataset (M11) and never blocks insertion.
- **queue context/source** = `source` + the adopted context list.
- **shuffle/repeat interaction** = `playOrder` (current-first permutation, Fisher–Yates for the remainder) + `repeatMode`, semantics unchanged from M4 (`off → context → track` cycling; circular traversal only under `context`).

## 3. Traversal and previous

- Advancement logic (`findNextUnfailed`, `findPreviousUnfailed`, repeat wrap, failed-set skipping) moves verbatim into `queueStore` (pure helpers over its state); `playerStore` calls them and loads the returned target. Termination proof (growable failed set) is unchanged.
- **History recording:** on any successful advance where the target ≠ the replayed track (manual next, ended, failed-skip — not repeat-`track` replay), push the finished entry onto `history`.
- **`previous()` semantics:** (1) `positionSeconds > 3` → `seek(0)` (unchanged M4 behavior, spec scenario preserved); (2) otherwise take the newest `history` entry and resolve its queue position by scanning `queue` **backwards from `queueIndex - 1`** for a matching identity — if found, load it and pop that history entry; if the entry's track no longer exists in the queue (removed meanwhile), drop it and try the next; (3) history exhausted → fall back to `findPreviousUnfailed` context step-back; (4) nothing → `seek(0)`. Scanning backwards from the current position makes history resolution unambiguous even if a duplicate identity exists in the played region.

## 4. Insertion, removal, reordering

- **Identity:** `sameQueueIdentity(a, b)` ⇔ `a.id === b.id` || (`a.source === b.source` && `a.providerId === b.providerId`) — mirrors `derive.ts` song dedupe.
- **`enqueue(track)`:** reject when the identity exists in `queue[queueIndex … end]` (current + upcoming — including the currently playing track); otherwise append to the array end and, when shuffle is on, append the new index to the `playOrder` tail. Never touches transport.
- **`remove(index)`:** `index > queueIndex` → splice, pointers untouched; `index < queueIndex` → splice, `queueIndex -= 1`; `index === queueIndex` → orchestrate through `playerStore`: next entry exists → load it (continues playing — the removal click is the user gesture); none → clean stop (`status: "idle"`, `currentTrack: null`, position 0, `bridge.pause()`; no error, no autoplay). `playOrder` is filtered/reindexed in every branch, then the current pointer is re-verified by identity (invariant check — tests assert it after every mutation).
- **`reorder(from, to)`** operates on the **displayed upcoming** (traversal) sequence: compute the moved sequence `S`, rewrite `queue` positions `> queueIndex` to `S`'s order, then rebuild `playOrder = [queueIndex, …S indices, …behind indices]` (shuffle on) or sequential identity (shuffle off). Both stores therefore stay consistent; a manual reorder is an explicit user ordering that outranks the shuffled permutation until the next context load or shuffle toggle. Drag = native HTML5 DnD on rows; keyboard = `Move up` / `Move down` `IconButton`s per row (same operation, identical result — spec scenario). Behind-current entries are untouched; the current entry can never be a reorder target (it has its own remove path).

## 5. Queue surface

- **Route:** `frontend/src/app/queue/page.tsx` + `frontend/src/features/queue/` (`QueueView`, `QueueRow`, section headers, empty state). Sections: **Now playing** (single row), **Next & upcoming** (traversal order; remove + move affordances), **Recently played** (read-only rows; no actions — M6 smallest). Header shows `source` label when not `unknown`; `EmptyState` ("Nothing queued yet") when `queue.length === 0`.
- **Rows** reuse design-system `IconButton`/typography tokens: artwork, title, artist, duration; controls: `Remove from queue`, `Move up`, `Move down` (hidden behind hover *and* always keyboard-focusable; `draggable` rows for pointer users).
- **Enabled placeholders:** `PlayerBar` and `/now-playing` `IconButton label="Queue"` become navigation to `/queue` (client `Link`/`router.push`); PlayerBar's accessible name carries the count: `Queue, N upcoming` (N > 0) / `Queue, empty`. No new BottomNav item (queue is an on-demand surface, mirroring Spotify). Compact access is via the Now Playing queue control.
- No autplay: the surface contains no play actions in M6 (activation paths live elsewhere); rows are metadata + management only.

## 6. Session persistence extension

- `SessionSnapshot` gains **optional** fields: `history?: QueueHistoryEntry[]`, `playOrder?: number[]`, `source?: QueueSource`; backup zod schema mirrors them as optional (old exports validate unchanged; new exports carry them — no dataset/count changes, so `architecture.test.ts` whitelists stay valid; `local-data` spec untouched).
- `snapshotOf` reads both stores; the persistence subscription subscribes to `playerStore` **and** `queueStore` (queue edits flush too); debounce (2 s) and hidden/pagehide flush unchanged.
- `restoreSession`: restores queue/index/position/repeat/volume as today, then applies `history`/`playOrder`/`source` when present (validating `playOrder` is a permutation of `queue` indices, else deriving via `buildPlayOrder`); old snapshots restore with empty history, derived order, `unknown` source. Still `mode: "cue"` + paused — no autoplay.
- Import: `backup/plan.ts` session equality stays keyed on index + queue ids (its role is merge messaging only); `backup/schema.ts` gains the optional keys.

## 7. Network store and monitor

- **`frontend/src/stores/networkStore.ts`**: `{ connection: "online" | "degraded" | "offline", lastChangedAt }` + `resetNetworkStore()`.
- **Derivation (priority order):** `!navigator.onLine → offline`; else Network Information present ∧ (`saveData` ∨ `effectiveType ∈ {slow-2g, 2g}`) → `degraded`; else `online`. API absent → only online/offline ever (no fabricated degradation — spec).
- **`initNetworkMonitor()`** — idempotent, once per page session: window `online`/`offline` listeners + `navigator.connection` `change` listener (when present), each re-deriving and writing the store. Called from `PlayerHost`'s mount effect next to session persistence (shell-global, testable with `resetNetworkStore()` + teardown in test isolation). No side effects at module import (bundler purity).
- **No search refactor** (proposal boundary): search keeps its route-scoped listeners — same underlying signals, no divergence possible.

## 8. Connection banner

- `frontend/src/components/layout/ConnectionBanner.tsx`, mounted once in `AppShell` (renders on every route in both variants). Position: fixed, top-right beneath the 64 px top bar (`z` below player overlays), so it can never overlap the bottom player region — scenario evidence via `elementsFromPoint` at the player center with the banner visible.
- Content: `role="status"` (polite live region), token-styled surfaces only: offline → surface `#1f1f1f`, primary text, accent dot, persistent until online; degraded → secondary text, subdued. Copy: offline "You're offline — some things won't load until you reconnect."; degraded "Connection looks slow.".

## 9. Offline failure suppression and reconnect recovery

- **Suppression (in `playerStore`, the single funnel):** `_markFailed` and `_advanceAfterFailure` first check `networkStore.getState().connection === "offline"` (or `!navigator.onLine` fallback): while offline they do **not** grow `failedTrackIds`, do **not** schedule advance, and set `status: "error"` with offline-specific copy ("You're offline — playback will resume when you reconnect."). The engine's transient retry/backoff continues to run (bounded, harmless); if it exhausts while still offline it lands in the same parked branch. Because the failed set never grows offline, reconnect cannot inherit a burned queue.
- **Recovery:** `initNetworkRecovery()` (idempotent, mounted from `PlayerHost`) subscribes to `networkStore` and on a transition **to online** inspects current transport state: `status ∈ {"error", "loading", "buffering"}` && `currentTrack` → issue **one** store `loadRequest` (`mode: "load"`, `startSeconds: positionSeconds`) for the same track — the user-initiated lineage of the original activation carries the gesture; browser refusal leaves the player paused (no re-loop — playback spec's external-pause rule applies). `status ∈ {"playing", "paused", "idle"}` → no action (paused/idle never resume automatically — spec; playing is unaffected). One retry per transition; a failed retry surfaces through the normal error path (bounded). A redundant engine backoff timer firing concurrently reloads the same id/position — accepted as idempotent.
- Player-host wiring keeps all cross-cutting init (`attachSessionPersistence`, `initNetworkMonitor`, `initNetworkRecovery`) in one place with cleanup on unmount.

## 10. Verification strategy

- **Unit/component (vitest + jsdom, fake timers, fake-indexeddb where repositories are touched):** store model and mutations with invariant assertions after each op; identity/dedupe matrix; pointer-integrity table for remove (before/at/after/last); reorder equivalence drag vs keyboard (same op ⇒ same result asserted at the store level); history bounds and previous resolution (found / removed / exhausted / restart fallback); snapshot round-trip including old-shape restore; network derivation matrix (API present/absent, events); banner presence/absence/copy; suppression (offline failure ⇒ no failed-set growth, no advance) and recovery matrix (error/loading/buffering ⇒ one reload at position; paused/idle ⇒ zero calls; failed retry ⇒ settled error); search add-to-queue scenario; existing `tests/player/*` behavior assertions preserved (access paths updated, not weakened).
- **Architecture (`tests/architecture.test.ts`, self-tested positive/negative pattern):** `queueStore` must not import `playerStore`/engine; `initialPlayerState` must not contain queue membership fields (`queue`, `queueIndex`, `playOrder`, `history`, `shuffle`, `repeatMode`); both rules proven to fail on violating input.
- **Browser evidence (task 8.3, CDP):** enqueue from search → reorder/remove in `/queue` while playing (current untouched) → reload restores queue/history/source with position and no autoplay → offline mid-playback: banner appears, queue/position byte-identical, no failed-set growth, no advance → reconnect: single retry resumes at position → banner cleared, player surface never obscured (one iframe, one API script), zero console errors.
