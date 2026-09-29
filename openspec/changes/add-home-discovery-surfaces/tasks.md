# Tasks

## 1. Server discovery core

- [x] 1.1 Add a curated static seed catalog module (`src/server/music/discoverySeeds.ts`) covering trending, genre, podcast, and collection kinds with per-language seed variants and a 37-entry language catalog (code + name) — verify: unit test asserts every kind has at least one seed, every language code is unique, and the catalog exposes ≥37 languages.
- [x] 1.2 Implement `src/server/music/discovery.ts` composing one feed from seeds: resolve each seed through the existing `runChain` with the outbound limiter, stamp each resulting track with the seed's language code, merge/dedupe/sort with the existing normalize/filter/score helpers, tolerate per-seed failure, and return structured success/failure results plus diagnostics — verify: integration tests with mocked providers assert language stamping, per-seed failure tolerance, all-seeds-failure structured error, dedupe, and result bounding.
- [x] 1.3 Add a short-lived TTL cache and in-flight dedupe for discovery feeds keyed by kind+languages+seeds, reusing the existing `TtlCache`/`createInflightDedup` helpers — verify: unit test asserts a repeat request within the TTL issues no new provider call and an expired request re-queries.

## 2. Discovery API route

- [x] 2.1 Add `src/app/api/discover/route.ts` validating `kind`, `languages` (bounded, catalog-known), and `seeds` (bounded length/count) with zod before any provider call; return `{ tracks, diagnostics }` with a short `Cache-Control`, `400` structured errors for invalid input, `503` structured `upstream_unavailable` when every seed fails, and `499` on client abort — verify: route tests cover happy path, every invalid-input branch, all-seeds-failure, and that invalid input contacts no provider.
- [x] 2.2 Assert the route accepts no local-library data and returns metadata only — verify: route test asserts the accepted query keys are exactly kind/languages/seeds/limit and the response contains no media bytes or local dataset fields.

## 3. Client discovery API, preferences, and language onboarding

- [x] 3.1 Add a client discovery API module (`features/home/discoveryApi.ts`) with bounded params, response parsing, and typed error codes mirroring the M7 `playlistApi` conventions — verify: unit tests cover parsing, bounds, and error mapping.
- [x] 3.2 Add a `preferencesStore` over the existing preferences repository (hydrate, save languages, complete onboarding) without importing `data/indexeddb` — verify: store test asserts hydrate/save round-trip through a fake IndexedDB and that hydration is idempotent.
- [x] 3.3 Add first-run language onboarding: a reusable language picker presenting the ≥37-language catalog with multi-select and a confirm action, shown on Home while onboarding is incomplete, reopening from a new Settings "Languages" control — verify: component tests assert the catalog renders, confirming persists languages + `onboardingComplete`, reopening lets languages change, and no account/sign-in prompt is rendered.

## 4. Listening signals for recently played

- [x] 4.1 Add a `historyStore` over the existing listening-history repository (record, list newest-first, clear) with no `data/indexeddb` import — verify: store test asserts record/list/clear through fake IndexedDB and newest-first ordering.
- [x] 4.2 Record one listening event per track step (new track id, `context` from the queue source, `secondsPlayed: 0`) via a `useListeningRecorder` hook mounted in `AppShell`, following the existing session-persistence attach pattern and never importing the player engine — verify: tests assert a play records exactly one event with the right context, re-activating the same track records at most one additional event, and no event is written on position ticks.

## 5. Feed primitives and pure feed helpers

- [x] 5.1 Add `components/recommendations/Shelf.tsx` implementing the DESIGN.md horizontal rail (5-column square grid, one `SectionHeader`, compact section spacing) and extend `AlbumCard`/`ArtistCard` with an optional `artworkUrl` that renders real artwork when present and keeps the placeholder otherwise — verify: component tests assert rail structure, artwork rendering with and without a URL, and that existing card usages still render.
- [x] 5.2 Add pure helpers: `interleaveByLanguage(tracks, languages)` (deterministic round-robin, lossless, single-language passthrough) and `groupArtistsByIdentity(tracks)` (dedupe by canonical artist identity with best artwork) — verify: unit tests cover multi-language mixing (no language monopolization), single-language order preservation, losslessness/determinism, and artist dedupe/ordering.

