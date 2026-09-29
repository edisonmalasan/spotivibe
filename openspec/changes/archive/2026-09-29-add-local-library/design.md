# Design

Binding technical decisions for `add-local-library`. Requirements come from the three spec deltas (`library`, `music-provider`, `search`); this document fixes *how* they are implemented. Where DESIGN.md is silent (library content pages, playlist hero, sidebar entry list — DESIGN.md specifies the sidebar shell and tokens but no library content design), this document is the visual/behavioral authority, using design tokens only (app-shell token rule).

## Context

- **Data layer (M2, done):** `LikedTracksRepository` and `PlaylistsRepository` already provide every operation M7 needs (`like/unlike/list`; `create/update/remove/get/list/addTrack/removeTrack/reorderTrack`), playlist IDs are `crypto.randomUUID()` (already name-independent), playlist order is the `tracks` array order, and backup export/import already covers both datasets. `getLocalData()` is the memoized repository accessor; components must never touch IndexedDB directly (architecture-tested).
- **Search (M5, done):** `ResultMenu` already implements like/unlike, add-to-queue, and `PlaylistPicker` (existing playlist + inline create). `useLikedTracks` and `PlaylistPicker` are feature-local (`features/search/`) with per-mount state. `SongRow` lives in `features/search/` with a comment that it stays there "until another feature needs it" — M7 is that feature.
- **Playback/queue (M4/M6, done):** `playTrack(track, context?, source?)` adopts a full ordered context into `queueStore` (one-way dependency), `toggleShuffle()` rebuilds traversal, and `QueueSource` already defines `"library"` with the display label "From your library" — M7 only needs to produce it.
- **Shell (M1, done):** `/library` is an empty-state placeholder; `Sidebar` renders static prompt cards with an inert `+`; `BottomNav` already links Library; `/now-playing` has a disabled "Save to Liked Songs" heart.
- **Server (M3, done):** search-only pipeline — `runChain` over `TIER_ORDER = ["ytmusic", "ytweb", "invidious", "piped"]`, shared `outboundLimiter`, TTL/in-flight cache, per-attempt timeouts, abort propagation, `candidateToTrack` normalization. No browse/next/playlist call exists anywhere.
- **Constraints:** Next.js 16 — dynamic-route and server/client component conventions MUST be read from `node_modules/next/dist/docs/` (per `frontend/AGENTS.md`) before writing the `[id]` route; no new dependencies; serverless-compatible (no background jobs, no server-side persistence).

## Goals / Non-Goals

**Goals:**

- One shared, hydrated library state driving sidebar, library, Liked Songs, playlist detail, the search picker, and Now Playing — with a single enforcement point for the duplicate rule and repository-first (await-then-update) writes.
- Library surfaces that need zero network: everything renders from IndexedDB; only import and actual playback touch the network.
- Playlist import that mirrors the existing provider-tier pattern (keyless, bounded, abortable, canonical Tracks only) rather than a bespoke fetch path.
- Token-only visuals consistent with DESIGN.md's dark surfaces, 6px content radius, 9999px actions, 24px heading ceiling, white pill primary action, green play affordances.

**Non-Goals:**

- No repository interface changes, no new IndexedDB stores/datasets, no backup schema changes (both datasets already exported/imported).
- No service-worker/offline-shell work (M13), no discovery shelves (M8), no artist/album routes or metadata enrichment (M9), no listening-event recording (M11), no radios/autofill (M10).
- No grid presentation for playlist detail (ordered collections stay lists); no playlist collaboration, sharing, or YouTube account features (permanently out of scope).
- No bulk-transaction repository API — import writes through the existing `create` + `addTrack` surface.

## Decisions

### 1. `libraryStore` as the single library state authority

