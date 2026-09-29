# Tasks

## 1. Server catalog core

- [x] 1.1 Add `src/server/music/catalog.ts`: plan at most two seeds for an artist/album identifier (or for a track's title+artist), resolve them sequentially through the existing `runChain` with the M8 per-seed/feed budget bounds, and merge into canonical tracks — verify: integration tests with mocked providers assert at most two chain calls, seeds run sequentially, and merge/dedupe/bound reuse the shared pipeline.
- [x] 1.2 Derive the entity views from that one result set: artist identity (name + best artist artwork), popular tracks, related artists (non-primary artists ranked by frequency then first appearance, deterministic, capped), and releases (tracks grouped by album title with member artwork) — verify: unit tests cover identity, related-artist ranking/capping/exclusion, release grouping, determinism, and behavior when the track set is empty.
- [x] 1.3 Derive album resolution (release metadata, tracks in resolved order, `metadataIncomplete` when no album summary matches) and similar-track resolution (candidates excluding the source track id) — verify: unit tests cover both, including the incomplete-metadata and source-exclusion cases.

## 2. Catalog API routes

- [x] 2.1 Add `src/app/api/artist/route.ts` and `src/app/api/album/route.ts` with zod validation before any provider call (bounded name/title/artist/id), 200 with the entity view and safe diagnostics, `400` structured `invalid_request`, `404`-class unresolvable, `503` structured `upstream_unavailable` when every seed fails, and `499` on abort — verify: route tests cover the happy path, every invalid-input branch (no provider contact), unresolvable, all-seeds-failed, and abort.
- [x] 2.2 Add `src/app/api/similar/route.ts` with the same contract plus source-track exclusion, and a short `Cache-Control` on all three — verify: route tests assert the source id never appears, the cache header is set, and the accepted query keys carry no library/user data.

## 3. Artist surface

- [x] 3.1 Add artist key helpers (`isProviderEntityId`, `toArtistRequestKey`, `artistHref`) covering both id keys and normalized text keys — verify: unit tests cover id-shaped keys, text keys with punctuation/accents/diacritics, and empty input.
- [x] 3.2 Add the artist client API module with bounds, response parsing, and typed error codes mirroring `discoveryApi` — verify: unit tests cover query construction, bounds, parsing, and each error code.
- [x] 3.3 Add `features/artist/ArtistView.tsx`: identity/artwork, popular tracks (play + like per row), releases, related artists, "Start artist radio" (seeded playback with the artist feed as context), plus loading/empty/retryable-error and not-found states — verify: component tests assert each section, the radio activation's playback context, like persistence, and both recovery states.
- [x] 3.4 Add the local "liked tracks by this artist" section as a pure derivation over `libraryStore.likedTracks` with no request, omitted when empty — verify: unit test for the pure filter (id and name matching) plus a component test that no request is issued and the section disappears when the liked set changes.

## 4. Album surface

- [x] 4.1 Add album key helpers and the album client API module (bounds, parsing, typed errors) — verify: unit tests cover keys and API behavior.
- [x] 4.2 Add `features/album/AlbumView.tsx`: artwork, title, artist, available release metadata, ordered tracks, play/shuffle (whole album as context), per-track like, add-to-local-playlist through the existing picker, the `metadataIncomplete` notice, and not-found — verify: component tests assert the sections, play/shuffle contexts, like and picker wiring, the incomplete-metadata notice, and not-found.

## 5. Related content and Now Playing presentation

- [x] 5.1 Generalize `useDiscoveryShelf` with an optional `fetchTracks` override (defaulting to the discovery fetcher) so a non-discovery feed reuses the same state/abort/queue contract — verify: hook tests assert the override is used and the default path is unchanged.
- [x] 5.2 Add the More Like This shelf for the current track (via `/api/similar`), re-resolving on track change and never autoplaying — verify: hook/component tests assert re-resolution on track change, exclusion of the current track, and no playback.
- [x] 5.3 Add the artwork-derived background and the reduced-motion-aware long-title treatment to the Now Playing surface, keeping the route bound to the same store/player state — verify: component tests assert the background appears/disappears with artwork, the static full-title fallback under reduced motion, and that the player region and surface agree.

## 6. Entry points repointed

- [x] 6.1 Repoint the M5 search artist/album tiles, the result menu's "go to artist"/"go to album", and the M8 Home artist cards at the new routes (keeping text-key fallback behavior) — verify: tests assert each entry point produces the new route and still resolves for id-less metadata.

## 7. Architecture and route contract

- [x] 7.1 Extend `tests/architecture.test.ts` with self-tested rules: `features/artist`, `features/album`, `features/related`, and the new catalog components stay repository-mediated and import no `data/indexeddb`, `@/server`, or provider shapes; `server/music/catalog.ts` imports no `@/data`; the three new routes are metadata-only and accept no library/user parameter; UI must not import `player/ytApi`/`player/types` — verify: each new rule fails on a violating snippet and passes on the clean tree.
- [x] 7.2 Update `tests/routes.test.tsx` for the new routes and Now Playing additions — verify: `npm test` passes with the new route shells asserted.

## 8. Integration verification and release evidence

- [x] 8.1 Run the full quality gates from the repository root (`cd frontend && npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`) — verify: every command exits `0`.
- [x] 8.2 Produce CDP browser evidence against a production server: an artist page resolves identity/tracks/releases/related artists with a playable radio entry; an album page lists its tracks with play/shuffle and like; an unknown key shows a recoverable not-found; liked-by-artist appears locally and disappears after clearing; More Like This on Now Playing excludes the current track and never autoplays; the artwork background and long-title treatment render; one failed entity request shows a retryable error while the page still renders; exactly one player iframe/API script during playback; zero console errors — verify: `results.json` reports `"pass": true` with screenshots and a reproduce-path README (disclosing live-run deviations) under the change's `evidence/`.
- [ ] 8.3 Update `ROADMAP.md`: M9 status row → `DONE`; tick the §11 items M9 delivers (Artist navigation, Album navigation, Artist page, Album/release page, Now Playing, More Like This, Artist Radio) — verify: `git diff` shows only those lines plus the status cell.
- [ ] 8.4 Re-verify the quality gates from a clean clone of the branch head — verify: all six commands exit `0` in the fresh clone.
