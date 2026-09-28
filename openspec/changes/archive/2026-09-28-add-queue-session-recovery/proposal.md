# Proposal

## Why

M4 shipped the persistent playback engine: a single flat context (`queue: Track[]` + `queueIndex`), auto-advance with repeat/shuffle traversal, retry/backoff, unplayable-track skipping, and session restore with position — and M2 shipped the `session` repository explicitly annotated "consumed by M6". But the product still cannot behave like a real music application: there is no way to add, remove, or reorder queue items (no duplicate protection either), `previous` only steps backward through list order rather than actual playback history, the Queue controls in the player bar and Now Playing are disabled placeholders with no queue surface anywhere, and the whole app is blind to connectivity — a connection loss mid-playback lets the engine's failure handling burn through the queue marking tracks failed (destroying usable state), while nothing tells the user why playback stalled. ROADMAP M6 requires a dedicated `queueStore` modeling current/next/upcoming/history with queue source, safe queue management, sensible previous behavior, locally persisted queue/session restored on reload, and an online/slow/offline state machine with a connection banner and safe, gesture-compliant reconnect.

## What Changes

- **Dedicated `queueStore`**: queue membership, current index, traversal order (play order), played history (bounded), queue source/context label, and shuffle/repeat interaction move out of `playerStore` into a new queue store; `playerStore` remains the transport façade (current track, status, position, duration, volume, mute, errors, load requests) that the engine and controls use, with a one-way dependency on the queue store.
- **Queue management**: add-to-queue (append; duplicate protection by track/provider identity), remove (pointer integrity for items before/at/after the current one, including clean stop when the queue empties), and reorder of the upcoming sequence (drag-and-drop plus keyboard-accessible move controls).
- **History-aware previous + advance bookkeeping**: advancing records the finished track into a bounded played-history stack; `previous` restarts the current track near its start (unchanged) and otherwise returns through the actually-played history before falling back to context order.
- **Queue surface**: a new `/queue` route (Now playing / Next & upcoming / Recently played, with source label, remove and reorder affordances, empty states), and the disabled Queue controls in the player bar and Now Playing become links to it; the player-bar control exposes the upcoming count in its accessible name.
- **Add to queue from search**: the M5-deferred `ResultMenu` item appends a result to the queue without disturbing playback.
- **Session persistence extension**: the session snapshot additionally carries played history, traversal order, and queue source (optional fields on the backup schema, backward compatible with existing exports); restore validates and reapplies them, still cueing paused with no autoplay.
- **Network state and recovery**: a new `networkStore` (online / degraded-where-detectable / offline, monitored once per session), a persistent route-independent `role="status"` banner in the shell that never obscures the player surface, connection-loss behavior that preserves position/status/queue and prevents offline failures from marking tracks failed or advancing, and a bounded single reconnect retry of an interrupted user-initiated track at its saved position — never starting playback from idle or paused.

Explicit scope boundaries — deferred to the milestones that own them (per ROADMAP milestone sections):

