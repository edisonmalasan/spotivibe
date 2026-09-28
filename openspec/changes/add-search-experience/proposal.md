# Proposal

## Why

M1 shipped only a placeholder Search route and M3 shipped the provider search API (`GET /api/search`), but the product still has no search experience: the top-bar search input is presentational (typing does nothing), there is no results UI, no search history surface, and no way to start playback from a search result even though M4's persistent playback engine is complete. ROADMAP M5 requires a polished, Spotify-like search workflow on top of the provider engine — fast typing that never shows stale results, progressive loading, rich result rendering, local-first search history, and useful empty/error/offline states — with clicking a track starting persistent playback.

## What Changes

- **Search page**: replace the M1 placeholder with a DESIGN.md-compliant client search surface — debounced query input driven from the top-bar search field, URL sync (`/search?q=...`), aborted stale requests with a stale-response guard, skeleton loading state, and distinct browse/loading/results/empty/error/offline states.
- **Result rendering**: Top Result (when a clear best match exists), Songs, and derived Artists/Albums sections computed client-side from canonical Track metadata ("where metadata can be resolved"), with client-side duplicate collapsing across the result set.
- **Playback affordance**: the first UI caller of `playerStore.playTrack` — activating a result starts persistent playback (M4 engine) with the result set as queue context.
- **Context actions**: per-result menu with play, like/unlike (M2 liked-tracks repository), add to local playlist (M2 playlists repository, with playlist picker and inline create), and go to artist / go to album (refined-search navigation until M9 entity pages exist).
- **Search history (local-first)**: settled queries recorded to the M2 search-history repository (new single-entry remove method on the repository interface), with a Recent Searches browse surface supporting remove-one and clear-all.
- **Local library fallback**: when the remote search API fails or the browser is offline, search liked tracks, playlists, and listening history client-side — nothing is uploaded (music-provider spec already mandates local-library search stays client-side).
- **Search experience is wired into existing chrome**: the top-bar search input becomes functional (navigates to /search and keeps the URL in sync).

Explicit scope boundaries — deferred to the milestones that own them (per ROADMAP milestone sections):

- **Add to queue** context action → M6 (queue capability is being built as a dedicated `queueStore`; enqueue before that would cement queue state in the wrong store).
- **Start radio** context action → M10 (radio capability does not exist).
- **Artist/album entity pages** as navigation destinations → M9 (M5 navigates to a refined search instead; M9 re-points these links).
- **Podcast results/category search** → M12 (provider search is music-filtered until podcast mode exists).

## Capabilities

### New Capabilities

- `search`: The user-facing search experience — query input and URL synchronization, debounced/stale-safe request handling, progressive result rendering (Top Result, Songs, derived Artists/Albums), result interaction affordances (play, like, playlist, artist/album navigation), local-first search history with recent-searches management, client-side local-library fallback, and empty/error/offline states.

### Modified Capabilities

- None. `app-shell`, `local-data`, `music-provider`, and `playback` requirements are unchanged: the shell already specifies the top-bar search input, local-data's repository contract already covers search-history datasets (the remove-one method is an interface extension serving the new search requirement, not a change to local-data's stated requirements), music-provider already specifies the search API contract consumed as-is, and playback behavior is unchanged (search merely becomes a client of `playTrack`).

## Impact

- **Code**: `frontend/src/app/search/page.tsx` (placeholder → feature host), new `frontend/src/features/search/` feature slice (state orchestration, results derivation, result rows/menu, recent searches, playlist picker), `frontend/src/components/layout/TopBar.tsx` (wire `SearchInput`), `frontend/src/data/repositories` + `frontend/src/data/indexeddb/searchHistory.ts` (single-entry remove), first consumer of `frontend/src/stores/playerStore.ts` `playTrack`. No server route changes; `/api/search` is consumed as-is.
- **Tests**: new Vitest suites for request orchestration (debounce/abort/stale guard), results derivation (top result, artist/album dedupe), history recording/removal, local fallback, and search UI interactions; intentional update of `tests/routes.test.tsx` placeholder assertions (the route no longer renders only an empty state); `architecture.test.ts` extended with positive/negative checks (features/search stays client-side and repository-mediated).
- **Roadmap**: M5 status row → `DONE` and §11 Search/Discovery items completed by this change (local library fallback/search, debounce + abort stale requests, search history) ticked during Apply — later-milestone items (artist/album navigation, podcast category) stay unticked.
- **Out of scope**: no provider/server changes, no queue/radio/playlist-library surfaces, no new dependencies, no milestone beyond M5.
