# M13 task 6.2 — browser evidence for the PWA install and offline shell

**Result: `pass: true` — 34/34 steps, 5 screenshots, 0 console errors**, with 83
network errors during the deliberate offline window disclosed rather than counted.

Reproduce from the repository root:

```bash
cd frontend
npm ci
npm run build          # the harness runs the build's output; it must exist first
cd ..
node openspec/changes/add-pwa-install-and-offline-shell/evidence/cdp-check.mjs
```

The harness is Node built-ins only (no dependencies), writes `results.json` and the
screenshots next to itself, and exits `0` only when every assertion passed. It
**starts and stops the production server itself** (`next start -p 3210`), so
nothing needs to be running beforehand. Optional environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SPOTIVIBE_PORT` | `3210` | The port the harness starts the server on. |
| `SPOTIVIBE_EXTERNAL` | unset | `1` runs against an already-running server and uses CDP emulation instead of a real outage. **Weaker** — see *Offline is a stopped origin*, below — and the results say so in `notes.offlineMechanism`. |
| `SPOTIVIBE_BROWSER_PATH` | auto | Edge/Chrome executable override. |
| `SPOTIVIBE_CDP_PORT` | `9455` | The DevTools port. |

`server.log` in this directory is the captured output of every server the harness
started; it is append-only across runs and is the first place to look when a run
fails to reach the origin.

## What is actually verified here

`results.json` holds the full record: every step, the values behind it, the
attached CDP targets, every document response with its `fromServiceWorker` flag,
the worker's cache contents at each phase, the console log, and every disclosure.

- **Installable identity.** The manifest is fetched from the running server and
  checked field by field (`display: standalone`, a stable `id`, root `start_url`
  and `scope`, the DESIGN.md colors). Every icon the manifest declares is fetched
  and its PNG header is read, so a 404 or a wrong-size icon fails here instead of
  at install time — the classic silent installability failure. The served payload
  is scanned for third-party brands.
- **The worker registers and controls the page.** The run waits for
  `navigator.serviceWorker.ready`, then asserts exactly one controlling worker,
  that its script is the app's own `/sw.js`, and that nothing is waiting or
  installing. The worker *target* is asserted to be attached to the run, because
  an unattached worker means "offline" cannot include the worker.
- **The local pages render offline, and the worker is what served them.** Each
  document response in the offline phase is checked for `fromServiceWorker: true`,
  so "the page rendered" is never taken as evidence that the worker did it.
- **Caches are bounded and namespaced.** Cache contents are read from the page
  after the run, compared against the bounds read out of `sw.js` at runtime.
- **An uncached route opens the application.** `/artist/…` (never visited) and
  `/search` (never visited) are navigated offline; each is asserted to be served by
  the worker, to have the app's own chrome rather than Chrome's error page, and to
  say why it cannot load. See *The shell's content* below for what that costs.
- **Metadata falls back; search does not.** `/api/artist` is fetched once while the
  origin is up (with `cache: "no-store"`, so the browser's own HTTP cache cannot
  satisfy it) and again with the origin down. The offline response carries the
  worker's own `x-spotivibe-cached-at` stamp, which is how "this came from the
  worker's cache" is distinguished from "this came from the network". `/api/search`
  is then fetched offline and must **fail**: a search is a live question.
- **The offline message is the shipped copy.** The banner's text is compared
  against fragments extracted from `ConnectionBanner.tsx` at runtime, not against a
  copy in this harness.
- **Data controls stay usable offline**, and an export control is found by its
  accessible name on the settings surface.
- **The update handshake really answers.** `SKIP_WAITING` is posted to the live
  controller and the worker's `ACTIVATED` reply is observed over the real message
  port. A liked-track row is written to IndexedDB before the activation and read
  back afterwards.
- **The install affordance appears and then withdraws**, driven by a *trusted*
  CDP mouse click (an in-page `click()` fails with `NotAllowedError`, because
  `BeforeInstallPromptEvent.prompt()` requires a user gesture).

## Disclosures — what this run did *not* prove

1. **A waiting worker is not reproducible here.** It needs a second, different
   build installed behind the current one; a single static build cannot produce
   one. The activation handshake is exercised for real; the waiting-worker state
   machine (including "a superseded attacher cannot report for the live one") is
   covered by `frontend/tests/pwa-client.test.tsx`.
2. **Installability as Chrome's install UI presents it, and real iOS/Android
   home-screen behavior.** The manifest, the icon set (including decoded PNG
   dimensions and the maskable safe area) and the iOS document metadata are
   verified *as served*. A headless desktop browser cannot install to a home
   screen. This is the "where possible" clause of ROADMAP M13, and this is where
   it stops.
3. **Offline artwork.** No artwork is displayed on the pages this run visits, so
   the artwork cache is exercised by `frontend/tests/pwa-service-worker.test.ts`
   (serving, background revalidation, FIFO eviction at its bound) rather than by
   real image traffic.
4. **The 7-day metadata freshness bound.** Exercised in the unit suite by aging a
   stored copy's stamp, not by waiting seven days.
5. **The shell's content.** An uncached route is served the cached shell document,
   which was rendered for the site root, so the application boots and shows the
   Home route's content at the requested URL (observed: `/search` rendered the Home
   shell). The connection banner states that search and playback need a connection.
   The listener gets a working application and an honest message instead of a
   browser error page, but not the exact route they asked for. A per-route offline
   document would need a build-time asset manifest, which this application has no
   honest way to produce for its dynamic routes. Recorded in
   `results.json → notes.disclosures.shellContent`.
6. **83 network errors during the offline window** (connection refused, failed
   subresource loads) are disclosed in `notes.disclosures.offlineWindow` rather
   than counted as defects. They are what an offline application looks like. The
   console-error assertion covers only the online phase and the boundaries.

## Offline is a stopped origin, not an emulation

This is the single most important thing about the harness, and it was learned the
hard way.

The first version emulated offline with `Network.emulateNetworkConditions`. That is
enough for the *page*, and it produced a completely misleading result for the
*worker*: the worker's own `fetch()` kept reaching the server, so the
"metadata is served from the cache offline" assertion was measuring the network and
reporting a cache hit. Two further traps sat behind it:

- A service worker is a **browser-scoped** target, so page-level emulation never
  reached it at all, and auto-attaching only at page level meant the worker was not
  even observable. The harness therefore connects to the **browser** endpoint and
  auto-attaches at browser level, recording every attached target.
- `child.kill()` on the spawned `next start` did not free the port on Windows —
  Next's own server process survived and kept serving. The run's "offline" phase was
  quietly online, and a second class of assertion (an API probe) reported network
  responses as cache behaviour. `stopServer` now kills the process **tree**
  (`taskkill /T /F` on Windows, process-group kill elsewhere), and the run asserts
  `originRefusedConnections` as a step of its own, because everything in the offline
  phase depends on it.

CDP emulation is still applied, for one narrow reason: the app derives its
connection state from `navigator.onLine`, and a stopped origin does not change
that value. So the page gets the browser's offline signal while the worker gets a
genuinely unreachable origin. `results.json → notes.offlineMechanism` states both
halves.

## Three defects this run found in the application

Recorded here because the evidence is the argument for them:

1. **An uncached navigation failed outright.** The first worker refused to answer a
   per-entity navigation at all, so an offline first visit to an artist handed the
   listener Chrome's own "no internet" page — no navigation, no player, no way back.
   The fix is an ordered fallback chain: network → this route's own cached document
   → the cached shell document. The spec and `design.md` were amended to state it,
   and the chain was then *unified* for every navigation after the same run showed
   that a prerendered route that had never been visited (`/search`) still failed.
2. **`new Request("/")` throws inside a service worker.** The install-time shell
   precache swallowed it in its own `catch`, so the cache silently stayed empty and
   the fallback chain had nothing to fall back to. The Cache API accepts a relative
   string key; that is what is used now.
3. **`install()` awaited `userChoice`, which can never resolve.** Headless Edge
   accepts `prompt()` and never reports a choice, which left the row stuck on
   "installing" with no way out. `install()` now resolves once the platform's prompt
   is up, the affordance withdraws (the app does not re-ask on its own), and a
   reported dismissal is recorded if and when it arrives. Completion is the
   `appinstalled` event's job.

## Screenshots

| File | What it shows |
| --- | --- |
| `offline-settings.png` | Settings rendered with the origin down, offline banner visible. |
| `offline-library.png` | The library rendered from the worker's cache. |
| `offline-entity-route.png` | An uncached artist route while offline: the application, with its own state. |
| `offline-search.png` | The unvisited `/search` route while offline: the application plus the offline message. |
| `settings-install-row.png` | Settings after the install affordance resolved. |
