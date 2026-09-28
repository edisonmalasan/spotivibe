# M6 browser evidence — queue, session persistence, and network recovery (task 9.3)

**Evidence class: browser/runtime evidence.** This directory captures what
unit tests cannot: the queue surface, session restore, and network recovery
running against a **production build** in a real Chromium browser (headless
Edge), driven end-to-end over the Chrome DevTools Protocol by a dependency-free
script (Node built-ins + the global `WebSocket` only — no Playwright/Puppeteer
packages).

Generated: 2026-09-28 (see `generatedAt` in `results.json`).

## What is proven

| Requirement | Result |
| --- | --- |
| Queue edits do not disturb transport state | reorder/remove/enqueue steps keep `control=Pause` and the current track id unchanged throughout |
| Starting playback from a surface records the queue source | play from search → `sourceLabel=true` after reload; restored queue still labeled `From search` |
| Enqueueing while playing leaves playback untouched | `Queue, 17 upcoming → 18 upcoming` while the position keeps advancing |
| Duplicate insertion is prevented | re-adding the same result: label stays `18 upcoming` |
| Reordering while playing preserves the current track | rows swap in `/queue`, `now=youtube:BSTsnWoslP4` unchanged, still playing |
| Removing an upcoming item while playing | `18 → 17 upcoming`, position `0:05 → 0:05`, playback uninterrupted |
| Advancing records history | manual Next: `now` changes, `history=["youtube:BSTsnWoslP4"]` |
| Playback progress is persisted during use | IndexedDB `session` record read in-page: `positionSeconds=4.002561` ↔ displayed `0:04` (within 1 s), queue/history current |
| Cold launch restores the track without starting playback | after reload: restored at `0:04`, `control=Play`, still Play after a 3.5 s window |
| Exactly one IFrame API script / player instance | `apiScripts=1, iframes=1` after reload **and** after recovery |
| Trusted gesture resumes at the saved position | CDP input click → position advances `0:04 → 0:05` |
| Going offline shows the banner everywhere | on `/queue`: `role="status"`, exact offline copy |
| The banner never covers the player surface | `overlapsBar=false, overlapsDock=false`; `elementsFromPoint` above bar/dock returns the banner only where expected |
| An outage preserves the session and queue | queue rows, current track, and label **byte-identical** across the transition; position never rewinds (`0:05 → 0:05`) |
| Failures while offline do not consume the queue | 60 samples across the outage: `autoAdvanced=false`, upcoming `15 → 15`, history unchanged |
| Parked copy on offline failure (conditional) | **DISCLOSED** — the live transport buffered instead of erroring, so the conditional park copy never rendered; see disclosures below |
| Reconnecting clears the banner | `banner=null, error=null` after the online flip |
| Interrupted playback is retried at position on reconnect | `stateClass=interrupted`; **exactly one** retry: in-page `loadVideoById=1`, corroborated by exactly one CDP-observed `/youtubei/v1/player` fetch (`netCalls=1`) |
| No position rewind; playback resumes | `0:00 → 0:01` after recovery, `noRewind=true`, no second retry |
| Zero console errors for the whole session | `consoleLog.appErrors=[]` (offline-window net-cut entries are disclosed separately — see below) |

All **23 steps passed** (`results.json` → `"pass": true`, script exit code 0).

## Files

- `cdp-check.mjs` — the self-contained driver (launches headless Edge with a
  throwaway profile, runs the queue/playback/offline/reconnect scenario,
  injects the observation patch at document start, writes `results.json` +
  screenshots).
- `results.json` — machine-readable run report: steps, DOM snapshots for every
  byte-identical comparison, the in-page session record probe, banner geometry,
  offline-window samples, transport classification, retry counters and wrapper
  diagnostics (`ytPatch`, `restoreCalls`, `retryObservation`), network
  emulation log, console split.
- `queue-edits-1280.png` — `/queue` after reorder + remove while playing.
- `reload-restored-1280.png` — reload restored queue + history + source, cued paused.
- `offline-banner-1280.png` — offline banner over `/queue` mid-playback.
- `recovered-1280.png` — reconnected: single retry at position, playback resumed.

## How the run works

1. Fresh browser profile ⇒ empty IndexedDB database; open the app, assert the
   hydrated top-bar search.
2. Live search → play the first ≥2:00 result (queue source `search`); assert
   the position advances.
3. Add a second result via its menu (`17 → 18 upcoming` while playing), re-add
   it (duplicate rejected), then in `/queue`: reorder two upcoming rows and
   remove one — current track, playback, and all untouched rows stay put.
4. Manual Next → the finished track appears in "Recently played".
5. Wait until the position is ≥0:04, click Pause, wait ≥2 s for the debounced
   session flush (see disclosure 1), then read the `session` record directly
   from IndexedDB and compare it to the DOM snapshot.
6. Full `Page.reload` → assert restore at the saved position, Play affordance
   with no autoplay (3.5 s window), source label, single iframe/API script;
   trusted Play click → position advances.
7. Go offline on the main frame **and the embed frame**
   (`Network.emulateNetworkConditions` mirrored via `Target.setAutoAttach`) →
   banner copy + geometry + byte-identical queue comparison, then a 45 s
   observation window sampling the queue/current track for any automatic
   advance (60 samples this run).
