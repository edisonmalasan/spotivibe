# M16 evidence — Lyrics and Now Playing enrichment

Change: `m16-synced-lyrics` · Branch: `feat/m16-lyrics-apply` · Runtime: **Node v24.21.0**, npm 11.19.0

Everything below was actually run. Anything that was not run is in "Not verified" rather than
implied by a green check elsewhere.

## Automated checks

| Check | Command | Result |
|---|---|---|
| Install | `npm run setup` (`cd frontend && npm ci`) | exit `0` — 445 packages, 446 audited, 0 vulnerabilities |
| Lint | `npm run lint` (root → `frontend`) | exit `0` |
| Format | `npm run format:check` | exit `0` |
| Types | `npm run typecheck` (`next typegen && tsc --noEmit`) | exit `0` |
| Tests | `npm test` (`vitest run`) | exit `0` |
| Build | `npm run build` | exit `0` |
| Tests, repeated | `npx vitest run` ×4 | **2493 passed, 0 failed** each run |
| Induced violations | `node scripts/lyrics-induced-violations.mjs` (from `frontend/`) | **18/18 caught**, exit `0` |
| Change validation | `openspec validate m16-synced-lyrics --strict` | valid |
| Spec validation | `openspec validate --specs --strict` | 20 passed, 0 failed |
| **Release gate** | M15's archived `evidence/release-gate.mjs` | **exit `1`, and not usable as a comparison — see below.** |

**Full suite: 2494 tests** (2356 before this change, so +138).

### What the counts do and do not prove

They prove the five gates pass on this machine under Node 24, and that the lyrics capability's
behavioural tests pass. They do **not** prove the lyrics panel follows a real YouTube playback
position in a real browser — see "Not verified".

The suite was run four times rather than once because a single green run is not evidence against an
*intermittent* defect, which is the whole lesson of the known `podcast-playback-history` flake. Four
consecutive clean runs is a sample, not a proof, and is labelled as such.

## The two verification passes

Two independent read-only verification agents reviewed this change. The first returned
**`NOT MERGEABLE`** (3 CRITICALs, 6 WARNINGs, 9 NITs); the second, reviewing the fixes, returned
**`NOT MERGEABLE`** again (2 CRITICALs, 6 WARNINGs, 7 NITs). Every CRITICAL in both passes was real.
That the *fixes* were the thing that failed the second time is the most useful fact here, and it is
why this section exists at all.

### What both passes confirmed clean

