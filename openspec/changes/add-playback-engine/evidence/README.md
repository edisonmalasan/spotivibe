# M4 browser evidence — persistent playback engine (task 6.3)

**Evidence class: browser/runtime evidence.** This directory captures what
unit tests cannot: the playback engine running against a **production build**
in a real Chromium browser (headless Edge), driven end-to-end over the Chrome
DevTools Protocol by a dependency-free script (Node built-ins + the global
`WebSocket` only — no Playwright/Puppeteer packages).

Generated: 2026-09-28 (see `generatedAt` in `results.json`).

## What is proven

| Requirement | Result |
| --- | --- |
| Backup import writes the session dataset | `Import complete (merge mode): … session updated.` |
| Cold reload restores the session cued and paused | transport shows the **Play** affordance, position `0:04`, duration `0:19` |
| No autoplay on restore | after 3 s: still `control=Play`, position unchanged at `0:04` |
| Exactly one IFrame API script / one player instance | `apiScripts=1, iframes=1` |
| Volume boot preference applied | volume slider `80` (default for a fresh profile) |
| Visible compliant surface (desktop) | iframe measures **400×225** (≥200×200), `restore-docked-1280.png` |
| Visible compliant surface (compact) | iframe measures **218×200** (≥200×200), `restore-docked-390.png` |
| No overlay on the player | `elementsFromPoint` at dock center → `["IFRAME","DIV","DIV","MAIN"]` (top hit is the player) |
| Trusted gesture starts real playback | CDP input click → control switches to **Pause**, position advances `0:04 → 0:05` (`playing-1280.png`) |
| Route navigation never restarts the player | Home → Search → Library → Now Playing: `same:true, connected:true` for the stamped iframe element on every route; control stays **Pause** |
| Playback continues across navigation | position `5s → 6s` after the full route sequence |
| Controls stay synchronized | PlayerBar control and Now Playing page control both read `Pause` while playing |
| Policy-compliant attribution | `href=https://www.youtube.com/watch?v=jNQXAC9IVRw`, `target=_blank`, `rel=noopener` (referrer **not** suppressed) |
| Zero console errors for the whole session | `consoleErrors: []` (console.error, runtime exceptions, and `Log` error entries all captured) |

All **20 steps passed** (`results.json` → `"pass": true`, script exit code 0).

## Files

- `cdp-check.mjs` — the self-contained driver (launches headless Edge with a
  throwaway profile, imports the fixture, reloads, measures the dock, sends
  trusted input, navigates routes, writes `results.json` + screenshots).
- `results.json` — machine-readable run report: steps, imported fixture
  session, DOM samples (post-restore / +3 s / final), geometry and hit-test
  measurements, trusted-click coordinates, console errors, autoplay flag.
- `restore-docked-1280.png` — restored session on the desktop shell: docked
  cued player (paused at 0:04) above the wired PlayerBar.
- `restore-docked-390.png` — compact shell: dock above MiniPlayer + BottomNav.
- `playing-1280.png` — playback running with the PlayerBar synchronized.
- `nowplaying-playing-1280.png` — Now Playing route with the same player
  running and the attribution link visible.

## How the run works

1. Fresh browser profile ⇒ empty IndexedDB database.
2. Open `/settings`, select a deterministic fixture backup via CDP
   `DOM.setFileInputFiles` — the fixture's `session` dataset contains a real,
   stable, embeddable YouTube video (`jNQXAC9IVRw`, "Me at the zoo") at
   position 4 s.
3. Full `Page.reload` — cold boot: `PlayerHost` applies the volume preference,
   restores the session, and cues the track paused.
4. Assert transport state, position label, single API script/single iframe,
   volume, and **no autoplay** after a 3 s observation window.
5. Measure the docked iframe at 1280×900 (desktop) and 390×844 (compact);
   hit-test the dock center with `document.elementsFromPoint`.
6. Send **trusted** mouse input (`Input.dispatchMouseEvent`) to the Play
   button; wait for the Pause affordance and for the position clock to advance
   past 0:04 — proof the real player is playing (autoplay-blocked and
   player-error outcomes are classified distinctly, never silently).
7. Stamp `window.__m4iframe`, then navigate Home → Search → Library → Now
   Playing by clicking the app's own links (client-side routing). After each
   route assert the stamped element is still the connected iframe — a reload
   or player recreation would reset the stamp and fail the step — and that the
   control still reads Pause.
8. Assert the Now Playing attribution `href/target/rel`, control
   synchronization, continued position advance, and zero console errors;
   write `results.json`; exit non-zero on any failure.

## Reproduce

```bash
cd frontend
npm run build
$env:PORT=3210; npm run start    # separate shell; any free port works
cd ..
node openspec/changes/add-playback-engine/evidence/cdp-check.mjs
```

Environment overrides: `SPOTIVIBE_ORIGIN` (default `http://localhost:3210`),
`SPOTIVIBE_BROWSER_PATH` (Edge/Chrome executable), `SPOTIVIBE_CDP_PORT`
(default `9444`). Requires outbound network access to YouTube (the IFrame API
and the video itself load live). Exit code 0 means every assertion passed.

## What this evidence surfaced

Nothing failed on this run — the first capture passed all 20 steps, including
the ≥200×200 geometry on both shells and the no-overlay hit test.

## What this does NOT prove

- Error-taxonomy paths (transient backoff, fatal skip, all-failed settle) —
  exercised by the fake-timer engine suite (`frontend/tests/player/engine.test.ts`),
  not triggerable deterministically against live YouTube in one run.
- Audio-element/background-play circumvention and extraction prohibitions —
  enforced by static architecture detectors (`frontend/tests/architecture.test.ts`),
  not by this run.
- Behavior in non-Chromium browsers or real installed-PWA contexts (M13).
- Queue-building UI (play buttons exist in later milestones; the restore path
  is the only in-product entry point until M7).
