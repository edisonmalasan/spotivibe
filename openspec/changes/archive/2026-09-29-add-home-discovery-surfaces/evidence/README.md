# M8 browser evidence — Home, discovery, trending, languages, curated surfaces (task 9.2)

**Evidence class: browser/runtime evidence.** This directory captures what
unit tests cannot: first-run language onboarding, the DESIGN.md Home feed fed
by the live provider chain, real language interleaving in the DOM, per-shelf
failure isolation, locally informed sections appearing after a real play, the
Discover surface, and offline behavior — running against a **production build**
in a real Chromium browser (headless Edge), driven end-to-end over the Chrome
DevTools Protocol by a dependency-free script (Node built-ins + the global
`WebSocket` only — no Playwright/Puppeteer packages).

Generated: 2026-09-29 (see `generatedAt` in `results.json`).

## What is proven

| Requirement | Result |
| --- | --- |
| First-run language onboarding offers the broad catalog | dialog `aria-label="Choose your languages"`, **38** options (spec floor 37), confirm control present |
| No account vocabulary anywhere in onboarding | 750 chars of dialog text scanned for sign-in/log-in/sign-up/account/email/password/google — none |
| The choice stays changeable | picker hint "You can change this later in Settings." is rendered |
| Multi-language selection | English + Spanish + German confirmed; all three verified checked before confirm (`allChecked=true`) |
| Selection persists across a full reload | `/settings` → "Showing English, Spanish, German." |
| Fresh profile shows only non-personalized shelves | sections `[trending, popular-artists, genres, podcasts, collections]` — no `recently-played`, no `made-for-you` |
| Trending Now renders real provider artwork | 20 cards, **20** with an `<img>` artwork URL |
| **Multi-language feeds are interleaved, not grouped** | card `data-language` order `[en, es, de, en, es, de, …]` (see disclosure 2) |
| Popular Artists is circular, unclustered, and early | index **1 of 5** rendered sections; 10 artists, 10 with artwork; every link is `/search?q=…` |
| Genres, podcast preview, curated collections | 10 genre tiles linking `/discover?genre=…`; 20 podcast cards; collections shelf present |
| No chart/ranking/editorial claim in shelf copy | 4531 chars of Home copy scanned for chart/most listened/official/editorial/ranking/spotify/youtube — none |
| Shelf activation starts real playback | trusted click on a card → `control=Pause` with the track in the player bar |
| One iframe / one IFrame API script during playback | `iframes=1, apiScripts=1` while playing (asserted at the moment the embed exists) |
| Queue records shelf playback as browse-sourced | `/queue` shows `From browse` |
| A recorded play creates the local-only sections | after a reload: `[recently-played, trending, made-for-you, popular-artists, genres, podcasts, collections]`; Recently Played 1 card, 1 unique id |
| Made For You is seeded from on-device taste | 20 cards; the request was `/api/discover?kind=for-you&languages=en,es,de&seeds=Lumivox&limit=20` — an artist **name**, no liked-track/playlist/history payload |
| **One failing shelf degrades alone** | with the collections request blocked over CDP `Fetch`: collections shows a `Retry` control and 0 cards while trending still shows 20 |
| …and recovers on retry | after lifting the block, the collections shelf repopulates |
| Discover renders per-genre shelves + language summary | 10 genres (4 populated this run), summary "Selected languages: English, Spanish, German", change affordance present |
| `?genre=` deep link honored | `discover-genre-rock` present |
| Offline Discover explains itself and issues **no** request | notice "You're offline. Genre discovery needs a connection, so no shelf is loading right now."; discovery requests issued while offline: **0** |
| Languages stay changeable and feeds follow | after unchecking Spanish: "Showing English, German." and the next trending request carried `languages=[en,de]` |
| IFrame API stays loaded exactly once | `apiScripts=1` at the end of the run |
| Zero console errors | `errors=0`; disclosed: 0 offline-window, 2 blocked-shelf-probe, 0 live-upstream (see disclosure 4) |

All **27 steps passed** (`results.json` → `"pass": true`, script exit code 0).

## Files