8. Reconnect → assert banner/alert clear, classify the transport from three
   position samples (`playing` / `interrupted` / `error`), reset the retry
   counters, flip online, and assert exactly one retry at the interrupted
   position, playback resume with no rewind, one iframe, and the console
   split; write `results.json`; exit non-zero on any failure.

## Disclosures (read together with the results)

1. **Debounced session flush before reload.** The player persists the session
   on a 2000 ms debounce that resets on every position tick, so no write lands
   during continuous playback; the `pagehide` write races page teardown in
   Chromium. The script therefore waits ≥2 s after Pause for the primary
   flush path, then asserts the record content itself (`recordProbe`,
   `recordBeforeReload`) instead of relying on teardown timing. This tests the
   designed flush path; it does not claim the pagehide fallback is reliable.
2. **Console evidence split.** Console capture separates `appErrors`
   (origin-console errors, runtime exceptions, `Log` errors — asserted empty)
   from `disclosedNetCutEntries` (resource-level `net::…` entries caused by the
   emulated network cut itself, which are disclosed and never counted). This
   run recorded 0 net-cut entries; the split exists so future runs cannot mask
   a real error behind an offline-window artifact.
3. **The parked copy is conditional on a player error.** The spec makes
   parking conditional on a surfaced player failure; the live YouTube transport
   buffers indefinitely while offline instead of erroring, so within the 45 s
   window no error appeared and the parked copy did not render. Rather than
   fabricate an error, the run asserts the stronger unconditional invariant —
   the outage never advances or consumes the queue — and discloses the park
   outcome (`parkTrigger`). The parked copy and no-failure-growth behavior are
   proven by `frontend/tests/player/offlineRecovery.test.ts`.
4. **Offline Next is a scripted user action.** To keep the outage→reconnect
   transition meaningful when the transport merely buffers, the script clicks
   Next once while offline (disclosed as `parkFallback`), so the "no automatic
   advance" baseline is explicitly post-Next (`baseline=post-Next` in the step
   detail). It is a trusted user click, not product behavior.
5. **Exactly-one-retry counting.** The driver injects a document-start patch
   that wraps `YT.Player` and the engine's `events.onReady`/`event.target`
   handoff (the engine reassigns `this.player = event.target`), counting
   `loadVideoById`/`cueVideoById` calls through the live instance; counters are
   reset immediately before the online flip. The count is corroborated
   independently by the number of `/youtubei/v1/player` fetches observed over
   CDP (`netCalls`), and wrapper diagnostics are stored in `results.json` — if
   the wrapper ever fails to attach, the step falls back to the CDP count and
   says so in its detail rather than passing silently.
6. **Automated vs browser evidence.** This run is one production-build session
   in headless Edge; it complements, and does not replace, the automated
   suite (`npm test`: 60 files / 550 tests at this change). Screenshots are
   supporting visual evidence; every claim above is asserted programmatically
   in `results.json`.

## Reproduce

```powershell
cd frontend
npm run build
$env:SPOTIVIBE_ORIGIN='http://localhost:3210'; npm run start -- -p 3210   # separate shell
cd ..
node openspec/changes/add-queue-session-recovery/evidence/cdp-check.mjs
```

Environment overrides: `SPOTIVIBE_ORIGIN` (default `http://localhost:3210`),
`SPOTIVIBE_BROWSER_PATH` (Edge/Chrome executable), `SPOTIVIBE_CDP_PORT`
(default `9445`). Requires outbound network access to YouTube (live search,
the IFrame API, and the videos themselves). Exit code 0 means every assertion
passed.

## What this evidence surfaced

All failures during development were **harness** defects, not product defects:

- The session-record probe reported `MISSING` although restore visibly worked:
  the probe compared store history entries (`{track, playedAt}`) and full track
  objects against DOM ID strings. The store shape is correct; the probe now
  normalizes to IDs and matches (`recordProbe: "matched"`).
- The banner-overlap geometry initially reported `true` because the script
  compared `r.left > r.right` instead of `br.right`; a live probe confirmed
  the banner sits top-right, clear of the bar and dock (product correct), and
  the corrected assertion passes.
- Retry counting needed the `event.target` trap: YouTube attaches
  `loadVideoById`/`cueVideoById` only after construction, and the engine
  reassigns `this.player = event.target` in `handleReady`, so constructor-only
  wrapping never saw a call. With the trap, the restore cue counts 1 and the
  reconnect retry counts exactly 1.

Final run: 23/23 steps, exit code 0.

## What this does NOT prove

- The parked copy rendering on a real player error while offline — covered by
  `frontend/tests/player/offlineRecovery.test.ts` (this run disclosed the
  buffering outcome instead).
- Paused/idle sessions never auto-resuming on reconnect, failed-retry settling
  without looping, transient error backoff, and fatal-error skipping —
  deterministic unit coverage (fake timers), not triggerable reliably against
  live YouTube in one run.
- Keyboard reordering, bounded history, re-queuing an already-played track,
  remove-current/remove-last edge cases, and repeat-mode traversal — covered
  by the queue unit tests (`frontend/tests/queue/`).
- Degraded-connection detection (only hard offline/online flips are emulated),
  non-Chromium browsers, and installed-PWA contexts (M13).
