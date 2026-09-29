# M10 task 7.2 — browser evidence (radio, queue autofill, local personalization)

`results.json` in this directory is the machine-readable output of `cdp-check.mjs`
and reports **`"pass": true`** for the run recorded on **2026-09-30** (21 steps, all
`ok: true`, `consoleErrors: 0`, 3 screenshots, 7 radio requests logged).

## What this evidence is, and what it is not

A **dependency-free CDP capture** (Node built-ins only — no Playwright, no
Puppeteer) driven against a **production build** (`next build` + `next start`) in
headless Edge, with a **live YouTube Music provider**. It exists for the things unit
tests structurally cannot: that a real click on a real menu item starts a real radio,
that a radio *played down to its low-water mark* actually refills, and that the
refill does not re-serve what it already played.

It is **not** a substitute for the unit/integration suite (1789 tests) or the quality
gates. Where a property is only asserted there, this README says so rather than
implying runtime proof.

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
node openspec/changes/add-radio-and-local-personalization/evidence/cdp-check.mjs

# exit code 0 == every assertion passed; results.json + screenshots are rewritten
```

Env: `SPOTIVIBE_ORIGIN` (default `http://localhost:3210`), `SPOTIVIBE_CDP_PORT`
(default `9445`), `SPOTIVIBE_BROWSER_PATH`. The script uses a throwaway browser
profile, so **every run starts brand new** — which is why the first-run language
onboarding is part of the flow.

All user-facing copy the run asserts on (menu item, queue source label, retry
label, autofill toggle label, onboarding labels) is **extracted from the TypeScript
sources at startup**, so a copy change fails the run instead of being asserted
against a stale literal.

## What the run covers

| Step | What it proves |
|---|---|
| 1–2 | Fresh profile → accountless first-run onboarding → live search → the result menu's **Start track radio** starts a radio, plays it, and the first request carries only `artist`/`kind`/`limit`/`title`/`variant` |
| 3 | The radio is presented as its **own source** ("From radio") with a filled queue (12 rows) |
| 4 | The radio is **played down to its low-water mark with the real transport** and refills with a **rotated variant** (start = 0, first refill = 1), excluding the **8 ids** it had played |
| 5–6 | The queue keeps playing through the refill with no error notice, and after it **no track id is queued twice** (22 rows, 22 distinct ids) |
| 7–8 | Now Playing offers the radio control with an accessible name (**"End radio"** while one plays) and shows the **Radio** indicator |
| 9–10 | A refill **blocked** over CDP `Fetch` leaves the queue playing and offers a **non-blocking** `role="status"` retry — no modal — and the retry resumes the radio's refills (feeds 1 → 2) |
| 11–12 | The artist page's "Start artist radio" enters radio mode for that artist (`kind=artist`, `artist=Queen`) and is labelled as a radio |
| 13–15 | The autofill setting exists and is **on by default**; with it **off**, draining a low ordinary queue spends **no** provider request; with it **on**, the same low queue **is** grown by a request |
| 16 | **No request ever carried profile, liked, or history data** — every observed request's parameters are a subset of `{kind, title, artist, variant, limit, exclude}` |
| 17–18 | Exactly one IFrame API script; **zero console errors** after disclosed windows |

## Disclosures for this live run

1. **Live provider data decided every number.** Query `bohemian rhapsody` returned
   17–18 rows; the radio resolved 12 tracks; the refill excluded 8 played ids. A
   re-run produces different counts.
2. **The page-side request log is re-seeded on every document load.** The harness
   therefore records each `/api/radio` request twice: in `notes.radioRequests`
   (survives navigation, used for the run record) and in `window.__spotivibeRadioLog`
   (per document, used for in-page assertions). Refill assertions are scoped to the
   document they happen on, and the drain loops navigate **once** rather than per
   iteration — otherwise a navigation would erase the evidence mid-run.
3. **Only one refill occurred in the recorded run** (12 initial tracks, low-water 3,
   14 skips). The spec requires a radio to *survive* multiple cycles; that is proven
   by unit tests driving several cycles (`tests/refill-agent.test.tsx`), and this run
   proves one real cycle end-to-end with a real exclusion list.
4. **A deliberate failure window is disclosed, not counted.** The blocked
   `/api/radio` probe produced 1 console network entry; it is bucketed in
   `notes.disclosures.blockedRadioProbe` and excluded from the zero-console-error
   step, which is asserted on the remaining errors (0).
5. **The reduced-motion/marquee guarantee is CSS-only** and is not exercised here; it
   is covered by `tests/nowplaying-presentation.test.tsx` (M9).
6. **The taste profile's influence is ranking, not the request.** The amended
   `personalization` spec says the profile never crosses the network; this run
   verifies the *request* half (step 16). The *ranking* half is proven by
   `tests/score-candidates.test.ts` (determinism, affinity, recency, repeat penalty).
7. **A radio surviving a reload** — discovered by this very run, which first caught
   the radio silently degrading to autofill after a page load — is now fixed and
   covered by `tests/radio-session-persistence.test.ts` and
   `tests/player/persistence.test.ts`. This run navigates between surfaces
   throughout, so it exercises the restored radio on every surface after the first
   navigation.

## Files

- `cdp-check.mjs` — the harness (Node built-ins only)
- `results.json` — steps, disclosures, the full radio request log, screenshots, `pass`
- `radio-queue-1280.png` — the radio's own source label and filled queue
- `now-playing-radio-1280.png` — the radio control ("End radio") and the live indicator
- `radio-refill-failure-1280.png` — refill blocked → non-blocking retry, queue alive
