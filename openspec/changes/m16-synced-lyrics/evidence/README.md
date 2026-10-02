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
| Tests, repeated | `npx vitest run` ×8 after the final fixes | **2496 passed, 0 failed** each run |
| Induced violations | `node scripts/lyrics-induced-violations.mjs` (from `frontend/`) | **22/22 caught**, exit `0` |
| Change validation | `openspec validate m16-synced-lyrics --strict` | valid, exit `0` |
| Spec validation | `openspec validate --specs --strict` | 20 passed, 0 failed, exit `0` |
| **Release gate** | M15's archived `evidence/release-gate.mjs` | **exit `1`, and not usable as a comparison — see below.** |

**Full suite: 2496 tests** (2356 before this change, so +140), across 150 files.

**On the earlier counts, and the flake.** Intermediate drafts of this file recorded 2491, then 2493,
then 2494, then 2495. Only the last of those was ever observed at the time it was written, and each
went stale the moment a test was added; the third verification pass caught one disagreeing with the
line below it. The figure above is the one every run reported. Recording four successive wrong
numbers in a file whose first line is "Everything below was actually run" is itself the argument for
the rule being enforced.

**Two different run sets, and what each covers.** The suite was run **4 times** before the
cross-test-contamination fix, **10 times** after it, and **8 times** again after the fourth pass's
fixes. The ×8 row is the final set: 8 consecutive green runs at 2496. Separately, while measuring,
the **pre-existing** `tests/podcast-playback-history.test.ts` flake — the wall-clock budget already
recorded in `ROADMAP.md` — was observed failing in roughly one full-suite run in three. It is not
caused by this change: that file is untouched by this diff, and the M16 suites were green in every run.
So the honest reading of the ×8 row is "8 clean runs of the M16 code and everything else, in an
environment where one unrelated file is known to flake" — not "the suite is deterministic".

### What the counts do and do not prove

They prove the five gates pass on this machine under Node 24, and that the lyrics capability's
behavioural tests pass. They do **not** prove the lyrics panel follows a real YouTube playback
position in a real browser — see "Not verified".

The suite was run repeatedly rather than once, because a single green run is not evidence against an
*intermittent* defect — which is the whole lesson of the known `podcast-playback-history` flake, and
which is exactly how a cross-test contamination bug in this change's own panel test was found. Run
counts are itemised in the checks table above; any count here is a sample, not a proof.

## The five verification passes

Five independent read-only verification agents reviewed this change in sequence, each reviewing the
previous one's fixes. **The first four returned `NOT MERGEABLE`** — ten CRITICALs between them — and
the fifth returned **`MERGEABLE`** with three WARNINGs, all of which are fixed here.

| Pass | CRITICALs | What they were about |
|---|---|---|
| 1 | 3 | claims the suite did not support; two dead CSS utilities; a bypassed outbound limiter |
| 2 | 2 | volume not verified; an arithmetically impossible tick-state claim |
| 3 | 3 | artwork verified via the *decorative backdrop*; a fabricated test count; a code fix shipped with no test able to catch its removal |
| 4 | 1 | the "different message" claim compared *containers*, never *words* |
| 5 | 0 | `MERGEABLE`, after 48 behavioural mutations of which 45 were caught, the other 3 being the pass's own malformed edits |

That the **fixes** were what passes 2, 3 and 4 failed is the most useful fact here. Ten CRITICALs
were found across four reviews of one change, and every one of them was a statement that outran its
evidence — not a behavioural defect in the lyrics code, which has survived four attempts to break it
and 45 of 48 mutations in the fifth. Four of the CRITICALs were *caused by an earlier pass's own fix*:
the artwork assertion was added next to the volume assertion pass 2 had just fixed and repeated its
mistake one line later; the `transition-colors` change was made to satisfy a task clause with no test
added to keep it true; the `text-body` figure "corrected" in pass 3 was the *previous commit's*
total, so the correction was itself a wrong number; and the guard docstring's stale count was fixed
and re-staled in the same commit.

### The fifth pass's three WARNINGs, fixed here

- **The guard's docstring said "Twenty-one of twenty-one"** while the harness printed `22/22` — pass 4
  had corrected a stale "Eighteen" in that exact sentence and then added a case in the same commit.
  Corrected to 22, and the sentence now says outright that it is a claim about a number to be checked
  against the harness's output rather than trusted, because it has now been stale twice.
- **The `METADATA_TAG` guard in `parseLrc` is not load-bearing**, and the fifth pass measured that
  deleting it leaves all 23 tests green. Task 1.1's clause and the constant's comment now say the
  timestamp pattern carries the guarantee, that broadening either pattern is what is pinned, and that
  the guard is defence-in-depth for a future laxer timestamp pattern. See the note under the task→file
  map.
