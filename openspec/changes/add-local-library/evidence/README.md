# M7 browser evidence — library, liked songs, and local playlists (task 9.3)

**Evidence class: browser/runtime evidence.** This directory captures what
unit tests cannot: the library surfaces, playlist editing, import flows, and
offline-from-IndexedDB behavior running against a **production build** in a
real Chromium browser (headless Edge), driven end-to-end over the Chrome
DevTools Protocol by a dependency-free script (Node built-ins + the global
`WebSocket` only — no Playwright/Puppeteer packages).

Generated: 2026-09-29 (see `generatedAt` in `results.json`).

## What is proven

| Requirement | Result |
| --- | --- |
| Fresh profile boots to a working app | hydrated top-bar search on Home (step 1) |
| Liked Songs: like/unlike round-trip from search | result menu flips to `Remove from Liked Songs`; surface shows row + `1 song` |
| Grid/list view toggle | `aria-pressed` flips `list → grid`, rows/tiles swap (step 5) |
| Shuffle play-all from the liked collection | real playback starts, `position=0:01` (step 6) |
| Queue labeled by source | `/queue`: `From your library` + shuffle on, **one** iframe / **one** IFrame API script |
| Now Playing heart mirrors the liked state | `Remove from Liked Songs → Save to Liked Songs` on unlike and back |
| Unlike empties the surface and inerts bulk controls | empty copy shown, `playAllDisabled=true, shuffleDisabled=true`; re-like restores the row |
| Create playlist is client-side and instant | grid card + live sidebar entry `Road Trip` with no reload (step 11) |
| Add from search via the picker | picker closes on success; re-adding shows `Already in playlist — …` and keeps the picker open |
| Playlist detail renders members in add order | 3 rows, exact ids `BSTsnWoslP4, MG0lA2oRu7Y, N5Q8EeyOiKY` (step 14) |
| Keyboard reorder | trusted Enter on focused `Move down`: `[A,B,C] → [B,A,C]` |
| Drag reorder | `[B,A,C] → [C,B,A]` — **fallback method used, see disclosure 3** |
| Reload preserves membership and order | full `Page.reload` → identical id sequence (step 17) |
| Rename | heading + sidebar entry both become `Coastal Drive` |
| Delete: cancel is a no-op, confirm removes | cancel keeps heading/sidebar; confirm clears grid + sidebar, liked entry kept |
| Import: invalid input | `That doesn't look like a YouTube playlist link.` (400 probe) |
| Import: unavailable playlist | `That playlist is private or unavailable.` (404 probe) |
| Import: live public playlist | creates the playlist, `Imported 50 songs`, detail renders 50 rows (step 22) |
| Offline banner + `/library` from IndexedDB | exact banner copy, `playlistCards=1, likedCard=true` while offline |
| Offline: detail **and** Liked Songs render from IndexedDB | detail `rows=50` with offline banner, liked row present — both via history popstate (disclosure 4) |
| Offline import fails gracefully | `You're offline — import needs a connection.` after returning to `/library` (`backs=2`) |
| Reconnect clears the banner | `onLine=true, banner=false` |
| Player integrity after all of the above | `iframes=1, apiScripts=1` at the end of the session |
| Zero console errors for the whole session | `errors=0`; disclosed: offline-window 1, import-probe 2, live-upstream 0 (see disclosure 6) |

All **28 steps passed** (`results.json` → `"pass": true`, script exit code 0).

## Files

- `cdp-check.mjs` — the self-contained driver (launches headless Edge with a
  throwaway profile, runs the like → library → playlist-editing → import →
  offline → reconnect scenario, writes `results.json` + screenshots). It
  derives its assertions from the app's own source copy at startup (e.g.
  `IMPORT_ERROR_MESSAGES`, like/unlike labels) and parse-checks every static
  page expression before the run begins.
- `results.json` — machine-readable run report: 28 steps with details, the
  console split with disclosure buckets, drag/offline/retry diagnostics
  (`dragMethod`, `dragCdpError`, `offlineEmulation`), and the screenshot list.
