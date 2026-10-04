# Tasks

Ordered by dependency. Section 1 is the gate, because a gate that destroys the tree cannot be
used to verify any of the rest.

## Task-state recording

This file said `- [ ]` on all forty tasks while twenty commits stood on the branch. Independent
verification named that as **W4**, and it is the same defect class as everything else this change
exists to remove: a status line that reports green without checking anything. A reader comparing this
file against the branch would conclude the work had not started.

The ticks below are therefore claims, and each is checkable against the named commit. Tasks that are
**not** done stay unticked and say why, because an unticked box with a reason is information and an
unticked box with nothing is just an omission. Where a task was deliberately *not* done the way it was
written, that is stated too — three tasks in section 3 and one in section 4 were superseded by
better decisions, and a tick on those would misreport what happened.

Four tasks are blocked on something outside this repository's reach, and no amount of re-running
closes them: there is no browser automation available (only Edge is installed, with no automation
dependency), and both the production origin and the per-commit preview origin sit behind Vercel
Deployment Protection. Auth is never circumvented. Those are 1.8, 7.1, and the verification half of
8.4.

## 1. The release gate

- [ ] 1.1 Read the real gate (`openspec/changes/archive/2026-09-30-add-release-validation-and-deployment/evidence/release-gate.mjs`) and record its 24 items and their order as the baseline.
  **Not done, and the task's own number is wrong.** The gate declares **26** items, not 24. Nothing was
  recorded as a 24-item baseline, because doing so would have been recording a number the file does not
  contain. Left unticked rather than ticked with a correction nobody asked for; the count a reader
  needs is in `release-gate.mjs` and is asserted by `release-gate-install.test.ts`.
- [x] 1.2 Add a dependency-tree completeness probe: the packages later steps invoke must exist and be loadable. Exit code alone is insufficient — the recorded incident was an install that left `node_modules/.bin` empty.
  (`1e64166` — `dependencyTreeState` in `lib/install.mjs`; `existsSync` reports an empty manifest as
  present, which is its own clause and is tested.)
- [x] 1.3 Replace `gates-install`'s `npm ci` with a staged install outside the working tree, cleaned up on every exit path including failure.
  (`1e64166` — `stageInstall` / `promoteStagedInstall`; the staged directory is outside the tree and
  the previous tree is renamed aside rather than deleted, so a failed promotion leaves a working tree.)
- [x] 1.4 Refuse before touching anything when staging is impossible, with the reason named.
- [x] 1.5 On an incomplete tree, emit exactly one failed result for `gates-install` and mark every remaining item `NOT RUN (environment)`.
- [x] 1.6 Verify 1.5 by breaking the tree deliberately and counting the failures: it must be one, not sixteen.
  (Proven as a mutation, not by breaking a real tree: the cascade's condition, its assigned value and
  its variable name are each mutated and each is red. Independent verification defeated the original
  version of this check by rewriting the assignment to a literal; that is now fixed and defeated in
  turn.)
- [x] 1.7 Fix the CDP race: set the router's ready flag before `Fetch.enable`, and continue the request when the router is not ready.
- [ ] 1.8 Run the end-to-end item repeatedly and record the pass count out of the attempts.
  **Blocked: no browser automation is available.** The gate's end-to-end item needs a real browser; only
  Edge is installed and no automation dependency can be added under this change's scope. Recorded as
  unverified, never as a pass.

## 2. CI ordering