- New `frontend/src/stores/libraryStore.ts`: `likedIds: ReadonlySet<string>`, `playlists: PlaylistRecord[]`, `hydrated: boolean`, plus `resetLibraryStore()` (mirrors the other stores' test helpers).
- `hydrate()` is idempotent and cheap (`likedTracks.list()` + `playlists.list()`); called from `Sidebar` mount (shell-global, so every surface is populated) and safe to call again from any surface. Settings reset and backup import re-call `hydrate()` so the store never diverges from the database after bulk writes.
- Actions are **repository-first**: await the repository write, then update state (the existing `useLikedTracks` pattern — no optimistic rollback; a failed write leaves UI unchanged). Failures reject so surfaces can show error feedback (the library's own error states; the network banner already covers connectivity).
- **Duplicate rule lives here:** `addTrackToPlaylist(id, track)` resolves to `"added" | "duplicate"` after checking membership — one enforcement point for the search picker, and any future add path. `createPlaylistFromResolved({ name, description, tracks })` creates then appends sequentially (array order = source order), and on a mid-sequence write failure calls `remove()` to roll the partial playlist back before rejecting.
- **Alternative rejected:** keeping M5's per-component repo reads. Like state would diverge between mounted surfaces (spec requires cross-surface consistency without remount), the sidebar could not update live after create/delete, and the duplicate rule would have to be restated at every call site.
- `architecture.test.ts` gains the store whitelist entry and a source-scan rule: playlist track-adds and like writes outside `libraryStore.ts` must go through the store (no direct `getLocalData().playlists.addTrack`/`likedTracks.like` in `features/`/`app/`).

### 2. Routes and navigation

- `/library` replaces the placeholder (library surface), `/library/liked` is the Liked Songs route, `/playlist/[id]` is the detail route. All three are client components reading the store; the `[id]` page accesses its parameter per the Next 16 docs (`node_modules/next/dist/docs/`), not per prior-Next habits.
- Reachability: existing `BottomNav` "Library" link → `/library`; sidebar entries → `/library/liked` and `/playlist/[id]`; library cards → detail; Liked Songs card → `/library/liked`. No new bottom-nav items (playlist detail is on-demand, mirroring the queue surface decision).
- Deleting the playlist you are viewing navigates to `/library` with success feedback; an unknown/deleted ID renders `EmptyState` "Playlist not found" with a link back (never a blank page or Next error boundary for a missing record).
- Compact viewports get the same content full-width; nothing here changes shell regions (app-shell unmodified).

### 3. Surface composition (visual authority — DESIGN.md has no library content pages)

- **`/library`:** header row — `SectionHeader`-style title ("Your Library", 24px/700) with actions: **Create playlist** (white pill — DESIGN.md names this exact primary action) and **Import playlist** (ghost text button). Filter input below (SearchInput token style). Content: the **Liked Songs card** (accent `#1ed760` square tile with white heart, title, "N songs") then a responsive grid of **playlist cards** (6px cover, name 14/600 white, "N songs" 14/400 mist — Square Album Card anatomy). Empty state when no liked songs and no playlists; filter-empty shows a "no matches" line instead.
- **`/library/liked`:** hero — accent tile with white heart, title "Liked Songs", "N songs", toolbar: circular green play button, **Shuffle** control, view toggle (list/grid, `aria-pressed` pair). List = `SongRow` rows (row click plays; trailing: heart toggle + menu-free remove? no — trailing = heart only, since unlike exists per-row and queue-add already exists in search). Grid = square tiles (cover, title, artist) that play on activation. Filter input above the list.
- **`/playlist/[id]`:** hero — cover block (232px square desktop, stacked compact), name (≤24px), description (mist) when set, meta line `Playlist · N songs · X min`, toolbar: green play button + **Shuffle**, **Edit** and **Delete** ghost buttons. Beneath: ordered track rows (number, artwork, title/artist, duration, trailing: `Move up`/`Move down`/`Remove`) with HTML5 drag on rows. All visuals from tokens; icons from the existing lucide set.

### 4. Playlist dialogs

- **Create/Edit** (one dialog component): name input (required), optional description textarea; `role="dialog"` + `aria-modal`, Escape/backdrop dismissal, focus enters the dialog and returns to the trigger, busy + failure states — the `PlaylistPicker` dialog pattern, extracted reuse by convention (same a11y contract, not a shared abstraction, unless trivially shared).
- **Delete confirm:** explicit confirmation with Cancel (changes nothing) and Delete; the destructive action uses the white pill (DESIGN.md: primary action is always a white pill; signal red stays decorative-only). Success navigates away if the detail route was open.
- The sidebar `+` opens the Create dialog in place (its own local dialog state); after create, `libraryStore` updates and the entry appears immediately (spec scenario).

### 5. Playlist track operations

- **Remove:** `libraryStore.removeTrackFromPlaylist(playlistId, trackId)` → repo `removeTrack` (first match by ID — safe because the duplicate rule guarantees at most one entry per track), then state update. Transport untouched by construction: neither the store nor the surface imports `playerStore` (architecture-tested).
- **Reorder:** the detail list *is* `playlist.tracks` (no traversal/shuffle concept here), so `reorderTrack(from, to)` maps directly; both drag-and-drop and the move controls call the same store action → identical results by construction (the queue's M6 pattern: boundary controls rendered-but-disabled, `draggable` rows, visible focus).
- **Duplicate feedback:** the picker renders an inline "Already in playlist" message on `"duplicate"` (and still closes cleanly); the existing "Add to an existing playlist appends" scenario covers the `"added"` path.

### 6. Playback integration

- `playAll(collection)` → if non-empty: `playTrack(collection[0], collection, "library")`. Row play → `playTrack(track, collection, "library")`.
- `shufflePlay(collection)` → if non-empty: ensure `queueStore.shuffle` is on (set directly — `toggleShuffle` only flips, so "ensure on" avoids turning an on-state off), then `playTrack(collection[0], collection, "library")`. The first track starts deterministically at index 0; shuffle randomizes the *subsequent* traversal (`buildPlayOrder` keeps current-first). **Alternative rejected:** random start index — surprising position jumps and weaker test determinism; the queue contract already guarantees shuffled continuation.
- Empty collections: play-all/shuffle render `disabled` (visibly muted, inert — app-shell disabled-state rule). Library surfaces contain no autoplay paths (activation-only), preserving the playback spec's gesture rule.
- **Now Playing heart:** replaces the disabled placeholder with a `libraryStore`-backed toggle (filled/outline by `likedIds`, accessible name Save/Remove from Liked Songs).

### 7. Sidebar content

- `Sidebar` hydrates the store on mount and renders: **Liked Songs entry** (accent heart tile) + one entry per playlist (cover or derived thumbnail, name) — compact rows, 6px radius, hover to `#1f1f1f` (Sidebar Panel internal-card anatomy) — plus the existing `+` control now wired to Create.
- **When the library is empty** (no liked songs *and* no playlists) the existing guidance prompt cards remain — preserves the M1 shell behavior and its test as the "empty" contract; the populated case is the new covered behavior.
- Entries are plain links (no playback from the sidebar in M7 — browsing only; the spec's navigation scenario is the contract).

### 8. Derived presentation helpers (pure, unit-tested)

- **Cover:** `derivePlaylistArtwork(playlist)` → first ≤4 *distinct* track artwork URLs (best resolution entry from `track.artwork`): 1 distinct → single image; 2–4 → 2×2 grid (empty cells graphite); none → placeholder tile (graphite surface + `Music2` icon). Applied to library cards, sidebar entries (single image), and the detail hero fallback (playlist's own `artwork` field wins when present).
- **Duration:** sum `durationSeconds` where present and >0; format `m min` under an hour, `h hr m min` at/above (floor; omit `0 min`). Empty or wholly unknown → no duration segment ("N songs" only).
- **Filter:** case-insensitive substring over title + artist names (playlists: name only), pure function, used by `/library` and `/library/liked`.

### 9. Playlist import — server

- **`GET /api/playlist?src=<ref>`** mirroring the search route's conventions: validate first (non-empty after trim, ≤500 chars) → `400 { error: "invalid_input" }` with no upstream call; abort signal propagated from the request; per-attempt timeout; bounded by the shared `outboundLimiter`; `Cache-Control: public, max-age=60` (public deterministic metadata, same as search).
- **`parsePlaylistRef(src)`** (pure, fixture-tested): extracts the `list` query parameter from watch/playlist/embed/short-link URLs on any YouTube host, or accepts a bare ID matching `^[A-Za-z0-9_-]{6,64}$`; otherwise invalid. No account/OAuth/cookies anywhere — keyless like search.
- **`resolvePlaylist(id, { signal })`** iterates `TIER_ORDER`:
  - `ytmusic`: Innertube `browse` (WEB_REMIX context), browseId `VL<id>`; `ytweb`: same with WEB context — both parse title, description, video entries, and follow continuation tokens (same endpoint + continuation payload) up to a documented cap of **500 entries** (bounded serverless work; the dialog reports "First 500 songs imported" when the response is marked truncated).
  - `invidious`: `GET /api/v1/playlists/<id>` (paged up to the cap); `piped`: `GET /playlists/<id>`.
  - Each entry normalizes to a canonical `Track` through the shared normalize helpers (playlist-shaped input → same conversion rules as search); raw renderer shapes never cross the API boundary.
- **Failure classification:** tier *transport/parse* failure → fall through to the next tier. A **definitive** "playlist is private/deleted/not found" answer from any tier that reached YouTube stops the chain → `404 { error: "playlist_unavailable" }` (retrying other tiers cannot change a definitive answer). All tiers transport-failed → `503 { error: "upstream_unavailable" }`. Structured JSON errors, never unhandled exceptions.
- **Entry handling:** unavailable/unnormalizable video entries are skipped and counted (`skipped`); duplicates by `providerId` keep the first occurrence; **no quality/junk filtering** — unlike search, an imported playlist must reproduce its source (user-chosen content), only non-resolvable entries drop out.
- **Response:** `{ playlist: { title, description?, tracks: Track[], skipped, truncated? }, diagnostics?: { tiers: [...] } }` — diagnostics carry tier ids/outcomes only (search's safety rule), and no local data is ever accepted (the endpoint takes only `src`).
- Reuses `cache.ts` (key `playlist:<id>`, 60s TTL + in-flight dedupe) — cheap consistency with search; no new service.

### 10. Playlist import — client

- **`features/playlists/ImportPlaylistDialog.tsx`** opened by the `/library` header action: input (URL or ID) → quick non-empty check → `GET /api/playlist` through a small typed API module (the `searchApi.ts` pattern: response parsed/validated before use; provider-agnostic `Track[]` only) → `libraryStore.createPlaylistFromResolved(...)` → success feedback ("Imported N songs", plus "M unavailable entries skipped" and the truncated note when present) → navigate to the new playlist's detail route.
- Error mapping: `invalid_input` → "That doesn't look like a YouTube playlist link."; `playlist_unavailable` → "That playlist is private or unavailable."; `upstream_unavailable` → "Couldn't reach YouTube — try again."; network failure/offline → "You're offline — import needs a connection." (the connection banner is already visible). **Resolution completes before any write**, so every failure path leaves the database untouched; a mid-write local failure rolls the partial playlist back.
- Resolution and creation are separate concerns by design: the server never sees local data, and the client never sees provider shapes.

### 11. Search rewire

- `features/search/useLikedTracks.ts` becomes a thin wrapper over `libraryStore` (same hook API: `likedIds`, `toggleLike`) — calls `hydrate()` then selects; search results now update live when like state changes elsewhere.
- `PlaylistPicker` reads `playlists` from the store (live after sidebar/library mutations), adds via the store action (duplicate → inline feedback), and creates inline via `createPlaylist` + add.
- `git mv features/search/SongRow.tsx components/track/SongRow.tsx` and update imports (the file's own note reserves this move for the first non-search consumer; ROADMAP's structure puts `components/track/` there).

### 12. Verification strategy

- **Unit/component (vitest + jsdom, fake-indexeddb for repositories):** libraryStore matrix (hydrate idempotence, like toggling and cross-surface consistency, duplicate `added|duplicate` matrix, create/rename/delete, reorder, import rollback on write failure); pure helpers (duration matrix incl. unknown durations, cover derivation incl. none, filter); `/library` (sections, filter, empty, offline render), Liked Songs (play-all/shuffle context + source, disabled when empty, view toggle, unlike propagation), playlist detail (hero metadata, derived cover, not-found, delete cancel/confirm, move==drag result, transport untouched while playing); dialogs (create/edit/confirm a11y contract); import client states + error mapping; parser fixture matrix (URL forms, bare ID, invalid); provider fixtures per tier (success + continuation, private → unavailable, entry skip, all-tiers-fail); API route contract (400 before upstream, 404, 503, 200 shape, no local-data params); search picker duplicate scenario; Now Playing heart.
- **Updated existing tests:** `routes.test.tsx` (library is functional now — placeholder assertions replaced), `shell.test.tsx` (empty keeps prompts; populated shows entries), `nowplaying.test.tsx` (heart functional), `search-menu.test.tsx` (picker/like via store), `architecture.test.ts` (store whitelist; features must not import IndexedDB/server/provider shapes — extended to the new surfaces; `libraryStore` must not import `playerStore`; playlist-add/like writes only inside `libraryStore`; all rules proven on violating input per the M4/M6 self-test pattern).
- **Browser evidence (task 9.4, CDP against production build):** like from search → visible in Liked Songs → unlike (and Now Playing heart) → create/rename/delete (cancel + confirm) → add track from search (incl. duplicate feedback) → reorder via keyboard + drag → reload keeps membership/order → play-all shows "From your library" in `/queue` → shuffle on → grid/list toggle → live public playlist import (real YouTube; unavailable-entry and invalid-input error paths; disclose any live-run deviations in the evidence README) → offline: library/liked/detail render fully from IndexedDB while import fails gracefully → one iframe/API script, zero console errors, screenshots per stage.
- **Gates:** full six-command gate run, then a clean-clone re-run (tasks 9.2/9.5, as in M6).

## Risks / Trade-offs

- [Live Innertube playlist rendering shapes vary and are unversioned] → fixture-based parsers per tier captured during implementation, four-tier fallback, definitive-error classification, and a live import in the CDP evidence run; deviations disclosed in the evidence README rather than papered over.
- [500-entry cap truncates very large playlists] → documented bound in the response (`truncated`), user-visible note in the dialog; raising the cap later needs no spec change.
- [Import writes are per-record, not one transaction (no bulk repo API by design)] → sequential ordered writes with rollback-on-failure so a failed import leaves nothing behind; atomicity stays within the local-data contract we did not modify.
- [Sidebar/library test changes could mask regressions] → the empty-library prompt-card behavior is preserved (existing assertions stay); only intentional new assertions cover populated state; no assertion is weakened to pass.
- [Like-state divergence after Settings reset or backup import] → those flows re-call `hydrate()`; covered by a store test simulating bulk clear + hydrate.
- [Duplicate rule bypassed by a future direct repo call] → source-scan architecture rule restricting playlist-add/like writes to `libraryStore`, proven on violating input.

## Migration Plan

No data migration: M7 writes only into existing stores/datasets with existing schemas (backup envelope unchanged). Deploy is a normal static app update; rollback is a revert — data written by M7 remains valid for older and newer builds (playlist/liked records already round-trip through backup).

## Open Questions

None — resolution-tier order, the duplicate rule, shuffle start semantics, and the import cap are all fixed above.
