# M16 evidence — Lyrics and Now Playing enrichment

Change: `m16-synced-lyrics` · Branch: `feat/m16-lyrics-apply` · Runtime: **Node v24.21.0**, npm 11.19.0

Everything below was actually run. Anything that was not run is in "Not verified" rather than
implied by a green check elsewhere.

## Automated checks

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` (root → `frontend`) | exit `0` |
| Format | `npm run format:check` | exit `0` |
| Types | `npm run typecheck` (`next typegen && tsc --noEmit`) | exit `0` |
| Tests | `npm test` (`vitest run`) | exit `0` |
| Build | `npm run build` | exit `0` |
| Tests, repeated | `npx vitest run` ×4 | **2491 passed, 0 failed** each run |
| Induced violations | `node scripts/lyrics-induced-violations.mjs` (from `frontend/`) | **18/18 caught**, exit `0` |
| Change validation | `openspec validate m16-synced-lyrics --strict` | valid |
| Spec validation | `openspec validate --specs --strict` | 20 passed, 0 failed |
| **Release gate** | M15's archived `evidence/release-gate.mjs` | **exit `1`, and not usable as a comparison — see below.** |

**Full suite: 2491 tests** (2356 before this change, so +135).

### What the counts do and do not prove

They prove the five gates pass on this machine under Node 24, and that the lyrics capability's
behavioural tests pass. They do **not** prove the lyrics panel follows a real YouTube playback
position in a real browser — see "Not verified".

The suite was run four times rather than once because a single green run is not evidence against an
*intermittent* defect, which is the whole lesson of the known `podcast-playback-history` flake. Four
consecutive clean runs is a sample, not a proof, and is labelled as such.

## The independent verification pass

An independent read-only verification agent reviewed this change against the artifacts and returned
**`NOT MERGEABLE`**: 3 CRITICALs, 6 WARNINGs, 9 NITs. All three CRITICALs were real and all were
fixed. It also confirmed several things were clean, and those confirmations are as load-bearing as
the findings:

- **Spec preservation: clean.** The `app-shell` MODIFIED block was compared programmatically against
  the existing spec — 12 scenarios in, 13 out, **zero dropped**, and every preserved WHEN/THEN body
  byte-identical. Nothing was silently weakened.
- **Local-first boundary: clean.** Nothing sends taste, history, likes or playlists. `/api/lyrics`
  reads only `videoId`/`title`/`artist`/`channel`/`duration` and forwards only `track_name`/
  `artist_name` to the provider. No store, no schema change, no persisted state, no profile.
- **Untouched areas: clean.** `openspec/specs/` and `openspec/changes/archive/` are untouched, and
  the two `ROADMAP.md` hunks are confined to the post-v1 open-items table and §21.6. No M0–M15
  milestone record was altered.

### C1 — four ticked tasks named verifications the suite did not perform

Fixed by **correcting the clauses and adding the two missing tests**, not by justifying the ticks.

| Task | Claimed | Actually | Fix |
|---|---|---|---|
| 1.3 | a test asserts no clock is read | a behavioural proxy (same answer after 5 ms) | clause reworded to state the check is behavioural and why a source scan is the wrong instrument |
| 2.4 | tests for timeout and non-OK response | a *pre-built* timeout error was classified; no non-OK test | **two tests added** — `timeoutMs` is asserted on the value handed to the transport, and a non-OK response is asserted to be `unreachable` |
| 4.4 | scroll behaviour **and** transition | only the scroll | clause reworded to the actual split, **plus a test** asserting the global `prefers-reduced-motion` block in `globals.css` still collapses transitions — the line transition is CSS, so the stylesheet is part of the requirement |
| 5.2 | controls present **and enabled** | presence only | `toBeEnabled()` added for transport, previous, next and queue |

A fifth claim — that each tick maps to a test "named in evidence/README.md" — was simply false: the
README had no such mapping. The table below is that mapping.

### C2 — the panel shipped two CSS utilities that do not exist

`bg-base-surface` and `text-base-content` are neither theme tokens nor Tailwind defaults, so they
compiled to nothing: the "Back to live" button had no background and the active line's colour class
was dead, with the styling coming from inheritance.

Fixed to real tokens. **The repository's own `token-contrast.test.ts` then caught the first
replacement**: only `pure-white`, `mist` and `spotify-green` are declared *text* tokens, so the
`text-fog`/`text-steel` I had reached for were themselves violations, and `text-body-xs` was not in
the declared type scale at all. The final values are `text-mist`, `text-pure-white`, and
`text-caption`. Every colour and size used was cross-checked against other `src` usage.

This is the clearest argument in the change for not trusting a review: the reviewer suggested
colours, and the repository's detector still rejected the suggestion.

### C3 — the lyrics provider bypassed the shared outbound limiter, and two artifacts claimed otherwise

`design.md` and the service's own header both stated that this milestone "inherits both" M3's shared
limiter and per-attempt timeout "through `fetchJson`". `fetchJson` has a timeout and **no limiter**;
`outboundLimiter` was acquired only by `chain.ts`, so `/api/lyrics` was the one provider call in the
application with no outbound concurrency ceiling. The inbound guard cannot substitute —
`throttle.ts` itself records that a caller rotating `x-forwarded-for` gets a fresh budget each time.

Fixed by acquiring and releasing `outboundLimiter` around the request, exactly as the chain does,
with an injectable semaphore for tests. Three tests cover it: a slot is held *during* the request and
released after, a failure releases it, and an exhausted limiter makes the request **wait** rather
than exceed the cap.

### Warnings fixed

- **W1 — the bounded-height claim was false.** The wrapper had no height, so an eighty-line track
  pushed More Like This off screen. The wrapper is now `max-h-[40vh]`, with a test. The overlay
  assertion was also reading the *inner* element's className while positioning comes from the
  wrapper — so a `fixed` wrapper in `page.tsx` would have passed it. It now checks the wrapper, and
  the induced case breaks the wrapper.
- **W2 — two spec scenarios had no end-to-end coverage.** "Timed beats untimed" and "closest duration
  wins" were asserted only against `scoreCandidate`, leaving the resolution step itself (map, filter,
  sort, take first) unpinned: reversing the comparator would have left everything green. Four tests
  now drive `resolveLyrics` with **two candidates, wrong-answer-first**.
- **W3 — the harness could not tell "the test failed" from "the runner broke".** A non-zero exit was
  recorded as "caught". See the harness section below for what that cost.
- **W5 — the count was a single run.** Now four.
- **W6 — the file list omitted `ROADMAP.md` and `tasks.md`.** Both are now listed.

### Nits fixed

Unused `resolve` import (the repository's only lint warning); a tautological ternary in
`parseLyricsPayload`; a comment claiming an `[offset:]` tag "is reported rather than silently
applied" when the code silently drops it (reworded to state the limit honestly); `.cjs` filenames in
the guard's docstring; and a `ROADMAP.md` cell that read as if the release gate had been repaired.

## The induced-violation harness, and three ways it lied

This repository has paid four separate times for a green check sitting on top of a live defect, so a
test never observed to fail is a claim rather than evidence. The harness breaks one production
behaviour at a time, runs the test named for it, and requires it to fail.

**18/18 caught.** But getting to a trustworthy 18/18 took three attempts, and the failures are the
most useful part of this record — because every one of them failed in the direction that looks like
"your tests are dead", which is the direction that gets a correct suite deleted:

1. **It matched the `dot` reporter's output for a `FAIL <file>` line.** That reporter prints no such
   line, so stdout never matched and the harness reported **0 of 18 caught** on a suite where all 18
   were caught.
2. **It inspected `npx`'s output.** `npx.cmd` on Windows returns **empty stdout and empty stderr**
   to a parent that asked for pipes, so any output inspection saw nothing. Diagnosed by a probe that
   printed the byte lengths, and fixed by invoking `node node_modules/vitest/vitest.mjs` directly.
3. **It read a report path that does not exist.** This vitest version silently ignores
   `--outputFile` for the json reporter, writing to `.vitest/json/output.json` and printing only
   "JSON report written to …". The report left behind then failed `format:check`, so a tool built to
   verify the suite was breaking the gate. Fixed by reading the real path, deleting the report, and
   ignoring `.vitest/`.

A fourth defect was found by the harness itself, once it could finally be believed: it reported an
**escape** for a case whose violation had deleted a trailing comma, turning a source file into a
parse error so the suite ran **zero** tests. The classifier called that "not caught" — accusing a
correct test of being dead. It now treats "the file ran no assertions" as a broken runner, which is
a distinct outcome with its own exit-code contribution.

And a fifth, found by re-auditing: the case for "a superseded response is accepted" **legitimately
escaped**. It removed the request-key comparison, but reset-on-track-change is now enforced by the
`key={providerId}` remount, so removing the key tag leaves defence-in-depth intact and nothing
observable changes. The case was retargeted at the remount, which is the mechanism that does the
work. An induced violation that *cannot* fail is a false claim of coverage, and the harness reporting
it honestly is exactly why the harness is worth having.

The guard (`tests/lyrics-induced-violations.test.ts`) asserts every anchor still resolves — an
unresolved anchor makes a case skip, and a skip counted as neither pass nor failure is how a harness
starts lying. It also includes one **behavioural** check: the classifier's decision rule is executed
over synthetic reports, so the central judgement is falsifiable rather than merely asserted in prose.

## Task → test map

| Task | Test(s) |
|---|---|
| 1.1, 1.2, 1.3 | `tests/lyrics/lyricsTiming.test.ts` |
| 2.1, 2.2 | `lyricsService.test.ts` ("cleanTitle / splitArtistTitle", "scoreCandidate", "candidate resolution") |
| 2.3, 2.4 | `lyricsService.test.ts` ("caching", "the lookup is bounded") |
| 3.1 | `tests/lyrics-route.test.ts` |
| 4.1–4.6 | `tests/lyrics/lyricsPanel.test.tsx` |
| 5.1, 5.2 | `tests/nowplaying-lyrics.test.tsx` |
| harness guard | `tests/lyrics-induced-violations.test.ts` |

## Defects found and fixed during this change

1. **`cleanTitle` did not strip `Song Title - Official Music Video`.** The ported Lyrix pattern strips
   a suffix that is a *single* noise word, so this very common YouTube form survived and matched
   nothing in LRCLIB. Widened to a *run* of noise words. The asymmetry is deliberate: a missed match
   costs the feature for that track, while over-stripping only widens the query.
2. **Literal en/em dashes were silently corrupted** by a PowerShell text round-trip that decoded
   UTF-8 bytes as Latin-1. The corruption failed *open*: the separator no longer matched, the split
   never happened, and the failure read as "did not split" rather than an encoding fault. Both files
   now use `\uXXXX` escapes. **Lesson: never round-trip a file through PowerShell text commands here.**
3. **Follow suspension was not implemented at all** in the first panel — nothing ever set `following`
   false. The first rule attempted (comparing scroll offsets) was also wrong: a smooth programmatic
   scroll fires a `scroll` event per animation frame, so it read the panel's *own* scrolling as manual
   and switched following off moments after enabling it. The rule is now positional.
4. **The controller reset state inside its effect** and carried a generation counter.
   `react-hooks/set-state-in-effect` flagged it and was right. Resolved by *deriving* the reset, which
   removed the bug class rather than silencing the warning.
5. **One test asserted nothing** — a follow test that tolerated either outcome because jsdom gives
   zero rects. jsdom also does not implement `scrollBy`, so giving elements real geometry made the
   panel call a method that threw. Both are now stubbed, and the reduced-motion requirement is
   asserted on the `behavior` actually passed to `scrollBy`.
6. **Two dead CSS utilities shipped** (C2), and the repository's own token detector caught the
   replacements.
7. **A real UI collision, found by an existing test:** the suite failed with two buttons named
   "Try again" on Now Playing, because the radio's failure surface already uses that label. The
   lyrics retry is now "Try lyrics again".

## Not verified, and not claimable here

- **The position plumbing is verified; the following is not observed in a real browser.** The
  YouTube IFrame API is blocked by CSP here, so no browser run can confirm the active line advancing
  against a real playback position. Verified: `positionSeconds` drives the selection, the centring
  delta is exact, and reduced motion changes the scroll `behavior`. Not verified: that a live player
  reports position smoothly enough for the highlight to look right.
- **The LRCLIB integration is exercised only against a stubbed transport.** No test performs a real
  network request, by design. Query shape, scoring, the timeout bound, the limiter, and abort
  propagation are verified; whether LRCLIB returns the right thing for any specific real track is not.
- **No visual review at either viewport.** Layout is asserted structurally (sibling, not overlay,
  height-bounded) and by the existing Now Playing suites, but nobody has looked at it.

## The release gate could not be used as a comparison, and running it did damage

Task 6.2 asked for the gate's counts to be compared against the pre-change baseline. **That
comparison was not obtained.** The gate ran and exited `1`, for reasons unrelated to this change, and
running it twice caused collateral damage that had to be repaired by hand.

**Finding 1 — the gate is already recorded as intermittently red.** `ROADMAP.md` carries a
flaky-release-gate item: M15's end-to-end suite fails intermittently on a CDP race in its own fixture
router, reproduced on a commit before the runtime correction. Its repair is scheduled for **M21**.

**Finding 2 (new) — the gate's own install step destroys `node_modules` when it fails.** Its
`gates-install` item runs `npm ci`, which deletes `node_modules` *before* installing. Run with a
production server up on port 3212, `npm ci` aborted with `EPERM` unlinking
`lightningcss-win32-x64-msvc.node` and left **19 top-level packages, no `node_modules/.bin`, and
`next` without its `package.json`**. Every later gate item then failed in under a second, not because
the code is broken but because the toolchain no longer existed. A second run with nothing holding the
module got past the install and failed on the `end-to-end` and `falsifiability` items — consistent
with the known CDP race.

`node_modules` was restored with `npm ci` (**445 packages, 446 audited, 0 vulnerabilities**, matching
the documented M0 baseline) and all five gates re-verified green afterwards. Nothing in
`frontend/node_modules` is committed.

**Restored, not rewritten:** the gate overwrote three files of *archived* M15 evidence
(`end-to-end-results.json`, `measurement/results.json`, `release-gate.json`). Reverted with a
path-scoped `git checkout`; no archived evidence is modified. Path-scoped deliberately — a bare
`git checkout -- frontend` has twice in this repository's history silently discarded uncommitted work.

**For M21:** the gate cannot be trusted to be non-destructive, and "run the gate" currently carries a
real risk of breaking a developer's tree with no obvious cause. Both that and the CDP race are now
recorded in `ROADMAP.md` as concrete, evidenced M21 items.

## Files

**Added** — `frontend/src/features/lyrics/{lyricsTiming.ts,lyricsApi.ts,useLyricsPanel.ts,LyricsPanel.tsx}`,
`frontend/src/server/lyrics/lyricsService.ts`, `frontend/src/app/api/lyrics/route.ts`,
`frontend/src/hooks/usePrefersReducedMotion.ts`,
`frontend/tests/lyrics/{lyricsTiming,lyricsService,lyricsPanel}.test.*`,
`frontend/tests/lyrics-route.test.ts`, `frontend/tests/nowplaying-lyrics.test.tsx`,
`frontend/tests/lyrics-induced-violations.test.ts`,
`frontend/scripts/lyrics-induced-violations{,.cases}.mjs`.

**Changed** — `frontend/src/app/now-playing/page.tsx` (hosts the panel: one import, one wrapper),
`frontend/.gitignore` and `frontend/.prettierignore` (ignore `.vitest/`, which the harness writes),
`ROADMAP.md` (two additions in the post-v1 open-items table and §21.6, both about the release gate —
no M0–M15 record touched), and this change's `tasks.md`.

**Not changed** — no dependency added, no store added, no IndexedDB schema change, no persisted
state, no backup-format change, no change to the player engine, and nothing under `openspec/specs/`
(which this change's Sync stage will own).
