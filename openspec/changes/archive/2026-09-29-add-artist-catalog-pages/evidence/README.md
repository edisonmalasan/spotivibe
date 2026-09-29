# M9 task 8.2 — browser evidence (artist pages, album pages, Now Playing, related content)

`results.json` in this directory is the machine-readable output of `cdp-check.mjs`
and reports **`"pass": true`** for the run recorded on **2026-09-29** (32 steps, all
`ok: true`, `consoleErrors: 0`, 6 screenshots, 10 catalog requests logged).

## What this evidence is, and what it is not

It is a **dependency-free CDP capture** (Node built-ins only — no Playwright, no
Puppeteer) driven against a **production build** (`next build` + `next start`) in
headless Edge, with a **live YouTube Music provider**. It exists to cover the things
unit tests structurally cannot: that a real click on a real card reaches a real
route, that a real provider request returns something a real page can render, and
that the player, the local library, and the network-failure paths behave together.

It is **not** a substitute for the unit/integration suite (1436 tests) or for the
quality gates. Where a behavior is only asserted there, the step text says so
rather than implying runtime proof.

## Reproduce path

```bash
# from the repository root
cd frontend
npm ci
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build

# serve the production build (separate shell, leave it running)
npm run start -- -p 3210

# drive it (repository root)
$env:SPOTIVIBE_ORIGIN = "http://localhost:3210"
node openspec/changes/add-artist-catalog-pages/evidence/cdp-check.mjs

# exit code 0 == every assertion passed; results.json + screenshots are rewritten
```

Environment variables: `SPOTIVIBE_ORIGIN` (default `http://localhost:3210`),
`SPOTIVIBE_CDP_PORT` (default `9445`), `SPOTIVIBE_BROWSER_PATH` (Edge/Chrome
executable override; otherwise the standard install paths are probed). The script
uses a throwaway browser profile, so **every run starts from a brand-new profile** —
which is why the first-run language onboarding (M8) is part of the flow.

The script extracts every piece of user-facing copy it asserts on (radio label,
queue source label, menu item labels, onboarding confirm label, dialog label) from
the TypeScript sources at startup, so a copy change fails the run instead of being
silently asserted against a stale literal.

## What the run covers

| Step group | What it proves |
|---|---|
| 1–3 | Fresh profile → accountless first-run language onboarding → live search → a result is liked (seeding the local signal) → the result menu's "Go to artist" opens a **real** `/artist/...` route, not a search refinement |
| 4–5 | The artist page renders identity + portrait, 16 popular tracks each with a real Play and Like control, 11 releases, and a "Liked tracks by this artist" section — while **no catalog request carries liked/playlist/history data** |
| 6–7 | Activating an artist track starts real playback with exactly one iframe and one IFrame API script, recorded with the `browse` queue source; "Start artist radio" begins playback within the artist feed |
| 8 | An unresolvable artist key yields a **recoverable not-found state** with a way back and a retry |
| 9–10 | A release entry point opens the album page (29 real rows, cover, play, shuffle), every row exposes Like + add-to-playlist, the committed completeness flag **agrees with the rendered notice**, the page **never shows the provider id as the release title**, the artist link targets `/artist/...`, liking persists, and the existing M7 playlist picker is reused |
| 11 | Now Playing offers a More Like This shelf (10 cards) that **excludes the current track** (checked against the `exclude` parameter of the very request that produced it), whose request carries only `title`/`artist`/`exclude`, and never autoplays; the artwork background is a real decorative `<img>`; the long-title treatment keeps the full title available |
| 12 | Every artist/album entry point in search results, the result menu, and the Home artists shelf targets the catalog routes — zero links still pointing at `/search?q=` |
| 13 | **One** blocked entity request (`/api/artist` failed over CDP `Fetch`) degrades to a retryable error on that page alone with the shell alive, and the page recovers on retry |
| 14 | Offline, retrying an entity resolution degrades to a retryable state rather than a crash; reconnecting restores a working page |
| 15–16 | Exactly one IFrame API script at the end of the run; **zero console errors** after disclosed windows are excluded |

## Disclosures for this live run

