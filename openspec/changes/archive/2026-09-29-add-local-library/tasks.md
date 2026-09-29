# Tasks

## 1. Library store foundation

- [x] 1.1 Create `frontend/src/stores/libraryStore.ts` holding `likedIds`, `playlists`, `hydrated` with idempotent `hydrate()` and `resetLibraryStore()` — verify: unit tests cover hydration populating both collections from fake-indexeddb repositories, double-hydrate not duplicating state, and reset isolation (`npm test`).
- [x] 1.2 Add repository-first actions: `toggleLike`, `createPlaylist`, `updatePlaylist`, `deletePlaylist`, `removeTrackFromPlaylist`, `reorderPlaylistTrack`, and `addTrackToPlaylist` returning `"added" | "duplicate"` — verify: tests cover like persistence, create/rename preserving ID/tracks/order, delete, the duplicate matrix (present → `"duplicate"` with unchanged playlist; absent → appended), reorder results, a failing repository write leaving state unchanged, and transport fields untouched after every action (`npm test`).
- [x] 1.3 Add `createPlaylistFromResolved({ name, description, tracks })` writing sequentially in order with rollback on mid-sequence failure — verify: tests assert the created playlist's tracks match the input order, and a simulated write failure removes the partial playlist and rejects (`npm test`).

## 2. Shared surface wiring

- [x] 2.1 Move `features/search/SongRow.tsx` to `frontend/src/components/track/SongRow.tsx` (`git mv`) and update all imports — verify: `npm test` passes with search/queue suites importing the relocated component and no reference to the old path remains (`git grep`).
- [x] 2.2 Rewire `features/search/useLikedTracks.ts` and `PlaylistPicker.tsx` onto `libraryStore` (live state, store-based add with inline "Already in playlist" feedback, inline create via the store) — verify: updated `search-menu` tests cover like persisting through the store, a like toggled elsewhere reflecting without remount, appending to an existing playlist, inline creation, and the new duplicate scenario from the search delta — playlist unchanged with feedback (`npm test`).
- [x] 2.3 Replace the disabled heart on `frontend/src/app/now-playing/page.tsx` with a functional `libraryStore`-backed like toggle — verify: now-playing tests assert filled/outline state by `likedIds`, the accessible name switching Save/Remove, and the like appearing in the liked set without a reload (`npm test`).

## 3. Playlist import — server

- [x] 3.1 Implement pure `parsePlaylistRef(src)` accepting list-parameter URL forms (watch/playlist/embed/short-link on any YouTube host) and bare IDs — verify: fixture tests cover every accepted form, rejection of empty/malformed/non-playlist input, and no upstream call on rejection (`npm test`).
- [x] 3.2 Implement the Innertube resolvers (`ytmusic`, `ytweb`: `VL` browse id, continuations up to the 500-entry cap, private/missing detection, entry normalization to canonical Tracks, unavailable-entry skip counts) — verify: fixture-based parser tests per tier cover title/description/entry extraction, continuation joining, canonical output with no provider keys, definitive-unavailable detection, skip counting, and providerId dedupe keep-first (`npm test`).
- [x] 3.3 Implement the `invidious` and `piped` playlist resolvers with the same normalization and skip/dedupe rules — verify: fixture tests for each tier cover success normalization, unavailable entries, and malformed-response failure (`npm test`).
- [x] 3.4 Implement `resolvePlaylist` over `TIER_ORDER` with per-tier transport fallback, definitive-error stop (private/missing → unavailable), all-tiers-failed → upstream error, truncation marking at the cap, and no quality filtering — verify: chain tests cover primary success stopping the chain, transport failure falling through, a definitive unavailable answer not retrying lower tiers, all-fail surfacing upstream error, truncation, and imported entries keeping source order (`npm test`).
- [x] 3.5 Add `GET /api/playlist?src=` validating input before any upstream call, mapping errors to `400 invalid_input` / `404 playlist_unavailable` / `503 upstream_unavailable`, propagating abort, applying timeout + shared limiter + 60s cache header, and returning canonical tracks with tier-only diagnostics — verify: route contract tests assert the 400 path contacts no provider, each error mapping, the success shape, abort propagation, and that no parameter accepts local data (`npm test`).

## 4. Playlist import — client

- [x] 4.1 Add the typed playlist API module and `features/playlists/ImportPlaylistDialog.tsx` (idle → resolving → success/error states, error-message mapping for invalid/unavailable/upstream/offline, success feedback with imported + skipped + truncated counts, navigate to the new detail route) — verify: component tests cover each state transition, the error mapping table, resolution-failure leaving the playlist list untouched, and dialog a11y (role/Escape/focus return) (`npm test`).

## 5. Library surface