- **Pre-cue next item** → *not safely implementable within M6*: pre-cueing the next video requires either a second player instance or replacing the current video on the single instance, both conflicting with the binding playback requirement "exactly one underlying YouTube player instance SHALL exist" and M4's verified evidence (exactly one iframe/API script). The roadmap phrases the task "where supported without breaking current playback" — it is not supported under the current single-instance contract, so §11 "Pre-cue next where safe" stays unticked with this rationale recorded rather than being silently checked. A future approved change may revisit it with an explicit spec amendment.
- **Queue autofill, Track Radio, Artist Radio, radio refill, played-track dedupe for autofill** → M10 (radio capability does not exist; M6 history is a traversal stack, not a recommendation feed).
- **Playlist play-all/shuffle entry points and playlist reorder** → M7 (queue primitives are generic; the Library surfaces that feed them are M7's).
- **Listening-event recording to `listeningHistory`** → M11 (queue history is playback bookkeeping, not analytics; the dataset's unused `queue` source value stays untouched).
- **Now Playing page redesign** → M9 (M6 only enables its existing Queue control to reach `/queue`).
- **Offline-app-availability messaging and service-worker update flow** → M13 (M6's banner reports live connectivity, not PWA offline capability).
- **Refactoring search's route-scoped connectivity listeners onto the shared service** → not performed: both read the same underlying browser signals (`navigator.onLine` + `online`/`offline` events) so their values cannot diverge, and search already satisfies its spec; consolidating would be an unrelated behavioral-risk refactor.

## Capabilities

### New Capabilities

- `queue`: the queue model and its surface — dedicated queue state (ordered context, current index, traversal order, bounded played history, source label, shuffle/repeat), insertion with duplicate protection, removal and reordering with pointer integrity, traversal bookkeeping on advance, and the `/queue` route with its controls.
- `network`: connectivity awareness — the shared connection state machine (online / degraded where detectable / offline), the persistent connection banner across routes, connection-loss preservation of playback state and queue, and safe bounded recovery on reconnect without autoplay.

### Modified Capabilities

- `playback`: four requirements adapt to the M6 architecture and behavior — *Store-backed playback state and control synchronization* (the "single client-side store" phrasing becomes an explicit two-store split: transport in `playerStore`, queue state in `queueStore`, player events still authoritative), *Track playback lifecycle* (previous gains history-aware behavior), *Unplayable track handling* (failures while offline must not mark tracks failed or advance — no queue burn-through during outages), and *Session persistence without autoplay* (snapshot gains history, traversal order, and source; restore reapplies them; still no autoplay).
- `search`: *Result context actions* gains the "Add to queue" menu item (the action M5 explicitly deferred to M6) with a scenario asserting it appends without disturbing playback.

### Unmodified Capabilities

- `app-shell`: the connection banner is a fixed-position `role="status"` overlay that changes no layout region (sidebar/top bar/main/player region all as specified), so no delta is required; its non-obscuring behavior is owned by `network`.
- `local-data`: the session/queue dataset contract ("support their create/read/update/list/clear operations") and the backup dataset list are unchanged — the snapshot gains fields *inside* the existing dataset, optional on import, so old exports remain valid; no new IndexedDB store or backup dataset is introduced.
- `music-provider`: untouched (no server or provider changes).

## Impact

- **Code**: new `frontend/src/stores/queueStore.ts` and `frontend/src/stores/networkStore.ts`; new `frontend/src/features/queue/` slice + `frontend/src/app/queue/page.tsx`; `frontend/src/stores/playerStore.ts` (queue fields/actions move out, delegation + offline-failure suppression + reconnect retry), `frontend/src/player/persistence.ts` (snapshot both stores, extended fields), `frontend/src/components/layout/AppShell.tsx` (banner) and `PlayerBar.tsx` + `frontend/src/app/now-playing/page.tsx` (enable Queue controls), `frontend/src/features/search/ResultMenu.tsx` (add-to-queue item), `frontend/src/data/repositories/types.ts` + `frontend/src/data/backup/schema.ts` (optional snapshot fields). No server route changes; no new dependencies (drag-and-drop uses native HTML5 DnD plus keyboard move controls).
- **Tests**: existing `frontend/tests/player/*` suites updated where the store split changes access paths (behavior assertions preserved), new queue-store/management/surface/network suites, `tests/routes.test.tsx` gains the `/queue` route, `tests/architecture.test.ts` gains the dependency-direction rule (`queueStore` must not import `playerStore`; `playerStore` must not hold queue membership fields).
- **Roadmap**: M6 status row → `DONE` and §11 items delivered by this change ticked during Apply — Queue/Radio: add/remove/reorder, current/next/upcoming/history, duplicate protection, auto-advance; Local-First/PWA: online/offline indicators (M6 owns the banner; M13 keeps only offline-availability messaging and SW update flow per its own tasks). Player "Pre-cue next where safe" and all M10/M11/M13 items stay unticked.
- **Out of scope**: no server changes, no new dependencies, no radio/autofill, no library/playlist surfaces, no milestone beyond M6.