- `cdp-check.mjs` — the self-contained driver (launches headless Edge with a
  throwaway profile, runs onboarding → Home → playback → shelf-failure →
  Discover → offline → language-change, writes `results.json` + screenshots).
  All copy and test ids are derived from the app's own sources at startup, and
  every static page expression is parse-checked before the run begins.
- `results.json` — machine-readable report: 27 steps with details, every
  `/api/discover` request the page issued (52 this run, flagged with the
  offline state), the trending shelf's language order, offline-emulation calls,
  the blocked-shelf probe, the console split, and the screenshot list.
- `onboarding-1280.png` — first-run language selection over the Home feed.
- `settings-languages-1280.png` — the persisted selection in Settings.
- `home-trending-1280.png` — Home with Trending Now + Popular Artists.
- `home-artists-1280.png` — the circular Popular Artists shelf.
- `home-local-1280.png` — Recently Played + Made For You after a real play.
- `home-shelf-error-1280.png` — the blocked Collections shelf's retryable error
  while the other shelves stay intact.
- `discover-1280.png` — Discover genre shelves + language summary.
- `discover-offline-1280.png` — the offline connection notice.

## How the run works

1. Fresh profile ⇒ empty IndexedDB; open `/`, assert the hydrated top-bar
   search, the Home feed, and the onboarding dialog; screenshot it.
2. Select English + Spanish + German (clicking only boxes that are not already
   checked — the picker pre-selects the default), confirm, and assert the
   dialog closes.
3. Full reload → `/settings` → assert the persisted selection lists all three.
4. `/` → assert the fresh-profile section set, then Trending Now's cards and
   artwork, the DOM language order of that shelf, the Popular Artists position
   and links, the genre/podcast/collection shelves, and the copy claim scan.
5. Activate the first Trending card → assert playback started, wait for the
   embed, assert one iframe / one API script; `/queue` → assert `From browse`;
   pause best-effort.
6. Reload `/` → assert Recently Played (deduped) and Made For You appear, and
   that the `for-you` request carried only a short artist-name seed.
7. Block only `kind=collection` over CDP `Fetch` (failRequest), reload, assert
   that shelf alone shows a retryable error while trending keeps its 20 cards;
   screenshot; lift the block and click `Retry` → assert recovery.
8. `/discover?genre=rock` → assert per-genre shelves, language summary, change
   affordance, and the deep link.
9. Go offline (mirrored onto attached targets) → click a genre retry → assert
   the offline notice and that **no** discovery request was issued; screenshot;
   reconnect and assert the banner clears.
10. `/settings` → uncheck Spanish → confirm → assert persistence, reload `/`,
    and assert the next trending request carried the reduced language set.
11. Assert the API script is still loaded once; write `results.json`; exit
    non-zero on any failure.

## Disclosures (read together with the results)

1. **Live provider dependency.** Every feed is query-driven against live
   YouTube Music/Invidious/Piped, so content varies per run. During
   development an earlier attempt hit a **transient upstream 503** on
   `kind=trending&languages=en` (the identical seed queries returned 200 moments
   later); the final run is green. The harness has **no** retry logic — a live
   flake fails the run rather than being papered over.
2. **Interleaving is strongest at the head of a shelf.** The observed order was
   `[en, es, de, en, es, de, en, es, de, en, es, en, es, en, es, en, en, en, en, en]`
   — round-robin puts all three languages at the front, after which `en` fills
   the tail because the Spanish and German seeds contributed fewer *unique*
   tracks after the server's dedupe (counts: en 11, es 6, de 3). This is the
   documented deterministic behavior of `interleaveByLanguage` (buckets are
   consumed in order; no language is ever starved while it still has results),
   not a grouping regression. Provider-side overlap between locales is the
   cause, and the unit suite pins the exact ordering contract.
3. **The live track had already stopped by the queue step.**
   `notes.pauseOutcome = "already-stopped"` — playback of a real YouTube track
   ended between the shelf click and the pause on `/queue`, so no Pause control
   existed to click. The run records this instead of failing; the playback
   claims themselves were asserted *before* navigation, while playing.