These are the places where the run is deliberately *not* a clean-room test, or where
live data decided the outcome. None of them is hidden from `results.json`.

1. **Live provider data decided the values.** Seeded query `bohemian rhapsody`
   returned 17–19 rows; the run liked row 0 (`Bohemian Rhapsody — Queen`), and every
   artist/album figure in the steps above comes from whatever the provider returned
   that minute. Re-running can produce different counts.
2. **Related artists were 0 for the resolved artist (Queen) and the shelf said so.**
   Related artists are the *other* artists co-credited on the artist's own tracks
   (no tier exposes a related/similar-artists or channel-browse capability). Measured
   live on 2026-09-29: Daft Punk 5, Kendrick Lamar 1 (SZA), **Queen/Radiohead 0**. The
   page therefore renders the section's explanatory empty state rather than inventing
   artists — asserted by unit tests, and recorded in the artist step's `related=0`.
3. **The album page ran on the *unconfirmed* branch.** The album tile the run clicked
   carried a provider release id (`MPREb_eEpQf8QskKl`), which no tier can resolve to
   that release's own metadata. The committed flag was `data-metadata-incomplete="true"`
   and the notice rendered. This is the honest outcome and it is what the step asserts;
   a *confirmed* album page (`metadataIncomplete: false`, no notice) is covered by unit
   tests and by the direct API probe below, not by this run.
4. **A direct API probe was used to confirm the confirmed branch.** Outside the browser
   run, `GET /api/album?title=OK%20Computer&artist=Radiohead` returned
   `metadataIncomplete: false` with the real release title, and
   `GET /api/artist?name=Daft%20Punk` returned 5 related artists — recorded here so
   the "unconfirmed only" result above is not mistaken for a systematic failure.
5. **Deliberate failure windows are disclosed, not counted as console errors.** The run
   itself causes network errors on purpose: the offline window (1 entry), the blocked
   `/api/artist` probe (1 entry), and the unresolvable-key 404 (2 entries — the initial
   visit and the offline retry). Each is bucketed in
   `results.json → notes.disclosures` and excluded from the zero-console-error step,
   which is asserted on the *remaining* errors.
6. **The first search used a bounded input fallback.** The recorded run typed the query
   and got results directly; `results.json → notes.disclosures.searchFallbacks` records
   any run that needed the native-setter fallback, so a dropped keystroke is never
   silently papered over.
7. **The marquee branch is data-dependent.** "Bohemian Rhapsody" fits the title area, so
   the run recorded `marquee=false` with the full title still exposed via `title`/
   `aria-label`. The overflow/animated branch is unit-tested; this run proves the
   *static* branch keeps the full title readable.
8. **The reduced-motion guarantee is CSS-only, and jsdom cannot prove it.** The browser
   run does not emulate `prefers-reduced-motion`; the guarantee that the marquee cannot
   animate under reduced motion rests on the stylesheet assertions in
   `tests/nowplaying-presentation.test.tsx` plus the global reduced-motion block.
9. **The album tracklist for the probe release is provider-shaped.** 29 rows for an
   unconfirmed release is a search approximation; the page labels it as such. One row was
   titled "FULL ALBUM" — provider data, not a rendering defect.
10. **An unattributed 500 appeared in an earlier run and did not reproduce.** The first
    run recorded a 500 with no URL; the harness now captures `Log.entry.url` on every
    entry so such a failure is diagnosable. It did not recur in the recorded run, and it
    is **not** disclosed as a known issue because it was never attributed.

## Files

- `cdp-check.mjs` — the harness (Node built-ins only)
- `results.json` — steps, disclosures, catalog request log, screenshots, `pass`
- `artist-page-1280.png` — identity, popular tracks, releases, related artists, radio
- `artist-liked-1280.png` — the local "Liked tracks by this artist" section
- `artist-not-found-1280.png` — recoverable not-found for an unresolvable key
- `album-page-1280.png` — cover, unconfirmed notice, 29 ordered rows, play + shuffle
- `now-playing-related-1280.png` — artwork background + More Like This shelf
- `artist-error-1280.png` — retryable error with `/api/artist` blocked, shell alive