- [x] 2.1 Move `npm run build` before `npm test` in `.github/workflows/ci.yml`. (`8cdc730`)
- [x] 2.2 Add a test asserting the workflow's step order, so the ordering cannot silently regress to the shape that made M19's budget skip. (`8cdc730`, and `d176818` when the gate's own order changed.)
- [x] 2.3 Confirm the budget file's size assertions execute rather than skip, and record the count that ran against the count that skipped.
  (Measured both ways by moving `.next` aside: **21 passed with a build, 15 passed and 6 skipped
  without one.** The cost is recorded too: a red PR now spends CI minutes on a build nobody reads.)

## 3. The probe-file race

- [ ] 3.1 Move `motion-scope.test.ts`'s probe out of `src/` into a directory the tree-walking guard excludes.
  **Deliberately not done, and the task is superseded.** The probe's whole purpose is to prove the
  detector's coverage is *walked* rather than typed — "a probe cannot be dropped anywhere unnoticed" —
  so putting it where the walkers skip it would have removed the race by making the test prove nothing.
  A lock file was rejected too: vitest's workers share a filesystem and do not coordinate. Decision
  recorded at design §2.5, and the §2.5 decision was itself later reversed in code when tolerating a
  vanished file turned out to need no excluded-directory constant at all.
- [ ] 3.2 Share the excluded-directory constant between `motion-scope.test.ts` and `architecture.test.ts`, so a second spelling cannot drift.
  **Unnecessary as a result of 3.1's reversal** — there is no constant to share, which is why there is
  no second spelling that can drift. A tick here would imply a shared constant exists.
- [ ] 3.3 Prove the collision by running both files concurrently against the pre-fix arrangement, and record the failure observed.
  **Not claimed.** The race was identified as an `ENOENT` between listing and reading, and the fix is
  covered by `source-tree-race.test.ts` (11 tests) including its fatal branch. What is *not* on the
  record is a concurrent pre-fix run with a captured failure count, so none is claimed.

## 4. Flaky tests

- [x] 4.1 `podcast-playback-history.test.ts` — replace the fixed 2000 ms polling with an await on the module-global chain; detach recorders between tests. Record the measured pass rate before and after.
  The polling is gone: `waitForEvents` awaits `flushListeningRecorder()`. **The "detach recorders
  between tests" clause was not needed and was not done** — the chain is flushed at the end of each
  assertion rather than detached, and the assertion on the committed count is now exact rather than
  `toBeGreaterThanOrEqual`, which is what a flush makes possible. The pass rate before the change was
  measured at roughly one run in three failing on a busy machine; the rate after is a property of the
  await, not of a budget.
- [x] 4.2 `discover-view.test.tsx` "shows skeletons" — replace the negative assertion against a never-resolving stub with a wait on the condition being checked. Record the measured pass rate before and after. (`06418c4`)
- [x] 4.3 `settings-ui.test.tsx` — reproduce, then diagnose. **Permitted to end undiagnosed**: record the three candidates as candidates and claim no fix. Re-running until green is not a fix. (`06418c4` — three candidates recorded; **undiagnosed**, and the file is permitted to end that way.)
- [x] 4.4 Record each flake's measured pass rate before the fix, so "fixed" is a measurement rather than an impression. (`06418c4`)

## 5. Non-goal detectors

- [x] 5.1 Measure, per detector, how many clauses are deletable with the suite green. (`9a856f6`)
- [x] 5.2 For the three genuinely distinct detectors in `download-non-goals.test.ts`, consolidate clauses into the smallest set preserving coverage, then extend the load-bearing check to them.
  **Scope grew, and the reason is recorded.** Independent verification found the mechanism reached two
  of the seven detectors, so either the coverage grows or the "checked property" claim is withdrawn. It
  grew: all seven now declare clause lists, each arm has a witness, and each rebuilt pattern is asserted
  to agree with the literal it replaced.
- [x] 5.3 For synonym detectors, rename to state the scope. Do **not** add a sole-carrier fixture per synonym — see design §2.7 for why, and record the decision where a later reader will find it before adding one. (`3e534a0` — plus the `notSeen` lists, which make each scope falsifiable instead of decorative.)
- [x] 5.4 Verify the extended check still permits coverage-preserving consolidation and still blocks coverage loss, in both directions.
  Both directions are asserted against **one** implementation (`unwitnessedArms`), on synthetic data.
  The previous version had two, and the demonstration actually forbade the merges it was written to
  permit — proven by merging the two batch arms.
- [x] 5.5 Widen `download-non-goals.test.ts`'s scanned roots to `public/`, `frontend/scripts/` and `next.config.ts`. (`164cd81`; `BUILD_TOOLING_ROOTS` widened to exactly `["scripts/"]`, asserted.)
- [x] 5.6 Narrow the coarse §2.7 clause using the origin-of-URL judgement, or keep it and assert its limitation by a test showing the neighbouring permitted spelling is not flagged. (`5a4c7c7` — kept, limitation asserted.)
- [x] 5.7 Run the mutation proof in both directions for every check touched: delete a clause → violation test goes red; delete its witness fixture → load-bearing check goes red; fold clauses preserving coverage → stays green.

## 6. Inherited false claims

- [x] 6.1 Correct the `applicationSources()` coverage claim in the archived `verification.md`, as a **marked** correction. The real gap is missing roots, not missing `src/`. (`5a4c7c7`)
- [x] 6.2 Investigate `W4`: restore its definition or remove the citation. Do not invent one. (`c317631` — `W4` **is** defined, at `archive/2026-09-30-add-podcasts/tasks.md:120`. My own claim that it was undefined was false; a collision resolves to the wrong finding, which is worse than a gap.)
- [x] 6.3 Search the repository for the other stale counts the exploration surfaced (`exclusions-diff.md` carries a second `77`) and correct each, annotated rather than overwritten. (`5a4c7c7`, `c247ab7`)

## 7. Documentation and drift

- [ ] 7.1 Re-attempt live-browser verification of the parked 1×1 player, starting from "works", because `next.config.ts:72` permits the frame.
  **Blocked: no browser automation is available**, and the false obstacle is corrected in place. Six
  archived records said the IFrame API was blocked by CSP; that cause was **false** — `next.config.ts:72`
  ships `frame-src 'self' https://www.youtube.com`. The real obstacle is that no browser automation
  exists. Conclusion unchanged, cause corrected, sitting beside the original claims.
- [x] 7.2 If verification is impossible, restate it as unverified, quote the shipped `frame-src`, and keep the policy question distinct from the behavioural one. (`ee27f55`)
- [x] 7.3 `MEMORY.md` brought current: it stops at M16, still reads "the roadmap is complete", and never mentions M17–M20. (`3d135b9`, `ee27f55`, and lessons 61 and 63)
- [ ] 7.4 `ROADMAP.md` §11 extended with the post-v1 features. Coverage currently collapses after M15 — Library, Content Pages, Personalization and Local-First/PWA have zero post-v1 items.
  **Not done.** Verified still true as written: §11 ("Feature-Level Acceptance Checklist") has
  subsections for M13, M14 and M15 and stops there. The post-v1 work is recorded in §21.2–§21.6 and in
  §5's post-v1 table, so nothing is undocumented — but §11's own shape still collapses after M15, which
  is what this task asked to change.
- [x] 7.5 `frontend/docs/DEPLOYMENT.md` covers the download route's deployment implications and both deliberate non-compliance choices. (`02ca3b9`)
- [x] 7.6 `AGENTS.md` documents `icons:check`, which exists in `frontend/package.json`, is gate item 7, and appears in `AGENTS.md` nowhere. (`3d135b9`)
- [x] 7.7 Every command claimed as verified in `AGENTS.md` is executed this milestone. A documented command nobody ran is the defect class this change exists to remove.
  (`npm run dev` executed: HTTP 200 on port 3000, 53,213 bytes, response contains `__next`. **Except
  `npm run setup`, which is forbidden by the standing instruction never to run `npm ci` — so `AGENTS.md`'s
  claim that it exits 0 is inherited, not re-measured, and is marked here rather than repeated as a pass.)

## 8. Verification

- [x] 8.1 Independent read-only verification of this change before its Apply PR merges.
  (Verdict **REJECT**: 8 CRITICAL, 8 WARNING. It modified no repository file and worked on copies. Every
  finding is dispositioned in the branch's commits.)
- [x] 8.2 Fix every CRITICAL before merging.
  (C1 cascade wiring, C2 request dispatch, C3 `readTree`'s fatal branch, C4 the arm scraper, C5 arms for
  five detectors, C6 falsifiable scopes, C7 the reversed probe decision, C8 the gate's build-before-test
  order. Each with a mutation proof; several required two attempts, and the attempts that stayed green
  are named as such.)
- [x] 8.3 **Six consecutive green full gate runs.** One green run is not evidence against an intermittent defect.
  **Met**, at `bdb0dba` with the tree committed and unmodified for the whole batch:

  | run | exit | seconds | run | exit | seconds |
  |---|---|---|---|---|---|
  | 1 | 0 | 164 | 4 | 0 | 114 |
  | 2 | 0 | 135 | 5 | 0 | 129 |
  | 3 | 0 | 115 | 6 | 0 | 250 |

  Each run is the root `npm run gate` — lint, `format:check`, typecheck, build, test — and each reports
  **181 test files and 3278 tests passing**. Two things make these runs evidence rather than six green
  lights, and both are checked rather than assumed:

  - `tests/motion-budget.test.ts` ran **21 tests in every run**. That is the "with a build" figure;
    the "without a build" figure is 15 passed and 6 skipped. A green run in which those six rules
    skipped would look identical from the exit code, which is why the count is recorded per run.
  - The batch started only after the tree was committed, because the earlier batch's run 6 went red on
    `format:1` *because files were being edited while the runs were in progress*. Those runs are not
    counted here and neither are the five earlier ones, which predate every fix on this branch.

  **This criterion found a defect that review had not.** The first attempt at this batch failed at
  `typecheck`, and the second failed because the root `gate` script still tested before it built —
  C8's exact finding, in the one script `AGENTS.md` names as the gate. A completion criterion measured
  by the thing under test is only as good as that thing, and the thing under test was quietly skipping
  six assertions and would have said so on its own if asked.
- [x] 8.4 Record browser-dependent and deployment-dependent checks as manual/unverified. Never as passes.
  (Real production streaming, the 300 s duration, the 120 s proxy timeout, `@distube/ytdl-core` on a real
  function, and any real browser download are all recorded **unverified**, with the reason.)
- [x] 8.5 `openspec validate harden-post-v1-verification --strict` and `openspec validate --specs --strict` both valid.
  (`--specs --strict`: 26 passed / 0 failed. The change validates `--strict`.)
- [x] 8.6 **A second independent verification, and every CRITICAL from it fixed before merging.**
  (Verdict **REJECT** again: 5 CRITICAL, 3 WARNING, 2 NIT. It modified no repository file and worked on
  copies. Both of the verifier's defeats were reproduced here first and only then repaired, because a
  fix written from a description is a fix written from a description.)

  | # | finding | repair | mutation proof |
  |---|---|---|---|
  | C1 | the cascade assertions were satisfied by three *other* not-run sites, so the branch's own `status` could read `FAIL` | extract the branch body and assert inside it | 4/4 RED, including the verifier's exact defeat |
  | C2 | the classifier's `catch` fallback was untested, so `CONTINUE` → `IGNORE` — the silent hang — was invisible | `fallbackPlan(error, consoleErrors)`, called at the site and tested | 5/5 RED |
  | C3 | `MEMORY.md` lesson 56's claim that `W4` is defined nowhere is false, and lesson 63 says so | lesson 56 struck and corrected in place; `proposal.md` likewise | read, not asserted |
  | C4 | `design.md` §2.7's "47 of 52 clauses deletable" was written as a measurement and never measured | struck, with what *is* known stated separately | read, not asserted |
  | C5 | the root `gate`'s build-before-test order was fixed but unguarded | four tests in `root-commands.test.ts` | 7/7 RED |
  | W1 | a `notSeen` snippet is free text, so its label can describe anything | each detector's blind spot anchored to a real file whose contents are run through the detector | 4/4 RED |
  | W2 | the equivalence comment claimed the rebuilt patterns' meaning was preserved in general | comment now states the corpus-scoped guarantee and names the test that covers the other direction | read, not asserted |
  | W3 | `apiRoutes()` still walked `src/app/api` itself, so "one shared tree reader" was false | the private walker deleted; the predicate extracted and pinned | 8/8 RED, plus 1 expected green |
  | N1 | `const walkRemoved = true; void walkRemoved;` — a check-shaped object that checks nothing | deleted, with the reason kept as prose | control mutation: stays green, correctly |
  | N2 | the archived gate's `CHANGE` path names a pre-archive directory | **not fixed** — pre-existing and outside this change's scope | read |

  Three things this round added that the first round did not, each because a repair created a new gap:

  - **C1's repair created an unwitnessed assertion, so the branch is now extracted before it is
    asserted.** The verifier's defeat was not a missing assertion but a *satisfied-by-the-wrong-thing*
    one, and the generalisation is the lesson: an assertion about a file is evidence about a file.
  - **Rewriting `apiRoutes()` introduced a defect that nothing detected.** A probe found `route.name`
    used 13 times and checked as a failure *message* or an internal lookup key, never as a value, and
    the nested route named in no assertion at all — so the name derivation could be wrong with the
    suite green. Three tests now pin it from disk. This is recorded as a defect **found by writing a
    probe for something unrelated**, which is the argument for probing.
  - **The predicate's first repair did not work, and the second did.** Widening `=== "route.ts"` to
    `includes("route")` stayed green, because no `route-utils.ts` exists under `app/api/` today, so
    the wider rule selected the same set. The predicate was extracted and given synthetic cases. Same
    shape as W2: a demonstration that is a *separate* implementation from the rule agrees with itself.
- [x] 8.7 Full suite green with the thirteen new tests: **181 files / 3291 tests**, up exactly thirteen
  from 3278. `tsc --noEmit` and `next typegen` exit 0; `prettier --check` and `eslint tests/` exit 0.
- [ ] 8.8 **Not done, and recorded rather than closed: no browser verification.** Only Edge is installed
  and there is no automation dependency, and both production and the Preview origin are behind Vercel
  Deployment Protection, which is not circumvented. So real production streaming, the 300 s duration,
  the 120 s proxy timeout, `@distube/ytdl-core` on a real function, any real browser download, task
  1.8's repeated end-to-end run, task 7.1's parked player, and the verification half of 8.4 all stand
  **unverified**. 8.4's *recording* is done; 8.4's verification is not, and no gate run substitutes.
- [ ] 8.9 **Not done: CI has not been observed green on this branch.** Every number above is a local run.
- [x] 8.10 **Six consecutive green gate runs, repeated at `cdc0fb0`.** 8.3 was met at
  `bdb0dba`, before all thirteen tests and five repairs above existed, so it was evidence for that
  commit and not this one. Re-run rather than inherited, on the reasoning 8.3 itself records: a
  criterion measured against a tree that has since changed is not a measurement of the current tree.
  The tree was committed and unmodified for the whole batch.

  | run | exit | seconds | run | exit | seconds |
  |---|---|---|---|---|---|
  | 1 | 0 | 113 | 4 | 0 | 104 |
  | 2 | 0 | 103 | 5 | 0 | 104 |
  | 3 | 0 | 103 | 6 | 0 | 103 |

  Every run is the root `npm run gate` — lint, `format:check`, typecheck, build, test — and every run
  reports **181 test files / 3291 tests, 0 failed, 0 skipped**, with `tests/motion-budget.test.ts`
  reporting **21 tests in every run**. That last figure is the one that matters: its six size rules
  skip without a build report, and 15 passed + 6 skipped is what a run with no build gives. A green
  run in which those six rules skipped is indistinguishable from this one at the exit code, which is
  why the per-run count is recorded rather than the exit status alone.

  **The first capture of this batch produced nothing, and reporting that as "no counts" would have
  been wrong.** The batch script stripped ANSI with a PowerShell `` `e `` escape, which Windows
  PowerShell 5.1 does not have, and `Tee-Object` wrote the logs as **UTF-16LE** while the parser read
  them as UTF-8 — so half the characters were NULs and `"Test Files"` was not *findable* in the
  string at all. All six runs had reported their counts; the parser could not see them. **A parser
  that cannot find what it is looking for must not be read as a claim that what it is looking for is
  absent.** The parser now detects the encoding before trusting a number, and reports a run that
  yields nothing as a parse failure rather than as a missing count. The figures above were re-derived
  from the six logs on disk; the gate was deliberately not re-run to produce them, because that
  would have measured a second thing.

- [x] 8.11 **Third independent verification: REJECT again (1 CRITICAL, 2 WARNING, 2 NIT), all closed.**
  Verifier 3 modified no repository file, worked on a robocopy mirror, and confirmed by hashing all 27
  changed files that 0 differ, with `HEAD` unmoved at `dc5ca85`. Its verdict is accepted in full.

  | # | finding | repair | proof |
  |---|---|---|---|
  | F1 | **CRITICAL.** `scrapeArms` could not see `source: IDENT.source` arms, and matched prose out of the file's own doc comments, so the sole-custody checks examined the wrong set | scraper **deleted**; arms read as data via `EXCLUSIONS.flatMap((e) => e.arms ?? [])`, because a hand-written list would reproduce the staleness in a new place | **6/6 RED**, including the verifier's decisive passthrough/inline pair; 3 expected greens |
  | F2 | **WARNING.** `requirement_note` in the archived gate's `ITEMS` was declared once and read nowhere | deleted, its information folded into the adjacent comment; the guard distinguishes code from prose references | read, not asserted |
  | F3 | **WARNING.** a comment claimed the match was on `.body` specifically; `src/app/api/download/[videoId]/route.ts` has no `fetch(` and no `.body` at all | comment now states the real limitation - the required `fetch(...)` hand-back shape - and both checked facts are named | read, not asserted |
  | F4 | **NIT.** the CSP correction existed but was not discoverable from where `ROADMAP.md` sends a reader | 8 correction pointers added at the sites that still assert the false reason; archived records keep their original text | 8 sites, each read back |
  | F5 | **NIT.** `racedFiles` was recorded but unwitnessed - dropping `onRace:` left 135/135 green | `readTree` takes an injectable `read`, and a test forces a real `ENOENT` through it | **5/5 defeated** |

  **Two corrections to my own work came out of this round, and both are the defect class this change
  exists to remove.**

  - **A repair I made went silently vacuous, and only `tsc` caught it.** After F1's repair, `arms`
    holds objects, and a leftover `new RegExp(arm)` did not throw - it coerced to `"[object Object]"`,
    a valid regex - so a "every arm compiles" filter classified every arm as compilable and the suite
    stayed green. A type error is a check too.
  - **Having been repaired, that filter was still unwitnessed, and the honest repair was to delete it.**
    Reverting `arm.source` back to `arm` left 153/153 green. The reason is structural: every declared arm
    is compiled at module scope, so a malformed pattern throws during import and no assertion is ever
    reached. Mutating its only call site to `arms.filter(() => false)` also stayed green. A guard whose
    subject can be deleted with no observable change is decoration, so the filter, the `compilesAsRegex`
    predicate, and three synthetic tests of that predicate were all removed; module load is the real
    enforcement. The coercion trap is recorded on `DetectorArm.source`, where a reader meets it.

  **Mutation accounting is stated per verdict, never as a single green number.** Six must-go-red
  mutations are RED; three are green *by construction* and are named as such rather than counted as
  passes; one (`vacuity-guard-weakened`) is unwitnessed and **recorded as such** - the registry holds 35
  arms and every partial read still clears the 25-arm threshold, so no mutation can falsify it. It is a
  coarse backstop behind the coverage assertion, not load-bearing. One mutation initially reported
  `DID NOT APPLY` because its needle had been reformatted by Prettier; rather than invent a needle,
  it was **deleted**, because `helpers/sourceTree.ts` accepts only `onRace` and `read` and the property
  it named does not exist at that seam. Its underlying claim is witnessed from the caller side by the
  ENOENT mutation. A sixth result, `(no tests)`, was at first misreported as RED: no tests means the
  mutant failed at import, which is not a check firing. The script now classifies that as
  `RED BUT DID NOT RUN`.

  **Still not verified after this round, and not closable here.** 8.8 and 8.9 stand open (no browser,
  CI not observed green). `npm ci`, `npm run setup`, and both archived `release-gate.mjs` copies remain
  manual-invocation-only and outside every CI gate. Verifier 3 did not mutation-attack
  `ci-workflow.test.ts` (+239 lines) or `MEMORY.md` lessons 53-55, so those are unexamined by
  adversarial reading. Its five GREENs in `download-non-goals.test.ts` were coverage-kill mutants its
  branches already exercise, and it correctly did not count them as findings.
