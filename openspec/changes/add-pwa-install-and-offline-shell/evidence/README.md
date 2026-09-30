# M13 task 6.2 — browser evidence for the PWA install and offline shell

**Result: `pass: true` — 34/34 steps, 5 screenshots, 0 console errors**, with 93
network errors during the deliberate offline window disclosed rather than counted.

Reproduce from the repository root:

```bash
cd frontend
npm ci
npm run icons:check    # the committed PNGs still match the generator
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
  `/search` (never visited) are navigated offline. Each is asserted to land on the
  shell **with the shell's own URL** — so the address bar and the content agree — to
  carry the app's chrome rather than Chrome's error page, and to be served by the
  worker (the shell document it lands on is checked for `fromServiceWorker`, because
  the 302 itself is not attributed to a request in CDP's response records). See *The
  shell's content* below for what that costs.
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
  accessible name on the settings surface. Every offline page assertion is scoped to
  the route's own `<main>` subtree and fails on an application error boundary, because
  a crash page still has the shell's landmarks — the earlier document-wide check
  scored `/library/liked`'s error boundary as a pass.
- **The update handshake really answers.** `SKIP_WAITING` is posted to the live
  controller and the worker's `ACTIVATED` reply is observed over the real message
  port. A liked-track row is written to IndexedDB before the activation and read
  back afterwards.
- **The install affordance appears and then withdraws**, driven by a *trusted*
  CDP mouse click (an in-page `click()` fails with `NotAllowedError`, because
  `BeforeInstallPromptEvent.prompt()` requires a user gesture). The step is named for
  what the run observes: the row withdraws because the offer has been spent, not
  because `appinstalled` fired — it never fired in this browser, and the run says so.

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
5. **The shell's content.** An uncached route is answered with a **redirect to the
   cached shell**, so the listener lands on the Home route at the Home route's own
   URL, with the connection banner stating that search and playback need a
   connection. They get a working application and an honest message instead of a
   browser error page — but not the route they asked for, because a single offline
   shell cannot render a route it has never been sent. (An earlier version served the
   shell's *document* under the requested URL; the run caught that the Home route then
   rendered at `/search`, and the worker now redirects instead.) A per-route offline
   document would need a build-time asset manifest, which this application has no
   honest way to produce for its dynamic routes. Recorded in
   `results.json → notes.disclosures.shellContent`.
6. **93 network errors during the offline window** (connection refused, failed
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

## Defects this run found in the application

Recorded here because the evidence is the argument for them. The first three are from
the initial run; the rest are from an independent verification pass that read the
implementation against the specification and drove the worker's shipped bytes.

1. **An uncached navigation failed outright.** The first worker refused to answer a
   per-entity navigation at all, so an offline first visit to an artist handed the
   listener Chrome's own "no internet" page — no navigation, no player, no way back.
   Fixed with an ordered fallback chain, unified for every navigation after the same
   run showed a never-visited prerendered route still failing, and finally changed from
   *serving* the shell's document to *redirecting* to it when the run showed the Home
   route rendering under `/search`'s URL.
2. **`new Request("/")` throws inside a service worker.** The install-time shell
   precache swallowed it in its own `catch`, so the cache silently stayed empty and
   the fallback chain had nothing to fall back to. The Cache API accepts a relative
   string key; that is what is stored now.
3. **`install()` awaited `userChoice`, which can never resolve.** Headless Edge
   accepts `prompt()` and never reports a choice, which left the row stuck on
   "installing" with no way out. `install()` now resolves once the platform's prompt
   is up, the affordance withdraws (the app does not re-ask on its own), and a
   reported dismissal is recorded if and when it arrives. Completion is the
   `appinstalled` event's job.
4. **`skipWaiting()` on install made the whole update flow unreachable.** A worker
   that skips waiting never enters `waiting`, so the page is never told an update
   exists: the notice was unreachable and the version swap silent — the one guarantee
   design decision 6 exists to provide. Install no longer activates on its own; the
   listener's action is the only path.
5. **A search URL requested as a navigation was cached as a page.** Classification
   checked `request.mode` before the `/api/` rule, so a listener who searched, lost
   the network and pressed Back had that result set written into the page cache — a
   stale answer set served as if live. A path is now classified as a path, whatever
   requested it, in both the worker and its test.
6. **`/api/discover` was cached on a false justification.** It is keyless but not
   profile-free: the client sends `seeds` derived from liked tracks and listening
   events. It is now served live and left uncached, and the requirement's wording no
   longer claims a host list it did not have.
7. **The precached shell was evicted after about nineteen document navigations**, as
   an entry in the FIFO-bounded page cache — quietly restoring the browser error page
   the fallback exists to prevent, about nineteen navigations later. The shell now has
   a cache of its own with a bound of one.
8. **The activation filter deleted any `spotivibe-` cache**, including one this worker
   never created. It now matches this worker's own cache *shapes* and versions, and
   the test creates previous-version, current-version and foreign caches to prove which
   survive.
9. **`/library/liked` crashed into the route error boundary** on a liked row whose
   track had no `artists` — a record the repository cannot write, but which a backup
   from an older build or an external tool could. The surface now skips what it cannot
   render, which is the same "stored records are untrusted" rule the repositories
   already apply, and the evidence run's assertion was scoped to the route's own
   subtree so a crash page can no longer pass as a rendered page.

## Screenshots

| File | What it shows |
| --- | --- |
| `offline-settings.png` | Settings rendered with the origin down, offline banner visible. |
| `offline-library.png` | The library rendered from the worker's cache. |
| `offline-unvisited-route.png` | An unvisited route while offline: redirected to the shell, inside the application. |
| `offline-search-fails.png` | A search request while offline: rejected, never answered from cache. |
| `settings-install-row.png` | Settings after the install affordance resolved. |

Both unvisited routes land on the same shell by design, so there is one screenshot of
that destination rather than two byte-identical ones presented as two pieces of
evidence.