4. **Console evidence split.** `consoleErrors` is asserted empty at step 27;
   three disclosure buckets exist so offline/probe artifacts can never mask a
   real error: `offlineWindow` (resource-level `net::…` entries from the
   emulated cut — **0** this run, because offline Discover correctly issued no
   request at all), `blockedShelfProbe` (the deliberate
   `net::ERR_FAILED` from the blocked Collections request — **2**), and
   `liveUpstream` (transient 429/503 — **0**).
5. **Deliberate single-shelf failure.** The shelf-isolation step needs one feed
   to fail while its siblings succeed, so the harness installs a CDP `Fetch`
   rule that fails only `/api/discover?…kind=collection…`. Every other request
   is continued normally; the block is lifted before the retry.
6. **Shelf cards expose `data-track-id` / `data-language`.** These are
   committed attributes on `ShelfTrackCard` (documented in the component) so
   tests and this evidence can see which tracks a shelf rendered and whether a
   multi-language shelf actually mixes — the interleaving is otherwise
   invisible in the DOM.
7. **Automated vs browser evidence.** One production-build session in headless
   Edge `Edg/154.0.4258.37` at 1280×900; it complements, and does not replace,
   the automated suite (91 files / 1107 tests at this change). Screenshots are
   supporting visual evidence; every claim above is asserted programmatically
   in `results.json`.

## Reproduce

```powershell
cd frontend
npm ci
npm run build
npm run start -- -p 3210    # separate shell
cd ..
node openspec/changes/add-home-discovery-surfaces/evidence/cdp-check.mjs
```

Environment overrides: `SPOTIVIBE_ORIGIN` (default `http://localhost:3210`),
`SPOTIVIBE_BROWSER_PATH` (Edge/Chrome executable), `SPOTIVIBE_CDP_PORT`
(default `9445`). Requires outbound network access to YouTube. Exit code 0
means every assertion passed.

## What this evidence surfaced

The first five runs failed, and every failure was a **harness** defect, not a
product defect:

- The confirm label was extracted from the picker's *default prop* value
  ("Confirm languages") while the onboarding passes its own label
  ("Save languages"), so the click target never existed. The extraction now
  reads the usage site.
- The picker pre-selects the default language, so blindly clicking "English"
  *deselected* it. Selection is now idempotent (click only unchecked boxes) and
  the step verifies all three boxes before confirming.
- The player embed is created asynchronously after the transport reports the
  track, so counting iframes in the same evaluation that noticed the track
  yielded 0. The invariant is now asserted after an explicit wait for the
  embed, and at the end the run asserts the API script count (the embed is
  released once no track is loaded).
- A blind Pause click threw when the live track had already stopped; the pause
  is now best-effort and its outcome is recorded in `notes.pauseOutcome`.
- An earlier run timed out waiting for onboarding because a burst of parallel
  discovery requests was starving the page — which is exactly the defect the
  independent verification pass found and that was fixed (bounded seed
  concurrency per feed + a client-side cap on shelves in flight).

Final run: 27/27 steps, exit code 0.

## What this does NOT prove

- **Cold-load/offline app shell, offline `<Link>` navigation, or the service
  worker** — M13 owns the offline shell. M7's evidence already documents that
  offline client navigation is impossible without one; this run therefore
  exercises offline *in place* (retry on an already-loaded surface).
- **Worst-case fan-out wall-clock.** This run used 3 languages. The fixed
  bounds (one seed at a time per feed, 3 shelves in flight, 20 s feed budget)
  are asserted by unit tests with deferred promises, not by an 8-language live
  run; a stalled upstream with 8 languages can take minutes for the last genre
  shelf, and serverless function duration is the practical bound to watch.
- **Per-artist Smart Mix identity / refresh** — M11. This run proves the
  section appears once local signal exists.
- **Podcast category accuracy** — the shelf prefers long-form results and falls
  back when too few survive, but category-appropriate filtering is M12.
- **Artist and album pages** — M9. Artist entries refine search here, which is
  the M5 behavior this milestone inherited.
- **The Popular Artists empty state** — unreachable in production because the
  shared filter drops artistless tracks; covered only by injection in tests.
- **Non-Chromium browsers, mobile viewports, installed-PWA contexts**, and
  Tailwind class-level visual audit beyond the 1280×900 screenshots.
