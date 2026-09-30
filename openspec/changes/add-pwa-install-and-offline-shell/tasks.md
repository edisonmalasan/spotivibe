# Tasks

## 1. Installable identity

- [ ] 1.1 Add a typed Web App Manifest at `src/app/manifest.ts` declaring name, short name, description, `id`, `start_url`, `scope`, `display: standalone`, orientation, theme and background colors, and an icon set — verify: a test asserts the manifest object's fields, and `GET /manifest.webmanifest` on a production build returns them (spec: `pwa` — "Installable application identity").
- [ ] 1.2 Generate PNG icons (192, 512, maskable 512) from the existing `icon.svg` geometry with a committed generator script, keep the SVG in the manifest as well, and commit the binaries — verify: a test asserts every icon the manifest declares resolves to a file the app actually serves, at the declared size, and that the maskable icon's safe area is respected — verify: the generator is deterministic (running it twice produces byte-identical files).
- [ ] 1.3 Set the document metadata the manifest depends on (theme color, viewport fit for standalone, apple touch icon and mobile-web-app tags) without changing the existing title/description contract — verify: a layout test asserts the new metadata and the unchanged title/description.

## 2. The service worker

- [ ] 2.1 Write `public/sw.js` as a hand-written worker: a versioned cache list, the per-request-class decision table (deny non-GET/Range/player, cache-first hashed assets, network-first prerendered navigations, network-first metadata with fallback, image cache), and FIFO eviction with named bounds — verify: a static test over the real file pins every class's rule, every bound, and every denial (spec: `pwa` — "Service worker caching strategy").
- [ ] 2.2 Keep the worker free of storage-clearing behavior and of any reach into IndexedDB — verify: a static test asserts the file contains no IndexedDB access, no `caches.delete` of a cache it does not own, and no storage-clearing API; the same rule is asserted again in the architecture suite.
- [ ] 2.3 Register the worker from a client module that is a no-op where service workers are unsupported, and register it only in a browser context — verify: a unit test with no `navigator.serviceWorker` asserts registration is skipped without throwing, and a test with a fake registration asserts the register call and the scope.

## 3. Offline pages and metadata

- [ ] 3.1 Prove the local surfaces render offline and add whatever they lack: verify: a browser run (task 6.2) loads `/library`, `/library/liked`, `/history`, `/queue`, and `/settings` online, cuts the network, and reloads each; each renders its stored content.
- [ ] 3.2 Ensure a first-time offline visit to a per-entity route shows the honest error state rather than a cached substitute — verify: with no cached response, the worker's navigation falls through to the network and the route's own error state renders (unit-level: the worker's class decision; browser-level: the error state is what appears).
- [ ] 3.3 Bound the metadata and artwork caches with freshness and count, and serve them only as a network fallback — verify: unit tests over the worker's helpers (pure functions, exercised directly) cover the freshness bound, the eviction bound, and the "live response wins" ordering.

## 4. Honest offline copy

- [ ] 4.1 Rewrite the connection banner's offline message to name search and playback as needing a connection and to state what remains available, keeping the `role="status"` region, the routing independence, and the no-overlay property — verify: a component test asserts the new copy and the existing region/positioning contracts (spec: `network` — "Connection status banner").
- [ ] 4.2 Add a negative test that no shipped user-facing copy claims offline playback or offline provider search — verify: a test scans the shipped sources for the phrases such a claim would use and fails if one appears, with a comment naming the requirement it protects.

## 5. Install affordance and update flow

- [ ] 5.1 Add an install-prompt module that captures `beforeinstallprompt`, exposes the deferred event, and records completion and dismissal in `localStorage` under a namespaced key — verify: unit tests cover capture, activation, dismissal persistence across a re-mount, and the installed transition.
- [ ] 5.2 Add an Install row to Settings that appears only when a prompt is available, explains "Add to Home Screen" where the platform has no prompt, and disappears once installed — verify: component tests for all four states, including the "dismissed" state not reappearing.
- [ ] 5.3 Add the update notice to the shell: a dismissible notice when a worker is waiting, with a Reload action that activates it and re-renders from the network — verify: unit tests over the registration module's waiting/notice state machine, and a component test for the notice's copy, its dismiss behavior, and that a later update is announced again.
- [ ] 5.4 Prove an activation preserves local data — verify: a browser run (task 6.2) records a liked track, activates an update, and re-reads the dataset from IndexedDB, asserting the record is still there.

## 6. Verification and release evidence

- [ ] 6.1 Extend the architecture suite for M13: the worker must not reach the data layer, the network layer, or any provider module; the manifest must not name a local-data parameter; the install/update modules must stay client-only and off the server — verify: each detector is proven against a violating snippet and passes on the clean tree.
- [ ] 6.2 Produce CDP browser evidence against a production build: the manifest and icons are served and well-formed; the worker registers; the local pages load online and again with the network cut; offline search says search needs a connection; an update activates and local data survives; exactly one worker controls the page; zero console errors with disclosed deliberate windows — verify: `results.json` reports `"pass": true` with screenshots and a reproduce-path README disclosing live-run deviations, including which platform behaviors (real iOS/Android home screens) were not verifiable here.
- [ ] 6.3 Run the full quality gates from the repository root (`cd frontend && npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`) — verify: every command exits `0`.
- [ ] 6.4 Re-verify the quality gates from a clean clone of the branch head — verify: all six commands exit `0` in the fresh clone.
- [ ] 6.5 Update `ROADMAP.md`: M13 status row → `DONE` and the M13 items the change delivers ticked in the feature checklist — verify: `git diff` shows the status cell, the ticked items, and a short delivery record for the M13 section.