- **`layoutRestore` was dead** — a leftover from pass 4's refactor, assigned `null` and never read,
  with a comment that still claimed the restore was keyed off it, and the repository's only lint
  warning. The declaration and the two comments are gone; the restore is unconditional from
  `PRISTINE`, which is what it already did.

### What all three passes confirmed clean

- **Spec preservation.** Compared programmatically: 12 scenarios in, 13 out, **zero dropped**, every
  preserved WHEN/THEN body byte-identical, one added ("Lyrics never displace or delay the rest of
  the surface"). Nothing was silently weakened.
- **Local-first boundary.** Nothing sends taste, history, likes or playlists. `/api/lyrics` reads only
  `videoId`/`title`/`artist`/`channel`/`duration` and forwards only `track_name`/`artist_name`. No
  store, no schema change, no persisted state, no new dependency. `LrcLibCandidate` is unexported and
  confined to the service; the panel sees two strings.
- **Untouched areas.** No changes under `openspec/specs/` or `openspec/changes/archive/`; the M0–M15
  status table in `ROADMAP.md` is byte-identical; no `package.json`, no lockfile, nothing under
  `frontend/src/data` or `frontend/src/stores`.
- **The limiter fix is not testing a double.** Verified by mutation: moving `release()` out of the
  `finally` makes the new abort test fail. The test injects the *real* `createSemaphore` and reads
  `activeCount` from inside the transport.
- **Pass-2 fixes verified by mutation**: deleting `VolumeControls` fails 4 tests; deleting the Queue
  button fails 4 tests; removing `transition-colors` now fails the panel suite; removing the artwork
  image testid fails the Now Playing lyrics suite; removing `VolumeControls` is now induced case 21.

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

**C2 — two dead CSS utilities shipped.** `bg-base-surface` and `text-base-content` emitted no rule:
the "Back to live" button had no background and the active line's colour came from inheritance. Fixed
to real tokens — and the repository's own `token-contrast.test.ts` then **rejected the
replacements**, because only `pure-white`, `mist` and `spotify-green` are declared text tokens and
`text-body-xs` is not in the type scale. The clearest argument in the change for not trusting a
review: the reviewer suggested colours, and the detector still rejected them.

**C3 — the provider bypassed the shared outbound limiter while an artifact claimed otherwise.**
The service's own header said this milestone inherits M3's limiter "through `fetchJson`" — and
`fetchJson` has a timeout and **no limiter**; `outboundLimiter` was acquired only by `chain.ts`, so
`/api/lyrics` was the one provider call in the application with no outbound ceiling, and the inbound
guard cannot substitute, since `throttle.ts` itself records that a caller rotating `x-forwarded-for`
gets a fresh budget each time. (`design.md` said only that this milestone "inherits rather than
bypasses" both, which was the right claim about the wrong code; it is now true. A fifth pass caught
that this record had attributed the `fetchJson` wording to `design.md` as well.) Fixed by acquiring
and releasing the same semaphore, with tests for hold-and-release, release-on-failure, waiting when the
cap is exhausted, and both abort paths.

### Pass 2 — CRITICALs, both about claims rather than behaviour

**C1 — task 5.2 named volume, and volume was not verified in any lyrics state.** The fix had asserted
`getAllByRole("slider").length >= 1` with a comment explaining that progress and volume are both
sliders. That is satisfied by `ProgressSlider` alone: deleting `VolumeControls` left all four state
tests green. Volume is now located by name (`getByLabelText("Volume")`, matching the pre-existing
Now Playing suite) and asserted enabled, and every control is named rather than counted.

**C2 — the tick-state comment was still false, in an arithmetically impossible form.** It claimed "the
19 load-bearing ones were shown to FAIL" when there are 17 ticked tasks and 18 induced cases — 19
cannot refer to anything — and it claimed a task-to-test mapping the table did not support. Replaced
with the actual relationship, which is deliberately not one-to-one.

### Pass 3 — CRITICALs, two of them caused by the previous fixes

**C1 — the "artwork" assertion was on the decorative backdrop.** The test asserted
`now-playing-background`, which is the blurred `aria-hidden` wash; the actual cover tile had no
`data-testid`. Deleting the artwork `<img>` left all nine tests green. The tile and the image inside it
now have `now-playing-artwork` and `now-playing-artwork-image`, both asserted per state, with the
image's `src` checked against the playing track. This is the same defect pass 2 fixed for volume,
reproduced one line below the fix.

**C2 — the evidence recorded a test count no run can produce.** One row said 2493 while the line below
said 2494 and the commit said 2494. The file opens with "Everything below was actually run", and 2493
was typed rather than observed. Corrected, along with the note about the three earlier counts.

**C3 — the `transition-colors` fix was pinned by nothing.** Pass 2 had moved the class onto both
branches so a transition would actually exist, which made task 4.4's claim true — and added no test
that it existed. Removing `transition-colors` entirely left **all 2494 tests green**. The panel suite
now asserts both branches carry it and that the two branches differ in colour, and it is induced case
19. The same pass added induced cases 20 and 21 for the artwork testid and the volume control, so the
two failures pass 3 found by experiment are now permanent.

### Pass 4 — the one remaining ticked clause the suite did not satisfy

**Task 4.1 claimed "unavailable and error are different *text*", and nothing ever asserted the
error state's text.** The two states are separate *containers*, so `queryByTestId("lyrics-error")`
being present while `lyrics-unavailable` is absent cannot see the words. Proven by experiment: setting
the error state's title to the unavailable string verbatim — the exact situation the spec forbids —
left **all 2495 tests in all 150 files green**.

The panel suite now asserts the error surface's rendered text (`couldn't be loaded`, `playback is
unaffected`) and its *absence* of the unavailable wording, plus a test that renders each state,
captures its message, and compares the two directly. Induced case 22 rewrites the error title to the
unavailable string, so the harness catches it too.

### Warnings fixed in pass 4

- **The `text-body` figure was wrong twice.** Pass 3 "corrected" 56 to 55 across 23 files; the real
  count is **52 across 22 other files** (the panel's own four mentions are all inside its comment).
  The parenthetical explaining the correction was also false — 55 was the *previous* commit's total
  including the panel, and 56 is the *current* total. Recounted by a script whose procedure is
  recorded, and the figure now appears in the panel comment and here with the same number.
- **`lyricsPanel.test.tsx` leaked global state by two routes**, both found by experiment rather than
  reading. `layout()` captured the prototype methods *inside itself*, so a test calling it twice saved
  the first stub as its "original" and `afterEach` then restored the stub instead of the real method.
  The originals are now captured once at module load. And `window.matchMedia` was redefined wholesale
  and never restored — `vi.restoreAllMocks()` does not undo a `defineProperty` — so every test after
  the first reduced-motion test ran under the previous test's answer. Both are closed.
- **A stale "Eighteen of eighteen"** in the guard's own docstring, four lines from where pass 3 had
  just written "twenty-one". Corrected.

### Nits fixed in pass 4

The evidence's two run-set figures are now itemised so "×8" and "the run counts" no longer read as
contradictory; the two documents' lists of "cases mapping to no ticked task" agreed on the count and
the retry-label case but named a different second entry, and now name the same two; and the one leg of
task 4.6's scenario that rests on a proxy — scroll position, which jsdom cannot model — is now noted
in the task→file map rather than left implicit.

### Warnings fixed in passes 2 and 3

- **The harness counted `pending`/`skipped` as failed.** vitest's status set is
  `{ pass, fail, only, run, skip, todo, queued }`, so `!== "passed"` meant an **interrupted or
  timed-out** run left tests as `pending` and was reported as a caught violation. Now `=== "failed"`.
- **The guard's behavioural check pinned a different rule than the harness runs** — it omitted the
  file-scoping step and had already drifted on the status comparison. It now mirrors the harness
  including scoping, and covers a failure in another file and an interrupted run. It remains a
  hand-copied duplicate, which the file now says plainly: editing the harness does not fail the
  check, and a shared exported predicate is the proper fix.
- **`text-body` is a dead size utility.** The declared scale is `caption | label | body-lg | link |
  heading`. The panel uses `text-body-lg`. There are **52 uses across 22 other files** under `src`
  (counted 2026-10-02; an earlier draft of this file said 56, which counted the panel's own mentions
  and went stale when they were removed), so it is recorded as a repository-wide finding rather than
  fixed piecemeal inside a lyrics feature.
- **The `transition-colors` class was on only the inactive branch**, so the colour change and the
  transition landed in the same commit and no transition was generated. Now on both branches (C3
  above).
- **The TTL asymmetry test's clock did not move** — it advanced then un-advanced by the same amount, a
  no-op. Rewritten as two tracks seeded at `t0` and one elapsed duration asserted to sit strictly
  between the two TTLs.
- **Two limiter exit paths were unasserted**: an abort *after* the grant and an abort *while queued*.
  Both are now asserted against observable counts, because a leaked slot is a permanent loss and the
  existing mid-flight test runs against the shared 4-slot limiter where a leak is invisible.
- **Task 1.3's tick** now states in the clause that its second half is a type-signature argument and
  not verification, and that the behavioural proxy is weak by nature.

### A flake I introduced, and fixed

Running the suite repeatedly — which is the only reason the counts above mean anything — turned up a
failure **in my own new test**, roughly one run in six: `scrolls without smoothing under a
reduced-motion preference` read a `scrollCalls` array shared across the file, and a scroll issued by
an earlier test's component could land in it after that test's teardown. A `smooth` call from a test
with no reduced-motion preference then failed an assertion about a different test.

The irony is not lost: this change spends a great deal of effort on a wall-clock flake elsewhere in
the repository, and the defect here was cross-test contamination through shared mutable state. Fixed
by clearing the recorder when the geometry is installed *and* by having every assertion examine only
the calls recorded after its own action, so each reading describes its own effect. Ten consecutive
full-suite runs were green afterwards. The pre-existing `podcast-playback-history` flake is separate
and is not fixed here — it is scheduled for M21.

### A test I wrote, and got wrong

The duplicate-timestamp test asserted that the **earlier** of two lines sharing a timestamp is
selected. It failed, and it was the test that was wrong: the selector returns the *last* line at or
before the position, so the later one wins — which is also what a listener expects when two lines
share a start time. The test now asserts the real semantics, and `tasks.md` states it.

## The induced-violation harness, and the five ways it lied

This repository has paid four separate times for a green check sitting on top of a live defect, so a
test never observed to fail is a claim rather than evidence. The harness breaks one production
behaviour at a time, runs the test named for it, and requires it to fail.

**22/22 caught.** Getting to a trustworthy number took three attempts, and the failures are the most
useful part of this record — because every one of them failed in the direction that looks like "your
tests are dead", which is the direction that gets a correct suite deleted. Three further cases were
added by the third verification pass after it found, by experiment, that deleting the artwork image or
the volume control left the suite green.

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
tasks, 22 induced cases, no case covering task 6.1, and two cases mapping to no ticked task by
number — the retry-label collision (found by an existing test, and assigned to no task) and the
outbound-limiter bypass (task 2.4's clause names the timeout, not the limiter).

| Task | Test file |
|---|---|
| 1.1, 1.2, 1.3 | `tests/lyrics/lyricsTiming.test.ts` |
| 2.1, 2.2, 2.3, 2.4 | `tests/lyrics/lyricsService.test.ts` |
| 3.1 | `tests/lyrics-route.test.ts` |
| 4.1–4.6 | `tests/lyrics/lyricsPanel.test.tsx` |
| 5.1, 5.2 | `tests/nowplaying-lyrics.test.tsx` |
| — (harness guard) | `tests/lyrics-induced-violations.test.ts` |

**One leg of 4.6 rests on a proxy, deliberately.** The spec scenario "A track change resets the panel
completely" names the *scroll position* among the discarded state. Lyrics, the active line, and a
late stale response are each asserted directly, but scroll position cannot be: jsdom does not model
scrolling, so `scrollBy` is stubbed and the position is not observable. What is verified instead is
the **mechanism** — induced case 8 removes the `key={providerId}` remount, and the stale-response
test fails. A hand-rolled reset that forgot the scroll would not be caught, which is a real limit and
is recorded rather than papered over.

**Two further behaviours rest on proxies, found by the fifth pass.**

- *"The lookup is bounded"* is asserted by checking that `timeoutMs` is handed to the transport and
  that the constant is a real bound. No test observes a timeout actually firing, because doing so
  means waiting on one. The bound is therefore proven at the point it is applied rather than at the
  point it takes effect.
- The `app-shell` scenario's *"related content … operable"* is asserted as the **presence** of the
  More Like This heading. It is not asserted that the shelf is operable, because it is a server-fed
  region whose contents are covered by their own tests. The word "operable" in the scenario is
  therefore narrower than the scenario is worded.

**One branch is defence-in-depth and says so.** The separate `METADATA_TAG` guard in `parseLrc` can
be deleted with every test in the file still green, because no metadata tag matches the timestamp
pattern in the first place — the fifth pass measured exactly that. Task 1.1's clause and the
constant's comment now state that the *timestamp pattern* carries the guarantee, that broadening
either pattern is what is pinned, and that the guard exists only so that a future laxer timestamp
pattern cannot silently start parsing `[ar:…]` as a lyric. Recording that is better than deleting it
or inventing a fixture to make it look load-bearing.

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