- `liked-list-1280.png` / `liked-grid-1280.png` — Liked Songs in both views.
- `queue-library-1280.png` — `/queue` labeled `From your library`.
- `now-playing-like-1280.png` — Now Playing heart matching the liked state.
- `library-create-1280.png` — new playlist on the grid + in the sidebar.
- `duplicate-feedback-1280.png` — `Already in playlist` notice with picker open.
- `playlist-reload-1280.png` — detail after reload (order preserved).
- `playlist-renamed-1280.png` — renamed to `Coastal Drive`.
- `library-after-delete-1280.png` — grid + sidebar after deletion.
- `import-detail-1280.png` — imported playlist detail (50 rows).
- `offline-detail-1280.png` — offline detail rendering from IndexedDB.
- `offline-import-error-1280.png` — offline import failure message.

## How the run works

1. Fresh browser profile ⇒ empty IndexedDB; open the app, assert the
   hydrated top-bar search.
2. Live search for a query, pick the first ≥2:00 row, like it via its result
   menu, and assert the Liked Songs surface shows the row + count.
3. Toggle grid/list (`aria-pressed`), then trusted-click **Shuffle** →
   `/queue` shows playback labeled `From your library` with shuffle on,
   exactly one iframe and one IFrame API script; Pause.
4. Now Playing: heart matches the liked state → unlike (empty surface with
   inert bulk controls) → re-like from Now Playing → row returns.
5. Create `Road Trip` from `/library` (grid card + sidebar, no reload),
   re-run the search, add three results through the picker (success closes it,
   duplicate reports `Already in playlist` and keeps it open).
6. Playlist detail: verify add order; keyboard reorder (focus `Move down`,
   trusted Enter); drag reorder row 3 → row 1; full `Page.reload` and verify
   order persists; rename to `Coastal Drive`; delete via Cancel then Confirm.
7. Import dialog: invalid URL probe (400), unavailable id probe (404), then a
   live public playlist (200 → creates the playlist, 50 rows, auto-navigates).
8. Pre-populate this document's history (push Liked Songs online, Go back
   twice → `/library`), go offline via `Network.emulateNetworkConditions`
   mirrored to attached targets → banner + `/library` cards from IndexedDB,
   then **history forward** to detail and Liked Songs (both render from
   IndexedDB with the banner up), then Go back to `/library`.
9. Offline import attempt → graceful offline message; reconnect → banner
   clears; assert one iframe / one API script and the console split; write
   `results.json`; exit non-zero on any failure.

## Disclosures (read together with the results)

1. **Live-provider dependency.** Search, playback, and import run against
   live YouTube/YouTube Music. The picked row varies by run (this run: index 0,
   `Bohemian Rhapsody`, 19 rows). Import sources used: invalid
   `https://example.com/not-youtube` (400), unavailable `PLAAAAAAAAAAAAAAAAAAAAAA`
   (404), and live `PLyORnIW1xT6wFaUUjhKa9Q6vcrxQiy9kc` (200, 50 tracks).
   A transient upstream 503 during development (run 2) is the reason bounded
   retries exist (disclosure 7); this run needed none.
2. **Conditional import-report lines did not render.** The live playlist
   resolved with 0 skipped entries and no truncation, so the optional
   `1 unavailable entry skipped` / `First 500 songs imported` lines were absent
   (`skippedLine=null, truncatedLine=null`). Rather than fabricate those
   conditions, the run asserts the core report (`Imported 50 songs` + row
   count); the conditional copy is covered by unit tests.
3. **Drag method.** CDP `Input.dispatchDragEvent` was rejected with
   `Invalid parameters` (`dragCdpError` in `results.json`), so the step fell
   back to in-page synthetic `DragEvent` dispatch across separate evaluates
   (React flushes discrete events between macrotasks). The step detail records
   which method ran (`dragMethod`); it never passes silently on the fallback.
   Trusted-input keyboard reorder (step 15) is asserted independently via CDP
   key events, and pointer-drag parity in a full input pipeline is covered by
   the Playwright-free unit suite (`reorderPlaylistTrack` splice semantics).
4. **Offline navigation uses history, not links.** Without a service worker
   (M13 owns the offline shell), Next.js cannot client-navigate via `<Link>`
   while offline: the RSC fetch fails and Next falls back to a browser
   navigation the offline document does not survive (confirmed with a
   standalone probe during development — scenarios: history back/forward work
   from the router cache; link clicks, even to visited routes, do not). The
   script therefore pre-visits detail and Liked Songs **online**, then moves
   offline exclusively with the TopBar's Go back / Go forward controls
   (popstate). This tests that the surfaces re-render from IndexedDB; it does
   **not** claim offline cold loads or offline link navigation.
