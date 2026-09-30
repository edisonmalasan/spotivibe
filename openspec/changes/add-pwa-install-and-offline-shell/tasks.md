# Tasks

## 1. Installable identity

- [x] 1.1 Add a typed Web App Manifest at `src/app/manifest.ts` declaring name, short name, description, `id`, `start_url`, `scope`, `display: standalone`, orientation, theme and background colors, and an icon set — verify: a test asserts the manifest object's fields, and `GET /manifest.webmanifest` on a production build returns them (spec: `pwa` — "Installable application identity").
- [x] 1.2 Generate PNG icons (192, 512, maskable 512) from the existing `icon.svg` geometry with a committed generator script, keep the SVG in the manifest as well, and commit the binaries — verify: a test asserts every icon the manifest declares resolves to a file the app actually serves, at the declared size, and that the maskable icon's safe area is respected — verify: the generator is deterministic (running it twice produces byte-identical files).
- [x] 1.3 Set the document metadata the manifest depends on (theme color, viewport fit for standalone, apple touch icon and mobile-web-app tags) without changing the existing title/description contract — verify: a layout test asserts the new metadata and the unchanged title/description.

## 2. The service worker

- [x] 2.1 Write `public/sw.js` as a hand-written worker: a versioned cache list, the per-request-class decision table (deny non-GET/Range/player, cache-first hashed assets, network-first prerendered navigations, network-first metadata with fallback, image cache), and FIFO eviction with named bounds — verify: a static test over the real file pins every class's rule, every bound, and every denial (spec: `pwa` — "Service worker caching strategy").
- [x] 2.2 Keep the worker free of storage-clearing behavior and of any reach into IndexedDB — verify: a static test asserts the file contains no IndexedDB access, no `caches.delete` of a cache it does not own, and no storage-clearing API; the same rule is asserted again in the architecture suite.
- [x] 2.3 Register the worker from a client module that is a no-op where service workers are unsupported, and register it only in a browser context — verify: a unit test with no `navigator.serviceWorker` asserts registration is skipped without throwing, and a test with a fake registration asserts the register call and the scope.

## 3. Offline pages and metadata

