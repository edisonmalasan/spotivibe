# Proposal

## Why

M2 shipped liked-tracks and playlists repositories (already covered by JSON backup) and M5 wired like/add-to-playlist into search results, but the product still has no library: `/library` is an empty-state placeholder, the sidebar's "+" is inert, playlists cannot be created, renamed, deleted, reordered, or played, liked songs have no surface of their own, Now Playing's heart is disabled, and a YouTube playlist cannot be brought in. ROADMAP M7 requires the full on-device personal library.

## What Changes

- **Library surface**: replace the `/library` placeholder with a real surface (Liked Songs entry, playlists, local filter, Create playlist and Import actions, empty states), and make the desktop "Your Library" sidebar data-driven (liked-songs and playlist entries that navigate, a working "+" create affordance, prompt cards only while the library is empty).
- **Liked Songs surface**: a dedicated route with hero, count, play all, shuffle, a local filter, a list/grid view toggle, per-row play and unlike, like state shared across search, Now Playing, and the library — including making Now Playing's disabled heart functional.
- **Playlist management**: create (name + optional description), rename, edit description, delete behind confirmation; immutable IDs independent of display name; immediate local persistence; a `/playlist/[id]` detail route with hero (artwork or derived cover, track count, total duration) and play-all/shuffle controls.
- **Playlist track operations**: remove and reorder (drag-and-drop plus keyboard move controls) from the detail page, order stable across reload, and one deterministic duplicate rule on every add path (search picker included): adding a track already in the playlist changes nothing and says so.
- **Public YouTube playlist import**: a library dialog accepts a public/unlisted playlist URL or ID; a new keyless server endpoint resolves it through the provider tier chain into canonical tracks; the client creates a normal local playlist (resolved title, source order, unavailable entries skipped and counted) with structured failures for invalid input, private/inaccessible playlists, and upstream outages — no Google OAuth, no Spotivibe account, ever.

Explicit scope boundaries — deferred to the milestones that own them (per ROADMAP milestone sections):

- **Home/Discover shelves, trending, languages, curated sections** → M8 (library renders local collections only; it consumes no discovery feed).
- **Artist pages, album pages, Now Playing redesign, related content** → M9 (M7 only enables the existing heart affordance on Now Playing; go-to-artist/album stay search refines).
- **Listening history, stats, streaks, Smart Mixes** → M11 (library actions record no listening events; the `listeningHistory` dataset is untouched).
- **Queue autofill / radios** → M10 (play-all adopts a context exactly as search does; no generation).
- **Offline metadata/PWA shell work** → M13 (library surfaces read IndexedDB directly and thus already work offline; no service-worker changes here).
- **Grid/list toggle scope note**: only Liked Songs gets a view toggle (ROADMAP's "list/grid view as designed"); playlist detail stays a list, matching DESIGN.md's dense row presentation for ordered collections.

## Capabilities

### New Capabilities

- `library`: the on-device personal library — the Your Library surface and sidebar, the Liked Songs collection (presentation, filtering, shared like state), local playlists (create/rename/delete, ordered membership with a deterministic duplicate rule, detail hero with derived cover and duration), library playback entry points (play all/shuffle, `library` queue source), and public YouTube playlist import into a normal local playlist.

### Modified Capabilities

- `music-provider`: adds playlist resolution beside search — a keyless playlist-resolution API contract (URL/ID forms, tier fallback, canonical tracks, metadata only) and graceful failure handling (structured errors for invalid/private/inaccessible playlists, per-entry skipping with counts, bounded attempts).
- `search`: *Result context actions* — "Add to local playlist" now states the library's deterministic duplicate rule (already-present tracks leave the playlist unchanged with user feedback), with a matching scenario.

### Unmodified Capabilities

- `local-data`: the liked-tracks/playlists repositories, datasets, and backup envelope already exist and are sufficient (import writes through `create` + `addTrack`); the duplicate rule is enforced by the library state layer, so no repository contract changes.
- `app-shell`: sidebar dimensions/surfaces/layout are unchanged; its library *content* is owned by `library`, and the prompt cards were never a specced requirement.
- `playback` / `queue`: play-all/shuffle reuse existing context adoption (`playTrack` + `toggleShuffle`), and `QueueSource` already defines the `library` value with its display label.
- `network`: an offline import failure surfaces through the dialog plus the existing connection banner; no connectivity contract changes.

## Impact

- **Code**: new `frontend/src/stores/libraryStore.ts` (hydrated liked-ID set + playlist records, repo-first actions including duplicate-rejecting add), new `frontend/src/features/library/` and `frontend/src/features/playlists/`, routes `frontend/src/app/library/page.tsx` (placeholder replaced), `frontend/src/app/library/liked/page.tsx`, `frontend/src/app/playlist/[id]/page.tsx`; `components/layout/Sidebar.tsx` (data-driven), `app/now-playing/page.tsx` (heart), `features/search/` rewire onto the shared store (`useLikedTracks`, `PlaylistPicker`), `SongRow` moved to `components/track/` (its own "until another feature needs it" note applies); server: `app/api/playlist/route.ts` + a playlist-resolution module under `src/server/music/` + `resolvePlaylist` in the provider tiers (keyless, no media bytes). No new dependencies.
- **Tests**: new store/surface/import suites; updated `routes.test.tsx` (library placeholder assertions), `shell.test.tsx` (sidebar), `nowplaying.test.tsx` (heart), `search-menu.test.tsx` (picker via shared store + duplicate scenario), `architecture.test.ts` (store whitelist, feature/server boundary rules).
- **Roadmap**: M7 status row → `IN PROGRESS` with this proposal, → `DONE` with the Apply stage's verification commit; §11 "Library" checklist (nine items) ticked at Apply end; no other milestone rows or checklist sections touched.
- **Out of scope**: no milestone beyond M7, no accounts/auth/cloud sync, no new dependencies, no server-persisted user data, no audio/video bytes through the server.
