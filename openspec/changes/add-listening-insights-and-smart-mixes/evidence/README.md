# M11 evidence — Listening insights and Smart Mixes

Task 7.2 of `openspec/changes/add-listening-insights-and-smart-mixes`. Everything in
this directory was produced by driving a **production build** in headless Edge over
the Chrome DevTools Protocol.

## What is in here

| File | What it is |
| --- | --- |
| `cdp-check.mjs` | The harness. Node built-ins only — no Playwright, no Puppeteer, no dependencies. |
| `results.json` | The run record: every step with its verdict and detail, the observed screenshots, the console-error buckets, and the observed `/api/discover` requests. |
| `history-*.png`, `mix-generated-1280.png` | Screenshots captured during the run at 1280×900. |

`results.json` reports `"pass": true` only when **every** step passed and the run
raised no uncaught error. Exit code 0 means the same thing.

## Reproducing the run

```bash
# 1. Production build and server (the harness never starts either itself).
cd frontend
npm ci
npm run build
npm run start -- -p 3210

# 2. In another shell, from the repository root:
node openspec/changes/add-listening-insights-and-smart-mixes/evidence/cdp-check.mjs
```

Environment overrides:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SPOTIVIBE_ORIGIN` | `http://localhost:3210` | Where the production build is served. |
| `SPOTIVIBE_BROWSER_PATH` | first Edge/Chrome found | Explicit browser executable. |
| `SPOTIVIBE_CDP_PORT` | `9445` | DevTools port. |

The run needs outbound network access: it performs a **live** search against
YouTube Music through the app's own `/api/search` route, and mix generation calls
the app's own `/api/discover?kind=mix`. There is no fixture or mock provider — a run
that cannot reach the upstream provider will fail on the search step, and that is
reported as a step failure rather than papered over.

## What the run asserts, and why it is not the same as the unit tests

The unit suite proves the derivation rules (`tests/build-stats.test.ts`,
`tests/classify-play.test.ts`, `tests/generate-mix.test.ts`) against synthetic
events. It cannot prove that **the real browser** records the seconds a track
actually played, that a real provider feed fills a mix, or that a backup round trip
survives a real reload. That is what this run covers:

1. **The measurements are real.** Events are read straight out of IndexedDB in the
   page and compared against the seconds the engine reported. Before the M11 recorder
   work (design decision 7) every event carried `secondsPlayed: 0`; this run is the
   evidence that a played track now carries real seconds, and that a track left
   playing still honestly reads zero.
2. **Verdicts follow from those measurements.** The History rows' verdicts are read
   from the DOM and include both "Played partly" and "Skipped", so the rule is shown
   distinguishing real plays from a zero-second step rather than being asserted in the
   abstract.
3. **The statistics are derived on read.** The page reports time, plays, verdicts,
   top tracks, top artists, and a streak from events that existed seconds earlier;
   then a single click on "Clear history" empties the record **and** the statistics,
   with no invalidation step — the proof that no aggregate is stored.
4. **A mix is built from local signal only.** On a cold device the surface says mixes
   appear after some listening and *no request is issued*. After real listening, a mix
   is generated from the app's existing `mix` feed, appears on Home by name, plays, and
   refreshes without changing its identity or name.
5. **Nothing private crosses a request.** Every observed `/api/discover` request's
   query keys are compared against the server's documented four (`kind`, `languages`,
   `seeds`, `limit`). Taste weights, liked tracks, history rows, and mix contents are
   asserted absent.
6. **The mixes dataset survives a real round trip.** Settings → Export backup, then
   Reset everything, then Import through the real file picker, then read the dataset
   out of IndexedDB again and compare identity and name.

## Live-run deviations, disclosed

These are the places where the run is *not* a clean-room reproduction, stated plainly
rather than buried:

- **Playback pacing is wall-clock.** Each step waits ~15 s of real playback before the
  real "Next track" control is clicked, because a step's measurements are written when
  the step *ends*. The recorded seconds therefore vary per run (typically 12–16 s).
  The assertions use thresholds, not exact values: ≥ 3 measured events, every measured
  event ≥ the 10 s skip threshold, and the classification follows from them.
- **Zero-second events are expected and kept.** A track that loads but never starts
  reporting a position (buffering) ends its step with no measurement, and that event
  honestly stores zero seconds. The harness keeps stepping until it has three measured
  plays, and those zero-second rows stay in the record — they are real events, and
  seeing one classified "Skipped" is the point.
- **The first search result is whatever is live.** Track and artist names in the output
  are the provider's, not the harness's. A result with an unknown artist or no album
  renders fewer links, so the link assertions are written against the link that exists
  rather than against a fixed title.
- **Artist navigation may use an in-page click.** The run tries a trusted mouse click
  first; if the row sits under the sticky header and the route does not change, it
  falls back to `element.click()`, which drives the same React router handler.
  `results.json` records which path was taken in `notes.artistLinkActivation`.
- **The mixes dataset is *derived* and survives, but is not precious.** The round trip
  restores it because a named mix the listener recognizes should not vanish on import.
  The restore is verified by identity and name, which is the property the requirement
  states; the track list is verified to round-trip through the repository tests rather
  than by diffing the live envelope.
- **Console errors are bucketed, and every bucket is disclosed.** Deliberate failures
  and live-provider flakes (`net::ERR_`, 404/5xx while a probe is open, 429/503 from the
  upstream provider) are recorded in `notes.disclosures` with their URL. Anything not
  matched by a documented bucket is counted as a console error and fails the run. This
  run's `consoleErrors` array is empty.

## Files not in the run

- **No offline-window test.** Unlike the M9/M10 harnesses, this run does not emulate an
  offline window: every M11 behavior under test is local derivation, and the one
  provider-dependent step (mix generation) is asserted for *its* failure path by unit
  test rather than by a network cut. `notes.disclosures.offlineWindow` is therefore
  expected to be empty rather than populated.
- **No share-surface test.** The `local-data` delta's "sharing is explicit and
  non-destructive" scenario is vacuous for this build: there is no share surface in the
  application at all, so nothing can leak one. It is not simulated here.