5. **Offline import cache.** The API serves successful imports with
   `public, max-age=60`; a development run re-submitted the same live source
   within that window, got a cache hit (the import *succeeded* offline), and
   its auto-navigation then produced Next's
   `Failed to fetch RSC payload … Falling back to browser navigation`
   console.error as the document fell over. The harness now calls
   `Network.clearBrowserCache` before the offline probe so it exercises the
   designed network-failure path; that RSC message is also bucketed as an
   offline-window disclosure (`offlineNow` gate only) so offline navigation
   noise can never mask a real error.
6. **Console evidence split.** Console capture separates `consoleErrors`
   (asserted empty at step 28) from three disclosure buckets:
   `offlineWindow` (resource-level `net::…` entries caused by the emulated
   cut — this run: 1× `ERR_INTERNET_DISCONNECTED` from the offline import
   request), `importErrorProbe` (deliberate 400/404 probes — this run: 2), and
   `liveUpstream` (transient 429/503 — this run: 0; the bucket exists because
   run 2 hit a live 503). The split exists so future runs cannot mask a real
   error behind an artifact.
7. **Bounded retries, zero triggered.** The script can retype the search
   query once after a live-upstream failure, resubmit the unavailable probe
   once if it sees the upstream message, and resubmit the live import once —
   each recorded in `notes` (`searchRetries`, `unavailableRetries`,
   `importRetries`). **This run recorded none**: every retry path was dormant.
8. **Playback evidence is positional.** Play-all/queue assertions read the
   player's position and control state (`position=0:01`, `control=Pause`);
   audio output itself is not asserted. The queue is paused to keep the run
   deterministic.
9. **Automated vs browser evidence.** One production-build session in headless
   Edge `Edg/154.0.4258.37` at 1280×900; it complements, and does not replace,
   the automated suite (74 files / 746 tests at this change). Screenshots are
   supporting visual evidence; every claim above is asserted programmatically
   in `results.json`.

## Reproduce

```powershell
cd frontend
npm ci
npm run build
npm run start -- -p 3210    # separate shell
cd ..
node openspec/changes/add-local-library/evidence/cdp-check.mjs
```

Environment overrides: `SPOTIVIBE_ORIGIN` (default `http://localhost:3210`),
`SPOTIVIBE_BROWSER_PATH` (Edge/Chrome executable), `SPOTIVIBE_CDP_PORT`
(default `9445`). Requires outbound network access to YouTube (live search,
the IFrame API, and the playlist import API). Exit code 0 means every
assertion passed.

## What this evidence surfaced

All failures during development were **harness** defects, not product defects:

- A selector template was missing its closing quote (`…npSave}])` instead of
  `…npSave}'])`), so the Now Playing heart expression was a SyntaxError that
  read as a silent `null` timeout. The script now parse-checks every static
  expression at startup so this class fails fast.
- `waitFor` accepted only expression strings while two call sites passed
  reader functions; it now evaluates either.
- CDP Enter key events need their layout text (`text: "\r"`) for the browser's
  default button activation — a bare `keyDown` focuses but never clicks; the
  script also re-verifies focus immediately before the key press.
- The grid/list toggles are `IconButton`s (label lives in `aria-label`/
  `title`, `textContent` is empty), so toggle clicks must match on the label.
- An offline `<Link>` click destroys the document under Next's RSC-failure
  fallback (disclosure 4) — the offline steps were rebuilt around history
  navigation after a dedicated probe mapped which paths work.
- The offline import "timeout" was the HTTP cache serving a still-fresh 200
  (disclosure 5); the alert wait now also dumps dialog/page state on timeout
  so any recurrence is diagnosable from the error alone.
- Run 2 failed on a transient live search `503` — infrastructure flake, not a
  product defect (search probe returned 200×3 immediately afterwards); the
  bounded search retry exists because of it.

Final run: 28/28 steps, exit code 0.

## What this does NOT prove

- Offline **cold loads**, offline `<Link>` navigation, or the offline shell /
  service worker — M13 owns the PWA scope (disclosure 4).
- Import truncation at 500 tracks and skipped-entry reporting for playlists
  with unavailable entries — conditional copy covered by unit tests
  (disclosure 2).
- Drag reorder through a real OS pointer pipeline (synthetic `DragEvent`
  fallback used — disclosure 3).
- Non-Chromium browsers, mobile viewports, installed-PWA contexts.
- That CI runs green or that a Vercel deployment succeeds — verified
  separately by the PR checks and deployment steps.