- [x] 3.1 Prove the local surfaces render offline and add whatever they lack: verify: a browser run (task 6.2) loads `/library`, `/library/liked`, `/history`, `/queue`, and `/settings` online, cuts the network, and reloads each; each renders its stored content.
- [x] 3.2 Ensure a first-time offline visit to a per-entity route shows the honest error state rather than a cached substitute — verify: with no cached response, the worker's navigation falls through to the network and the route's own error state renders (unit-level: the worker's class decision; browser-level: the error state is what appears).
- [x] 3.3 Bound the metadata and artwork caches with freshness and count, and serve them only as a network fallback — verify: unit tests over the worker's helpers (pure functions, exercised directly) cover the freshness bound, the eviction bound, and the "live response wins" ordering.

## 4. Honest offline copy

- [x] 4.1 Rewrite the connection banner's offline message to name search and playback as needing a connection and to state what remains available, keeping the `role="status"` region, the routing independence, and the no-overlay property — verify: a component test asserts the new copy and the existing region/positioning contracts (spec: `network` — "Connection status banner").
- [x] 4.2 Add a negative test that no shipped user-facing copy claims offline playback or offline provider search — verify: a test scans the shipped sources for the phrases such a claim would use and fails if one appears, with a comment naming the requirement it protects.

## 5. Install affordance and update flow

- [x] 5.1 Add an install-prompt module that captures `beforeinstallprompt`, exposes the deferred event, and records completion and dismissal in `localStorage` under a namespaced key — verify: unit tests cover capture, activation, dismissal persistence across a re-mount, and the installed transition.
- [x] 5.2 Add an Install row to Settings that appears only when a prompt is available, explains "Add to Home Screen" where the platform has no prompt, and disappears once installed — verify: component tests for all four states, including the "dismissed" state not reappearing.
- [x] 5.3 Add the update notice to the shell: a dismissible notice when a worker is waiting, with a Reload action that activates it and re-renders from the network — verify: unit tests over the registration module's waiting/notice state machine, and a component test for the notice's copy, its dismiss behavior, and that a later update is announced again.
- [x] 5.4 Prove an activation preserves local data — verify: a browser run (task 6.2) records a liked track, activates an update, and re-reads the dataset from IndexedDB, asserting the record is still there.

## 6. Verification and release evidence

- [x] 6.1 Extend the architecture suite for M13: the worker must not reach the data layer, the network layer, or any provider module; the manifest must not name a local-data parameter; the install/update modules must stay client-only and off the server — verify: each detector is proven against a violating snippet and passes on the clean tree.
- [x] 6.2 Produce CDP browser evidence against a production build: the manifest and icons are served and well-formed; the worker registers; the local pages load online and again with the network cut; offline search says search needs a connection; an update activates and local data survives; exactly one worker controls the page; zero console errors with disclosed deliberate windows — verify: `results.json` reports `"pass": true` with screenshots and a reproduce-path README disclosing live-run deviations, including which platform behaviors (real iOS/Android home screens) were not verifiable here.
- [x] 6.3 Run the full quality gates from the repository root (`cd frontend && npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`) — verify: every command exits `0`.
- [x] 6.4 Re-verify the quality gates from a clean clone of the branch head — verify: all six commands exit `0` in the fresh clone.
- [x] 6.5 Update `ROADMAP.md`: M13 status row → `DONE` and the M13 items the change delivers ticked in the feature checklist — verify: `git diff` shows the status cell, the ticked items, and a short delivery record for the M13 section.

## Verification record

All twenty tasks are implemented and verified. What each kind of evidence actually
established, recorded here rather than left to inference:

- **Unit and static (69 new tests; 2152 total, from a clean clone as well as the
  working tree).** `tests/pwa-service-worker.test.ts` evaluates the *shipped bytes*
  of `public/sw.js` in a sandbox with a fake `self`/`caches`/`fetch` and drives the
  `fetch` handler the worker registered, so the classification table and the handler
  cannot disagree unnoticed. `tests/pwa-manifest.test.ts` decodes the committed PNGs
  (dimensions, the mark's position, the maskable safe zone) and compares them
  byte-for-byte with a fresh render. `tests/pwa-client.test.tsx` covers registration,
  the update state machine, the install affordance's four states, and the offline
  copy. `tests/pwa-offline-claims.test.ts` scans every shipped source for
  offline-playback claims and proves the detector fires on a violating snippet.
  `tests/architecture.test.ts` gains the M13 section for `public/sw.js`, the one file
  no existing rule covered.
- **Static checks and the production build** (`lint`, `format:check`, `typecheck`,
  `build`): clean, with no new warning.
- **Browser evidence** (`evidence/results.json`, `pass: true`): 34/34 steps, 5
  screenshots, 0 console errors, 83 disclosed offline-window network errors. The
  offline phase stops the production server, so "offline" is a genuinely
  unreachable origin for the page *and* the service worker rather than an emulation
  that only reaches the page.

### Tasks 3.1 and 5.4, as the browser run measured them

- 3.1 — `/library`, `/library/liked`, `/history`, `/queue` and `/settings` were each
  loaded with the origin up and again with it down; every offline document response
  carries `fromServiceWorker: true`, and `/settings` still offered its backup export
  control with the origin down.
- 5.4 — a row was written to `likedTracks`, `SKIP_WAITING` was posted to the live
  controller, the worker answered `ACTIVATED`, and the row was still present after
  the reload.

### What the verification pass changed, after the implementation was complete

An independent read-only pass compared the implementation against this change's own
specification and drove the worker's shipped bytes in a sandbox. It found defects that
no unit test and no earlier evidence run had caught. All of them are fixed, and each
one is recorded in `evidence/README.md` under *Defects this run found in the
application* with the reason it was invisible before:

- `skipWaiting()` on install made the entire update flow unreachable (a worker that
  skips waiting never enters `waiting`, so the page is never told an update exists).
- A search URL requested as a *navigation* was classified as a page and cached, so a
  stale search result could be served as if it were live.
- `/api/discover` was cached on a justification ("keyless and profile-free") that is
  false: the client sends `seeds` derived from the listener's own liked tracks and
  listening events. It is no longer cached.
- The precached shell document was an entry in the FIFO-bounded page cache, so it was
  evicted after about nineteen document navigations — silently restoring the browser
  error page the fallback exists to prevent.
- The activation filter deleted any cache whose name began with `spotivibe-`,
  including one this worker never created.
- The offline-fallback redirect rendered the Home route under `/search`'s URL. The
  worker now redirects to the shell, so URL and content agree; the spec, `design.md`
  and the evidence claims were corrected, because the previous version claimed the
  route rendered its own error state, which a single offline shell cannot do.
- `/library/liked` crashed into the route error boundary on a liked row whose track
  could not fill `artists`. The surface now skips what it cannot render.
- The install row had no way to be dismissed, so a recorded dismissal was reachable
  only through the platform dialog the app deliberately suppresses. It now has a
  "Not now" control.
- Three evidence steps could not fail: the offline document-response check scanned
  both phases (so an all-fail offline phase still found online entries), the page
  checks scanned the whole document (so a crash page passed), and the redirect
  assertions read a response CDP does not attribute. Each is now phase-marked,
  subtree-scoped, or asserted on the landing.
- Two spec statements contradicted the implementation after the first amendment (the
  absolute "never another route's cached response" against the shell fallback, and
  "no deletion of browser storage" against retiring this worker's own previous
  caches). Both requirement bodies were rewritten to say what the code does.

### Where this milestone deviates from the tasks as written, and why

- Task 2.1's table originally had a distinct rule for per-entity navigations ("no
  cached fallback") and one for prerendered routes ("fall back to the cache"). The
  browser run showed both wrong in the same way - an uncached navigation failed
  outright and handed the listener the browser's own "no internet" page - so the
  worker now has one ordered fallback chain for every same-origin navigation, and
  the `pwa` delta plus `design.md` (decision 2) were amended to state it, with the
  evidence recorded in the design's table.
- Task 5.1's dismissal is remembered in `localStorage`, as decision 5 specified;
  task 6.1's "no dataset" rule is therefore asserted as the repository/store
  whitelist being byte-for-byte unchanged rather than as a new field.
- Task 6.2's "installed mode" could not be exercised on a real device: the run
  verifies the manifest, the icons and the worker against a headless desktop
  browser, and `evidence/README.md` lists exactly which platform behaviors remain
  unverified instead of claiming them.
