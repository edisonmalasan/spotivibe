# M2 browser evidence — Settings data controls round-trip (task 7.2)

**Evidence class: browser/runtime evidence.** This directory captures what
unit tests cannot: the Settings page running in a real Chromium browser
against a **production build**, driven end-to-end over the Chrome DevTools
Protocol by a dependency-free script (Node built-ins + the global `WebSocket`
only — no Playwright/Puppeteer packages).

Generated: 2026-09-27 (see `generatedAt` in `results.json`).

## What is proven

| Requirement | Result |
| --- | --- |
| `/settings` renders at 390px and 1280px | `settings-390.png`, `settings-1280.png` |
| Import through the real file picker succeeds | `Import complete (merge mode): 2 liked tracks, 1 playlist, 1 listening history entry, 1 search entry, preferences updated, session updated.` |
| Imported data survives a full page reload | export **after** reload deep-equals the imported fixture (six datasets, order-independent) |
| Export matches the import | `roundTrip.deepEqual = true`; envelope `spotivibe-backup` v1, `appVersion 0.1.0` |
| Export filename contract | `spotivibe-backup-2026-09-27.json` |
| Zero console errors for the whole session | `consoleErrors: []` (console.error, runtime exceptions, and `Log` error entries all captured) |

All **11 steps passed** (`results.json` → `"pass": true`, script exit code 0).

## Files

- `cdp-check.mjs` — the self-contained driver (launches headless Edge with a
  throwaway profile, drives the page, writes `results.json` + screenshots).
- `results.json` — machine-readable run report: steps, feedback strings, the
  imported fixture data, round-trip comparison result, console errors, pass flag.
- `settings-390.png` — `/settings` at a 390×844 viewport.
- `settings-1280.png` — `/settings` at a 1280×900 viewport.
- `settings-import-success-1280.png` — supplementary: post-import success
  feedback at 1280×900.

## How the round-trip works

1. Fresh browser profile ⇒ empty IndexedDB database.
2. Navigate to `/settings`, wait for the controls to enable.
3. Capture the two viewport screenshots.
4. Select a deterministic fixture backup (`evidence` script generates it) via
   CDP `DOM.setFileInputFiles` on the real import input — the app validates,
   merges, and reports success (default merge mode, no confirmation needed).
5. `Page.reload` — full reload, controls re-ready (proves persistence).
6. Click **Export backup**; the script captures the exact Blob bytes handed to
   the download boundary plus the anchor filename.
7. Deep-compare (order-independent, key-order-independent) exported `data`
   against the fixture: equality ⇒ data survived reload and export matches.
8. Assert zero console errors; write `results.json`; exit non-zero on any
   failure.

## Reproduce

```bash
cd frontend
npm run build
$env:PORT=3210; npm run start    # separate shell; any free port works
cd ..
node openspec/changes/archive/2026-09-27-add-local-first-data-backup/evidence/cdp-check.mjs
```

Environment overrides: `SPOTIVIBE_ORIGIN` (default `http://localhost:3210`),
`SPOTIVIBE_BROWSER_PATH` (Edge/Chrome executable), `SPOTIVIBE_CDP_PORT`
(default `9444`). Exit code 0 means every assertion passed.

## What this evidence surfaced

The first capture showed the top-bar **settings gear missing at 390px**: the
`w-full` search pill could not shrink below its min-content width, pushing the
gear past the viewport. Fixed by adding `min-w-0` to the search pill in
`TopBar.tsx`; the screenshots above are from the fixed build.

## What this does NOT prove

- Replace-mode confirmation gating, cancel paths, scoped clears, and failure
  feedback — covered by the jsdom integration suite
  (`frontend/tests/settings-ui.test.tsx`), not exercised in this browser run.
- Real-device installs/PWA behavior (M13) and other milestones' features.
- Cross-browser behavior beyond the Chromium build used here.