- [x] 5.1 Replace the `/library` placeholder with the real surface: header with Create playlist and Import playlist actions, Liked Songs card (count), playlist grid (cover, name, count), empty state, and not-found-free navigation to detail/liked routes — verify: `routes.test.tsx` library cases and new component tests assert sections, counts, navigation targets, and the empty state (`npm test`).
- [x] 5.2 Add the library filter (pure matcher over playlist names + liked entry) and its input with a no-matches state — verify: unit tests cover the matcher matrix (case-insensitive, no match, clear restores) and a component test shows filtering and restoring (`npm test`).
- [x] 5.3 Add the Create playlist dialog (name required, optional description, busy/failure states, focus contract) wired to `libraryStore` from the library header — verify: tests assert creation persists, the new playlist appears in the surface immediately, validation blocks empty names, and the dialog a11y contract holds (`npm test`).

## 6. Liked Songs surface

- [x] 6.1 Build `/library/liked`: hero (accent tile, count), filter, list presentation with per-row play and unlike, and the list/grid view toggle — verify: component tests cover row metadata, unlike removing the row and clearing like state elsewhere, filter behavior, the toggle's `aria-pressed` and grid rendering, and the empty state (`npm test`).
- [x] 6.2 Implement the shared bulk-play helpers `playAll` / `shufflePlay` (non-empty → `playTrack(..., "library")`, shuffle ensured on; empty → disabled/inert) and wire Liked Songs controls — verify: tests assert context adoption with source `library` (queue surface label), shuffle on after activation, disabled controls with zero tracks, and no autoplay on mount (`npm test`).

## 7. Playlist detail surface

- [x] 7.1 Add pure helpers `sumPlaylistDuration` and `derivePlaylistArtwork` plus the `/playlist/[id]` route and hero (cover/artwork/derived/placeholder, name, description, count, duration formatting, meta line) with a recoverable not-found state for unknown IDs — verify: unit tests cover the duration matrix (known/unknown/empty, `min` vs `hr min` formats) and cover derivation (0/1/2–4 distinct, placeholder), plus component tests for hero rendering and the not-found state (`npm test`).
- [x] 7.2 Add the hero toolbar: play all and shuffle (via the group-6 helpers), Edit dialog (rename/description prefill), and Delete confirmation (cancel changes nothing; confirm removes everywhere and navigates to `/library`) — verify: tests cover play-all/shuffle context + source, edit persisting with unchanged ID/membership, both delete branches, and navigation after confirm (`npm test`).
- [x] 7.3 Add the ordered track list with per-row play, remove, and reorder (HTML5 drag + `Move up`/`Move down` producing the same store operation), persistence across reload, and transport untouched while playing — verify: tests assert drag and keyboard yield identical orders, removal/reorder persisting via fake-indexeddb reload, boundary controls disabled correctly, accessible names present, and transport fields unchanged after each operation (`npm test`).

## 8. Library sidebar

- [x] 8.1 Make `Sidebar` hydrate the store and render Liked Songs + playlist entries (cover, name) with live updates after create/delete, keeping the guidance prompt cards only while the library is empty — verify: shell tests cover the empty library still showing prompt cards (existing assertions preserved), a populated sidebar listing entries with navigation, and entries appearing/disappearing without a reload (`npm test`).
- [x] 8.2 Wire the sidebar `+` control to open the Create playlist dialog in place — verify: a shell test asserts the dialog opens, creates through the store, and the new entry appears in the sidebar (`npm test`).

## 9. Integration verification and release evidence

- [x] 9.1 Extend `frontend/tests/architecture.test.ts` with self-tested rules: feature/route code imports no IndexedDB/server/provider shapes, `libraryStore` never imports `playerStore`, playlist-add/like writes occur only inside `libraryStore`, and the server playlist module imports no data layer — verify: each rule fails on violating input and passes on the clean tree (`npm test`).
- [x] 9.2 Run the full quality gates from the repository root (`cd frontend && npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`) — verify: every command exits `0`.
- [x] 9.3 Produce CDP browser evidence against a production server (`npm run build` + `npm run start`): like/unlike consistency across search, Liked Songs, and Now Playing; create → rename → delete (cancel + confirm); add-from-search incl. duplicate feedback; keyboard and drag reorder; reload preserving membership/order; play-all showing "From your library" in `/queue` with shuffle on; grid/list toggle; a live public playlist import (plus invalid-input and unavailable-playlist error paths, with the skipped/truncated reporting when present); offline library/liked/detail rendering fully from IndexedDB while import fails gracefully; one iframe/one API script; zero console errors — verify: `results.json` reports `"pass": true` with screenshots and a reproduce-path README (disclosing live-run deviations) under the change's `evidence/`.
- [x] 9.4 Update `ROADMAP.md`: M7 status row → `DONE`; tick all nine §11 Library items (Liked Songs, create, rename, delete, add/remove, reorder, play/shuffle, hero/cover, public import); leave every other milestone row and checklist section untouched — verify: `git diff` shows only those lines plus the status cell.
- [x] 9.5 Re-verify the quality gates from a clean clone of the branch head — verify: all six commands exit `0` in the fresh clone (proves no uncommitted-file dependency).
