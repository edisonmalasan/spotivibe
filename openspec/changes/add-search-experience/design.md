# Design

## Context

- M1 left a placeholder Search route (`app/search/page.tsx`, empty state only) and a presentational `SearchInput` in the top bar that is not wired to anything.
- M3 provides the server contract consumed as-is: `GET /api/search?q&limit` → `{ tracks: Track[], diagnostics }` (400 `invalid_query`, 503 `upstream_unavailable`, 499 on caller abort; `Cache-Control: public, max-age=60`). The response is a **flat, score-ordered Track array** — no topResult/songs/artists/albums grouping, and `music-provider` spec forbids the UI from depending on diagnostics.
- M2 provides repositories: `searchHistory` (`record`/`list`/`clear`, no remove-one yet), `likedTracks` (`like`/`unlike`/`isLiked`/`list`), `playlists` (`list`/`create`/`addTrack`), `listeningHistory` (`list`). Components must use repository interfaces only (local-data spec).
- M4 provides `playerStore.playTrack(track, context?)`; it currently has **no UI caller**.
- Design system has `SectionHeader`, `Skeleton`, `EmptyState`, `ErrorState`, `Button`, `IconButton`, `ArtistCard`, `AlbumCard`, `SearchInput` — but no track row, menu, or dialog primitive. The only feature-slice precedent is `features/backup/DataControls.tsx`.

## Goals / Non-Goals

**Goals:**

- A stale-safe, responsive search flow where the top-bar input is the single entry point and the URL is shareable/restorable.
- Render rich results (Top Result, Songs, derived Artists/Albums) from the canonical Track contract alone.
- Make search the first playback entry point and expose the M5 context actions against existing M2 repositories.
- Local-first history and local-library fallback with zero new server work.

**Non-Goals:**

- Queue management (add-to-queue), radio, artist/album entity pages, podcast search mode — deferred to M6/M10/M9/M12 per the proposal's scope boundaries.
- Recording listening events (M11) and any server/provider changes (M3 contract is consumed unchanged).
- A shared design-system menu/dialog/track-row primitive — kept feature-local until another feature needs it (avoid speculative abstraction).

## Decisions

### 1. Client-side result derivation, not a server grouping change

Top Result / Artists / Albums are derived in a pure module (`features/search/derive.ts`) from the canonical `Track[]`: artists dedupe by normalized artist name (first occurrence wins), albums dedupe by normalized album title + artist, songs collapse by `id`/`providerId` preserving API relevance order.

**Why:** the `music-provider` API contract and its tests stay untouched (no spec delta), derivation doubles as the local-fallback presentation layer (same Track shape), and "where metadata can be resolved" is literally satisfied by only emitting entries whose metadata exists. **Alternative rejected:** extending the API response with grouped results — requires provider-layer entity extraction (M3 fixture/spec churn), a `music-provider` delta, and would still not cover local fallback.

**Top Result rule (deterministic):** exact normalized (trim + case-insensitive) match of the query against any result artist name → artist card; else against any result album title → album card; else against the #1 ranked track's title → that track. No fuzzy/partial matching — when no exact match exists, no Top Result renders ("when a clear best match exists"). Top Result duplicates neither removes the item from Songs.

### 2. Query state: tiny zustand store + page-local controller

`searchStore` holds only `{ query, setQuery }` — the value shared by the top-bar input (AppShell) and the search page. Everything else (debounce timer, AbortController, request sequence, results/derived sections, status, recents, notices) lives in a page-local controller (`useSearchController` + `SearchView` in `features/search/`).

**Why:** two distant components need the query, so a shared store is the codebase's established pattern (playerStore), but results/recents are page-scoped — keeping them out of global state avoids a second state machine to reconcile on unmount/remount and keeps the orchestration testable in one place. **Alternatives rejected:** URL-only state (controlled-input lag and two-way sync glitches while typing); full results store (unnecessary global surface, stale-results reconciliation on back/forward).

### 3. URL synchronization

- Top bar `onChange` → `setQuery` immediately, then a debounced `router.replace("/search?q=...")` when not already on the Search route (typing from Home navigates without remounting the input — AppShell owns TopBar, so focus survives).
- The page reads `useSearchParams`; when the param differs from the store (deep link, back/forward) it adopts it into the store; when the store query differs from the param it debounced-`replace`s. Every write is guarded by a compare-first check so the two directions cannot loop.
- `replace` (never `push`) so back/forward steps between settled queries, not keystrokes.

### 4. Request orchestration: debounce + sequence token + abort

On query change: cancel prior timer → 300 ms debounce → issue `fetch("/api/search", { signal })`. Each issued request gets a monotonically increasing sequence number. A response renders only if `seq === latestSeq` **and** its signal is not aborted; the previous controller is `abort()`ed when a new request issues.