- **Spec preservation.** Compared programmatically: 12 scenarios in, 13 out, **zero dropped**, every
  preserved WHEN/THEN body byte-identical, one added ("Lyrics never displace or delay the rest of
  the surface"). Nothing was silently weakened.
- **Local-first boundary.** Nothing sends taste, history, likes or playlists. `/api/lyrics` reads only
  `videoId`/`title`/`artist`/`channel`/`duration` and forwards only `track_name`/`artist_name`. No
  store, no schema change, no persisted state, no new dependency. `LrcLibCandidate` is confined to
  the service; the panel sees two strings.
- **Untouched areas.** No changes under `openspec/specs/` or `openspec/changes/archive/`, and no
  M0–M15 milestone record in `ROADMAP.md` altered.
- **The limiter fix is not testing a double.** The test injects the *real* `createSemaphore` and reads
  `activeCount` from inside the transport, so it observes production behaviour; and induced case 15
  proves it fails when production stops acquiring.
- **The harness's honesty**, verified by running it (18/18, exit 0, tree left clean), and the guard's
  anchor, distinct-anchor and non-empty-`to` assertions.

### Pass 1 — CRITICALs

**C1 — four ticked tasks named verifications the suite did not perform.** Task 1.3 claimed a test
asserts no clock is read when it is a behavioural proxy; 2.4 claimed timeout and non-OK tests that did
not exist; 4.4 claimed the transition was asserted when only the scroll was; 5.2 claimed "present and
enabled" when it asserted presence only. A fifth claim — that each tick maps to a test named in this
README — was simply false, because there was no such mapping.

Fixed by **correcting the clauses and adding the two missing tests**: `timeoutMs` is now asserted on
the value handed to the transport, a non-OK response is asserted to be `unreachable` rather than
`unavailable`, the global `prefers-reduced-motion` block in `globals.css` is asserted by name (the
line transition is CSS, so the stylesheet is part of the requirement), and the transport controls are
asserted enabled. The mapping table below is that map.

**C2 — two dead CSS utilities shipped.** `bg-base-surface` and `text-base-content` are neither theme
tokens nor valid utilities, so they emitted no rule: the "Back to live" button had no background and
the active line's colour came from inheritance. Fixed to real tokens — and the repository's own
`token-contrast.test.ts` then **rejected the replacements**, because only `pure-white`, `mist` and
`spotify-green` are declared text tokens and `text-body-xs` is not in the type scale at all. The
clearest argument in the change for not trusting a review: the reviewer suggested colours, and the
detector still rejected them.

**C3 — the provider bypassed the shared outbound limiter while two artifacts claimed otherwise.**
`design.md` and the service header both said this milestone inherits M3's limiter "through
`fetchJson`". `fetchJson` has a timeout and no limiter; `outboundLimiter` was acquired only by
`chain.ts`, so `/api/lyrics` was the one provider call in the application with no outbound ceiling —
and the inbound guard cannot substitute, since `throttle.ts` itself records that a caller rotating
`x-forwarded-for` gets a fresh budget each time. Fixed by acquiring and releasing the same semaphore,
with tests for hold-and-release, release-on-failure, waiting when the cap is exhausted, and both abort
paths.

### Pass 2 — CRITICALs, both about claims rather than behaviour

**C1 — task 5.2 named volume, and volume was not verified in any lyrics state.** `expectSurfaceIntact`
asserted `getAllByRole("slider").length >= 1` with a comment explaining that progress and volume are
both sliders. That is satisfied by `ProgressSlider` alone: deleting `VolumeControls` would have left
all four state tests green. Volume is now located by name (`getByLabelText("Volume")`, matching the
pre-existing Now Playing suite) and asserted enabled, the **artwork** the `app-shell` scenario names
first is asserted, and each control is named rather than counted.

**C2 — the tick-state comment was still false, in an arithmetically impossible form.** It claimed "the
19 load-bearing ones were shown to FAIL" when there are 17 ticked tasks and 18 induced cases — 19
cannot refer to anything — and it claimed a task-to-test mapping the table did not support (the table
maps tasks to test *files*, no case covers task 6.1, and two cases map to no ticked task). The C1
pattern, restated. Replaced with the actual relationship, which is deliberately not one-to-one.

### Warnings fixed in pass 2

- **The harness counted `pending`/`skipped`/`todo` as failed.** vitest's status set is
  `{ pass, fail, only, run, skip, todo, queued }`, so `!== "passed"` meant an **interrupted or
  timed-out** run left tests as `pending` and was reported as a caught violation. Now `=== "failed"`.
- **The guard's behavioural check pinned a different rule than the harness runs** — it omitted the
  file-scoping step and had already drifted on the status comparison. It now mirrors the harness,
  including scoping, and has cases for a failure in a *different* file and for an interrupted run.
- **`text-body` is a dead size utility.** The declared scale is `caption | label | body-lg | link |
  heading`; `text-body` emits no rule. The panel now uses `text-body-lg`. **The repo has 56 uses
  across 22 pre-existing files**, so this is a wider finding that is recorded rather than fixed
  piecemeal; the earlier claim that "every colour and size used was cross-checked" was a *consistency*
  claim presented as a *validity* one.
- **The `transition-colors` class was on only the inactive branch**, so the colour change and the
  transition were applied in the same commit and no transition was generated. Task 4.4's clause claims
  the global reduced-motion rule neutralises a transition that did not exist. The class is now on both
  branches, so the claim is true.
- **The TTL asymmetry test's clock did not move** — it advanced then un-advanced by the same amount, a
  no-op, so the hit was re-read at the instant it was written. Rewritten as two tracks seeded at `t0`
  and one elapsed duration chosen to sit between the two TTLs, with an assertion that the duration is
  in fact shorter than the hit TTL.
- **Two limiter exit paths were unasserted**: an abort *after* the grant and an abort *while queued*.
  Both are now asserted against observable counts, because a leaked slot is a permanent loss for the
  process and the existing mid-flight test runs against the shared 4-slot limiter where a leak is
  invisible.

### A test I wrote, and got wrong

The new duplicate-timestamp test asserted that the **earlier** of two lines sharing a timestamp is
selected. It failed, and it was the test that was wrong: the selector returns the *last* line at or
before the position, so the later one wins — which is also what a listener expects when two lines
share a start time. The test now asserts the real semantics, and `tasks.md` states it.

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

## Task → test file map

This maps tasks to test **files**, and is deliberately not one-to-one in either direction: 17 ticked
tasks, 18 induced cases, no case covering task 6.1, and two cases (the taste-profile parameter, the
retry-label collision) mapping to no ticked task.

| Task | Test file |
|---|---|
| 1.1, 1.2, 1.3 | `tests/lyrics/lyricsTiming.test.ts` |
| 2.1, 2.2, 2.3, 2.4 | `tests/lyrics/lyricsService.test.ts` |
| 3.1 | `tests/lyrics-route.test.ts` |
| 4.1–4.6 | `tests/lyrics/lyricsPanel.test.tsx` |
| 5.1, 5.2 | `tests/nowplaying-lyrics.test.tsx` |
| — (harness guard) | `tests/lyrics-induced-violations.test.ts` |

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