## 6. Home feed

- [x] 6.1 Replace `app/page.tsx` with the Home feed: a typed, ordered section list (Recently Played when history exists, Trending Now, Made For You, Smart Mixes when ≥3 local artists, Popular Artists, genres, podcast preview, curated collections) that keeps the circular artist section unclustered and inside the first four sections — verify: unit test asserts no two circular sections are adjacent and the circular section's index is within the first four rendered sections.
- [x] 6.2 Implement a per-shelf hook issuing one discovery request per shelf with its own abort, returning loading/ready/empty/error states so a failing shelf renders a retryable error while others render — verify: tests assert independent failure isolation, skeleton-then-content transitions, empty-state copy, and that unmount aborts in-flight requests.
- [x] 6.3 Make Home locally informed: Made For You and Smart Mixes seed from on-device likes/recent plays only (short seed terms in the request, no liked/history payload), and Recently Played renders newest-first from the history store — verify: tests assert seed terms derive from local data, the request carries no local dataset, and the section is absent with empty history.
- [x] 6.4 Wire shelf activation to playback with the shelf as queue context (existing `browse` source label), keep Home free of autoplay, and label shelves without any chart/editorial claim — verify: tests assert activating a card starts playback with the shelf context, nothing plays on load, and shelf copy contains no chart claim.

## 7. Discover surface

- [x] 7.1 Add the `/discover` route with genre entries resolving per-genre shelves, a selected-language summary with a change affordance, and independent loading/empty/error states — verify: tests assert per-genre isolation, the language summary + affordance, skeleton/empty/error rendering, and that no playback starts on its own.
- [x] 7.2 Ensure Discover explains that remote discovery needs a connection while offline instead of rendering blank or unhandled failure, and never claims official chart status — verify: test asserts the offline notice renders and no remote request is issued while offline.

## 8. Architecture and route contract updates

- [x] 8.1 Extend `tests/architecture.test.ts` with self-tested rules: `features/home`, `features/discover`, `features/preferences`, `features/history`, and `components/recommendations` stay repository-mediated and import no `data/indexeddb`, no `@/server`, and no provider shapes; `stores/preferencesStore` and `stores/historyStore` reach data only through repository interfaces; `server/music/discovery.ts` imports no `@/data`; and the new route handler obeys the metadata-only rules — verify: each new rule fails on a violating snippet and passes on the clean tree (`npm test`).
- [x] 8.2 Update `tests/routes.test.tsx` to the new Home contract (feed sections instead of placeholder skeletons/empty copy) and add route coverage for `/discover` — verify: `npm test` passes with the updated assertions and no placeholder copy remains in the tree.

## 9. Integration verification and release evidence

- [x] 9.1 Run the full quality gates from the repository root (`cd frontend && npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`) — verify: every command exits `0`.
- [x] 9.2 Produce CDP browser evidence against a production server (`npm run build` + `npm run start`): first-run language onboarding persists across reload; Home renders trending/For You/artists/genre/podcast/collection shelves with real artwork; a failing shelf shows a retryable error while the rest render; multi-language selection produces visibly mixed shelf ordering; recently played appears after playing a track and disappears after clearing history; Discover genre shelf populates; offline shows the connection explanation; exactly one player iframe/API script; zero console errors — verify: `results.json` reports `"pass": true` with screenshots and a reproduce-path README (disclosing live-run deviations) under the change's `evidence/`.
- [x] 9.3 Update `ROADMAP.md`: M8 status row → `DONE`; tick the §11 items M8 delivers (Home, Discover, Language onboarding, For You, Trending, Popular Artists, Genre discovery, Recently Played) — verify: `git diff` shows only those lines plus the status cell.
- [x] 9.4 Re-verify the quality gates from a clean clone of the branch head — verify: all six commands exit `0` in the fresh clone (proves no uncommitted-file dependency).