**Why both seq and abort:** abort races are real (a response can be resolved-but-unsettled when abort lands), mirroring M4's loadRequest-token discipline. **Spec mapping:** debounce/abort/stale-guard scenarios of *Debounced stale-safe requests*; HTTP cache (browser + server 60 s TTL) covers back/forward repeats without a client cache layer.

### 5. State model

```
query empty            → browse state (recent searches if any, else EmptyState)
remote pending         → loading (skeletons shaped like result rows)
remote ok, tracks      → results (sections derived)
remote ok, 0 tracks    → empty state naming the query
offline at query time  → skip remote entirely → local results + offline notice
remote failed          → local fallback matches + notice + retry;
                         if no local matches → ErrorState with retry
```

Offline detection is `navigator.onLine` checked at request time plus `online`/`offline` listeners while the Search route is mounted (re-runs the current query on change). This is deliberately search-local — the global network-state service is M6 scope.

### 6. Local fallback

`features/search/localSearch.ts`: load `likedTracks.list()`, `playlists.list()` (flatten ordered tracks), `listeningHistory.list()` (bounded), dedupe by track id, case-insensitive substring match on title + artist names. Pure and unit-tested; called only on remote failure/offline, so no library data is ever attached to a request (music-provider "local data never reaches the provider layer").

### 7. Search history recording

Record via repository when a result set **settles**: a response rendered for the current query, held for a 1.5 s settle window, then `searchHistory.record(query)` — timer cancelled if the query changes or the route unmounts. Re-searching refreshes `searchedAt` (existing `record` semantics), so interim queries during a typing burst collapse rather than spam. Error/fallback-not-settled states do not record.

**Remove-one:** add `remove(query: string)` to `SearchHistoryRepository` (raw query in, normalized internally — symmetric with `record`), implemented in `data/indexeddb/searchHistory.ts` with a keyPath delete; export/import untouched (the record shape is unchanged, merge semantics unaffected).

### 8. Context actions

- **Like/unlike:** read `likedTracks.list()` when results render → `Set<trackId>` for state; toggle awaits the repository before updating UI (IndexedDB is fast; no optimistic-rollback complexity).
- **Add to playlist:** feature-local dialog (`role="dialog"`, Escape/close, focus return) listing `playlists.list()`, plus inline "create new playlist" (name → `create` → `addTrack`). Inline create is included because otherwise the action is inert on a fresh install; it uses only M2 repository APIs and builds no library surface (M7 owns those).
- **Go to artist / go to album:** `setQuery(artistOrAlbumName)` → the search itself is the navigation destination until M9 pages exist.
- **Menu:** feature-local `ResultMenu` — `IconButton` trigger with `aria-haspopup`/`aria-expanded`, `role="menu"` items in DOM order (tab-reachable), Escape + outside-click close. No portal; the menu is clipped only by row overflow which we avoid with z-index. Keyboard operability per spec, full arrow-key roving tabindex deferred until a shared menu exists.

### 9. Playback

Song row activation → `playTrack(track, resultsAsContext)` (M4 store; no store changes needed). Search never autoplays; `listeningHistory.record` on play is M11 scope and is not wired here.

### 10. Layout

Desktop: left column Top Result + Songs, right column Artists + Albums (DESIGN.md surfaces `#121212` cards, hover `#1f1f1f`, `SectionHeader`); compact stacks sections vertically. Skeletons: 1 top-result block + 6–8 text/block rows. All tokens from app-shell design-token foundation; no new design-system files.

## Risks / Trade-offs

- [Derived artist/album quality capped by track metadata (no artist images/IDs)] → static `ArtistCard`/`AlbumCard` icon art per DESIGN.md; entries only emitted when metadata resolves; M9 upgrades navigation targets.
- [Settle-timer can record an interim query if the user pauses mid-type] → 1.5 s window + `record` dedupe keeps the list short; matches "recent searches" semantics. Acceptable.
- [Two-way URL sync can loop or clobber focus] → compare-first writes, `replace` only, and a dedicated browser-evidence step (type from Home, assert focus + no lost characters + single history entry per settled query).
- [jsdom fetch/abort testability] → orchestration reads `globalThis.fetch` through the controller with an injected `AbortSignal`; tests stub `fetch` and assert `signal.aborted` on supersede — no real network.
- [routes.test.tsx placeholder assertions become wrong] → intentional test update (documented in tasks), same precedent as M4's progress-slider role change; assertions are strengthened, not deleted.
- [Like-state race if two surfaces toggle the same track] → last-write-wins on the repository (M7's library surface will re-read state); not a data-loss path.

## Migration Plan

None. No schema/backup changes (the search-history record shape is unchanged; only a new repository method). Rollback = revert the feature branch commits.

## Open Questions

None blocking — deferred items (queue, radio, entity pages, podcasts) are explicitly owned by later milestones per the proposal.
