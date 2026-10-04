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
- [x] 8.9 **CI observed green on this branch — closed during Archive, and it was the last of the
  "unverified" items that observation could close.** This entry read *"Not done: CI has not been observed
  green on this branch. Every number above is a local run."* It was true for nineteen rounds and became
  false the moment Apply merged, because merging is what causes CI to run. Observed, not inferred:
  - run `37239459341`, `fix/verification-integrity` at `8b072be` — `quality-gates` **SUCCESS**
  - run `37240070622`, `main` at the merge commit `a2c1665` — **SUCCESS**
  - run `37240237780`, the spec-sync branch at `7a89cd9` — **SUCCESS**
  - run `37240257686`, `main` at `5400d92c` — **SUCCESS**

  **What that establishes, and what it does not.** It establishes that the CI workflow runs the gate in
  the order `tasks.md` requires and is green on this branch's final tree. It does **not** retroactively
  validate any earlier figure: every number above was measured locally, and local runs remain local runs.
  **A CI run on the merge commit is evidence about the merge commit's tree, not about the twenty-two
  commits that preceded it** — the same rule this change applied to its own batches, now applied to CI.
  It also does not cover the browser, which no CI job touches; 8.8 stands, and it is the one item on this
  list that observation alone cannot close.

  **This claim recurs in six later entries of this file — §8.30, §8.32, §8.35, §8.37, §8.39 and §8.41 —
  and each was true when written.** None is edited. A round record stating what observation had not yet
  established is a dated measurement, and rewriting it would falsify the round it belongs to. But a reader
  who greps `CI unobserved` finds six hits and can reasonably conclude the record is current, so the
  supersession is stated here once, at the entry that owns the claim, rather than repeated six times.
  **This is the difference between an entry and a pointer: an entry is scoped to its own round and says so;
  a pointer has no round, so it must be updated or it is wrong.** §8.37, §8.39 and §8.41 are the entries
  a reader most likely lands on, and each already names the criterion batch and its residual, so the
  supersession is reachable from them without editing any of them. **The list was written as §8.28/§8.31
  first and measured as §8.30/§8.32** — two of six section numbers inferred from nearby headings rather
  than counted, which is the same class as the round count `ROADMAP.md` got wrong in this very archive.
  The count of six was right; the identifiers were not. **An enumeration assembled from memory is still
  an enumeration assembled from memory**, however carefully the sentence around it is written.
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

- [x] 8.12 **Six consecutive green gate runs, repeated at `9a5634e` after the pass-3 repairs.**
  8.3 was met at `bdb0dba` and 8.10 at `cdc0fb0`; neither covers F1-F5 or the two defects those
  repairs created. Re-run on 8.3's own reasoning rather than inherited: a criterion measured against a
  tree that has since changed is not a measurement of the current tree. The tree was committed and
  unmodified for the whole batch (`git status --short` empty at `9a5634e` before it started).

  | run | exit | seconds | files | tests | motion-budget | skipped | parse |
  |---|---|---|---|---|---|---|---|
  | 1 | 0 | 108 | 181 | 3292 | 21 | 0 | ok |
  | 2 | 0 | 96 | 181 | 3292 | 21 | 0 | ok |
  | 3 | 0 | 96 | 181 | 3292 | 21 | 0 | ok |
  | 4 | 0 | 96 | 181 | 3292 | 21 | 0 | ok |
  | 5 | 0 | 96 | 181 | 3292 | 21 | 0 | ok |
  | 6 | 0 | 95 | 181 | 3292 | 21 | 0 | ok |

  Every run is the root `npm run gate` - lint, `format:check`, typecheck, build, test. All six report
  **181 test files / 3292 tests, 0 failed, 0 skipped**, and all six are distinct-free: one suite total,
  one file count, one budget count, across the batch. `tests/motion-budget.test.ts` reports **21 tests
  in every run**, which is the figure that makes these runs evidence rather than six green lights: its
  six size rules skip without a build report, and 15 passed + 6 skipped is what a run with no build
  gives - indistinguishable from a full run at the exit code.

  **The capture tooling was repaired before this batch, not after it failed.** 8.10's first capture
  produced no counts because `Tee-Object` wrote UTF-16LE while the parser read UTF-8, and the ANSI
  strip used a PowerShell `` `e `` escape that 5.1 does not have. Both are fixed here: output is
  captured to a variable and written with `[System.IO.File]::WriteAllText` as UTF-8, so the bytes
  parsed are the bytes emitted, and `[char]27` replaces the unavailable escape.

  **The mistake that produced the wrong conclusion is now structurally impossible.** A run whose
  counts cannot be parsed is reported as a **PARSE FAILURE** and ends the streak. It is never reported
  as a run that reported no counts, because those are different claims and only one of them is about
  the gate. Every row above carries `parse: ok`, so each figure was positively found rather than
  inferred from an absence.

  **The figures were then re-read from the six logs by separate code, and that check was wrong first.**
  That code is `evidence/verify-gate-batch.mjs` today; when these figures were taken it was a
  temp-directory script, **not in the repository**, so this entry records a method a reader could not
  have re-run. The figures stand - they were measured - but the corroboration was self-reported.
  Trusting the batch script's own console output would repeat lesson 64 one level up, since the script
  parsed the logs it also wrote. An independent re-read reported that the logs contained **none** of the
  counts. They contained all of them. The checker had not stripped ANSI, so the bytes read
  `Test Files ESC[2m181 passed`, and an escape sequence is not whitespace - `Test Files\s+(\d+) passed`
  does not match it. The counts were present and findable throughout, and the checker reported absence
  without ever asserting that its marker existed. That is the one check lesson 64 asks for, and this
  round's own verification of its own measurement is what skipped it.

  Fixed by locating each marker as a **string** first and only reading a number from a region already
  known to contain it, so "no number" can no longer be reported as "no marker". Re-run, it finds all
  three markers in all six logs and corroborates 181 / 3292 / 21 with zero `skipped`, zero NUL bytes
  and zero replacement characters - so the logs are neither UTF-16 nor lossy, and the batch script's own
  UTF-8 fix is confirmed from outside the script.

  **This is the third time in this change that a tool reported an absence that was not there** (the
  UTF-16LE logs, the `` `e `` escape, and now this), and in all three the system under test was fine.
  The rule that survives is the narrow one: assert that what you are reading is present before you
  conclude that it is missing.

- [x] 8.13 **Fourth independent verification: REJECT again (1 CRITICAL, 1 WARNING, 5 NIT), all closed.**
  Verifier 4 modified no repository file, hash-verified all four files it touched as restored, and left
  `HEAD` at `4781453` with a clean tree. Its verdict is accepted in full, including the two NITs that
  are about *my* claims rather than the code's behaviour.

  | # | finding | repair | proof |
  |---|---|---|---|
  | C1 | **CRITICAL.** `expect(workflow).toContain("node-version: 24")` reads the raw YAML, comments included. Commenting out the pin - **one character** - left 43/43 and then 3292/3292 green. `deployment-contract.test.ts`'s `ciNodeMajor()` had the identical hole via a regex | shared `tests/helpers/yaml.ts`; comments stripped before any content assertion, in **both** files, because fixing one and not the other only moves the weakness | **6/6 RED**, including the verifier's exact edit and their two-line form |
  | W1 | **WARNING.** the sole-custody check compiled every arm flagless while every arm-bearing detector builds with `"i"`, so it reasoned about different matching semantics than the detectors | arms paired with their owning exclusion and compiled with `exclusion.pattern.flags`; the clause under test gains its own detector's flags too | 3 defeats + 2 controls, below |
  | N1 | the coverage assertion compares two functions of the same `EXCLUSIONS`, so it is a tautology, while its comment claimed it caught a missing arm | comment corrected to state what it does catch (a change to the *reading*) and what catches the rest; the `> 25` sibling recorded as unwitnessed | read, not asserted |
  | N2 | `reductionIsReal` compared raw `arm.source` against `RegExp.prototype.source`, which escapes `/`, so any arm with a bare slash was reported as a fake reduction | both sides normalised through `new RegExp(arm.source).source` - the same call that builds the joined pattern | read, not asserted |
  | N3 | `dependedOn` was populated and never read - dead code in the load-bearing check | deleted; `grep` finds zero occurrences | read, not asserted |
  | N4 | `ROADMAP.md:241` pointed at a section heading `"Not verified"`; the heading is `"Not verified, and not claimed"` | heading quoted exactly | read |
  | N5 | the `\s{4}id:` anchor is decorative - loosening it leaves the suite green - while `toHaveLength(26)` is what actually proves the scan was complete | both labelled at the regex: which decides *which keys and what order*, which decides *completeness* | verifier's own measurement, confirmed |

  **C1 is the finding this change is about, committed by this change.** `MEMORY.md` lesson 53, added
  by this diff, says a source assertion that must be kept from matching a comment is one edit away
  from matching it again and prescribes stripping comments first. The same diff added a check a
  comment satisfies. The file even demonstrated it knew better - `readSteps` discarded comment lines
  three assertions before one that read the un-stripped text.

  One assertion is deliberately left on the raw text, and the strip is what revealed why:
  `motion-budget` appears in `ci.yml` **only inside the comment** explaining the build-before-test
  order. There is no executable reference to it. So that assertion checks that the workflow
  *documents* the budget, which is a real thing to check and was the intent - it moves to the raw group
  and says so. Stripping it would have looked like completing the repair and would have deleted a check.

  **W1's numbers need their three-way split, because two of the five results are green and neither
  green is a pass.** The verifier's probe now fails the sole-custody assertion *by name* (3 defeats:
  the probe alone, the probe plus the clause-under-test deflagged, and the verifier's bounded
  same-exclusion case). Two results are green because each applies the probe **and reverts the repair**,
  which is precisely the state the verifier measured as green - so their greenness is what attributes
  causation to the repair rather than to anything else that changed. Had either gone red, that would
  have meant something else now catches the defect and the repair would need revisiting.

  **Three of my own errors this round, each caught by reading a verdict rather than a summary:**

  - My first W1 probe anchored on a `violations` array belonging to a **different exclusion**, so its
    red came from an unrelated assertion. That would have been filed as a witness for a check that was
    not what fired. Re-anchored on the MP3 exclusion's own first violation.
  - Two probe insertions were parse errors - inside an object literal, then inside the array - both
    reported as "no tests". `RED BUT DID NOT RUN`, twice, from multi-line literals I had believed
    matched. Inserted after a scanned entry close instead.
  - Reverting the W1 repair **alone** is green, because with no case-sensitive competitor in the tree
    flags change nothing observable. Composed with the probe instead. Run alone it would have read as
    "the repair is unwitnessed", which would have been the wrong conclusion.

  Re-run after these repairs, because three test files changed under them: `mut-f1` 6/6 (its
  `identity-filter-removed` needle was re-pointed after W1 changed the filter's shape - reported as
  `DID NOT APPLY` first, not quietly dropped), `mut-f5` 5/5, `mut-c1-comments` 6/6 + 1 expected green,
  `mut-gate-order` 7/7, `mut-apiroutes` 8/8 + 1 expected green, `mut-notseen-anchor` 4/4. Suite **181
  files / 3292 tests**; `tsc`, `next typegen`, `prettier --check`, `eslint` exit 0; both validators valid.

  **Still unverified, unchanged from 8.11.** No browser verification (8.8); CI not observed green (8.9);
  `npm ci` / `npm run setup` / both archived gates never run and outside every gate. Verifier 4 also
  did not mutation-attack `release-gate-install.test.ts` (+1068), `download-non-goals.test.ts`,
  `motion-budget.test.ts`'s size rules, or `MEMORY.md` lessons 53/54. It did re-derive lesson 55's
  figures (233 files in `src`) and lesson 56's correction, and found both accurate.

- [x] 8.14 **Six consecutive green gate runs, fourth measurement, at `68860cb` after the pass-4 repairs.**
  8.3 was met at `bdb0dba`, 8.10 at `cdc0fb0`, 8.12 at `9a5634e`. None covers C1's comment strip, W1's
  flags repair, the five NIT corrections, or the new `tests/helpers/yaml.ts`. Re-run on the same
  reasoning rather than inherited. The tree was committed and unmodified for the whole batch
  (`git status --short` empty at `68860cb` before it started).

  | run | exit | seconds | files | tests | motion-budget | skipped | parse |
  |---|---|---|---|---|---|---|---|
  | 1 | 0 | 102 | 181 | 3292 | 21 | 0 | ok |
  | 2 | 0 | 98 | 181 | 3292 | 21 | 0 | ok |
  | 3 | 0 | 97 | 181 | 3292 | 21 | 0 | ok |
  | 4 | 0 | 95 | 181 | 3292 | 21 | 0 | ok |
  | 5 | 0 | 95 | 181 | 3292 | 21 | 0 | ok |
  | 6 | 0 | 97 | 181 | 3292 | 21 | 0 | ok |

  Every run is the root `npm run gate`. All six report **181 test files / 3292 tests, 0 failed, 0
  skipped**, and `tests/motion-budget.test.ts` reports **21 in every run** - the figure that separates
  this from a run where its six size rules skipped, which is indistinguishable at the exit code. One
  suite total, one file count, one budget count across the batch.

  **Corroborated by re-reading the six logs with separate code, and that checker now asserts its
  markers exist before reading any number.** 8.12's first version of this check reported that the logs
  contained none of the counts; they contained all of them, and it had not stripped ANSI. The rewrite
  locates `Test Files`, `Tests` and the `motion-budget` line as *strings* first and reports `MARKER
  ABSENT` separately from a missing number, so "no number" can no longer be reported as "no marker".
  This run: all three markers found in all six logs, 181 / 3292 / 21 agreed, zero skipped, zero NUL
  bytes and zero U+FFFD in every log - so no log is UTF-16 or lossy, confirmed from outside the batch
  script that wrote them.

  The batch script itself needed no repair this time: it carried forward 8.12's UTF-8 write, the
  `[char]27` ANSI strip, and the `PARSE FAILURE` verdict, and every row reports `parse: ok`.

- [x] 8.15 **Verification round 5: one CRITICAL, five WARNINGs, three NITs. All closed, each
  mutation-proven.** Round 5 attacked round 4's repairs rather than the original defects, and its
  CRITICAL is round 4's CRITICAL reproduced against the fix for it.

  **C1 — the comment strip was defeatable by an apostrophe, and every test stayed green.**
  `stripTrailingComment` tracked quote state and toggled `inSingle` on every `'`. A YAML **plain
  scalar may contain an apostrophe**, so this one line of `.github/workflows/ci.yml`:

  ```
  -          node-version: 24
  +          x: it's # node-version: 24
  ```

  opened a quote that never closed, so every later `#` on that line read as quoted content, the decoy
  survived the strip, and `toContain("node-version: 24")` matched it. `/node-version:\s*["']?(\d+)/`
  in `deployment-contract.test.ts` extracted `24` from the decoy. **181 files / 3292 tests, all green,
  with the Node pin genuinely absent from CI.** The verifier confirmed the pin was really gone using a
  real YAML parser — not by asking whether my strip accepted it, which is the question that had already
  been answered wrongly three times.

  **The aggravating fact, and it is the finding: lesson 53 prescribed this repair.** The lesson added
  by this same diff says a source assertion that matches a comment should be fixed *by stripping
  comments before asserting*. That was applied. Three assertions after code that discarded comment
  lines, the same diff added a check a comment satisfies. The lesson was written down and then not
  followed, twice.

  **Fix: stop stripping trailing comments, refuse block scalars, and assert on values.**
  - `helpers/yaml.ts` rewritten. `stripWholeLineComments` removes only **whole-line** comments — the
    one form YAML leaves unambiguous, since a plain scalar cannot begin with `#`. `assertNoBlockScalars`
    **throws** on `run: |` / `run: >` rather than mishandling the body, because inside a literal body a
    `#` is content and deleting that line would delete a command. Loud failure naming the line, not a
    quietly shortened workflow.
  - Assertions compare **values**: `workflowScalar(code, "node-version")` `toBe("24")`, not
    `toContain("node-version: 24")`. A decoy anywhere — in a comment, after the value, under another
    key — becomes part of the value and fails an exact comparison. `ciNodeMajor()` likewise reads the
    scalar and requires `/^\d+$/`, returning `null` for anything else, which every caller already treats
    as failure.
  - The two mechanisms are complementary and each was muted alone to prove the other holds it up.
    `stripWholeLineComments` disabled → still red. `assertNoBlockScalars` neutered → still red.

  **Proof: `mut-c1-round5`, 9 of 9 defeated, plus 1 expected green.** Includes the verifier's exact
  one-line defeat, `node-version: x # node-version: 24`, `node-version: 24 # pinned by Vercel`, the
  round-4 whole-line-comment form, `node-version: 22`, the apostrophe decoy on `working-directory` and
  on `cache-dependency-path`, and both single-mechanism mutings. **Positive control:** removing the
  documentation comment the two raw-text assertions check stays GREEN — the one thing the strip must
  not touch.

  `node-version: 24 # pinned` failing is **red by design**. It fails closed on a legitimate trailing
  comment; `ci.yml` has none, and when one is added the test going red so a human decides is the right
  way round. Recorded as a designed failure, not a defect.

  **W1** `readSteps`'s comment claimed its input was stripped while it was still called with the raw
  workflow, and it carried its own inline comment skip. Now consumes `workflowCode` and the inline skip
  is deleted: one code path, named at the call site. **W2** `run: |` was recorded as the literal
  one-character command; `runMatch` now yields `null` for a block indicator and `prepareWorkflow`
  refuses one upstream. **W3** resolved by the throw rather than by handling block bodies. **W4**
  `finds nothing in the application` had no witness for its own input — emptying `SOURCES` kept all
  seven blocks green; now anchored on `src/app/page.tsx` existing, reading as text, and not a
  placeholder. A `toBeGreaterThan(N)` floor was rejected for the reason round 3 rejected the 25-arm
  one: every partial walk clears any safe N, so nothing can falsify it. **W5**
  `motion-budget.test.ts`'s header still described the pre-M21 CI order as current, sending a reader
  to look for a pipeline defect that no longer exists; corrected, with the real local caveat kept because
  the two causes have opposite remedies.

  **NITs.** The sole-custody filter compared `arm.source`, so an arm in another exclusion with the same
  pattern dropped out of the competition and two clauses could catch a violation with the claim still
  green; it now compares the clause's **name**. Object identity is unavailable and the reason is
  recorded rather than worked around: the registry entry is a fresh literal copying `.source`, so
  `arm === STREAMED_BODY_AS_RESPONSE_ARM` is false for the very arm under test and an identity filter
  would exclude **nothing** — a red that means the opposite of what it looks like. The
  every-fixture comment claimed credit for catching a lost witness; it witnesses *detection of present
  fixtures*, not *presence*, and now says so. The fixture-presence gap is recorded rather than closed
  with an unwitnessed threshold. **`MEMORY.md` lesson 53 amended:** stripping comments is necessary and
  **not sufficient**; the robust form is a value-level assertion.

  **Two new witnesses, synthetic, on input `ci.yml` does not contain.** `assertNoBlockScalars` cannot
  fire on the current workflow, so three tests exercise the helper directly — the block-scalar refusal
  including a `#` inside a literal body, whole-line-only removal, and the decoy-is-part-of-the-value
  property the repair depends on. Same lesson-65 pattern as `isRouteModule`.

  **Two mutation-verdict errors made and caught in this round, both recorded rather than smoothed.**
  **(a)** `probe-plus-flags-stripped` and `probe-plus-flags-forced-empty` were labelled must-go-red and
  came back green. They are **controls that attribute causation**: the same probe with the flags left
  correct is RED, so the flags are exactly what makes an arm catch the violation, and these two re-create
  the pre-fix state — which was green by construction, because that *was* the defect. The runner also
  never supported `expectGreen`, so every green was counted as unexpected; it now separates defeats from
  designed greens and reports `3/3 that must go red did; 2 green as designed` instead of `3/5`. This is
  the branch's recurring theme again: a verdict read before establishing what it is a verdict *about*, in
  the opposite direction to the earlier `(no tests)`-as-RED and mis-anchored-probe errors.
  **(b)** Two `mut-f1` witnesses reported `DID NOT APPLY` because the identity repair renamed the text
  they target. Re-aimed at the new text, never at anything weaker, and the note records that this block's
  needles have now needed re-pointing twice.

  **All suites re-run, since five files changed under them.** `mut-f1` 6/6 + 3 designed greens,
  `mut-w1-flags` 3/3 + 2 designed greens, `mut-c1-round5` 9/9 + 1 designed green, `mut-f5` 5/5,
  `mut-c1-comments` 6/6 + 1 designed green, `mut-gate-order` 7/7, `mut-apiroutes` 8/8 + 1 designed green,
  `mut-notseen-anchor` 4/4. Full suite **181 files / 3297 tests, 0 skipped** (+5 from the new witnesses).
  `tsc --noEmit`, `prettier --check`, `eslint` exit 0; `openspec validate --strict` and
  `--specs --strict` both valid (26 items, 0 failed).

  **Two self-inflicted tooling faults, caught before producing a verdict.** A mutation note written as a
  multi-line single-quoted literal was a syntax error and each mutation object lost its closing brace;
  `node --check` caught it, so no verdict came from the broken state — worth the two lines, because a
  runner that cannot parse its input reports nothing and *nothing* is indistinguishable from *nothing
  found*.

  **Still unverified, unchanged from 8.11.** No browser verification (8.8); CI not observed green (8.9);
  `npm ci` / `npm run setup` / both archived `release-gate.mjs` copies never run and sit outside every
  gate. `release-gate-install.test.ts` (+1068 lines) has still not been mutation-attacked by any round —
  five rounds in, and it remains the largest unattacked surface in the diff. The fixture-presence gap
  noted above is open by decision, not by oversight.

- [x] 8.16 **Six consecutive green gate runs, fifth measurement, at `f4b5cb1` after round 5's repairs.**
  8.3 was met at `bdb0dba`, 8.10 at `cdc0fb0`, 8.12 at `9a5634e`, and 8.14's six runs at `68860cb`.
  None of them executes round 5's `stripWholeLineComments`, `assertNoBlockScalars`, `workflowScalar`,
  the three synthetic witnesses, the two non-goal scan witnesses, or the corrected `motion-budget`
  header, so none of them measured this commit. The tree was committed and unmodified for the whole
  batch — `git status --short` empty at `f4b5cb1` before it started, and **nothing may edit a repository
  file while a batch runs**: 8.3's batch failed run 6 on `format:1` for exactly that reason.

  | run | exit | seconds | files | tests | motion-budget | skipped | parse |
  |---|---|---|---|---|---|---|---|
  | 1 | 0 | 121 | 181 | 3297 | 21 | 0 | ok |
  | 2 | 0 | 98 | 181 | 3297 | 21 | 0 | ok |
  | 3 | 0 | 95 | 181 | 3297 | 21 | 0 | ok |
  | 4 | 0 | 96 | 181 | 3297 | 21 | 0 | ok |
  | 5 | 0 | 98 | 181 | 3297 | 21 | 0 | ok |
  | 6 | 0 | 99 | 181 | 3297 | 21 | 0 | ok |

  Every run is the root `npm run gate`. All six report **181 test files / 3297 tests, 0 failed, 0
  skipped**, and `tests/motion-budget.test.ts` reports **21 in every run** — the figure that separates
  this from a run where its six size rules skipped, which is indistinguishable at the exit code. One
  suite total, one file count, one budget count across the batch. 3297 rather than 3292 because round 5
  added five tests; the corroboration checker's expected figure was updated with them, because a checker
  asserting a stale expectation would fail for a reason that has nothing to do with the logs.

  **Corroborated from the six logs by separate code - `evidence/verify-gate-batch.mjs`, which at the
  time of writing was a temp-directory file **not in the repository** - which asserts its markers exist
  before reading any
  number.** All three markers found in all six logs; 181 / 3297 / 21 agreed; **zero NUL bytes and zero
  U+FFFD in every log** — so no log is UTF-16 or lossy, confirmed from outside the script that wrote
  them. That checker's v1 reported the logs contained none of the counts when they contained all of them
  (it neither stripped ANSI nor asserted the marker first); v2 is carried forward **unchanged in method**
  for that reason, because rewriting a checker that has already been wrong once, in the same round that
  repairs other checks, is how it becomes wrong again unnoticed.

  **One retargeting checker was itself wrong and is recorded as such.** The script that produced this
  table initially asserted the file no longer mentions `68860cb`, which is wrong — the new header must
  mention it, because the claim being made is "the previous six runs were at `68860cb` and did not
  measure this commit". It fired on correct output and reported a failure it could not distinguish from
  a real one: the same shape as the 8.12 checker that reported missing counts where the counts were
  present. Narrowed to check the old *header* is gone, the new one present, the prior batch named as
  prior, and the log directory moved. This is the sixth time this branch has produced a checker that
  reports something it did not establish, and the second time the fix was to narrow the check rather
  than widen it.

  **Batch script body carried forward unchanged**, on the same reasoning. Its two previously-fixed
  defects remain in place: `[char]27` rather than PowerShell 6's `` `e `` for ANSI stripping (Windows
  PowerShell 5.1 has no `` `e ``, which had left escapes in the text), and
  `[System.IO.File]::WriteAllText` with UTF-8 rather than `Tee-Object` (which writes UTF-16LE on 5.1, so
  the parse read NULs and "Test Files" was not *findable* — and a string that cannot be searched looks
  exactly like a string with no results in it). A run whose counts cannot be parsed is still reported as
  `PARSE FAILURE`, never as a run that reported no counts.

- [x] 8.17 **Verification round 6: one CRITICAL, two WARNINGs, all closed, each mutation-proven. Round 6
  attacked round 5's repairs, and its CRITICAL is round 5's CRITICAL reproduced against the fix for it —
  the third time this change has done that.**

  **C1 — round 5's claim was false, and the false part was the load-bearing part.** Round 5 wrote:
  *"a decoy anywhere — in a comment, after the value, in a second key — is part of what you compared,
  and fails."* True for a decoy on the same line or after it. **False for a decoy on an earlier line
  elsewhere**, because reading a value means first deciding *which* `node-version` was meant, and
  `scalarValue` resolved that by returning the **first** match in the document. So:

  ```yaml
      env:
        NODE_VERSION: "24"
        node-version: 24        # decoy, in a mapping that does not own the pin
    steps:
      - uses: actions/setup-node@v7
        with:
          node-version: 22        # the real pin, now wrong
  ```

  **181 files / 3297 tests, all green, with the runner on Node 22.** The verifier confirmed the pin was
  really gone using a real YAML parser — not by the absence of an error, which is the only way to confirm
  an absence. Both C1 sites were defeated: `ci-workflow.test.ts` and `deployment-contract.test.ts`, the
  latter being the check that *proves itself by rejecting a pin Vercel cannot build*.

  **Fix — the rule that survives: A BARE KEY IS AMBIGUOUS, AND POSITION IS EXACTLY WHAT A DECOY
  MANIPULATES.** "Which `node-version` did you mean?" is a question, and answering it by order of
  appearance is answering it on the decoy's behalf. Two mechanisms:
  - **Scope.** `stepWith(workflowCode, "Setup Node.js")` returns that step's `with:` inputs and nothing
    else; `jobRunDefaults` returns `defaults.run`. A decoy outside the scope is not *unlikely* to lose —
    it is not found. Both consumers read the same scopes, so they agree by construction rather than by
    coincidence, and fixing the shared helper alone would have left the second site reading the whole
    document through it (round 4's lesson restated).
  - **Refusal.** `scalarValue` **throws** when the key appears more than once in its scope, naming the
    lines. Refusing is the whole trick: it is the one answer that cannot be wrong in the decoy's favour.

  Each was muted **alone**, composed with the verifier's decoy, to prove the other holds it up. That
  composition is the point: round 5 shipped two mechanisms and round 6 proved one had been carrying
  both.

  **A fourth defect found by my own mutation suite, which the verifier's report had closed.** Inserting a
  second `run:` under `defaults:`, decoy inside it, left the suite green — `blockAfter` refused duplicate
  *scalars* while still resolving duplicate *mappings* first-wins. **Refusing a duplicate scalar while
  resolving a duplicate mapping by position is the same defect with one of its two faces removed.** Fixed;
  `blockAfter` now refuses a repeated container key too. Nothing in the file could have revealed this;
  only a mutation aimed at the repair could.

  **W1 — three of five gate orderings were vacuous.** `indexOfStep` returned `-1` for an absent needle,
  and `-1 < 6` is true. `npm run lint`, `npm run format:check` and `npm run typecheck` could each be
  replaced with `echo <gate> is disabled` — or with `npx eslint .` — and every ordering assertion stayed
  green. The `is proven able to fail` witness that should have caught it covered only `npm run build` and
  `npm test`, the two gates M21 actually moved. **A witness that covers two of the five things it is a
  witness for is not a witness for the other three.** Now: `indexOfStep` **throws** on absence, so every
  ordering assertion is also a presence assertion; the gates are declared once as `GATES` so the
  assertions and their witness cannot disagree; and the witness covers all six, asserting presence,
  distinctness (one step per gate, or an ordering comparison becomes a number against itself), and a
  floor on run-bearing steps. Muted alone and composed with the echo defeat, the throw is not the only
  thing working.

  **W2 — a name is a label, and a label is only an identity if it is unique.** Round 5 had just moved the
  sole-custody filter from `arm.source` to `arm.name`, reasoning that a name is what a named clause is
  identified by. Nothing enforced uniqueness, so `arm.name !== NAME` excluded **every** arm carrying that
  name: a second arm with the same name and a different source was excluded too, and two clauses could
  catch the violation with the sole-custody claim green. Two mechanisms again:
  - the filter excludes the clause under test by name **and** source together, so a same-name competitor
    written differently stays in the competition (the verifier's exact defeat);
  - **arm names are asserted unique across the registry**, which is what makes the conjunction sound —
    without it, two clauses identical in both would both catch and both be excluded.

  Each muted alone and composed with the competitor. Round 5's reasoning here was *right about what it
  rejected and wrong about what it replaced*, which is a harder failure to see than being simply wrong.

  **Proof: `mut-round6`, 15 of 15 that must go red did, plus 1 green by design.** Includes the verifier's
  exact defeat for all three findings, the same defeat on `working-directory` and on
  `cache-dependency-path`, a duplicate key inside the owning scope, the second-`run:` mapping defeat
  found by this suite, both single-mechanism mutings composed with the decoy, and **positive control:**
  removing the documentation comment the two raw-text assertions check stays green.

  **Four synthetic witnesses added, all multi-line — and that is the repair to round 5's witnesses.**
  Round 5's three witnesses each fed the reader a **single line**, so they proved trailing-decoy handling,
  which was never the hole, and left scope and repetition entirely unwitnessed. The new ones feed it
  documents, reproduce round 6's exact defeat on synthetic input, and witness the run-defaults scope and
  the duplicate refusal. **A witness must exercise the shape that failed, not the shape that passes.**

  **`MEMORY.md` lesson 53 amended a second time.** Round 5's amendment asserted "a decoy anywhere"; that
  is now corrected in place rather than erased, and the rule that replaces it is the ambiguity rule above.
  The lesson records the full ladder — comments are not the problem, *text containing the value* is; nor
  is it *text at all*, it is *which occurrence* — because each rung was sufficient against the round
  before it and insufficient against the next.

  **Five defects in my own tooling, all caught, all recorded rather than smoothed.** This is the third
  round in a row whose ledger leads with them, because they are the part a reader cannot derive from the
  diff.
  1. **The runner reported a verdict about a tree it had not produced.** `applyAll` wrote each compose
     edit from `pristine`, so when a mutation's own file was also one of its compose files — the normal
     case — the second write silently discarded the first. The competitor never entered the file and the
     row reported STILL GREEN.
  2. **A crash was reported as a defeat, twice.** Two mutations were invalid TypeScript; vitest failed to
     transform the file and exited non-zero, and the runner called it RED. Now `RED BUT DID NOT RUN` is
     raised on a transform error or a short file count.
  3. **The guard for (2) was then mis-calibrated**, reading vitest's *passed* count instead of its total —
     so `Test Files  1 failed | 2 passed (3)` read as `2 < 3` and **all fifteen real defeats became
     `RED BUT DID NOT RUN`.** Caught only because fifteen simultaneous class changes is unmissable where
     one would not have been. The guard is now self-calibrating: a bad calibration flips every row at
     once, which is the property that makes it safe to have.
  4. **Three mutations were not composed with their probes**, so they were green by construction — round
     4's lesson in a fourth new shape. Each is now composed, and the un-composed rows are kept and
     relabelled so the two reasons cannot be confused.
  5. **One witness was declared but never registered.** `same-name-different-source-competitor` added a
     probe arm as a `const` and never put it in any `arms` array, so it was a no-op that reported as an
     unexpected green. **The most expensive kind of harness bug, because it looks like a finding about
     the code.**

  **And one needle re-pointed, reported `DID NOT APPLY` first.** `mut-f1`'s `identity-filter-removed`
  stopped matching because round 6 rewrote that filter into a conjunction. Re-aimed at the new text with
  the same meaning. **That block's needle has now needed re-pointing three times** — W1 made it flag-aware,
  round 5 made it name-based, round 6 made it a conjunction — and the honest reading is that each repair
  was correct about the defect it targeted and wrong about the one underneath it.

  **Suites, all re-run because four files changed under them.** `mut-round6` 15/15 + 1 designed green,
  `mut-f1` 6/6 + 3, `mut-w1-flags` 3/3 + 2, `mut-c1-round5` 9/9 + 1, `mut-c1-comments` 6/6 + 1,
  `mut-f5` 5/5, `mut-gate-order` 7/7, `mut-apiroutes` 8/8 + 1, `mut-notseen-anchor` 4/4. Full suite **181
  files / 3302 tests, 0 skipped** (+5: four synthetic witnesses, one uniqueness assertion). `tsc
  --noEmit`, `prettier --check`, `eslint` exit 0; `openspec validate --strict` and `--specs --strict`
  both valid (26 items, 0 failed).

  **Note on ordering.** Prettier reformatted `tests/helpers/yaml.ts` after the first full run, and the
  file is one `mut-round6` and one `mut-c1-round5` mutation attack. Both suites were re-run against the
  formatted file before any of the figures above were believed — the standing rule being that a repair
  invalidates the suites beneath it, and a formatter is a repair.

  **Still unverified, unchanged from 8.11.** No browser verification (8.8); CI not observed green (8.9);
  `npm ci` / `npm run setup` / both archived `release-gate.mjs` copies never run and outside every gate.
  Round 6 **did** attack `release-gate-install.test.ts` for the first time in six rounds and found it
  sound: the `installItem` window and the cascade assignment are both non-vacuous (4/4 mutations
  defeated). It recorded one **latent** issue, not a current defect: the `code()` comment stripper
  mis-reads an unescaped `//` inside a regex literal, and no scanned `.mjs` file contains one — so it is
  a trap for the next person who adds one, not a hole today. `download-non-goals.test.ts`'s
  `SOURCES_BY_FILE` anchor and `motion-budget.test.ts` were also checked and found sound. The
  fixture-presence gap noted in 8.15 remains open **by decision**.

- [x] 8.18 **Six consecutive green full gate runs at `4d31728`, after round 6's repairs, corroborated
  from the logs by a separate checker.**

  8.3 was met at `bdb0dba`, 8.10 at `cdc0fb0`, 8.12 at `9a5634e`, 8.14's six runs at `68860cb`, and 8.16's
  six runs at `f4b5cb1`. **None of those executes round 6's `stepWith`, `jobRunDefaults`,
  duplicate-key refusal, throwing `indexOfStep`, the `GATES` declaration, the arm-name uniqueness
  assertion, or the four new multi-line witnesses** — so on 8.3's own reasoning (*a criterion measured
  against a tree that has since changed is not a measurement of the current tree*) the batch is re-run
  rather than inherited.

  ```
  run  exit  seconds  files  tests  motion-budget  skipped  parse
  1    0     104      181    3302   21                      ok
  2    0     100      181    3302   21                      ok
  3    0     98       181    3302   21                      ok
  4    0     98       181    3302   21                      ok
  5    0     97       181    3302   21                      ok
  6    0     96       181    3302   21                      ok
  ```

  **3302, not 3297:** round 6 added four multi-line witnesses to `ci-workflow.test.ts` and one
  registry-wide arm-name uniqueness assertion to `release-exclusions.test.ts`. `motion-budget` is 21 in
  every run, which is the load-bearing half — 15 passed + 6 skipped is the no-build figure, so a run
  without a build would report 15 here.

  **Corroborated from the logs, not from the batch's own summary.** `evidence/verify-gate-batch.mjs` reads all six. (The script by that name when this entry
  was written was `verify-gateruns6.mjs`, which existed only in a temp directory and **is not in the
  repository** - so a reader could not have re-run it. The shipped file is the one named here.)
  logs and finds every marker (`Test Files`, `Tests `, `tests/motion-budget.test.ts`), 0 NUL bytes and 0
  U+FFFD replacement characters in each — so no log is UTF-16 or lossy — and asserts each total is
  distinct across the six. **The checker locates each marker as a string before reading any number from
  its region**, because the first version of this checker reported *the logs contain none of the counts*
  when they plainly did: vitest colours its summary, so the bytes read `Test Files \x1b[2m181
  passed\x1b[22m` and an escape sequence is not whitespace. A parser that cannot find what it is looking
  for is not evidence that it is absent — the lesson this whole change is an instance of.

  **No repository file was edited while the batch ran.** Round 6 sharpens that constraint rather than
  repeating it: four of the five files the gate checks are files that mutation suites edit, and 8.3's
  batch failed run 6 on `format:1` for exactly this reason.

  **Not re-measured by this batch, and therefore not claimed:** `npm ci`, `npm run setup`, and both
  archived `release-gate.mjs` copies. `npm run gate` does not invoke them, so AGENTS.md's claim that they
  exit 0 remains inherited from M0 rather than re-measured here.

- [x] 8.19 **Verification round 7: one CRITICAL, two WARNINGs, two NITs, all closed, each
  mutation-proven. Round 7 attacked round 6's repairs and its CRITICAL is round 6's CRITICAL reproduced
  against the fix for it — the FOURTH round in a row to do that.**

  **C1 — the scope *selector* was still a bare key resolved by position.** Round 6 scoped two lookups and
  refused duplicates *inside* a scope. It left the level above both:

  ```ts
  // frontend/tests/helpers/yaml.ts, before
  const start = lines.findIndex((line) => /^\s*defaults:\s*$/.test(line));
  ```

  So a **second job** won the scope:

  ```yaml
      jobs:
        dependency-audit:            # decoy job
          defaults:
            run:
              working-directory: frontend
        quality-gates:               # the real job, its own `defaults:` DELETED
          steps:                      # every step carrying its own working-directory
  ```

  **The workflow's behaviour is identical** — CI does the same work in the same directory — and
  `quality-gates` has **no default working directory at all**. 181 files / 3302 tests, green. The
  verifier confirmed this with `js-yaml` rather than by the absence of an error.

  The doc comment had claimed *"the `defaults.run` mapping of **the single job**"* for a round while the
  code read whichever job came first. **A stated assumption is not a constraint.**

  **Fix — a shape, not another patch.** Four rounds have now walked up one level each, so the repair is
  the general rule rather than the next instance:

  > **Every level of a scoped lookup is itself a scoped lookup, so every level must refuse. `findIndex`
  > cannot express "I am not sure", so it always answers — and its answer is available to whoever
  > placed the earlier block.**

  Hence, at every level: **`null` for zero, a throw naming the lines for two or more**, and no
  "first match wins" anywhere. `findIndex` no longer appears in `yaml.ts` — a helper whose signature
  cannot express uncertainty will always be certain, and being certain is the defect. Four levels, one
  rule:

  ```
  reading a value      →  which occurrence?   →  scope + refuse duplicates   (round 6)
  choosing the scope   →  which mapping?      →  refuse ambiguity            (round 7)
  walking the mapping  →  which depth?        →  direct child, not subtree   (round 7, N5)
  naming a thing       →  which one is it?    →  refuse duplicates + assert uniqueness (round 6, W2)
  ```

  **W1 — every gate could be made non-blocking while the needle stayed in the text.** `npm run lint ||
  true` keeps `npm run lint` inside the step's `run:`, so every ordering assertion through `indexOfStep`
  stayed green — while the gate cannot fail CI. `|| true` on a CI step is an ordinary edit and it is
  completely silent. **3302/3302 with five of six gates unable to fail.**

  The revealing detail is that the file **already knew the difference**: `npm ci` was protected by
  `step.run.trim() === "npm ci"` — the *command* — while the ordering assertions used `.includes(gate)`
  — the *text*. One gate out of six. Round 6's recorded claim that gates "could be replaced with
  `echo <gate> is disabled`" was true only because that particular echo omits the needle; the general
  form survived the repair. Now every gate is required to be *exactly* its command.

  **W2 — the block-scalar guard was defeated by a trailing comment, and then the strip deleted a command.**
  The pattern required the indicator to be the **last thing on the line**, so `run: | # the unit tests`
  walked straight past it — and the stripper then removed a real command from the literal body, which is
  the exact outcome the guard exists to prevent. A YAML block header may carry a comment after the
  indicator, so the comment is part of the header: **a guard that only recognises the tidy spelling of
  the thing it guards is not a guard.** No scanned file has a block scalar today, so this was latent —
  but the failure mode is silent *deletion of content*, not a mis-read.

  **N4 — `stepWith` took the first of two steps sharing a name.** `findIndex` again. On the real workflow
  it was caught, but by *a different test* asserting the step-name list — **a consumer's guarantee, not
  this helper's**, while the helper's own doc comment promised "the step named `stepName`", a phrase
  with no referent when there are two.

  **N5 — the scope was a subtree, not a mapping.** `blockAfter` matched the key at any depth, so a
  `defaults:` nested inside a step's `with:` was a candidate for the job's own. **No Actions-valid
  workflow exploiting this was found** — `defaults:` has exactly one legal child and action inputs are
  scalars — so it was latent. Fixed and witnessed anyway: a reader assumes "mapping" from the word.

  **N6 — one extraction window in `release-gate-install.test.ts` had no anti-vacuity anchor.** The cascade
  window beside it carried one; the `gates-install` window did not, so re-indenting its closing brace made
  the lazy window swallow the next item — two mutations, both green.

  **And the first repair for N6 was itself wrong, which is worth recording because the mutation suite
  caught it rather than a reviewer.** A `toContain('id: "gates-install"')` anchor passes on a window that
  has *widened* — it contains everything the narrow one did. **An anchor must test the window's extent,
  not its content**, so both windows now assert *exactly one* `id:` key / one `isShortCircuited(`.

  **Proof — `mut-round7`, 12 of 12 that must go red did, plus 1 green by design.** The verifier's exact
  defeat in three separate edits; each refusal muted alone and composed with the decoy it exists to defeat;
  the block-scalar header comment; `|| true` across five gates; the pre-repair `command`/`args` shape;
  the widened window; and **positive control** — removing the witnesses' own documentation stays green.

  **Suites, all re-run because three files changed under them.** `mut-round7` 12/12 + 1, `mut-round6`
  15/15 + 1, `mut-f1` 6/6 + 3, `mut-w1-flags` 3/3 + 2, `mut-c1-round5` 9/9 + 1, `mut-c1-comments` 6/6 + 1,
  `mut-f5` 5/5, `mut-gate-order` 7/7, `mut-apiroutes` 8/8 + 1, `mut-notseen-anchor` 4/4. Full suite **181
  files / 3305 tests, 0 skipped** (+3: three new witness tests). `tsc --noEmit`, `prettier --check`,
  `eslint` exit 0; `openspec validate --strict` and `--specs --strict` both valid (26 items, 0 failed).

  **Three needles in my own tooling, all reported `DID NOT APPLY` first and re-aimed at the new text with
  the same meaning.** `mut-round7`'s install row aimed at `command:`/`args:` lines the M21 repair had
  itself deleted four milestones ago — a mutation aimed at retired text. Two further aims failed because
  the item carries a fifteen-line comment block before its brace. `mut-c1-round5`'s block-scalar row
  needed re-pointing when round 7 split that lookup across two lines. **A mutation that stops applying is
  a witness that stopped working**, and `DID NOT APPLY` is the only honest report of it.

  **And a tooling mistake worth naming: I wrote a patch script to repair the suite, and it failed
  `node --check` twice** on mixed quote styles inside an array-of-strings — the exact trap the branch's
  own notes warn about, committed by the person who wrote the warning. It cost nothing because it failed
  before touching anything, and I stopped patching through hand-written JS and edited the suite directly.
  **A patch script is code and gets checked like code.**

  **`MEMORY.md` lesson 66 added**, stating the four-level ladder as a property of the shape rather than a
  caution. Lessons 53 and its two amendments are left untouched: they cover the value level, and this one
  is the level above every value-level rule.

  **Attacked by round 7 and found sound** (recorded so they are not re-attacked): the
  conjunction-plus-uniqueness pair in `release-exclusions.test.ts`, against a competitor in a different
  exclusion, a same-name competitor, a same-name-**and**-source competitor, and the identity filter alone;
  `release-gate-install.test.ts`'s cascade branch, install branch and call site (4/4 defeated); the
  `code()` latent hazard; `motion-budget.test.ts`'s 21 tests and its stated 15 + 6 skipped discriminator,
  measured both ways; and the fails-closed shapes — `with:` as a flow mapping, a YAML alias, a quoted step
  name, a quoted key, and `cache-node-version` not suffix-matching `node-version`.

  **Open by decision, not by oversight:** the registry-wide *scope* of the arm-name uniqueness assertion,
  in composition with a load-bearing competitor, is the one question in round 7's target list the verifier
  could not answer with a valid probe — its narrowing mutation still accumulated into the registry-wide
  map, so it proved nothing and was reported as a failed probe rather than a pass.

  **Still unverified, unchanged from 8.11.** No browser verification (8.8); CI not observed green (8.9);
  `npm ci` / `npm run setup` / both archived `release-gate.mjs` copies never run and outside every gate
  (round 7 edited the archived gate for mutations and restored it byte-exactly; it was never executed).
  No production verification against `spotivibe-web.vercel.app` was performed in round 7 — every finding
  is about test-suite integrity and has no runtime observable on the deployed site, so a fetch would have
  been decoration rather than evidence. There is still no `openspec verify` subcommand, so the
  AGENTS.md-mandated verification-workflow step remains unverified.

- [x] 8.20 **Six consecutive green full gate runs at `9f1dc2a`, after round 7's repairs, corroborated
  from the six logs by separate code that then had to be corrected twice to mean anything.** That
  separate code is `evidence/verify-gate-batch.mjs` today; at the time of each of those entries it was
  a temp-directory script, **not in the repository**, and the entries above are therefore claims a
  reader could not have re-run. Measured is not the same as re-runnable, and only the second one is
  checkable by someone else.

  8.3 was met at `bdb0dba`, 8.10 at `cdc0fb0`, 8.12 at `9a5634e`, 8.14's six runs at `68860cb`, 8.16's
  at `f4b5cb1`, and 8.18's at `4d31728`. **None of those executes round 7's `keyLinesIn` /
  `directChildKeys`, the rewritten `jobRunDefaults`, the `stepWith` duplicate-name refusal, the
  generalised exact-command gate assertion, the block-scalar trailing-comment refusal, or the two
  window-extent anchors** — so on 8.3's own reasoning (*a criterion measured against a tree that has since
  changed is not a measurement of the current tree*) the batch is re-run rather than inherited.

  ```
  run  exit  seconds  files  tests  motion-budget  skipped  parse
  1    0     126      181    3305   21                      ok
  2    0     100      181    3305   21                      ok
  3    0     98       181    3305   21                      ok
  4    0     97       181    3305   21                      ok
  5    0     96       181    3305   21                      ok
  6    0     97       181    3305   21                      ok
  ```

  **3305, not 3302:** round 7 added three witness tests to `ci-workflow.test.ts`. `motion-budget` is 21
  in every run, which is the load-bearing half — 15 passed + 6 skipped is the no-build figure, so a run
  without a build would report 15 here.

  **No repository file was edited while the batch ran.** Round 7 sharpens that constraint rather than
  repeating it: round 7 changed the *exported shape* of `tests/helpers/yaml.ts`, which every
  workflow-reading test consumes, so a stray edit mid-batch would surface as a baffling suite failure
  rather than as a diff.

  ## The corroborator, and the two ways it was wrong first

  `evidence/verify-gate-batch.mjs` reads all six logs. (At the time of writing that was
  `verify-gateruns7.mjs`, a temp-directory file **not in the repository**; the method described here
  is the shipped checker's, and it has been corrected three times since - see 8.25.) Each marker (`Test Files`, `Tests `,
  `tests/motion-budget.test.ts`) is located **as a string before any number is read from its region**, 0
  NUL bytes and 0 U+FFFD per log, and every total identical across the six. Unlike run 6's checker, it does
  **not** hard-code the expected test total: a hard-coded expectation that is wrong about the tree reports
  itself as a finding about the tree, which is the same false-report shape as a decoy that wins.

  **v1 reported `UNAVAILABLE` for the independent enumeration while the measurement was working.** It
  guarded the phase behind a regex for a summary line *`vitest list` does not print*, so a working
  enumeration read as an absent capability. **A precondition stricter than the method turns a working
  measurement into a missing capability** — lesson 64's shape, committed by the checker rather than the
  code.

  **v2 then asserted equality against a count it could not legitimately have.** It counted ` > `
  *separators* (5966) rather than ids (2980), and required the id count to equal the gate's 3305. The
  reason it cannot is real and worth recording: **`vitest list` emits one line per test *template*, not
  per expanded parameterised case**, and this suite has 33 `.each(` call sites that expand over their
  tables at run time. Enumeration is therefore a **lower bound by construction**, and the two mechanisms
  do not measure the same quantity — so their difference is not a discrepancy in either of them.

  **v3 asserts only the one directional claim the two mechanisms share** — enumerated <= executed, since
  every executed test is enumerated at least once as its template — and *reports* the gap and its cause.
  The alternative, tuning the id pattern until the number equalled 3305, is **fitting a checker to the
  number it was supposed to be checking**, which is precisely what this change exists to remove.

  That is five defects in this change's own tooling across three rounds, and four of the five share one
  signature: **a report about something other than what was measured.**

  **Not re-measured by this batch, and therefore not claimed:** `npm ci`, `npm run setup`, and both
  archived `release-gate.mjs` copies. `npm run gate` does not invoke them, so `AGENTS.md`'s claim that they
  exit 0 remains inherited from M0 rather than re-measured here.

- [x] 8.21 **Six consecutive green full gate runs at `868e658`, after round 8's `indexOfStep` repair,
  corroborated from the six logs.**

  8.3's batch has now been re-run seven times — at `cdc0fb0`, `9a5634e`, `68860cb`, `f4b5cb1`,
  `4d31728`, `9f1dc2a` and `868e658` — and on every occasion the reason was the same: **a criterion
  measured against a tree that has since changed is not a measurement of the current tree.** None of the
  seven executes round 8's `stepsRunning`, the new `indexOfRunning`, the refuse-on-two ambiguity throw,
  or the synthetic three-property witness.

  ```
  run  exit  seconds  files  tests  motion-budget  skipped  parse
  1    0     102      181    3306   21                      ok
  2    0     98       181    3306   21                      ok
  3    0     95       181    3306   21                      ok
  4    0     97       181    3306   21                      ok
  5    0     98       181    3306   21                      ok
  6    0     98       181    3306   21                      ok
  ```

  **3306, not 3305:** one witness added to `ci-workflow.test.ts`.

  **No repository file was edited while the batch ran**, and the constraint is stated more sharply than
  before rather than restated: round 8 touched `ci-workflow.test.ts` alone, and that file is the target or
  the oracle of **eight of the eleven** mutation suites — so a mid-batch edit would not surface as a diff,
  it would invalidate suites nobody was running.

  ## Two things this batch got wrong on the way, both recorded

  **The first gate invocation was aborted by its own reporting pipeline, and the abort looked like a
  result.** Piping `npm run gate` into `Select-Object -First 20` closes the pipeline once twenty lines
  have been read, which kills npm; it reported `exit -1` beside output that looked like ordinary passing
  test activity. **A broken pipe is indistinguishable from a hang when the output happens to end on a
  passing line.** Re-run with the output captured to a variable and filtered afterwards: exit 0. Capturing
  before filtering is now how every gate invocation on this branch works, which is the reason the batch
  script above was already written that way.

  **The corroborator's `vitest list` phase was corrected three times across rounds 7 and 8**, and all
  three corrections are kept rather than smoothed: v1 guarded the phase behind a summary line the tool
  does not print, so a *working* enumeration read as an absent capability (**a precondition stricter than
  the method turns a working measurement into a missing capability**); v2 counted ` > ` separators rather
  than ids and then asserted equality against a count it could not legitimately have, because `vitest
  list` emits one line per test **template** and this suite has 33 `.each(` call sites; v3 asserts only
  the one directional claim the two mechanisms share. The alternative at every step — tune the pattern
  until the number matched — is **fitting a checker to the number it was meant to check**.

  **One cross-check this batch does provide.** Enumeration rose 2980 -> 2981 alongside execution
  3305 -> 3306, holding the gap at exactly 325. Two mechanisms that cannot be compared in absolute terms
  still have to *move together*, and these did. That is what independent agreement looks like when the
  quantities differ.

  **Not re-measured by this batch, and therefore not claimed:** `npm ci`, `npm run setup`, and both
  archived `release-gate.mjs` copies. `npm run gate` does not invoke them, so `AGENTS.md`'s claim that
  they exit 0 remains inherited from M0 rather than re-measured here.

- [x] 8.22 **Round 9: two CRITICALs and one WARNING in rounds 7-8's own repairs, all repaired and
  mutation-proven; six consecutive green full gate runs at `e26ea2a`, corroborated from the logs.**

  Round 9's independent verification found the same defect class for the sixth round running, one rung
  further along the ladder. All three findings were re-confirmed by reading the source before any repair,
  and **both CRITICALs were worse than reported.**

  ## C1 — `readSteps` attributed any `run:` line to the step above it, with no indentation scope

  An `env:` variable named `run` became a step's command, and `current.run` overwrote rather than
  refused, so a second `run:` in one step won by position. Proven live, composed with the real lint gate
  becoming `|| true`: **21/21 in the file, 3306/3306 across the suite, with the lint gate unable to fail
  CI.** Round 8 unified the *comparison* and left the *attribution* positional — the level directly
  beneath it. Repaired: a step's `run:` must be a **direct child** of its `- name:` line by indent, a
  nested one is refused, and two in one step are refused.

  **The refusal is load-bearing in a way no assertion was.** Because the reader is called at module
  scope, a nested `run:` stops `ci-workflow.test.ts` from loading at all — the strongest fail-closed
  point available, and *not* the same evidence as an assertion failing. It has its own reported verdict,
  `RED, FILE COULD NOT LOAD`, because a RED whose mechanism is unexplained is a verdict without evidence.

  ~~This also gave the batch corroborator something new to guard: a file that cannot load contributes
  **zero** tests, so `Test Files 181 passed (181)` is now the figure that distinguishes *the tree is happy*
  from *a reader refused and the suite quietly shrank*.~~

  **CORRECTED IN ROUND 10 — the conclusion holds and the stated reason does not.** I measured the refused
  state rather than reasoning about it, by adding round 9's own `r9-env-run-decoy-alone` decoy and running
  the full suite:

  ```
   ❯ tests/ci-workflow.test.ts (0 test)
   FAIL  tests/ci-workflow.test.ts [ tests/ci-workflow.test.ts ]
   Test Files  1 failed | 180 passed (181)
        Tests  3289 passed (3289)
  ```

  **The parenthesised file total does not move: it is 181 either way.** The string
  `Test Files 181 passed (181)` never appears in the refused state, so it cannot be the figure that
  distinguishes the two. The figures that actually distinguish them are the **exit status** (non-zero) and
  the **executed-test count** (3312 → 3289, −23) — and **neither of which `evidence/verify-gate-batch.mjs` recorded at the time.** That is
  measured, not inferred: with all six logs carrying every green figure plus a trailing
  `npm error code 1`, the checker still reported `run1 ... asserted ok` and `corroborated`, exit 0;
  and with all six logs rewritten to claim `Tests  999999 passed`, it reported that figure as
  agreed, exit 0. So the half of the criterion that says *green* had no evidence behind it anywhere,
  and this sentence named a file that ships as its reason.
  The conclusion was still right, on grounds this sentence did not give: a genuinely red gate run has
  one `Tests ... passed` match and its only `Test Files` line reads
  `Test Files  1 failed | 180 passed (181)`, which does not match the green pattern at all, so its
  figures are refused rather than agreed.
  Round 11 closed both gaps in the checker - the driver now writes `gate exit <code>` into every log
  and the checker refuses a log without one - at which point this sentence is true as written. It is
  left standing rather than deleted, because **correcting a claim in place keeps the history** and a
  reader who remembers the old claim deserves to find out it was wrong and why.

  So the *conclusion* was right and arrived at by the wrong route, and the difference matters: I asserted a
  mechanism and then added an assertion to the corroborator believing it, so for one round the checker
  carried a claim that measurement does not support. **An assertion added on the strength of a reason
  nobody measured is a claim, not a check** — the same defect as a named thing with no witness, one level
  up. The `Test Files` assertion is retained because it is independently true and worth having; what was
  removed is the sentence claiming it is what catches a refused reader.

  ## C2 — `keyLinesIn` derived a line index from text

  `nestedBlocks` skipped blank lines while returning `string[]`, and `keyLinesIn` recovered a line number
  by adding an offset to `at + 1`. That arithmetic is correct only while the body is a contiguous slice,
  so **every index after the first blank line in a block was wrong.** Its own doc comment named this
  hazard in the past tense and then performed the arithmetic.

  The consequence was a confident false claim rather than a wrong value: one blank line before
  `defaults:` made `jobRunDefaults` answer `null`, and the assertion reported **the job must set a
  default working directory** for a file that sets one.

  **Worse than reported, and the extra part is the interesting one.** On the suite's own path — after
  `prepareWorkflow` strips comment lines and renumbers everything a second time — a blank line inside
  `setup-node`'s `with:` costs **both** the working directory and the Node pin. The raw-text path was
  fine. **Two independent line-renumbering transforms interacting is where this lived**, and reporting
  only the raw path would have understated it. Repaired by having the walker return `number[]`, so no
  index is ever derived from text.

  ## W1 — round 7's extent anchor was a guess about a guess

  Round 7 answered *the lazy regex window may have drifted* with an extent anchor (exactly one `id:`).
  Round 9 defeated it in **both directions at once**:

  - **Widening, falsely counted.** An `id:` inside a *string value*, or a second `id:`-shaped token that
    is not an item boundary, increments the count. The window can cover two items and still read `1`.
  - **Narrowing, not counted at all.** The anchor was a **lower bound**, so a window cut short passed.
    The `gates-install` item's last real field is `how:` — everything after it is comments, stripped
    before reading — so truncating anywhere after `how:` satisfies every content assertion. Measured:
    **168 characters of a 1358-character item**, while the assertion whose stated purpose is *the window
    must cover exactly this item* reported that it did.

  **A second content anchor cannot repair an inference, so the inference was removed.** `typescript` is
  already a dependency of the type check, so the item's text is the object literal's own span and the
  cascade branch is located the same way. Both locators refuse zero and two-or-more. Four of
  `mut-round9`'s seven designed-green rows are the old defeats, now green **because the check no longer
  depends on formatting at all** — a suite where they went red would be asserting the formatting, which
  was never the claim.

  ## `mut-round9` — 9/9 that must go red did, 7 green as designed, 0 did not apply

  ```
  r9-env-run-decoy-plus-non-blocking-lint      RED, FILE COULD NOT LOAD
  r9-env-run-decoy-alone                       RED, FILE COULD NOT LOAD
  r9-guard-removed-plus-the-probe              RED   (caught by the synthetic witness)
  r9-lint-non-blocking-alone                   RED
  r9-index-arithmetic-restored-plus-a-blank-line RED
  r9-two-items-share-one-id                     RED
  r9-two-branches-name-the-cascade-helper      RED
  r9-item-refusal-muted-so-the-witness-fails   RED   (caught by the new `describe`)
  r9-branch-refusal-muted-so-the-witness-fails RED   (caught by the new `describe`)
  + 7 designed greens: 2 blank-line rows, 3 old W1 defeats, 1 duplicate-token, 1 witness-docs-removed
  ```

  Two rows exist only to prove the **new synthetic witnesses can fail** — lesson 66's corollary, since a
  witness that cannot fail is not a witness. Both are caught by exactly the `describe` they target, which
  the output names. Their needles are two lines long on purpose: `if (matching.length > 1) {` occurs in
  **both** locators, and a one-line needle would silently mutate whichever came first.

  ## Three errors of mine this round, all kept

  **1. A mutation built from a paraphrase.** Restoring the old offset arithmetic as
  `nestedBlocks(…).map((_, offset) => at + 1 + offset)` does **not** reproduce C2: the committed code
  tests `KEY_LINE` against the *correct* line while recording the *wrong* index, and the paraphrase
  shifted both. The row reported `STILL GREEN` — a confident false claim about my own repair, one step
  from being recorded as a pass. It reproduced immediately once the committed body was taken **verbatim**
  from `git show`. **A mutation row built from a paraphrase of the code it claims to remove is a row
  that verifies the paraphrase.**

  **2. Two summary regexes, both wrong, then one selected by shape.** Taking vitest's *first* `Tests`
  match reported *78 passed* for rows that ran 101, because vitest prints an interim line for the
  failing file first; taking the *last* reported `(1 ⎯⎯⎯)`, because the tail is a per-failure detail
  line. The summary is now selected as the line ending in a parenthesised total. **A position in a
  stream is not an identity** — lesson 66's rule applied to output instead of YAML.

  **3. An unused `SourceFile` that eslint caught, and that was mine.** `itemSource` parsed the module
  twice and kept the second result in a variable it never read. Two parses of one document is the shape
  every finding in this change has had. Fixed by parsing once and passing the `SourceFile` down.

  ## One finding declined

  N2 claimed the *the workflow has exactly one job* requirement is stated nowhere findable. **It is named
  in a test**: `refuses to pick one of two jobs, rather than reading the first`. Half the finding was
  wrong, so no message was edited to satisfy it — and `mut-round7`'s `job-ambiguity-refusal-removed`
  depends on that exact wording. Recorded as half-wrong with the evidence.

  ## Two `mut-round7` rows re-aimed, one expectation inverted

  Round 9 deleted the mechanism both rows attacked, and one became **logically contradictory** with a
  `mut-round9` row applying the identical edit:

  | row | edit | was | is now |
  |---|---|---|---|
  | `install-window-widens-past-its-item` | re-indent the item's closing brace | RED | **GREEN** |
  | `install-extent-anchor-removed` | mute the extent anchor | `DID NOT APPLY` | **re-aimed** |

  The first is green because nothing widens any more, which is the coverage becoming *unnecessary*;
  the value of a row that changes verdict is that the change is itself the evidence, provided the new
  verdict is explained. The second's subject was deleted but its **meaning** survived one mechanism down —
  *what stops the extraction resolving an ambiguous item by position?* — so it now mutes
  `itemSource`'s refusal composed with a duplicate `id` placed **first**, the arrangement that makes
  first-wins read the wrong item. Same meaning, and it is the round-6 defect reintroduced through the
  round-9 repair: the ladder now runs downward as well as upward. `mut-round7` is 11/11 + 2 designed.

  ## The ninth batch — six consecutive green full gate runs at `e26ea2a`

  ```
  run  exit  seconds  files  tests  motion-budget  skipped  parse
  1    0     181      181    3312   21                      ok
  2    0     119      181    3312   21                      ok
  3    0     126      181    3312   21                      ok
  4    0     205      181    3312   21                      ok
  5    0     182      181    3312   21                      ok
  6    0     132      181    3312   21                      ok
  ```

  **3312, not 3306:** six witnesses — two in `ci-workflow.test.ts`, four for the AST locators.

  **The cross-check is the strongest result in this batch.** Independent enumeration rose
  **2981 -> 2987** alongside execution **3306 -> 3312**: exactly +6, matching the six witnesses added,
  holding the gap at 325 for the third batch running. Two mechanisms that cannot be compared in absolute
  terms still have to *move together*, and these did by the number of tests this change actually added.

  ## The run times roughly doubled, and the cause is NOT established

  Batch 8 ran in 95-102 s; batch 9 in 119-205 s. That is reported rather than smoothed. It was
  **measured** rather than attributed: the only file containing AST parsing, `release-gate-install.test.ts`,
  runs in 2.1-2.8 s of a ~130 s gate, with vitest attributing ~42% of that to environment and ~26-29% to
  the tests themselves. Six parses of a ~1000-line file cannot account for ~25 s, so **the AST extraction
  is not the cause** — and what is, is **unverified**. Recording a plausible cause as though it were
  measured is the same false-report shape as everything else this change has been removing, and it is
  cheaper to write *unverified* than to write a guess with a number attached.

  ## Not re-measured by this batch, and therefore not claimed

  `npm ci`, `npm run setup`, and both archived `release-gate.mjs` copies. `npm run gate` does not invoke
  them, so `AGENTS.md`'s claim that they exit 0 remains inherited from M0. No browser verification was
  possible at any point in this round (only Edge installed, no automation dependency), so every check that
  needs a real browser remains unverified rather than passing. CI has still not been observed green on
  this branch.

  ### Post-commit correction — batch 9 was stale on a *documentation* file, and batch 10 exists because of it

  The batch above was measured at `e26ea2a`, which is where round 9's source repair landed. The task entry
  and lessons 67-72 then landed at `fe43949`, which looked exempt: documentation is not source code, and no
  gate step runs `MEMORY.md`.

  **It is read.** `tests/encoding-integrity.test.ts:164` decodes `MEMORY.md` among the root files it
  checks, so the commit that recorded round 9's results changed an input to the gate and batch 9 was
  measuring a `MEMORY.md` that no longer existed. Found by grepping for the filename rather than by
  assuming docs were exempt.

  **The test suite decides which files are inputs, and it decided this one was.** The rule this change has
  applied eight times — *a criterion measured against a tree that has since changed is not a measurement of
  the current tree* — makes no exception for files that are "only" documentation, and an exception made
  on that basis is indistinguishable from forgetting.

  ## The tenth batch — six consecutive green full gate runs at `fe43949`

  ```
  run  exit  seconds  files  tests  motion-budget  skipped  parse
  1    0     122      181    3312   21                      ok
  2    0     121      181    3312   21                      ok
  3    0     121      181    3312   21                      ok
  4    0     117      181    3312   21                      ok
  5    0     114      181    3312   21                      ok
  6    0     120      181    3312   21                      ok
  ```

  Corroborated independently from the six logs (`evidence/verify-gate-batch.mjs`, exit 0; at the time of writing a temp-directory script,
  `verify-gateruns10.mjs`, **not in the repository** and therefore not re-runnable by a reader): 181 files and 3312 tests
  in every log, motion-budget 21 in every log, no NULs and no `U+FFFD` in any of them (a UTF-16 log and a
  lossy log both read as *markers absent*, not as *markers absent*), and enumeration holding at 2987 against
  execution at 3312 with the gap steady at 325 for the fourth batch running.

  **Amending this task file after the batch is safe, and that is a checked claim rather than an assumed
  one:** no test reads `tasks.md` or the active change directory — the only `openspec/changes` paths under
  `frontend/` are imports of the *archived* `release-gate.mjs`'s `lib/*.mjs`, which this amendment does not
  touch. The claim was established by grep before the edit, not by the reasoning that documentation is
  inert — which is the same reasoning that made batch 9 stale.

  ## The timing question, one batch later

  Batch 8 ran in 95-102 s. Batch 9 ran in 119-205 s and this entry first recorded the cause as **not
  established**: the only file containing AST parsing runs in 2.1-2.8 s of a ~130 s gate, so the extraction
  could not account for it. Batch 10 runs **the same AST code** in 114-122 s.

  Two things follow, and only two:

  - **The AST extraction is not the cause** — now supported by a control rather than by an argument. Batch
    10 is the same code with an 8-second spread, where batch 9 had an 86-second spread. That is consistent
    with a transient environmental cost and **does not identify what it was**.
  - **The cause remains unverified.** A tighter spread is corroboration, not an explanation, and recording
    it as the explanation would be the same false-report shape this change has spent nine rounds removing.

## 8.23 Round 10 - the findings were about *wiring*, not text

  Round 10's verifier returned **REJECT: 2 CRITICAL, 2 WARNING, 2 NIT**. Rounds 4-9 all found *textual*
  problems - a value read from the wrong place, a key attributed to the wrong owner, an item located by a
  pattern. Round 10's two CRITICALs are a different kind of question, and neither needed a new round to
  find:

  ```
  naming a thing      ->  which one is it?    ->  the node's own span       (round 9)
  attributing a key   ->  whose key is this?  ->  direct child by indent    (round 9)
  WIRING IT           ->  is the value consumed here the one produced over there?
                      ->  compare producer to consumer, refuse either    (round 10)
  ```

  ### C1 - the gate's only `prepareDependencies` call site was asserted nowhere

  `prepareDependencies` had **eight behaviour tests**. `cascadeReason` had four. The file contained the
  assignment that joins them:

  ```js
  environmentBroken = cascadeReason(prepared);
  ```

  and that assignment was asserted. **What `prepared` *is* was not.** So replacing the line that produces
  it with a fabricated literal satisfied every assertion:

  ```js
  const prepared = prepareDependencies({ frontendDir: FRONTEND });
  // becomes
  const prepared = { ok: true, detail: "...", output: "" };
  ```

  `prepared.ok` is then literally `true`, the `else` arm at line 474 - the **only** writer of
  `environmentBroken` in the file - becomes unreachable, no later item is ever short-circuited, and the
  cascade cannot fire. Measured independently before any repair: **105/105 targeted, 3312/3312 across the
  suite, with the gate preparing nothing.**

  The comment above the check already said *"The gate must actually **call** it"* - the prose claimed
  the property the two lines beneath it did not enforce. Repaired by comparing **producer to consumer**
  rather than matching text: a text match can be satisfied by a name, only the comparison can be
  satisfied by the wiring.

  ### C2 - nothing tied the extracted `gates-install` item to the gate executing it

  ```js
  for (const item of ITEMS) {
  // becomes
  for (const item of ITEMS.filter((candidate) => candidate.id !== "gates-install")) {
  ```

  The identifier stays in the file and the loop stays a loop, so any locator asking *is there a loop over
  `ITEMS`?* answers yes. `itemSource` proved the item is **declared**; nothing proved it was **reached** -
  one claim about the data and one about the control flow that consumes it. Also **3312/3312**.

  Each of the two is **individually sufficient**: C1 makes the `else` arm unreachable, C2 removes the only
  writer. Neither needs composing with the other, so both are repaired as one finding and both are
  witnessed separately.

  ### The repairs, and the three ways the repair reproduced the defect it was answering

  New locators `callsTo`, `soleCall`, `boundVariableName`, `firstArgumentName` and `soleLoopOver`, each
  refusing at every level - including the clause that distinguishes `ITEMS` from `ITEMS.filter(...)`,
  since a locator asking only whether a loop exists would answer yes and be wrong.

  **`mut-round10`'s first run then found three of my own defects**, one round after NIT N1 was reported
  and repaired:

  1. **Two new refusals were unwitnessed.** Muting `soleCall`'s refuse-on-zero and `soleLoopOver`'s
     derived-clause both reported STILL GREEN, because nothing fed either locator the input it exists to
     refuse. That is *a guard defended by a comment while nothing reached it* - the very finding this round
     had been dispatched to fix. Six refusal witnesses added; seven rows added that mute each refusal.
  2. **`soleLoopOver`'s recursive descent was dead code on the real gate.** The archived gate's loop is a
     **top-level** statement (line 418, column 0), so `forEachChild(file, visit)` reaches it in one hop
     and the recursive `forEachChild(node, visit)` never runs. Removing it changed nothing. **A walk
     deeper than the tree it is pointed at looks exactly like a walk that is not.** A witness that feeds it
     a nested gate now makes the descent load-bearing.
  3. **The harness's transform guard mis-calibrated a second time.** It keyed on the bare word
     `SyntaxError`, and this suite has a test whose *subject* is a syntax error - so a legitimate failure of
     it arrived carrying that word and was reported as a crash of the suite's own code: 113 tests executed,
     1 failed, verdict `RED BUT DID NOT RUN`. Now keyed on vitest's own transform signatures.

  ### W1 of round 10 - this record's own corroborator rationale was wrong about its mechanism

  ~~It is now the only figure in the checker that distinguishes *the tree is happy* from *a reader refused
  and the suite quietly shrank*.~~ **Corrected in place: measured, and false.** A file that cannot load
  does **not** move the parenthesised file total - vitest reports `Test Files 1 failed | 180 passed (181)`,
  and the string `Test Files 181 passed (181)` never appears in the refused state. The figures that
  distinguish it are the **exit status** and the **executed-test count** (3312 -> 3289), both of which the
  checker already recorded. The `Test Files` assertion is kept because it is independently true; what is
  removed is the claim that it is what catches a refused reader. **An assertion added on the strength of a
  reason nobody measured is a claim, not a check.**

  ### W2 of round 10 - the corroborator was not in the repository

  Eleven entries in this file described their figures as *corroborated from the six logs by separate code*,
  naming a script each time. `git grep -l gateruns` returned nothing, and a recursive filename search over
  the repository and the agent workspace found nothing either: **every batch entry was self-reported by the
  tool that produced it** - the arrangement `verify-gateruns7.mjs` was created to replace (itself a
  temp-directory file, **not in the repository**), reintroduced one
  level up. A claim of independent corroboration nobody else can run is a second script by the same author
  agreeing with the first.

  So the mechanism now ships with the claim it supports, under this change's `evidence/`:

  - `evidence/run-gate-batch.ps1` - the batch driver, with the log directory and the run count as
    parameters. Documents the two Windows traps that produced false evidence once: `Tee-Object` writes
    UTF-16LE on PowerShell 5.1 (half the characters become NULs, so `Test Files` is not *findable* and a
    log full of passing tests reads as an empty one), and the PowerShell `` `e `` escape does not exist in
    5.1.
  - `evidence/verify-gate-batch.mjs` - the checker, parameterised by log directory and by expected file
    and budget counts. **Verified against the batch-10 logs: it reproduces all six runs' figures exactly**,
    181 files / 3312 tests / motion-budget 21, 0 NULs and 0 `U+FFFD`, and its `vitest list` enumeration
    phase reported **2991 against execution 3312**. A checker hard-coded to one author's temporary directory
    is not runnable by the person reading it, which is the same defect as not shipping it.

  ### The eleven earlier entries are corrected rather than deleted

  Each said `verify-gaterunsN.mjs`, a file that existed only in a temp directory. They now read as: the
  figures below were corroborated by a checker that is **now** `evidence/verify-gate-batch.mjs`, and the
  logs they were read from are not in the repository. The **figures stand** - they were measured - but the
  corroboration was self-reported at the time and a reader could not have re-run it. **Correcting a claim
  in place keeps the history; deleting the entry would hide that the claim was ever made.**

  ### NITs, and the comment that ran the wrong way

  - **N1** - the block-scalar guard in `readSteps` was defended by a comment claiming it was *unnecessary*,
    because a recorded `|` would "silently pass some" assertions. It would fail **all** of them: the
    comparison is `===` on the whole command. And nothing witnessed the guard - `prepareWorkflow` refuses
    block scalars first, so the branch was unreachable from every test and mutating it away left the suite
    green. Comment corrected; witness added, with a `cat file | grep x` control so it cannot be satisfied by
    refusing anything containing a pipe.
  - **N2** - the block-exit **silently dropped** a `run:` key at or left of `steps:`, because it returned
    before the refusal that described itself as covering *exactly that case*. The reader was described more
    carefully than it behaved, in the one message a future editor would consult. It now refuses; a second
    `steps:` block, which used to be concatenated into one list, is refused too - the same trade
    `jobRunDefaults` already makes for two jobs.

  Neither NIT was a live hole for today's assertions, and that is exactly why they survived nine rounds:
  **nothing in the suite needed the dropped line to be present in order to fail.**

  ### An intermittent gate failure, recorded rather than buried

  One full gate run in this round reported `2 failed | 3314 passed (3316)` and exit 1. It **could not be
  reproduced** in three subsequent runs (3320 passed, exit 0, twice) and the failing test names were not
  captured, because the run's log was not written before it was understood. The cause is **unverified**;
  the known intermittent vitest fork-pool failure is a candidate and nothing more. **A red run that cannot
  be reproduced is not a green run, and the honest record is that it happened.**

  ### Proof - `mut-round10`, **14/14 that must go red did, 5 green as designed, 0 did not apply, 0 wrong**

  19 rows: the two verifier CRITICALs plus the comparison's own negative; **seven rows mutating one new
  refusal each**, which is what makes a witness more than a comment; one row removing the descent; the
  three `readSteps` repairs; five controls including the consistent-rename refactor that a suite pinning a
  *name* would fail, and a decoy loop over a different array; two documentation controls.

  Every needle that touches a `length === 0` / `length > 1` refusal is **multi-line**, because those
  expressions open refusals in two different locators and a one-line needle would mutate whichever came
  first - choosing by position inside the harness.

  Three rows in that suite were **wrong three times** and are kept with their history in their notes: one
  renamed an item the suite pins by exact id, one added an item and tripped the inventory check at
  `ci-workflow.test.ts:918`, and one closed a brace by pattern and matched an inner brace instead of the
  loop's own. **A control that fails tells you the control was mis-aimed; deleting it instead would cost
  the suite one honest data point and one chance to notice.**

  ### Figures at this commit

  Full suite **181 files / 3320 tests, 0 skipped**. `tsc --noEmit`, `prettier --check` and `eslint` exit 0
  with no warnings. `openspec validate harden-post-v1-verification --strict` valid;
  `openspec validate --specs --strict` **26 passed, 0 failed**.

  All thirteen mutation suites green at this tree, `mut-round10` included. Enumeration moved **2987 ->
  2991** alongside execution **3312 -> 3320**, the same direction and by more than the tests added, because
  the new witnesses contain `.for` loops over indicator strings and a nested-gate array rather than only
  single cases.

## 8.24 The shipped corroborator's own two defects - found by running it, not by reading it

  Round 10's W2 repair put `run-gate-batch.ps1` and `verify-gate-batch.mjs` in the repository so a reader
  could re-run them. The eleventh batch was the first use of the driver **as shipped**, and it returned
  two defects in the very mechanism that was supposed to remove the self-reporting problem.

  ### Six green runs at `ad8a965`, and what the driver printed afterwards

  ```
  run 1  exit 0  156s  files 181  tests 3320  motion-budget 21  skipped none
  run 2  exit 0  128s  files 181  tests 3320  motion-budget 21  skipped none
  run 3  exit 0  118s  files 181  tests 3320  motion-budget 21  skipped none
  run 4  exit 0  120s  files 181  tests 3320  motion-budget 21  skipped none
  run 5  exit 0  130s  files 181  tests 3320  motion-budget 21  skipped none
  run 6  exit 0  119s  files 181  tests 3320  motion-budget 21  skipped none
  ```

  Six of six, `181 / 3320 / 21` identical, 0 skipped, spread 38 s. Then the driver printed the command to
  run next - and that is the moment the defects surfaced, because **the printed command was a path that
  does not exist**:

  ```
  --frontend "C:\...\spotivibe\openspec\frontend"     <- three parents, lands on openspec/
  ```

  ### D1 - the driver walked up three levels and printed a nonexistent path

  `$PSScriptRoot` is `<repo>/openspec/changes/<change>/evidence`, so reaching the repository root takes
  **four** `Split-Path -Parent` calls. Three land on `<repo>/openspec`. The value is only used in the final
  `Write-Host`, so nothing failed - it printed a wrong command.

  Repaired, and **asserted rather than assumed**: the script now checks for `frontend\package.json`
  beneath the computed root and refuses to continue without it. A comment saying "four" is not a check
  that there are four, especially in a file whose only prior defect was the number four.

  **Witnessed by making it fire** - the script was copied to a shallower directory and run:

  ```
  FAIL the computed repository root is not a repository root: C:\Users\Edison\AppData\Local
       (expected <root>\frontend\package.json beneath it, from evidence dir ...\shallow-probe\evidence)
  exit: 1
  ```

  ### D2 - and this one is worse: **the checker reported agreement while its independent phase had not
  run**

  Following the printed instruction produced:

  ```
  n/a   independent enumeration: `vitest list` produced no ids (exit null, 0 ids).
        Reported as UNAVAILABLE, not as agreement.

  corroborated: every asserted figure was found in all 6 logs, they all agree, and no log is UTF-16
  or lossy
  exit: 0
  ```

  The first three lines are careful and the fourth is not. `vitest list` could not run at all - there is
  no `node_modules` under `openspec/frontend` - and the checker **printed the word "corroborated"** and
  **exited 0**.

  This is this change's own defect class - *a check that reports green without checking what it claims* -
  committed by the very script committed to repair an instance of it. And it is worse than a stale
  number, because **it is invisible to every consumer that reads only the exit status**, which is what CI
  does and what every batch entry in this file has been doing. The whole reason W2 was repaired was so
  that a reader would not have to take the word of the tool that produced the logs; the repaired tool
  would have said "corroborated" to a reader who had pointed it at the wrong directory.

  **This is not the checker's recorded defect 2**, which is adjacent and is not the same bug. That one
  *skipped* a working phase behind a summary line `vitest list` never emits. This one *ran* the phase, the
  phase failed, and the failure was absorbed. **Skipping a check and swallowing a failure produce the same
  symptom, and conflating them would have left this one in place.**

  Repaired so that an unavailable enumeration is a **problem**, not a note, with the reason it exists and
  how to fix it - because `npm run gate` is driven from the repository root while `vitest list` runs with
  `cwd = --frontend`, and those are deliberately different directories. A missing log total is now a
  problem too: with no total there is no number, so `enumerated <= executed` cannot be established at all.

  ### Both repairs, measured in both directions

  The negative case is the one that matters, because it is the case that used to pass:

  ```
  wrong --frontend : FAIL independent enumeration: `vitest list` produced no ids (exit null, 0 ids).
                    1 problem(s) unresolved
                    exit: 1                                        <- was: corroborated, exit 0

  correct --frontend : corroborated: every asserted figure was found in all 6 logs, they all agree,
                    and no log is UTF-16 or lossy
                    exit: 0
                    enumeration: 2995 templates vs 3320 executed (gap 325)
  ```

  The `2995` is itself worth noting: batch 10 enumerated `2991` against `3316` executed, and the four
  witnesses added since account for the difference exactly in both directions.

  ### What this says about a script's first use

  **The eleventh batch entry's `git grep` check proved the scripts were in the repository. It did not prove
  they worked.** A file's existence is the cheapest possible check, and it is the one most likely to be
  reported as though it were the substantive one - `git grep -l gateruns` returning the two filenames reads
  exactly like a passing verification and is not one.

  The only thing that found D1 and D2 was **running the shipped script the way a reader would**, i.e.
  copying the command it printed and pasting it. A script that has never been invoked by anyone but its
  author is untested code wearing the costume of evidence, and the costume is what makes it dangerous.

  **The remaining open items are unchanged and still open:** the unreproduced `2 failed | 3314 passed`
  run (cause **unverified**), no browser verification, CI not observed green on this branch, and the
  round-9 question about whether refusing loudly at module scope is the right trade for three reader
  ambiguities rather than one.

## 8.25 The corroborator's third defect - found by attacking it rather than by using it

  8.24 fixed two defects in the two scripts this change had just shipped, both found by pasting the
  command the driver prints. That is a *use* test, and it is bounded: it can only find what the happy path
  touches. So the next question is what the checker **absorbs** - every phase, given a deliberately broken
  input, asked whether it reports a problem or prints a verdict word anyway.

  Five cases against copies of the batch-11 logs. Four were already caught; **one was not**:

  ```
  control (6 untouched logs)                    exit 0  corroborated          <- the pass that must stay
  one log removed (5 present)                   exit 1  FAIL only 5 of 6 logs were present
  --runs 9 against 6 logs                       exit 1  FAIL only 6 of 9 logs were present
  --runs 2 against 6 logs                       exit 0  corroborated: ... all 2 logs   <- THE DEFECT
  one log's 'Test Files' marker damaged         exit 1  FAIL Test Files across the logs: 181,
  one log reports 3319 tests instead of 3320     exit 1  FAIL Tests across the logs: 3320, 3319
  ```

  ### D3 - the checker was loud about missing evidence and silent about unexamined evidence

  The loop reads `run1.log` .. `runN.log` and **never enumerates the directory**. So a caller passing
  `--runs 2` against six logs had `run3.log` .. `run6.log` silently ignored, and the closing line read:

  ```
  corroborated: every asserted figure was found in all 2 logs, they all agree, and no log is UTF-16...
  ```

  Asserting *more* runs than exist was caught. Asserting *fewer* was not. **The asymmetry is the defect**, and
  the word "all" is what makes it one: it is a claim about the batch, printed over a subset of it. Four logs
  of real evidence went unread and the tool said the batch agreed.

  This is 8.24's general form one level down - *a report that mixes what was checked with what was skipped
  must not print one word of verdict over both* - with the skipped part being four logs the caller plainly
  meant to include.

  Repaired: the directory is enumerated and must contain exactly the logs the caller named. **Excess logs
  are reported as *unexamined*, distinctly from *absent*,** because they fail differently and a reader who
  conflated the two would be told to go and run a batch that has already been run:

  ```
  FAIL 4 log(s) in ... were NOT examined, because --runs is 2: run3.log, run4.log, run5.log, run6.log
        These are not missing logs; they are logs nobody read, and a verdict over a subset is not a
        verdict over the batch. Pass --runs 6 to examine them, or --runs 6 to assert this batch.
  exit: 1
  ```

  Re-measured, all five caught and the control unchanged:

  ```
  control (6 untouched logs)                    exit 0  corroborated
  one log removed                               exit 1  FAIL only 5 of 6 logs were present
  --runs 9 against 6 logs                       exit 1  FAIL only 6 of 9 logs were present
  --runs 2 against 6 logs                       exit 1  FAIL 4 log(s) ... were NOT examined
  one log's 'Test Files' marker damaged         exit 1  FAIL Test Files across the logs: 181,
  one log reports 3319 tests instead of 3320     exit 1  FAIL Tests across the logs: 3320, 3319
  ```

  **The control is the part that matters.** Three of the five broken cases were already caught before this
  repair, so "the fix works" is only half the claim; the other half is that the fix did not make the honest
  case fail. A repair that closes a hole by tightening the tool until it refuses everything is the same
  defect wearing the opposite sign, and only the control distinguishes it.

  ### The criterion batch, and why its figures are in the PR body rather than here

  Six consecutive green full gate runs at `6f24e8a`: `181 files / 3320 tests / motion-budget 21`, 0 skipped,
  exit 0 on all six, spread 20 s (129 / 126 / 114 / 126 / 131 / 134). Corroborated by the checker above,
  which reported agreement with enumeration `2995 <= 3320`.

  **These figures are deliberately not written here.** `tasks.md` and `MEMORY.md` are both gate inputs, so
  any commit recording a batch's results invalidates the batch it describes - and recording batch 12 would
  oblige a batch 13, and so on without end. That regress is lesson 73, and its recorded resolution is that
  the final batch is run at the final documentation commit and its evidence lives outside the tree. So this
  entry records the *defect and its repair*, the entry above records batch 11, and the criterion batch's
  numbers are in PR #100 - which is mutable, not in the repository, and therefore costs no gate run.

  If a reviewer wants the criterion's evidence to be checkable from the repository, the honest fix is to
  commit the six logs as artifacts under this change's `evidence/`, which is a scope decision this change
  does not make for itself. It is raised in the round-11 brief as a judgement call rather than settled here.

## 8.26 Batch 12 at `6f24e8a`, and how far a *use* test reaches

  ### The criterion

  ```
  run 1  exit 0  129s  files 181  tests 3320  motion-budget 21  skipped none
  run 2  exit 0  126s  files 181  tests 3320  motion-budget 21  skipped none
  run 3  exit 0  114s  files 181  tests 3320  motion-budget 21  skipped none
  run 4  exit 0  126s  files 181  tests 3320  motion-budget 21  skipped none
  run 5  exit 0  131s  files 181  tests 3320  motion-budget 21  skipped none
  run 6  exit 0  134s  files 181  tests 3320  motion-budget 21  skipped none
  ```

  Six of six, `181 / 3320 / 21` identical, 0 skipped, spread 20 s. Corroborated by the shipped checker,
  which reported agreement and an enumeration of `2995 <= 3320`.

  **Why this is the criterion batch and not batch 11's.** This entry and the memory lesson beside it both
  change gate inputs, so the batch that satisfies the criterion is measured at the commit that *follows*
  them - and recording *this* batch would oblige a batch 13. The regress is real and unbounded, so it is
  resolved rather than iterated: **the final batch is run at the final documentation commit and its figures
  are reported in PR #100**, which is not in the tree and therefore costs no gate run. Batch 12's figures are
  in the section above; they are not restated here, because restating them is the regress.

  ### A use test finds defects a review cannot, and then stops

  Round 10 found D1 and D2 in the two shipped evidence scripts by pasting the command the driver prints - a
  **use** test, and it worked immediately. But a use test is bounded by the happy path: it can only reach
  what a correct invocation touches. `run-gate-batch.ps1` printed a correct command, the checker ran, and
  both defects were visible - **D3 was not**, and D3 was found only by *attacking* it.

  The distinction is worth keeping because the two answer different questions:

  ```
  USE      "run it the way its reader will"        ->  does the happy path work at all?
  ATTACK   "give each phase a broken input"       ->  what does it absorb?

  ```

  Five broken inputs against the shipped checker; four were caught, and the fifth (`--runs 2` against six
  logs, which silently ignored four and then printed `corroborated: ... all 2 logs`) was the defect. The
  repaired checker now enumerates the directory and requires exactly the logs the caller named, reporting
  excess as *unexamined* rather than *absent* - different failures, because absent logs are missing evidence
  and excess logs are evidence nobody read, and a reader who conflated them would be sent to run a batch
  that has already been run.

  **The control is load-bearing in that measurement and is easy to leave out.** Three of the five cases were
  already caught before the repair, so the fix is only half the claim; the other half is that it did not make
  the honest case fail. A repair that closes a hole by tightening a tool until it refuses everything is the
  same defect with the sign flipped, and only an unmodified control distinguishes the two.

  ### Unchanged, and still open

  - The unreproduced `2 failed | 3314 passed (3316)` run from round 10. **Cause unverified**; six further
    green runs raise confidence in the tree but do not identify the cause, and no log exists to identify it
    from. It is not closed by this batch.
  - No browser verification of any kind. CI unobserved green on this branch. Root `scripts/`, both archived
    `release-gate.mjs` copies, and now these two evidence scripts all sit outside every gate - the evidence
    scripts' case is the sharpest, since their entire purpose is to be run by a reader.
  - Round 9's open question, now larger: `readSteps` throws at module scope for three ambiguities rather than
    one, so any of them takes down a whole suite file and 180 others stop reporting with it.

## 8.27 Round 11 - the eleventh independent pass, and what it found inside round 10's repair

  **Verdict: REJECT.** 2 CRITICAL, 6 WARNING, 4 NIT. (The report's own summary line said *five* WARNING
  and its list ran W1 through W6. The list is what is repaired and what is recorded; the discrepancy in
  the summary is left visible rather than smoothed, because a verdict whose own arithmetic disagrees with
  its own contents is worth a reader knowing about.)

  Both CRITICALs were **confirmed here before any repair**, at 71/71 targeted with the gate's cascade
  dead, from a byte copy taken with `git hash-object` before the first mutation:

  - **C1 - the wiring comparison compared identifier *spellings*.** It read the producer's bound name off
    `call.parent` and the consumer's argument text and asserted the two strings were equal. Two different
    declarations spelled alike satisfy that. **One inserted line** into the cascade arm -
    `const prepared = { ok: true, detail: "installed" };` - makes the consumer read a nearer declaration.
  - **C2 - `soleLoopOver`'s *derived* clause was a substring test on the iterand's text.** An alias defeats
    it: `const ORDERED = ITEMS.filter(...)` plus a vestigial bare-`ITEMS` loop satisfies every locator,
    including `expression === "ITEMS"` and a body containing `item.how`. **This is round 10's CRITICAL C2
    verbatim**, which the record says was measured at 3312/3312 green.

  Both are round 10's own defect class reproduced inside round 10's repair. Round 11's contribution was not
  the findings - it was the explanation of how they survived a fully witnessed locator:

  > every one of round 10's eight locator witnesses was derived from a **synthetic fixture**, a hand-written
  > array of strings, and every mutation either substituted one line or appended a **new top-level
  > declaration**. Not one inserted a declaration into an existing scope between the producer and the
  > consumer. The witnesses were complete relative to the locator's vocabulary and blind outside it.

  So the witness set had a **wrong universe**, not a gap - and no number of additional synthetic fixtures
  would have found it. Every new witness below is aimed at the **real** archived `release-gate.mjs`.

  ### The repairs

  - **C1**: the comparison is now between **declarations** (`declarationFor`, resolving outward through the
    scope chain), not between strings. A shadowing declaration is a different declaration.
  - **C2 + W1 + S1-S5, one question each**:
    - `dispatchOnHow` - the loop must contain a dispatch comparing a field of its **own loop variable**
      against the item's **declared** `how` (`declaredHow` reads the declaration rather than a literal
      typed beside the assertion, so the two cannot drift apart silently). Catches the alias, the decoy
      loop, and the renamed condition.
    - `reachableComplementArm` - the cascade must sit in the **reachable complement** of a plain
      `<produced>.ok` test, and a conditional in the complement position is refused by name. This is the
      survivor round 11 named against the C1 repair: `} else if (false) {` leaves every binding, dispatch
      and loop correct and only makes the arm unreachable, which is round 10's C1 in new clothing.

  ### Measured, against the real gate, with controls

  ```
  baseline (gate unmodified)                     expected-green  71 passed (71)
  M2 shadow producer inside the cascade arm      RED   1 failed | 70 passed     <- C1
  M6 aliased filtered array + decoy loop         RED   1 failed | 70 passed     <- C2
  M3 dispatch literal renamed to "bootstrap"      RED   1 failed | 70 passed     <- W1
  M7 inline filtered iterand (round 10's C2)     RED   1 failed | 70 passed
  M8 the only dispatch compares "command"         RED   1 failed | 70 passed
  S1 `} else if (false) {`                       RED   1 failed | 70 passed     <- named survivor
  S2 `if (item.how === "install" && false)`      RED   2 failed | 69 passed     <- named survivor
  S3 two-step alias through LIST                 RED   2 failed | 69 passed     <- named survivor
  S4 decoy loop kept, body moved to an alias     RED   2 failed | 69 passed     <- named survivor
  S5 `&& !SKIP`, SKIP = false                    RED   2 failed | 69 passed     <- see below
  C1 control: consistent rename prepared->outcome  expected-green  71 passed (71)
  C2 control: needles only, no semantic change     expected-green  71 passed (71)
  ```

  **S5 was predicted to survive, and did not.** The row was written down as `STILL GREEN` before it was
  run, on the reasoning that only a value had changed. It dies for S2's reason: `dispatchOnHow` requires
  the arm's condition to *be* the `===` comparison, and a `&&` is not that comparison. So the limit is
  narrower than predicted - the suite cannot evaluate a boolean, but it can refuse a condition it cannot
  read as the declared dispatch. **Recorded because a predicted survivor that dies is evidence about the
  repair; a predicted survivor quietly deleted from the plan would have been neither.**

  **The two controls are the load-bearing half.** `declarationFor` makes "two different declarations" the
  failure condition, and a consistent rename is the mutation that most resembles a maintainer's actual
  edit. Had it gone red, the repair would have been refusing valid wiring - the same category of error as
  reporting a `run:` the reader never saw.

  ### Two measurements this round voided itself, and the control that caught both

  Both of the first two runs of the survivor probe reported **rows behaving as designed** while the whole
  measurement was worthless:

  ```
  run 1  baseline exit 1, no summary line   -> two template literals closed early; the file did not parse
  run 2  baseline exit 1, Tests 1 failed | 70 passed (71)
         -> `IfStatement.statement` does not exist; it is `thenStatement`. tsc: TS2339.
  ```

  In both cases the **baseline was red**, and a red baseline voids every other row. That is the whole
  reason the taxonomy keeps `RED BUT DID NOT RUN` and `RED, FILE COULD NOT LOAD` as distinct classes
  rather than collapsing them into "failed": a row can be red for a reason that has nothing to do with
  the check, and only an unmodified control distinguishes the two. Two rounds of green rows would
  otherwise have been recorded as five named survivors killed.

  A third row was wrong for a fourth reason: the W6 witness removed the word `(itself a` and **left the
  disclaimer standing on the next line**, so it tested nothing and reported the new gate as broken. A
  mutation that does not remove what it claims to remove verifies nothing, whatever colour it returns.

  ### W2, W3, W4, N1, N3 - the checker this change had itself shipped

  All four were reproduced against the repaired checker, in copies, with two controls:

  ```
  C1 the six untouched logs as the new driver writes them   expected-green  corroborated, exit 0
  C2 the same logs verbatim, with no `gate exit` line        FAIL  6 problems, exit 1
  B12 --frontend is a tree holding ONE test                  FAIL  1 / 3320 = 0.000, floor 0.8, exit 1
  B13 all six logs inflated to `Tests 999999`                FAIL  2997 / 999999 = 0.003, exit 1
  B14 run1 copied over run2..run6                            FAIL  1 distinct digest of 6, exit 1
  B16 green figures with a trailing red summary              FAIL  a second verdict in one log, exit 1
  ```

  **W2 and W4 are one finding wearing two hats: the second mechanism was bounded and never anchored.** It
  enforced `listedIds <= logTotal`, which detects an understated log total, is blind to an overstated one,
  and is satisfied just as well by a tree holding a single test. A figure three thousand times off, and a
  gap of 997 004, were both printed by the script on the line above the verdict word.

  **The first repair was wrong and was measured to be wrong.** It asserted `listedIds === 2995`. With
  **zero tests added** - `git diff` finds no new `it(` or `test(` - enumeration moved 2995 -> 2997 across
  the same 181 files, and the two extra entries are

  ```
  tests/release-gate-install.test.ts > node
  tests/release-gate-install.test.ts > lineOf
  ```

  top-level entries with no suite segment, named after local identifiers in the edited file. The suite was
  then run to settle it: `Tests  1 failed | 3319 passed (3320)` - the executed total is unchanged, so
  **they are not tests and `vitest list` emitted two non-test lines.** *Why it does that is* **unverified**;
  the mechanism was not established and a guess with a number attached would be worse than saying so.

  What that settles is enough to reject the constant: an anchor that moves when nothing was added is a
  value nobody can maintain, and maintaining it means editing 2995 to 2997 until it agrees - which is this
  checker's own recorded defect 3 reached by a different road. So the anchor is the **ratio** of
  enumerated to executed, a property of the suite rather than of the enumerator's line discipline, with a
  floor of 0.8 against an honest 0.90.

  **W3**: the criterion is six consecutive *green* runs and the exit status had **no artefact anywhere**.
  The driver's `$exitCode` went to the console; the log received the gate's stdout and nothing else. It
  now writes `gate exit <code>` as a leading line and the checker **refuses** a log without one. C2 above
  is the row that shows refusing is a requirement and not a way of refusing everything: the only
  difference between C1 and C2 is one line the shipped driver now writes.

  **N3**: six byte-identical logs were corroborated as six runs. Agreement between copies is one run
  counted six times, and copying is the cheapest available way to make a stability criterion vacuous.
  Distinctness is now asserted on a per-log digest.

  **N1**: the driver printed a checker command with no `--runs`, so the printed interface was correct only
  for `-Runs 6`. Loud rather than silent, hence a NIT - but an interface that is right only for the default
  is not an interface.

  ### W5 and W6 - two false claims in this change's own records

  **W5** sat *inside* the sentence round 10 wrote to correct a different false claim: it said the batch
  checker "already recorded" the exit status and the executed-test count. Measured: it recorded neither.
  Both of B16 and B13 reached `corroborated` and exit 0. The conclusion was true on grounds the sentence
  did not give - a genuinely red run's only `Test Files` line reads `1 failed | 180 passed (181)`, which
  does not match the green pattern - and the grounds it *did* name were about a file that ships.

  **W6** was a *correction* that asserted a fact about the file which the file did not bear out: the
  eleventh entry claims all eleven earlier entries "now read as" pointing at the shipped checker, while
  three still named `verify-gaterunsN.mjs` and three more said "by separate code" with no pointer. The
  correction sat 600 lines *after* the entries it corrected, which is the wrong direction for a reader
  going forward. Seven entries are amended in place, each naming the shipped checker and stating that the
  logs are not in the repository.

  **And both are now closed by a gate rather than by an amendment**, because a correction one edit away
  from the hole it closed is not a correction. `frontend/tests/evidence-scripts.test.ts` asserts that
  both evidence files exist, that the checker parses (`node --check`), that the driver writes the exit
  status the checker requires *and* that the checker refuses its absence, that neither script hard-codes a
  machine path, that the printed command carries `--runs`, and that every mention in `tasks.md` of a
  temp-only checker carries its disclaimer nearby - with a population assertion first, so the rule cannot
  pass vacuously. Five mutations, each RED, and an unmodified control, green:

  ```
  driver stops writing `gate exit`            RED  1 failed | 5 passed (6)
  checker stops requiring it                  RED  1 failed | 5 passed (6)
  driver's printed command loses --runs       RED  1 failed | 5 passed (6)
  checker stops asserting distinct logs       RED  1 failed | 5 passed (6)
  tasks.md regains a bare mention             RED  1 failed | 5 passed (6)
  control, nothing broken                     expected-green  6 passed (6)
  ```

  This closes **N4**, which the verifier graded *not acceptable as it stands*: these two files are the
  only artefacts in this change a reader is asked to execute, they sit outside `frontend/` and so outside
  prettier, eslint, tsc and vitest, and round 10 found two defects in them after shipping and round 11
  found five more. None of the seven would have been caught by the gate. The defence that they had been
  corrected several times was an argument for a gate, not against one.

  **N2** is closed as a side effect of C1's repair and by dropping the unused parameter: the locator's
  signature advertised file-awareness it did not have, which is part of why the name-versus-binding
  confusion behind C1 was easy to miss at the call site.

  ### A second red gate run, this one with a log

  ```
  Test Files  1 failed | 180 passed (181)
       Tests  1 failed | 3319 passed (3320)
  FAIL  tests/encoding-integrity.test.ts > every text file is clean UTF-8 > no file carries a UTF-8 BOM
  Error: Test timed out in 20000ms.        (actual 28320ms)
  ```

  Round 10 had one unreproduced red run whose failing test names were never captured. **This is a second,
  and unlike the first it was written to disk before it was understood.** It is a *timeout*, not an
  encoding fault: the check reads every file in the tree and took 28.3 s against a 20 s limit, on a run
  where the environment was reported at 38% and 181 workers were spawned. **Cause unverified** - load is a
  candidate and a growing tree is a candidate and I have not separated them. It is not closed by any green
  batch, and it is the second item on this list a reviewer should press on.

  ### Open, unchanged

  - No browser verification of any kind. CI unobserved green on this branch. The unreproduced-and-now-
    twice-observed red gate run. Both are recorded rather than resolved.
  - Root `scripts/` and both archived `release-gate.mjs` copies remain outside every gate; the evidence
    scripts no longer are.
  - Round 9's question is now larger: `readSteps` throws at module scope for three ambiguities, so any of
    them takes down a whole suite file and 180 others stop reporting with it.

## 8.28 Round 12 — the twelfth pass, and the first round to say *stop climbing this ladder*

  **Verdict: REJECT. 4 CRITICAL, 7 WARNING, 4 NIT.** Round 11's own summary line was corrected above;
  this round's list is W1-W7 plus N1-N4 and it is the list that is worked here.

  **CRITICAL 3 is the one that matters, and it was mine.** Round 11 shipped
  `frontend/tests/evidence-scripts.test.ts` as four assertions on literal substrings of the checker and
  driver's own diagnostic messages. Round 12 disabled the *enforcement* and left the *message* standing:

  ```
  verify-gate-batch.mjs:274   if (!allDistinct) {  ->  if (false && !allDistinct) {
  ```

  and the gate stayed green at 6/6 while the checker printed, on consecutive lines,

  ```
  FAIL log digests across the logs: 1 distinct of 6
  corroborated: all 6 logs are distinct runs, each green, and every asserted figure was found in all of them
  exit: 0
  ```

  **Confirmed here independently before any repair**, and the confirming measurement is worse than the
  report's: the gate is green when the checker is **correct** too. R7a — the checker *as shipped*,
  against six byte-identical logs — correctly refuses (exit 1, no `corroborated`), and the gate reports
  6/6. A test that greps a file for strings it wrote has no opinion about behaviour in either direction.

  That is this checker's own recorded **defect 6** — *a phase that cannot run was counted as a pass, and
  the word `corroborated` was printed under it* — reintroduced by the repair written for it, in this
  change, in round 11. And it is the same defect class `code()` was written to kill two files over: a
  needle satisfied by prose. The second instance, R6, was the driver stopping its exit-status write with
  the needle left standing in a comment — **STILL GREEN**.

  ### The repair: make something execute

  The gate now **runs the checker**, seven times, over synthetic logs in a temp directory, with a stub
  frontend whose `node_modules/vitest/vitest.mjs` emits a chosen number of enumerated ids. No package is
  installed, which is why it can run on a machine that has never run an install. Each negative case is
  its own proof the checker can fail — there is nothing to mutate, because the assertion *is* the
  mutation:

  ```
  control: six green, distinct logs                    corroborated, exit 0
  six byte-identical logs                              refused,    exit 1
  a log with no `gate exit` line                       refused,    exit 1
  a log whose gate exited non-zero                     refused,    exit 1
  a log carrying a second, failing verdict              refused,    exit 1
  --frontend holding ONE test                          refused,    exit 1
  all six logs inflated to `Tests 999999 passed`       refused,    exit 1
  ```

  Measured in both directions against round 12's own attacks:

  ```
  R7b  checker: distinctness enforcement unreachable     RED   1 failed | 13 passed (14)
  R6   driver: exit-status write commented out          RED   1 failed | 13 passed (14)
  C1   control, nothing broken                          expected-green  85 passed (85)
  ```

  Also closed by the rewrite, each with a measured row: **W2** (the path filter was four Windows shapes;
  `/home/runner/...` in the driver was STILL GREEN, and CI is `ubuntu-latest`), **W3** (the
  `tasks.md` pattern required `.mjs`, so `verify-gateruns9` left the population entirely), **W4** (the
  ±3-line window is proximity, not reference — a disclaimer on the *neighbouring* entry satisfied it),
  **W5** (the driver now gets a real assertion: the exit status must be written *by the `WriteAllText`
  call*, taken from comment-stripped executable text), and **N3** (`.find` no longer reads a comment).
  The `tasks.md` rule's unit is now the **entry** — a blank-line-delimited paragraph — so a mention
  requires that same entry to say the script is not in the repository. R11 (disclaimer five lines out) is
  still correctly RED: measured, ±3 was not too narrow, the *pattern* was.

  **CRITICAL 4 — four untrue claims in the two shipped executables, all corrected in place.**

  - **4a** the header said the flags *default to 181 and 21* while the code read `?? "182"`. Commit
    `ed6f9f6` raised the default and left the sentence, and nothing compared them. `evidence-scripts.test.ts`
    now reads both out of the checker and compares them, so a documentation edit cannot drift again.
  - **4b** the same comment claimed the flags are *optional on purpose — the honest move is for the
    caller to say what it expects, not for this script to guess*, while the script guessed (`?? "182"`)
    and then asserted its own guess. A stated philosophy contradicted two lines below it is worse than no
    philosophy, because a reader deciding whether to trust the script reasons from it. Rewritten to say
    what is true: a default is a guess made once on the caller's behalf and then asserted.
  - **4c** **this correction withdraws a causal claim I recorded as measured one round ago.** I wrote
    that the two phantom `vitest list` entries were *"named after local identifiers in the edited file"*.
    Round 12 refuted that by measurement: renaming the `lineOf` const *and* its `node` parameter, in
    `declarationFor`, then `declaredHow`, then `reachableComplementArm`, one per run, left the phantom
    names unmoved; three further probes each left the count unchanged. **The names are invariant to the
    identifiers they were alleged to be named after.** A coincidence recorded as a cause is the exact
    failure this change exists to remove, and I committed it here in round 11 while writing lesson 78
    about not doing that.
  - **N1/N2** `1 failed | 180 passed (181)` was stale at 182 files, now `N-1 passed (N)`; and the claim
    that a red run has *exactly one* `Tests … passed` match is **zero**, measured — the red line reads
    `Tests  1 failed | …` and the passed-anchored pattern does not match it. Round 12 forced a real
    failure and confirmed the surrounding claim: `files`, `tests`, `budget` and `skipped` all null,
    `exitCode` `"1"`, failing-summary matched — so a red run is caught by **three** mechanisms, not one.

  **W1 — the 0.8 ratio floor is defensible; two claims attached to it were not.** The accepted window
  for the executed total is `[listedIds, listedIds/0.8]`, so an **overstated** total of up to **+12.8%** is
  accepted as `corroborated`; measured boundary 3753 passes, 3754 fails. That is two orders of magnitude
  better than the 999999 hole it replaced, and the floor is derived from a property rather than fitted to
  a number, so it is kept. But the comment's *"far enough below 0.90 that ordinary growth in `.each(`
  expansion cannot cross it"* was **unmeasured**, and the real headroom is 11.4%, not *far*. Withdrawn.
  Also measured and now fixed: at the boundary the printed figure and the verdict disagree
  (`= 0.800, floor 0.8` on a `FAIL` line) — `toFixed(3)` rounding against `>=`.

  **W6 — a refusal that misstates what it saw.** `if (prepared["ok"])` is behaviour-preserving and was
  refused with *"nothing inside the dispatch tests `prepared.ok`"*. It does test `prepared.ok`; the
  locator could not read it. That refusal is a false green with the sign flipped and it is worse in one
  way: **a maintainer who trusts it concludes the code is wrong and rewrites working code to satisfy a
  shape**, rather than concluding the locator is blind and widening it. Element access is now accepted,
  and the zero-match message **names the conditions it actually observed** instead of asserting an
  absence. Measured: `prepared["ok"]` is now expected-green 71/71.

  ### CRITICAL 1 and CRITICAL 2 — measured, named, and NOT closed

  Both confirmed here, both with a parseable gate, both **STILL GREEN 71/71**:

  ```
  R13a  const SKIP_INSTALL = true; if (!SKIP_INSTALL) { <the whole install dispatch> }
        prepareDependencies never called, cascadeReason never called, environmentBroken never
        written, no later item short-circuited.  71 passed (71)
  R13b  if (item.id === "gates-install-retired") { <the whole install dispatch> }
        same, with no flag at all — a condition nothing can satisfy.      71 passed (71)
  G5    const prepared = prepareDependencies(...); prepared.ok = true;
        the value is discarded one line after it is produced, so the else arm never runs
        and the cascade cannot fire.                                       71 passed (71)
  ```

  (R13's first attempt opened the guard and never closed it, so `node --check` rejected the file and the
  row read `RED BUT DID NOT RUN` — a verdict withheld, not a verdict. Re-aimed with both braces.)

  **Why these are not repaired here, and why the next rung is not taken.** `declarationFor`,
  `dispatchOnHow` and `reachableComplementArm` are *syntactic* instruments: spans, shapes, names, literal
  comparisons. Every one of them can be defeated by an edit that changes what the code **does** without
  changing what it **says**, and there is no limit to the supply of those. Twelve rounds have each found
  the previous round's defect class reproduced inside the previous round's repair, and the pattern is
  legible: name -> span -> declaration -> dispatch -> complement. Each rung is real; none is the rung
  that would have covered the next finding, because the ladder was extended along the axis the last
  defect was on rather than the axis the next one would be on.

  The instrument that closes this class is **executing the gate** — or a taint/flow analysis, which is the
  same instrument with more machinery. Execution of the gate is **forbidden by a standing constraint on
  this work**: `npm ci`, `npm run setup` and both archived `release-gate.mjs` copies are never run here,
  and the gate's own first step is a dependency install. So the closing instrument is unavailable, and
  the alternative is a thirteenth rung.

  **This is therefore escalated rather than papered over.** It is a scope decision, not a repair:

  1. authorise an execution harness — run the gate with its install step stubbed, and assert on
     *observed behaviour* (`environmentBroken` set or not) rather than on syntax. This closes the class
     rather than one instance, and it is new scope for a change already at ~10 000 lines of diff;
  2. accept CRITICAL 1 and 2 as **named, measured, unclosed residuals** and stop adding shape
     assertions to this milestone;
  3. or retire the milestone's claim that this suite makes a false green impossible, and narrow the
     change to what it can actually deliver.

  Option 3 is the one this record most supports. Twelve rounds have produced a genuinely strong
  *syntactic* instrument — round 11's locators survived a shadow, a renamed dispatch, an aliased loop, a
  conditional complement, a deleted call, a wrong field name and a full rename, and round 12 could not beat
  any of them on their own terms. What it has not produced, and cannot by continuing, is a *semantic* one.
  A suite that keeps growing a meta-layer per round acquires a meta-layer that must itself be verified:
  three of this round's eight CRITICAL/WARNING rows are defects in the verification apparatus rather than
  in the code it verifies. The meta-layer is now growing faster than the thing it verifies.

  ### Also measured, and recorded rather than repaired

  - **W7 — `readSteps` is loud, but not for the reason assumed.** The premise that 180 other files stop
    reporting is **refuted**: 181 of 182 reported normally, the failure was named, exit non-zero. The real
    and smaller cost is that `ci-workflow.test.ts`'s tests **silently vanish** (`Tests 3326` -> `3301`)
    while `Test Files` still reads `182`, so the two figures disagree and nothing says they must.
  - **Q6, settled by measurement: the captured timeout is not tree size.** `encoding-integrity.test.ts`
    isolated runs 2.3 s / 2.1 s, file reported 471 ms; full suite, file reported 1639 ms; suite 67.28 s.
    Tree size explains 471 ms -> 1639 ms, a 3.5x contention factor. The recorded failure was **one test at
    28320 ms** — ~17x the entire file's loaded runtime and ~12x its own timeout. Nothing about this tree's
    size produces a 17x stall, and it did not reproduce in three isolated runs or one full run. Whether
    it was machine load, antivirus or a transient stall is **unverified**.
  - **Q5, verified against a real red log** — see N1/N2 above. The claim survives; two figures in its
    supporting sentence did not.
  - **Q3 — why `vitest list` emits `> node` and `> lineOf` remains unverified.** Deterministic 6/6,
    on stdout not stderr, invariant to the identifiers.
    > **BOTH FIGURES ABOVE WERE CORRECTED AFTER THIS ENTRY WAS WRITTEN, and are kept only because this is
    > a historical record.** It read *"localised to one file (73 lines for 71 tests)"*. Measured per file
    > across the whole suite: **two** files have a positive delta, `release-gate-install.test.ts` listed 74 /
    > executed 71 (+3) and `lyrics-induced-violations.test.ts` listed 18 / executed 17 (+1), summing to 4 -
    > so "localised to one file" is false and 73 is itself stale. Round 14 corrected the count in the
    > checker and 8.33's narrative; **round 16's NIT 2 found this second site, far earlier in the
    > same file, where the correction never landed.** See `evidence/verify-gate-batch.mjs` for the
    > current figures. Annotated rather than rewritten, because a superseded entry is evidence of what was
    > believed and when, and quietly editing it destroys that. **This is round 14's NIT 1 - *a correction
    > that can be summarised away from its own site has not been made* - arriving at the same figure in a
    > third place, which is the measure of how hard it is to catch every copy of a number.**
    > > **Round 17's WARNING 2: the annotation above carried its own unverified figure, and it is gone.** It
    > > read *"210 lines earlier"*. Round 17 measured every distance between the four sites of this figure
    > > in this file — 718, 714, 455 — and **210 matches none of them.** So the annotation written to close
    > > a stale-figure finding contained a stale line-number figure, in a change whose ROADMAP names
    > > *"numbers written down rather than counted"* as the defect family of this very milestone. There was
    > > no reason to put a distance in at all: "this second site, far earlier in the same file" says
    > > everything true and nothing unverifiable. **A number is not a claim because it is precise, and the
    > > temptation to add one to an annotation is the same reflex that produced the original error.**
    A `formatName` helper that accepts a function and reads `.name` is consistent with the symptom without
    explaining why these two arrows and not the three probes; a `@jridgewell/trace-mapping` lead was a
    substring hit on `lineOffset`. Both recorded so nobody repeats them; neither offered as the answer.

  ### Open, unchanged

  - **CRITICAL 1 and CRITICAL 2**, above: measured, named, unclosed, escalated.
  - Two red gate runs, one unexplained; the second's cause is now *not* tree size, by measurement.
  - No browser verification of any kind. CI unobserved green on this branch.
  - Root `scripts/` and both archived `release-gate.mjs` copies remain outside every gate; the two
    evidence scripts no longer are.

  ### Resolution — option 3, decided by the owner

  The three options above were put to the repository owner rather than chosen here, because each one
  trades a different thing away and the trade is not mine to make. **Option 3 was taken: retire the
  claim that this suite makes a false green impossible, and narrow the change to what it can deliver.**

  Applied, in this commit:

  - `proposal.md`'s headline, which read "**The gate stops being able to lie**", is corrected in place to
    "stops being able to lie about the state of the tree", with the two measured counter-examples quoted
    beside it. The old sentence was not a rounding of the truth; it was false, and it was the first line
    a reader of this change would meet.
  - `proposal.md`'s "**The checks that cannot fail, stop not being able to**" is qualified: true of the
    checks named in it, not of checks as a category.
  - `proposal.md`'s `verification-integrity` capability description said the checks are required to be
    **provable**. They are **witnessed**. That distinction is the entire content of this round.
  - `design.md` §2.11 added: the decision, both escape routes, why execution is the only instrument that
    closes the class, why execution is unavailable here, and why a thirteenth syntactic predicate was
    rejected on the measured evidence rather than on taste.
  - `tests/release-gate-install.test.ts`'s header gained **"What this file cannot see — read this before
    adding a clause"**, carrying both mutations and the reason no further clause is being added. The
    header previously said why the file existed and why its fixtures are hand-written, and said nothing
    about its limits; a 71-test file with no stated blind spot reads as a proof.

  **Not done, and not to be done without a new decision:** an execution harness, a thirteenth syntactic
  predicate, or any widening of `release-gate-install.test.ts`'s reach. Each is a way of re-opening the
  question this resolution closed.

  **What "accepted residual" means precisely, so it is not softened later.** The gate's install cascade
  can be made dead code by two edits, both one line, both leaving 71/71 green: a guard wrapped around the
  install dispatch, or discarding the install's result before the `.ok` test. This is a known,
  reproducible false green in the repository's own verification machinery. It is accepted, not fixed and
  not forgotten, and it is not covered by this change's acceptance criterion — which is worded to say so.

## 8.29 Batch 15 - the criterion is NOT met, and the run that broke it had a cause that is now established

  **Five of six green. `design.md` 2.10's criterion is six consecutive green full gate runs, so it is
  not satisfied at `0e65dc8`.** Batch 14 satisfied it at `ed6f9f6`; between those two commits this
  branch changed one test file's header comment, one test's assertions, one evidence script's comments,
  and four documents. Nothing in that list can plausibly cause what failed, and the measurement below
  says so rather than assuming it.

  ```
  run 1  exit 0  149s  files 182  tests 3334  motion-budget 21
  run 2  exit 1  135s  files 181  tests 3334  motion-budget 21   <-- FAILED
  run 3  exit 0  145s  files 182  tests 3334  motion-budget 21
  run 4  exit 0  189s  files 182  tests 3334  motion-budget 21
  run 5  exit 0  130s  files 182  tests 3334  motion-budget 21
  run 6  exit 0  127s  files 182  tests 3334  motion-budget 21
  ```

  **The failure, verbatim from `run2.log`:**

  ```
  FAIL  tests/lyrics/lyricsPanel.test.tsx > LyricsPanel - following yields to the listener
        > scrolls the active line into view while following
  AssertionError: expected [ ...(2) ] to deeply equal [ { top: 150, behavior: 'smooth' } ]

  - Expected  [ { behavior: 'smooth', top: 150 } ]
  + Received  [ { behavior: 'smooth', top: 150 }, { behavior: 'smooth', top: 150 } ]

  at tests/lyrics/lyricsPanel.test.tsx:406
  ```

  Note the shape. The assertion is `expect(scrollCalls.slice(before)).toEqual([...])` - an **exact
  count** of scroll calls issued after a marker index. The received array holds the *same* call twice,
  identical in both fields, which is not what a layout regression produces and not a wrong position.

  ### Reproduced, and load is the discriminator - measured, not assumed

  ```
  40 consecutive isolated runs of the single test               0 failed
  10 concurrent instances of the single test, 10-way parallel  2 failed, identical signature
  ```

  The concurrent run's own tally line was wrong on the first attempt - the regex matched `(N) failed`
  while vitest prints `1 failed | 6 passed`, so it read 0 over output that plainly carried the
  assertion. The figure above is the corrected count, taken from the output rather than the summary. A
  counter that reports zero failures over a captured failure is worse than no counter: it converts a
  caught bug into an uncaught one and reports success while doing it.

  So the condition is **contention, not isolation** - the same discriminator round 12 reached for the
  `encoding-integrity` timeout. Two findings, one shape: a test that is correct when the machine is idle
  and wrong when it is busy.

  ### M21 did not cause it — **as of `0e65dc8`**, the commit batch 15 ran at

  ```
  git log --oneline -3 -- frontend/tests/lyrics/lyricsPanel.test.tsx   -> 6e11917 (M19), 20d69a1, 214bd12
  git log --oneline -3 -- frontend/src/features/lyrics/LyricsPanel.tsx -> 20d69a1, 214bd12, 2cac646
  git diff --stat origin/main...HEAD -- <both files>                      -> empty
  ```

  **Neither file was touched by this branch at `0e65dc8`.** The defect was pre-existing from M16/M19 work,
  and the six-green criterion is what made it visible. That is the criterion working, not failing.

  **This statement was true when written and is now false, so it is timestamped rather than deleted.**
  `a0bf535` touched `lyricsPanel.test.tsx` — the *test*, never the panel. `LyricsPanel.tsx` remains
  untouched by this branch: `git diff --stat origin/main...HEAD -- frontend/src/features/lyrics/
  LyricsPanel.tsx` is empty, and `git diff --stat -- src/` is empty.

### Cause: ESTABLISHED by measurement, at `a0bf535`

  **This section replaces an earlier one in this same §8.29** which recorded the cause as *narrowed but not
  established*, listed four candidate dependencies, and declined to fix anything on that basis. That text is
  gone, so this is a replacement rather than an appendix, and it is wrong in one specific respect worth
  correcting plainly: **all four candidate dependencies are inert.** The
  effect fires exactly three times, with these values, and there are only ever two scrolls:

  ```
  effect#1  render#1  following=true  kind=loading  activeIndex=-1   early return
  effect#2  render#2  following=true  kind=timed    activeIndex=0    scrolled
  effect#3  render#3  following=true  kind=timed    activeIndex=2    scrolled
  ```

  The trace is **byte-identical whether the run passes or fails**. So `following` never changes,
  `state.kind` does not transit, `activeIndex` changes once, and the callback identity is stable. **None
  of the four was the moving part**, which is why two rounds of reading could not separate them.

  The real mechanism, and it is in the **test's measurement window**, not in the panel:

  ```
  MARKER read: scrollCalls.length = 0     (8 of 8 isolated runs)
  exactly ONE scroll recorded per passing run
  ```

  `layout()` mutates the global `getBoundingClientRect` stub, and `scrollActiveLineIntoView` computes its
  delta **at the moment the effect flushes**, not when it is scheduled. So:

  | the `activeIndex = 0` effect flushes | delta | outcome |
  |---|---|---|
  | before `layout()` | `0` | `delta === 0` early return, nothing recorded -> **1 call, passes** |
  | after `layout()` | `150` | records into the window -> **2 calls, fails** |

  Which branch occurs is decided by a scheduler, not by anything in the component. That is the whole
  defect: **the test read its marker at a point where an effect it had not quiesced could still record.**

  Why the diagnosis was worth the trouble rather than a guess: adding a `console.error` inside `scrollBy`
  dropped the reproduction to 0/48, and two log lines in the test dropped it to **0/100**. This defect is
  sensitive enough that observing it removes it, so a probabilistic test would have proved nothing.

  **The panel is not at fault and no production change was made** - `git diff --stat -- src/` is empty. The
  panel issues one scroll per active-line change, which is the intended behaviour, and a fix here would
  have meant suppressing a legitimate first centring.

  **The fix**, in the test only: flush pending passive effects, discard whatever the flush recorded, then
  take the marker. The window then provably contains only the change under test, whichever way the
  scheduler ran the pending effect. The assertion is **unchanged**, including its exact count.

### The regression test, and the one that had to be thrown away first

  The first version of the guard was **decorative and was measured to be so**. It installed the geometry
  inside `act()` on the theory that this would force the pending flush; it did not. Geometry is not one of
  the effect's dependencies, so changing it re-runs nothing, and by that point the `activeIndex = 0` effect
  had already flushed. The test **passed with the discipline removed** - a guard that cannot fail, which
  is the exact defect family this milestone exists to remove, caught in its own new test.

  Fixed by installing the geometry **before** the lyrics settle, which makes the leak vector exist on
  every run. Proven in both directions, isolated, 5 runs each:

  ```
  discipline removed   5/5 RED     expected [ ...(2) ] to deeply equal [ { top: 150, ... } ]
  as committed         5/5 GREEN   1 failed | 0 ... -> 29 passed (29) whole file
  ```

  and under 4-way contention, 40 runs of the original test with the fix: **0 failures**. That 0/40 is
  reported as an observation, **not** as proof the fix works - the pre-fix ordering did not reproduce in
  the same sample either. What the fix does is remove the race *by construction*; the cause evidence for
  the race is the 8/8 marker reading above, which is independent of load.

  All instrumentation removed. Every probe restored its target byte-exactly.

  ### What the criterion means now

  It is **not met at `0e65dc8`**, and the milestone does not merge on a claim that it is. Where M21
  honestly stands:

  - batch 14 (`ed6f9f6`): 6/6 green, corroborated, exit 0 - the criterion was satisfied at that commit;
  - batch 15 (`0e65dc8`): **5/6**, broken by a load-sensitive assertion in a file this branch does not
    touch, reproduced at 2/10 concurrent and 0/40 isolated;
  - so the criterion is currently **unsatisfied**, for a cause outside this change's scope and outside
    its authorship.

  Three readings were available, and this record did not pick one silently:

  1. **A defect in the criterion's reach.** Six sequential runs miss a 2-in-10-under-load failure. The
     criterion is a *reliability* criterion, and one that passes 5 times in 6 while missing a
     reproducible 20% failure rate under load has not established reliability.
  2. **A defect in the product**: `LyricsPanel` emits a duplicate smooth scroll on a
     contention-affected activation. Harmless in effect - the second call scrolls to the same place -
     but it is a duplicate, and a listener who has not asked for reduced motion gets a second
     animation they did not ask for.
  3. **A defect in the test**: an exact-count assertion against a shared counter, whose measurement
     window can legitimately include a second activation.

  **Reading 3 is the one that is correct, and it is established by measurement rather than chosen.**
  It was always the defect: the component's behaviour never varied between a passing and a failing run, so
  there was no component defect to find. See the established cause and the fix above.

  Reading 1 is **still true and still applies to the batch of six in §8.30**, which runs sequentially and
  so cannot rule out a contention-only failure. That is a property of the criterion rather than a defect in
  it, and it is recorded rather than argued away.

## 8.30 Batch 16 at `a0bf535` - six of six green, corroborated, and the criterion was MET **at that commit**

  > **SUPERSEDED — and amended in this heading, not only in a cross-reference further down.** Round 16's
  > WARNING 3 is right that this heading read "the criterion is MET" in the present tense while batch 16
  > had been superseded by four later commits, and that the supersession lived 162 lines away in §8.32.
  > **A correction that can be summarised away from its own heading has not been made** — the sentence
  > above is round 14's NIT 1, fixed in `design.md`'s heading and missed here.
  >
  > The criterion was met at `a0bf535` and is not claimed here. **Round 17's WARNING 4: this pointer used to
  > read "Current evidence is §8.36, at the merge commit", which §8.36's own heading contradicted three
  > lines into it — that batch is at `7855f08`, and **no commit on this branch is a merge commit at all**
  > (`git log -1 --format=%P 7855f08` → one parent `6e817d4`, which is round 18's WARNING 2: the heading
  > said "the merge commit" and the file said elsewhere that `90c2496` was it, and git says neither).** A
  > live pointer in the
  > tree naming a record the tree itself calls stale is worse than no pointer, because it looks current.
  > The pointer is now to §8.38, and each batch entry states its own supersession rather than relying on a
  > reader to follow the chain. **A criterion's satisfaction does not outlive the commit it was measured
  > at**, and this section is retained because the sequence of batches is itself the evidence for that
  > rule.

  Run at the commit that fixed §8.29's cause, from a fresh log directory, driving six `npm run gate` passes.
  The count restarted here: pre-fix runs are not evidence about the tree the fix produces.

  ```
  run 1  exit 0  299s  files 182  tests 3335  motion-budget 21
  run 2  exit 0  163s  files 182  tests 3335  motion-budget 21
  run 3  exit 0  103s  files 182  tests 3335  motion-budget 21
  run 4  exit 0   99s  files 182  tests 3335  motion-budget 21
  run 5  exit 0   96s  files 182  tests 3335  motion-budget 21
  run 6  exit 0  147s  files 182  tests 3335  motion-budget 21
  ```

  Checked by the shipped corroborator, exit **0**, `corroborated`. Per log: `gate exit0` as the leading
  line, 0 NUL bytes and 0 U+FFFD, all markers found, `files 182`, `budget 21`, `skipped none`, and **six
  distinct SHA-256 digests** - so this is six runs, not one log copied six times. Enumeration
  `3013 templates / 3335 executed = 0.903`, floor 0.8.

  **Which commit these ran against is `consistent-with`, not stamped, and the difference matters.**
  Round 13 raised this and it is correct: the driver writes no commit identifier, so no log can be tied
  to a commit by its own contents. What is established: all six carry `3335` tests, which is the
  post-fix tree (`+1` regression test from §8.29) and **not** `3334`, which batch 15 at `0e65dc8` is
  recorded at; all six carry `182` files and `motion-budget 21`; and the logs postdate the commit. So the
  logs are consistent with `a0bf535` and inconsistent with its parent. **A commit stamp in
  `gate exit <code>`'s log header would settle it, and adding one after the fact does not settle it for
  this batch** - it would only bind future ones. Recorded as a limitation, not presented as verified.

  **Where the milestone stands on its own criterion, in full:**

  - batch 14 (`ed6f9f6`): 6/6 green, corroborated, exit 0;
  - batch 15 (`0e65dc8`): **5/6**, broken by the defect established and fixed in §8.29;
  - batch 16 (`a0bf535`): **6/6 green**, corroborated, exit 0 - **the criterion is met.**

  `3334` -> `3335` is the regression test added in §8.29, and it is the count I expected; a silent jump
  would have been the finding.

  **What this does not establish, unchanged:** CI is unobserved on this branch. There is no browser
  verification of any kind. CRITICAL 1 and CRITICAL 2 remain named, measured, **unclosed** residuals, and no
  document in this change claims otherwise. Reading 1 above applies: six sequential runs are not a
  contention test. And the logs live outside the repository at a temp path, so a reader of `main` cannot
  re-check them from the tree - which is a consequence of committing ~300 KB of build output to the
  repository being the only alternative, and is recorded rather than solved.

## 8.31 Round 13 - REJECT on the record, and the claim that was falsified by the commit that measured it

  **Verdict: REJECT. 1 CRITICAL, 2 WARNING, 2 NIT.** The code change was confirmed sound - the verifier
  reproduced the regression evidence with its own needles and mutations (5/5 red without the discipline,
  5/5 green with it, byte-exact restore) and independently re-ran the corroborator. **The rejection was
  entirely about the record.**

  **CRITICAL: `design.md` asserted a `src/` change that does not exist.** §2.12 and §3 were written
  **before** the investigation, on the belief that the defect was in shipped code, and §2.12 said so in the
  present tense: *"This defect **is** shipped code"*, and *"**One shipped-code change is now authorised
  and on the record** ... It is the only `src/` change this milestone will make."* The measurement in the
  same commit reversed it, `tasks.md` was corrected, and **`design.md` - this change's scope authority -
  was not.** The verifier found it by checking the claim against `git diff`, which is the cheapest
  possible check and the one a reader would have run first.

  This is the same defect family this milestone exists to remove - **something believed because it was
  written down** - and it was introduced by the very commit that measured the question. §3 promised a
  shipped-code edit; §2.12's scope still required *"make the smallest production change"* for work the
  measurement showed was unnecessary because all four dependencies are inert. Repaired in place, with the
  supersession in `design.md` itself and not only in `tasks.md`, and with the heading corrected so it no
  longer reads as a claim about where the defect lives.

  **The lesson is the one this change keeps re-learning, and it is now the fourth instance:** write the
  finding down only after measuring it. §2.12 was written to authorise work before the work was done,
  which was correct as an authorisation - and it is precisely that, a document describing work not yet
  done - but then it was left in the present tense after the work falsified it. **An authorisation is not
  a finding, and the document carrying it must be re-read when the answer arrives.**

  **WARNING 1, first half - now repaired for future batches.** Round 13 could not tie the six logs to a
  commit and marked it `unverified`, correctly. Repaired by having the driver write `commit <sha>` into
  each log, resolved **once, above the run loop** - resolving it inside the loop would let a batch that
  spanned a commit change stamp all six logs with the last HEAD seen, appearing to be six runs of one
  tree when it was six runs of two. The checker refuses a log with no commit line, reports a batch naming
  more than one, and accepts `unknown`: presence is required, informativeness is not, because refusing
  `unknown` would punish a shallow clone rather than the evidence. **This binds future batches only;
  batch 16's logs cannot acquire the stamp, and that limitation is recorded above rather than hidden by a
  stamp added too late.**

  **WARNING 1, second half and WARNING 2 - record gaps, now closed.** Batch 16 was not recorded anywhere
  (§8.30), and a sentence that was true at `0e65dc8` still read in the present tense (§8.29, now
  timestamped, with its two dangling back-references repointed at the section that replaced them).

  **NIT 1 is accepted and disclosed:** reverting the *original* test's discipline leaves the file 5/5
  green in isolation. Only the new test pins it, deterministically. The suite cannot fail if that specific
  repair is reverted under light load, and that is stated here rather than left for a reader to find.

  **NIT 2** folded into the CRITICAL repair - the §2.12 heading read as a claim about the defect's
  location.

  **The five new clauses were mutation-tested before being believed**, each RED, control green, all three
  files restored byte-exactly:

  ```
  driver stops writing `commit $commit`                    RED  Test Files  1 failed (1)
  checker stops requiring the commit line                  RED  Test Files  1 failed (1)
  checker stops flagging a batch spanning two commits      RED  Test Files  1 failed (1)
  checker treats an `unknown` stamp as a failure           RED  Test Files  1 failed (1)
  driver resolves the commit inside the run loop           RED  Test Files  1 failed (1)
  control, nothing broken                                  expected-green  Test Files  1 passed (1)
  ```

  **Two of my own instruments lied while producing that table, and both are recorded because the pattern
  is the point.** The first run labelled all five `RED BUT DID NOT RUN`: the detector's "did the suite
  load" test matched only one of the two shapes vitest prints, so four genuine reds were reported as
  inconclusive and **the suite reported 0/5 RED with a green control** - a mutation table that looks like
  a total failure and is really a broken instrument. The second attempt matched `passed \((\d+)\)`, which
  **does not match a red file at all** - `Test Files  1 failed (1)` contains no `passed` token - and still
  reported them as not-run. Reading the parenthesised total directly fixed it: `/\((\d+)\)/` yields `1`
  for both shapes, **because in the `Test Files` line that figure is the file count**. Round 14 hit the
  same trap independently and measured it.

  **The composite shape this entry used to quote, `Test Files  1 failed | 18 passed (1)`, does not occur** -
  round 14 measured the real shapes, and the `18` and the `(1)` belong to different lines: the `Tests`
  line reads `Tests  1 failed | 18 passed (19)`, where the parenthesised figure is the test count. The
  lesson above is unchanged and the correction is to say *which line* the total must be read from.
  **Third instrument failure of this shape in this milestone, and the same lesson each time: a counter
  that cannot see the thing it counts is worse than no counter, because it reports a result.**

  **And one mutation returned STILL GREEN and was right to.** Hard-coding the status word while leaving
  the count text intact passed my straddling-batch test, because that test asserted only
  `2 distinct of 6`. The clause exists to make a straddling batch *visible*, and visibility is the
  `WARN` label; the count is detail. **The test was amended to assert the label**, and only then was the
  mutation RED. A still-green row is not a failed experiment — it is a finding about the test, and reading
  it as anything else is how a suite acquires a clause that cannot fail.

  **Round 13's `unverified` items are accepted as unverified**, not argued away: the pre-fix ordering's
  `2 in 10 concurrent` figure and the fixed ordering's `0 in 40` were both the verifier's own runs to
  make and it made neither; batch 16's commit attribution is `consistent-with` and cannot become `stamped`
  after the fact; the two install-cascade escapes were not executed, being forbidden; the phantom
  `vitest list` mechanism stays unverified by agreement.

  **What round 13 got right that is worth keeping:** it found a falsified claim in the document that
  defines scope, by checking it against `git diff`, in a change whose entire subject is claims that were
  believed rather than measured. It also disclosed its own incident — a mutation interrupted before its
  restore, detected, restored with `git checkout --`, tree confirmed clean — rather than quietly
  proceeding. A reviewer who reports its own mishap is worth more than one who reports none.

## 8.32 Batch 17 at `9f78ee1` - six of six green, and **stamped**

  ```
  commit under test: 9f78ee13c208
  run 1  exit 0  125s  files 182  tests 3340  motion-budget 21
  run 2  exit 0  129s  files 182  tests 3340  motion-budget 21
  run 3  exit 0   99s  files 182  tests 3340  motion-budget 21
  run 4  exit 0   99s  files 182  tests 3340  motion-budget 21
  run 5  exit 0   95s  files 182  tests 3340  motion-budget 21
  run 6  exit 0  101s  files 182  tests 3340  motion-budget 21
  ```

  Corroborator exit **0**, `corroborated`: six distinct digests, `182` files (asserted), `motion-budget 21`
  (asserted), `3340` tests (stability only), enumeration `3018/3340 = 0.904` against a 0.8 floor. **And the
  line batch 16 could not have: `commits named across the logs: 9f78ee13c208 (1 distinct of 6)`.** Six
  runs of one named tree, which is what `design.md` 2.10 asks for and what no previous batch could say.

  `3335 -> 3340` is the five new `evidence-scripts` cases, confirmed by count: that file had 14 `it(` and
  now has 19, delta exactly `+5`, `describe()` 4 -> 4, zero removed. Round 14 confirmed this independently,
  and additionally derived `3013 + 5 = 3018` for the enumerator.

  **A criterion's satisfaction does not outlive the commit it was measured at.** Batch 16 at `a0bf535` was
  superseded by the commit that changed `evidence-scripts.test.ts`, a file the gate executes, so the count
  restarted here rather than being carried forward. Round 14 raised exactly this as its WARNING 2.

  Unchanged and unestablished by it: CI unobserved on this branch; no browser verification of any kind;
  CRITICAL 1 and CRITICAL 2 remain named, measured, **unclosed**; reading 1 of §8.29 applies, since six
  sequential runs are not a contention test. **Batch logs still live outside the repository**, so the
  stamp proves which commit a *batch* ran against — it does not make the logs part of the tree.

## 8.33 Round 14 — the new CRITICAL is my own clause, escaped through the failure its comment named

  **Verdict: REJECT. 1 CRITICAL, 2 WARNING, 3 NIT.** Round 14 confirmed the round-13 CRITICAL is genuinely
  repaired and *true* rather than self-consistent, confirmed the batch independently by re-running the
  corroborator and by hashing the logs itself, and **rejected on a clause added in the very commit written
  to close round 13's WARNING 1.**

  **CRITICAL: the "resolve once, outside the loop" pin was escapable, and its comment claiming the check
  distinguishes the failure was falsified by measurement.** The assertion compared the *first*
  `$commit = "unknown"` against `for ($run`, and its comment said, in bold-adjacent prose, *"no assignment
  count distinguishes that from resolving once. **Text position does.**"* Round 14's M6 left the decoy above
  the loop and added a real per-run re-resolution inside the body — **the exact failure the comment named
  by name** — and the suite was **19/19 green**.

  **"Text position does" is withdrawn.** `indexOf` finds the decoy first, so text position does not
  distinguish resolve-once from resolve-per-run whenever a decoy exists. Repaired to assert the property
  that survives a decoy: **the last assignment preceding the loop body is a real assignment, and no
  `$commit =` occurs inside the loop body**, the latter scoped to the body's own text so an unrelated later
  assignment elsewhere in the script cannot fail it.

  **This is the ladder again, one rung along, and the pattern is now predictable enough to name.** The
  rungs were name → span → declaration → dispatch → complement, each real, none covering the next finding,
  because each was extended along the axis the last defect was on. Round 13 added a sixth rung — *source
  position* — and the sixth rung is the one that fails, because position was extended along the axis the
  previous defect was on (a comment asserting more than its check). **A rung added to survive a known
  mutation is the rung most likely to have been shaped by that mutation rather than by the property.**

  **WARNING 1: the straddling-commit batch exited 0.** The checker printed `WARN`, left `problems` at 0,
  printed `corroborated:` and **exited 0** — while its own comment said a straddling batch "cannot pass
  unnoticed". Measured by round 14 on six synthetic logs. **"Unnoticed" means seen by a human reading the
  output; every caller of a checker reads the exit status**, which this same file says about a different
  defect a few hundred lines below. Repaired: the clause now increments `problems` and exits non-zero. The
  contrast with the `unknown` case is the reasoning, and it holds in both directions — refusing `unknown`
  punishes the *environment*, refusing a straddling batch refuses *defective evidence*, and the criterion
  is stated about a commit.

  **WARNING 2: the record said the criterion was met on batch 16's evidence while HEAD had changed a
  gate-executed test file.** True at HEAD in substance, missing from the tree in fact. Now recorded:
  batch 17 supersedes batch 16, and §8.32 states why a count does not carry across a commit.

  **NIT 1 — and it is right, and the fix was to remove the phrase rather than the heading.** The §2.12
  heading still read *"one defect, in shipped code on the premise"*. In running text the falsification is
  stated immediately beneath it, but a **heading-only** reader — a table of contents, a grep for `shipped
  code`, a diff summary — still extracts the falsified premise. The phrase is gone from the heading and the
  correction is in the blockquote, where a summary cannot reach it. **A correction that can be summarised
  away from its own heading has not been made.**

  **NIT 2 — a stale count in the checker's own comment, which is the mistake that file names.** It read
  "two non-test lines", "inflate `listedIds` by 2", "73 lines for 71 tests". Measured at `9f78ee1`: three
  (`> node` twice), 74 lines. Corrected in place with the old figures kept alongside, **because the
  immateriality is the argument for the ratio**: 3 in a 3000-line count moves it by 0.001 against 0.104 of
  headroom. The stale figure had not been revisited after the file gained five cases — which is precisely
  the failure the ratio replaced, recurring in the comment that documents the ratio.

  **NIT 3** — this entry's own quoted vitest output shape, corrected in place above. The lesson was
  independently confirmed by round 14; only the quoted string was wrong.

  **What round 14 got right, and it is the second time:** it found a claim that could not fail, by
  constructing the failure the claim's own comment said it excluded. It re-ran every check rather than
  trusting my figures, confirmed the `3335 -> 3340` delta was `+5` and zero removed, derived `3013 + 5 =
  3018` for the enumerator, hashed the logs itself, and disclosed that all seven of its mutation runs
  restored byte-exactly with the tree clean. **It also declined to escalate its own WARNING 1 to CRITICAL
  on the grounds that the shipped driver cannot produce such a batch** — a fair distinction between a live
  defect and a reachable one, and stated as reasoning rather than as a favour.

  **What round 14 could not verify, recorded rather than argued:** that its batch's logs came from a gate
  run rather than being synthesised. The `commit` stamp is **self-reported by the driver**, and no stamp
  written by the thing it describes can establish provenance — it binds a batch to a commit, it does not
  make the logs part of the tree or prove they were not written by hand. That limit is real, it is not
  repaired by any stamp, and the logs remain outside the repository. Round 15 reached the same limit by a
  different route and is recorded at 8.35.

## 8.34 Batch 18 at `6e817d4` - six of six green, stamped, and superseded by the commit that follows it

  ```
  commit under test: 6e817d40da9f
  run 1  exit 0  104s  files 182  tests 3340  motion-budget 21
  run 2  exit 0   89s  files 182  tests 3340  motion-budget 21
  run 3  exit 0   91s  files 182  tests 3340  motion-budget 21
  run 4  exit 0   88s  files 182  tests 3340  motion-budget 21
  run 5  exit 0   89s  files 182  tests 3340  motion-budget 21
  run 6  exit 0   89s  files 182  tests 3340  motion-budget 21
  ```

  Corroborator exit **0**, `corroborated`: six distinct digests, `commits named across the logs:
  6e817d40da9f (1 distinct of 6)`, `182` files (asserted), `motion-budget 21` (asserted), `3340` tests
  (stability only), enumeration `3018/3340 = 0.904` against a 0.8 floor. Round 15 corroborated it
  independently, including six distinct whole-file SHA-256 digests and six distinct durations.

  **Batch 18 is superseded by the commit recording round 15**, which changed `evidence-scripts.test.ts`
  and the driver. The count does not carry across a commit; §8.29's rule applies to every batch, not
  only the ones that were red.

## 8.35 Round 15 - REJECT, and the last of the resolve-once rungs is the one that broke

  > **The heading previously read "the seventh rung is the one that broke", which endorsed a rung count
  > this section retracts nineteen lines below.** Round 17 filed it as NIT 2 and, separately, as WARNING 3
  > for the same sentence surviving in the closing paragraph. The correct count is **three rungs, seven
  > escapes**, derived in this section; "seventh" was round 16's own unreproducible phrasing, carried into
  > a heading where nothing could correct it. **A heading is the one line in a document that every later
  > reader sees first, and it is the hardest line in the document to amend once written.**

  **Verdict: REJECT. 1 CRITICAL, 2 WARNING, 2 NIT.** Round 14's CRITICAL was confirmed genuinely repaired —
  round 15 ran round 14's exact escape and got RED — and the batch was confirmed independently. **The
  rejection was on the clause added in the commit written to close round 13's WARNING 1, again.**

  **CRITICAL: the replacement clause was escapable four more ways, and its new comment overclaimed in the
  same way the withdrawn one had.** Rounds 14 and 15 each tried to assert, by reading the driver's text,
  that the commit is resolved once outside the loop.

  **The counts below are stated as counted, because the previous phrasing was not.** This entry first said
  *"Seven syntactic rungs, seven escapes"* above an eight-row table, and round 16's NIT 1 is right that no
  reading of that table reproduces seven rungs. It does not, because **there were three rungs and seven
  escapes**, and "seven" was doing duty for both. Round 16 recorded which convention was intended as
  `unverified`; rather than pick one by assertion, both numbers are now derived from the lists below:

  | # | the rung | what it got wrong |
  |---|---|---|
  | R1 (round 14) | text order of `for ($run` against `$commit` | **vacuous** — the loop header necessarily precedes the loop body, so it asserted nothing |
  | R2 (round 14) | first `$commit = "unknown"` precedes `for ($run`; comment claimed "Text position does" | `indexOf` finds a decoy first |
  | R3 (round 15) | `lastIndexOf("$commit")` before the loop, and no literal `$commit =` in the body text | a **spelling** test, not an assignment test |

  | # | escape | defeats |
  |---|---|---|
  | 1 | decoy `$commit` above the loop, real re-resolution inside | R2 |
  | 2 | `Set-Variable -Name commit` | R3 |
  | 3 | `Set-Item -Path variable:commit` | R3 |
  | 4 | `${commit} =` | R3 |
  | 5 | a decoy `for ($run` owning the textual scan | R3 |
  | 6 | a column-0 `}` truncating any text-scanned body | R3 |
  | 7 | the pre-loop *assignment* deleted, leaving only a `Write-Host` mention | R3 |

  **R1 is the one worth keeping.** It is counted as a rung because it was written as one, and it is in the
  table because a clause that was *always true* is the purest instance of this milestone's subject: R1
  passed every run and would have passed every mutation, which is the stronger form of "cannot fail" — it
  did not merely escape a mutation, it had no mutation to escape. Round 13's `contains("commit $commit")`
  clause is **not** counted: it asserted that the stamp is written at all, not where it is resolved, and
  conflating the two is what produced the unreproducible number in the first place.

  **The reason is structural, not insufficient effort: PowerShell can assign a variable many ways, and no
  spelling test can enumerate them.** Round 15's own words for it — the clause "is a spelling test, not an
  assignment test" — are the finding. This is §2.11's conclusion about the archived gate's install cascade
  arriving a second time, for this change's own apparatus, and it was predicted in §2.11 three rounds
  before it happened.

  **The repair is data flow, not an eighth rung.** The driver freezes the commit into `$header` **once,
  above the loop**, and the per-run write consumes `$header` verbatim. Re-resolving `$commit` inside the
  loop is therefore **inert, not detected** — whatever syntax is used to do it, the written string cannot
  change. `tests/evidence-scripts.test.ts` correspondingly **stops checking the position of the
  resolution at all** and says so in a section a reader will find before adding a clause back. **A check
  that cannot be written is not replaced by a weaker one.**

  Measured, with the split verdicts never collapsed:

  ```
  A. clauses that must fail
  driver reads $commit per run instead of the frozen $header    RED  Test Files  1 failed (1)
  driver stops writing the commit line entirely                 RED  Test Files  1 failed (1)
  the frozen header is declared after the run loop              RED  Test Files  1 failed (1)
  the frozen header carries no commit                           RED  Test Files  1 failed (1)

  B. round 15's escapes - green, and the stamp demonstrably unmoved
  Set-Variable -Name commit in the loop          STILL GREEN  stamp: commit PRETREE000000  x2
  ${commit} = in the loop                       STILL GREEN  stamp: commit PRETREE000000  x2
  Set-Item variable:commit in the loop          STILL GREEN  stamp: commit PRETREE000000  x2
  pre-loop resolution deleted, Write-Host left  STILL GREEN  stamp: commit PRETREE000000  x2
  control, nothing broken                       expected-green  Test Files  1 passed (1)
  ```

  **Section B is the part that matters, and its rows are `STILL GREEN` on purpose.** A repair that merely
  failed to detect the escape would look identical to this table without the second column. So each escape
  is *executed as PowerShell* — the mutated driver's own freeze and write, with the gate call stubbed — and
  the written stamp is read back. It reads `commit PRETREE000000` in every run of every variant, while
  `$commit` is being reassigned inside the loop to a different value. **The escape routes are inert, and
  that is measured rather than asserted.** The probe labels such a row `expected-green`, so a future round
  cannot mistake "still green" for a gap and re-add a spelling test for something that can no longer go
  wrong.

  **Two instrument failures again, and this time one of them produced a plausible lie.** The first run of
  section B reported every escape as `*** WRONG ***` with `*** STAMP MOVED ***`, because my PowerShell stub
  never defined `$encoding` and every write threw — an instrument failure reported as a driver failure, the
  `RED BUT DID NOT RUN` case in a place where nothing was red at all. The second run came back `RED` for
  three rows **for a reason unrelated to any clause under test**: the escape text I injected hard-coded
  `C:\Users\Edison\...`, which tripped the suite's own *no hard-coded machine path* clause. The verdict was
  correct and the attribution was not. Re-aimed with `$repoRoot`, and the probe now prints **which test
  went red** on every row, so a mutation table cannot credit the wrong clause. **Fifth instrument failure
  of this family in this milestone, and the second where a correct verdict pointed at the wrong thing.**

  **WARNING 1: round 14's NIT 2 correction was wrong on arrival.** It corrected "two non-test lines" to
  "three" and "73 lines" to "74", both measured and both right for the file it names, but the claim
  directly above them — that the phantom lines are **localised to one file** — is false at HEAD.
  `tests/lyrics-induced-violations.test.ts` contributes a fourth, an entry named `\/`, which is an artefact
  of the test's own `replace(/\\/g, "/")` and not a test name. **A correction added as a fix is still a
  claim, and still has to be measured across the whole population rather than at the site of the original
  error.** The ratio is unaffected — 4 in 3018 moves 0.904 by about 0.0005 against a 0.8 floor — and that is
  now the comment's stated argument, which is the correct place for it.

  **WARNING 2: batch 18 existed, was green, and was recorded nowhere**, with §8.32 still presenting batch
  17 as current criterion evidence. Closed by §8.34, which records batch 18 *and* states that it is
  superseded by the commit recording this round.

  **NITs 1 and 2 are confirmed closed by measurement:** the §2.12 heading no longer contains
  `shipped code` (a grep returns five hits, none of them a heading line), and §8.31's quoted vitest shapes
  now match real output. Round 15 also re-derived the `3335 -> 3340` delta as exactly `+5` with zero tests
  removed, and `3013 + 5 = 3018` for the enumerator.

  **What round 15 got right, for the third consecutive round:** it refused to report "the ladder has moved"
  as a finding, and instead enumerated four specific parse-valid escapes with the mechanism for each, each
  verified to genuinely re-resolve `$commit` by *executing* the variant as PowerShell. It distinguished a
  comment over-claim from wrong behaviour, noting the shipped driver is correct. It declined to escalate
  its own WARNING 1 because the shipped driver cannot produce such a batch. And it re-hashed every file it
  mutated, restoring all thirteen runs byte-exactly with a clean tree. **A verifier that reports what it
  could not escalate is worth more than one that escalates everything.**

  **Still unverified and recorded as such:** that any batch's logs came from a gate run rather than being
  synthesised — the `commit` stamp is self-reported by the thing it describes, and no stamp written by the
  driver can establish its own provenance. CI unobserved on this branch. No browser verification of any
  kind. CRITICAL 1 and CRITICAL 2 remain named, measured, **unclosed**. And the resolve-once ladder had
  **three rungs, seven escapes** behind it, of which R2 and R3 each broke within a single round — which
  is why the repair is data flow rather than a fourth rung, and why **no claim is made that a syntactic
  pin would now suffice.**

## 8.36 Batch 19 at `7855f08` - six of six green, corroborated, and the criterion was met at `7855f08`

  ```
  commit under test: 7855f083190a
  run 1  exit 0   97s  files 182  tests 3340  motion-budget 21
  run 2  exit 0   88s  files 182  tests 3340  motion-budget 21
  run 3  exit 0   97s  files 182  tests 3340  motion-budget 21
  run 4  exit 0  109s  files 182  tests 3340  motion-budget 21
  run 5  exit 0   99s  files 182  tests 3340  motion-budget 21
  run 6  exit 0  107s  files 182  tests 3340  motion-budget 21
  ```

  Corroborator exit **0**, `corroborated`: six distinct digests, `commits named across the logs:
  7855f083190a (1 distinct of 6)`, `182` files (asserted), `motion-budget 21` (asserted), `3340` tests
  (stability only), enumeration `3018/3340 = 0.904` against a 0.8 floor.

  Round 16 corroborated it **independently of the shipped script**: line 1 `gate exit0` and line 2
  `commit 7855f083190a` in all six, equal to HEAD's short SHA; six distinct whole-file SHA-256
  (`bf83f6ee`, `bb97d58f`, `6df7f876`, `69395a2b`, `81a68979`, `f1865151`); six distinct durations
  (56.49, 55.91, 65.85, 67.62, 66.30, 66.38s); `motion-budget` 21 in all six; and an executed total it
  measured itself at HEAD of **3340**, matching the batch.

  **The sequence, because the restarts are themselves the evidence for the rule.** Batch 14 (`ed6f9f6`)
  6/6; batch 15 (`0e65dc8`) **5/6**, red on a real defect; batch 16 (`a0bf535`) 6/6; batch 17 (`9f78ee1`)
  6/6; batch 18 (`6e817d4`) 6/6; batch 19 (`7855f08`) 6/6; batch 20 (`90c2496`) 6/6. **Six restarts, and
  exactly one was caused by a red run** - the other five were caused by *documentation and tooling*
  commits, each of which invalidated the count for the same reason: a criterion's satisfaction may not
  outlive the commit it was measured at. **That is a cost of this milestone's own standard, and it is
  recorded rather than presented as diligence.** A reader deciding whether this process is worth its price
  should have the number.
  > **Two counts of this same sequence disagreed inside this change, and round 17 caught the disagreement
  > by checking the pointer rather than trusting it.** §8.30's SUPERSEDED block said *"five restarts, three
  > of them caused by documentation commits, **none of them by a red run**"*, which contradicts the
  > paragraph above — batch 15 was 5/6 red on a real defect. Both cannot be true, and the false one was the
  > more flattering. The corrected count above is the one each batch's own log supports. **A sequence
  > counted twice and disagreeing about whether anything ever failed is the `73 lines` defect with a
  > process narrative attached**, and it survived five rounds because both counts read plausibly.

## 8.37 Round 16 - ACCEPT / MERGEABLE, no CRITICAL, and the repair confirmed by execution

  **Verdict: ACCEPT / MERGEABLE. No CRITICAL, four WARNING, three NIT.** The verifier stated plainly that
  it did not find a CRITICAL and was not manufacturing one. That is the first round in five to return
  anything but REJECT.

  **It confirmed the round-15 CRITICAL is closed, and closed the right way**, by execution rather than by
  reading. It copied the driver to a mirror tree with only the gate invocation stubbed, ran it under
  Windows PowerShell against a fake `git` returning the sentinel `PRETREE000000`, and read the stamp back
  for five variants - baseline, `Set-Variable -Name commit`, `Set-Item -Path variable:commit`,
  `${commit} =`, and plain `$commit =`. **All five stamped `commit PRETREE000000` on every run.**

  **The two controls are what make that result mean anything, and they are the part of the report worth
  keeping.** First: with the freeze removed and the write reading `$commit`, the stamp became
  `commit MIDBATCH999999` - so "unmoved" is a real observation and not a blind instrument. Second: with
  `Set-Variable` injected, the driver printed `after Set-Variable, commit=[MIDBATCH111111]
  header=[commit PRETREE000000]` - the escape genuinely fires at runtime and `$header` is what holds.
  **A verdict that cannot be shown wrong is worth nothing, and here the same probe produced both outcomes
  depending on the variant.**

  Its judgement, recorded as its own words: *the repair is now sound precisely because the property is
  enforced by data flow rather than detected. This is not "the ladder has moved".*

  **WARNING 1 - a comment overreach written while claiming to have stopped writing them.**
  `evidence-scripts.test.ts` said *"the data flow enforces the property, so there is nothing left for a
  spelling test to miss."* Round 16's mutation E - `$header` assigned per run from a loop-dependent
  value - is exactly a spelling-test-missable defect and came back `STILL GREEN`. Not a behaviour defect:
  the shipped driver does not do it, and the corroborator refuses E's logs with exit 1, because six logs
  stamped `run1`...`run6` are six distinct commits. But a completeness claim a specific parse-valid
  rewrite defeats. **Narrowed to the two claims that are actually established**, and the narrowing is
  the interesting part: the sentence is true of `$commit` and false of `$header`, and only the first was
  written down. **The unscoped version of a true claim is this milestone's defect, and it appeared in the
  sentence explaining why it could not happen.**

  **WARNING 2 - batch 19 was recorded nowhere.** Round 15's WARNING 2, recurring one round later on the
  same axis. Closed by 8.36.

  **WARNING 3 - 8.30's heading still read "the criterion is MET" in the present tense**, superseded only
  by a cross-reference 162 lines later. That is round 14's NIT 1 verbatim - *a correction that can be
  summarised away from its own heading has not been made* - fixed in `design.md` and missed here. The
  heading is amended in place, and the six-batch sequence is recorded under it, because **five
  restarts, only one of them caused by a red run, is the evidence for the rule the heading was breaking.**

  **WARNING 4 - the checker printed `ok` when every commit was absent.** `new Set([null, ...]).size === 1`,
  so a batch in which no log names a commit read as one agreeing commit. The run was still caught - six
  `ASSERTED MISMATCH` rows, `problems` 7, exit 1 - so it was never a false green, and the verifier said
  so rather than escalating. But **a check printing `ok` while the thing it checks is absent** is the
  exact shape this project has twice promoted to CRITICAL. Repaired: the status word is derived from what
  is *known* rather than from how many values there are, an absent commit reads `FAIL`, and `unknown`
  stays `ok` because presence is required and informativeness is not.

  Round 16 also found **two mutations that are green here and red in the corroborator** - E, and a freeze
  moved into a function re-entered per run, whose logs carry an empty commit line and are refused with
  seven problems. It reported these as a **two-layered defence with both layers pinned by execution
  elsewhere in the same file**, rather than as escapes. That is the distinction this milestone spent
  fifteen rounds failing to draw on its own apparatus: *undetected by this check* is not *unmitigated*.

  **NIT 1 - "seven rungs, seven escapes" was not reproducible from the eight-row table beside it.** The
  verifier recorded which convention was intended as `unverified`, correctly. Rather than pick one by
  assertion, both numbers are now derived from lists: **three rungs, seven escapes**, with round 13's
  `contains("commit $commit")` clause excluded because it asserted that the stamp is written *at all*,
  not where it is resolved - conflating the two is what produced the unreproducible number. R1 is kept in
  the table because a clause that was **always true** is the purest instance of this milestone's subject:
  it passed every run and would have passed every mutation, which is a stronger form of "cannot fail"
  than escaping one.

  **NIT 2 - a second site of the stale `73 lines for 71 tests` figure**, in 8.28, round 12's record.
  Round 14's correction landed in the checker and in 8.33's narrative and not here. Annotated rather than
  rewritten, because 8.28 is a superseded entry and rewriting a historical record is worse than
  annotating it.

  **NIT 3 - round 16's own instrument, disclosed by it.** Its first log capture via `Tee-Object` was
  UTF-16LE - the exact trap `run-gate-batch.ps1:22-25` documents. Decoded and re-measured; no figure
  affected. **A verifier that reports its own mishap is worth more than one that reports none, and this
  is the second round in a row to do it.**

  **What round 16 got right that the previous three did not:** it declined to manufacture a CRITICAL; it
  named the two controls that made its central measurement meaningful; it distinguished "green here, red
  in the corroborator" from an escape instead of counting either as a defect; and it reported the
  corruption of its own capture before using any figure from it.

  **What it could not verify, recorded as such:** batch 19's provenance - the `commit` stamp is
  self-reported by the driver and binds a batch to a commit without proving the logs came from a gate
  run. CI unobserved on this branch. No browser verification of any kind. CRITICAL 1 and CRITICAL 2
  remain named, measured, **unclosed**, and no document re-claims that false greens are impossible.

## 8.38 Batch 20 at `90c2496` - six of six green, corroborated, and the criterion is met at `90c2496`

  ```
  commit under test: 90c2496256d3
  run 1  exit 0   86s  files 182  tests 3341  motion-budget 21
  run 2  exit 0   84s  files 182  tests 3341  motion-budget 21
  run 3  exit 0   84s  files 182  tests 3341  motion-budget 21
  run 4  exit 0   84s  files 182  tests 3341  motion-budget 21
  run 5  exit 0   83s  files 182  tests 3341  motion-budget 21
  run 6  exit 0   84s  files 182  tests 3341  motion-budget 21
  ```

  Corroborator exit **0**, `corroborated`: six distinct digests, `commits named across the logs:
  90c2496256d3 (1 distinct of 6)`, `182` files (asserted), `motion-budget 21` (asserted), `3341` tests
  (stability only), enumeration `3019/3341 = 0.904` against a 0.8 floor.

  Round 17 verified it **with its own script and no use of `verify-gate-batch.mjs`**: line 1 `gate
  exit0` and line 2 `commit 90c2496256d3` in all six, equal to HEAD's short-12 SHA; **six distinct**
  whole-file SHA-256, computed over both raw bytes and ANSI-stripped text; six distinct durations
  (54.31, 54.13, 54.48, 54.10, 53.71, 54.03s); `motion-budget` 21 read from the per-file line in every
  run; `Test Files 182` / `Tests 3341` in all six; 0 NUL bytes and 0 U+FFFD in all six. It also
  noticed that thirteen lines per log match `failed` and are test-*fixture* stderr appearing
  identically in all six - **a `failed` match is not evidence of a failure, which is why every
  detector in this change tests the summary lines by shape rather than by substring.**

  **Supersession, stated here because round 17's WARNING 4 was its absence.** Batch 19 (8.36) was
  measured at `7855f08` and is superseded by `90c2496`, which changed a gate-executed test file and the
  checker. Batch 18 (8.34) was measured at `6e817d4` and is superseded by `7855f08`. Batch 17 (8.32) at
  `9f78ee1` is superseded by `6e817d4`. Batch 16 (8.30) at `a0bf535` is superseded by `9f78ee1`.
  **A record that does not state its own supersession is worse than no record, because it looks
  current** - and this change learned that four separate times before writing the chain down once.

  **On where a batch record belongs.** I proposed recording the criterion's batch in the PR #100 body,
  on the reasoning that an in-tree record creates a commit which invalidates the batch it certifies.
  Round 17 rejected the conclusion while accepting the premise, and it is right: the premise is a real
  circularity, and the conclusion was a rationalisation. `tasks.md` 8.30's SUPERSEDED block was a
  **live pointer in the tree naming a record the tree itself called stale**, and moving the record to a
  PR body would have left that pointer dangling while discarding the sequence it depends on. The
  self-consistent form was already in the tree at 8.34 - record the batch, and state in the same section
  that the commit which follows supersedes it - and this entry is that form. **It never claims to be
  current, so it does not invalidate itself.**

## 8.39 Round 17 - MERGEABLE / ACCEPT, no CRITICAL, and it rejected my reasoning rather than my code

  **Verdict: MERGEABLE / ACCEPT. No CRITICAL, five WARNING, three NIT.** The second consecutive
  non-REJECT round, and the first to find nothing behavioural. It stated plainly that it was not
  manufacturing a CRITICAL - which is the disposition this milestone needed by round 17 and did not get
  until then.

  **It confirmed the round-15 repair sound, in its own words:** the property is enforced by data flow
  rather than detected, R1-R3 red on the three mutations that must fail, `Set-Variable` STILL GREEN on
  the one that must not, and **no overreach found in the narrowed W1 text.** It added a fourth mutation
  I had not tried - `row.commit !== undefined` instead of `!== null` - which is RED, and that answers the
  question the round-16 finding left open: **`allPresent` is a check about parsed values, not a spelling
  test about the driver's text**, because an absent commit is explicitly `null` and `!== undefined` lets
  it through. The negative case never reads the driver at all; it synthesises logs and runs the checker.

  **WARNING 1 - a comment claimed unreachable code, and the verifier executed it.** I wrote that the
  `!allPresent` branch was "unreachable in practice", arguing from `problems` already being 7. That
  argument proves the *consequence* of an absent commit, not its *absence* - a non-sequitur - and round
  17 reached the branch by feeding it the all-absent batch the new negative test builds, which is a
  routine input here. **This is warning 4's own shape one branch down, in the one file whose header is a
  catalogue of the defects this checker's history contains.** The branch is kept because it earns its
  place on the merits, and the comment now says so.

  **NIT 1 - a partly-absent batch explained itself as straddling.** Five logs naming one commit and one
  naming none has two distinct values, so the straddling branch described a batch that spans commits as
  one that does. Cosmetic: `FAIL`, `ABSENT` visible, exit non-zero, never a false green. Repaired by
  testing absence FIRST, with a message that states how many logs are affected, and pinned by a second
  negative case that asserts the *explanation* - plus an assertion on the straddling case that its own
  explanation survives the reorder. **A reorder that fixed the new case by swallowing the old one would
  otherwise have left the suite green.**

  **WARNING 2 - my annotation for warning NIT 2 carried its own unverifiable figure.** It read "210
  lines earlier"; round 17 measured every distance between the four sites of that figure - 718, 714,
  455 - and **210 matches none of them.** The number is gone. **A number is not a claim because it is
  precise, and the urge to add one to an annotation is the same reflex that produced the error it was
  correcting.**

  **WARNING 3 - "seven rungs" survived in the section that retracts it**, and in 8.35's heading. Both
  amended in place. Round 17 also caught a contradiction I had not seen: two counts of the same batch
  sequence, in the same file, disagreeing about **whether any red run ever occurred** - 8.30 said none, and
  8.36 said one, and 8.36 was right because batch 15 is recorded 5/6. **Two counts of one sequence that
  disagree about whether anything failed is the `73 lines` defect with a process narrative attached**, and
  it survived five rounds because both numbers read plausibly.

  **WARNING 5 - `ROADMAP.md` still said twelve rounds**, contradicting its own line seventy below, which
  reported round 16's ACCEPT. It understated, so no false green - but it was a number written once and
  never recounted.

  **The vacuous check, which round 17 found by reading it literally.** `ROADMAP.md` stated
  `git diff --stat -- src/` is empty, as evidence that no shipped code changed. **There is no root `src/`
  in this repository.** The command is trivially true and would have stayed true through any edit to the
  application - the purest form of this milestone's subject, a check that cannot fail. Re-scoped to
  `frontend/src/`, where it reports one real change (`useListeningRecorder.ts`, +26 lines,
  `flushListeningRecorder()`), and that change is now described rather than glossed. It reads the
  existing `writeChain` instead of a 2000 ms polling deadline, has a test consumer, and is a real API -
  **so the honest statement is one shipped file changed and the panel's behaviour did not, not that
  nothing changed.**

  **It voided two of its own measurements rather than reporting them.** Its first mutation battery used
  `--reporter=basic`, which this vitest rejects, so the *control also went red* and all five rows were
  discarded. Its first "header after the loop" mutation duplicated the line instead of moving it - a
  semantic no-op that came back green - and was redone properly. **A verifier that discards its own rows
  and says so is doing the thing this milestone asks for and no round before it did.**

  **Still unverified and recorded as such:** batch 19's and earlier batches' recorded figures - their logs
  were not supplied to round 17 and it declined to repeat them unverified. The provenance of any batch's
  logs. CI unobserved on this branch. No browser verification of any kind. CRITICAL 1 and CRITICAL 2
  remain named, measured, **unclosed**. And `openspec verify` does not exist as a subcommand, so the
  verification-workflow step this change mandates has never been run as specified.

## 8.40 Batch 21 at `b931c7c` - six of six green, corroborated, and the criterion was met at `b931c7c`

  ```
  commit under test: b931c7c4b75c
  run 1  exit 0   85s  files 182  tests 3342  motion-budget 21
  run 2  exit 0   84s  files 182  tests 3342  motion-budget 21
  run 3  exit 0   84s  files 182  tests 3342  motion-budget 21
  run 4  exit 0   83s  files 182  tests 3342  motion-budget 21
  run 5  exit 0   84s  files 182  tests 3342  motion-budget 21
  run 6  exit 0   85s  files 182  tests 3342  motion-budget 21
  ```

  Corroborator exit **0**, `corroborated`: six distinct digests, `commits named across the logs:
  b931c7c4b75c (1 distinct of 6)`, `182` files (asserted), `motion-budget 21` (asserted), `3342` tests
  (stability only), enumeration `3020/3342 = 0.904` against a 0.8 floor.

  Round 18 verified it **with its own script and no use of `verify-gate-batch.mjs`**: six distinct
  whole-file SHA-256; line 1 `gate exit0` and line 2 `commit b931c7c4b75c` in all six, equal to
  HEAD's short SHA; six distinct durations (54.19, 53.78, 54.12, 53.77, 54.06, 54.90s);
  `Test Files 182` / `Tests 3342` / `motion-budget 21` in all six; 0 skipped, 0 NUL, 0 U+FFFD; no
  failing summary in any log. Its own executed total at HEAD: **3342**, and `vitest list` at **3020**
  ids, ratio **0.90365**.

  **The one partial piece of evidence on a residual that was open for the whole milestone.** The
  `commit` stamp cannot prove a batch's logs came from a gate run rather than being synthesised, and
  that residual is not closed by this. Round 18 recorded what the logs *do* carry: a real `next build`
  Turbopack trace (Next.js 16.3.6), `Generating static pages using 11 workers (21/21)` in every run,
  the exact five-phase gate chain `lint && format:check && typecheck && build && test`, and per-run
  distinct `Compiled successfully in {1222, 796, 781, 769, 820, 756} ms` with
  `Finished TypeScript in {2.5, 2.6, 2.3, 2.4, 2.4, 2.3} s`. **That is evidence the logs came from real
  runs; it is not proof, and the verifier explicitly declined to claim it closes the residual.** A
  synthesised log reproducing a Turbopack trace with six distinct compile times is possible, so the
  honest description is *partially evidenced*, not *closed* — and recording it as closed on the strength
  of plausibility would be the last and most embarrassing version of this milestone's own defect.

## 8.41 Round 18 - MERGEABLE / ACCEPT, no CRITICAL, and the repair cycle ends here

  **Verdict: MERGEABLE / ACCEPT. No CRITICAL, three WARNING, four NIT.** The third consecutive round
  with no CRITICAL, and the second with nothing behavioural in it. It also voided two of its own
  measurements rather than reporting them — a first mutation battery using `--reporter=basic`, which this
  vitest rejects, so the control went red too and all five rows were discarded.

  **It confirmed 8.38 is genuinely self-consistent rather than a claim that had merely moved.** That was
  the question asked, because round 17 had caught the identical overreach being relocated between files
  rather than fixed. It measured the supersession chain through git (`a0bf535`←`88f9780`,
  `9f78ee1`←`a0bf535`, `6e817d4`←`9f78ee1`, `7855f08`←`6e817d4`, `90c2496`←`7855f08`,
  `b931c7c`←`90c2496` — strictly linear), confirmed 8.38's heading scopes its claim to a named commit,
  and **could not make it invent a new problem.** The overreach, it found, had *migrated* to
  `ROADMAP.md`, which does make a present-tense currentness claim. **A claim does not stop being wrong
  because it was moved to a file with fewer readers.**

  **WARNING 1 (material-mild) — a pointer to a moving target, which is the structural finding.**
  `ROADMAP.md` read *"the current criterion evidence is batch 20, at `90c2496` … executed total 3341
  measured at HEAD"* while HEAD executed **3342**, batch 21 existed at `b931c7c`, and batch 21 appeared
  in no file at all. Repaired by **replacing the pointer with the rule that identifies the live entry**:
  the live batch is whichever entry's commit equals the merge commit, and if none does the criterion is
  not met there and the batch must be re-run. **A pointer has to be updated every time its target moves,
  which means it is wrong by default and briefly right.** That is why this cycle terminates rather than
  merely stopping, and it is the one repair in this round that prevents a future recurrence instead of
  documenting one.

  **WARNING 2 (cosmetic-to-material) — a heading claimed something git contradicts.** 8.36's heading said
  *"the criterion is met at the merge commit"*; `git log -1 --format=%P 7855f08` returns a single parent,
  and `90c2496` too. **No commit on this branch is a merge commit**, and 8.30 said `90c2496` was, so one
  file held two answers and both were wrong. Corrected in both places, with the git evidence recorded
  rather than the new assertion.

  **WARNING 3 (cosmetic) — a hard-coded count in a sentence about a count.** The partly-absent message
  said *"as if it covered all six"* while its own count was correctly parameterised, so a five-log read
  printed `1 of 5 … all six`. Both figures are now `rows.length`-derived. **Round 12 corrected this
  exact class of stale figure twice in this same comment block**: a figure in prose is the first thing to
  go stale when the thing it counts is parameterised, and the fix took two dozen rounds to notice the
  third instance.

  **NIT 2 was the sharpest finding of the round, and it was not one of its own corrections.** Three
  arithmetic figures in the checker's comment block were wrong: `1 / 3326 = 0.0004` (it is 0.0003),
  *"4 in a 3018-line count moves the ratio by about 0.0005"* (it is 0.0013, off 2.4x), and *"a figure
  three thousand times off"* (999999/3326 = 300.7). Two of the three **understated or overstated in ways
  that flattered their own sentences** — a figure written down to support "this is immaterial" sits under
  pressure toward whichever side makes the sentence work. The 300x error was **inherited from round 12's
  recorded evidence**, so the verifier was correcting a defect this change had already accepted as
  measured. A fourth, the *"11.4%"* headroom, turned out to be **a correct answer to an older input**:
  `(ratio − 0.8)/ratio` at a ratio of 0.9030 gives 11.4%, and batch 16 reported 0.9034. It was not an
  arithmetic error at all; it was a figure that stayed true in its own arithmetic and went stale silently,
  which is harder to catch than a plain mistake. Both definitions are now stated, plus the number that
  does not move with the suite — the floor accepts an executed total up to **+25%**, against a measured
  honest gap of **+8.7%**.

  **NIT 4 — a list claimed something about its items, and the claim was checked.** `ROADMAP.md` said the
  five chain sections each state their own supersession; 8.29 does not, and does not need to, since its
  heading reads "the criterion is NOT met". **It was found by checking a list against its items rather
  than by reading the sentence**, which is the only method that has caught this family, every time.

  **Its non-findings are recorded so they are not re-derived as findings later.** P4 is genuinely
  redundant: removing `problems += 1` from the absent branch leaves all three absence shapes at exit 1
  with `corroborated` false, because any absent commit already forces `assertedHold` false. A log stamped
  literally `commit ABSENT` reads as present and prints `ok`, but `run-gate-batch.ps1` sets `$commit` to
  `"unknown"` or a 12-char `git rev-parse --short=12` and never to that string. A log with an empty
  `commit ` value reads as **absent** and is refused — correct and conservative. Its `commitNote`
  extractor **fails closed**: a wrong capture turns assertions red, not green. `MEMORY.md`'s "twelve
  rounds of shape assertions" is a past-tense count attached to one abandoned ladder, not a claim about
  the current total. A byte scan of 9,005 tracked `.md/.ts/.tsx/.mjs/.ps1/.yml/.json` files finds **0
  U+FFFD and 0 NUL**, the only literal being the regex that *checks* for U+FFFD.

  ### Accepted open residuals, recorded and NOT repaired

  The repair cycle ends here by the rule stated when round 17 was recorded: **a round returning no
  CRITICAL ends the cycle, and its remaining findings are recorded rather than repaired.** The reason is
  not that the findings are unimportant — it is that a process which repairs everything it is shown can
  be run forever, and seventeen rounds have produced this milestone's real content while also
  demonstrating that its own standard has a stopping problem. These are left open deliberately:

  - **CRITICAL 1 and CRITICAL 2** - two one-line edits can each make the archived gate's install cascade
    dead code, leaving 71/71 green. Named, measured, and **unclosable here**: the closing instrument is
    executing the gate, whose first step is a dependency install, and that is forbidden for this work.
  - **NIT 1 (accepted) - the absent count in the partly-absent message is pinned by no case.** Hard-coding
    `${absentCount}` to `1` is green: with 2 of 6 absent the checker still prints the right *class* of
    message, only the wrong number, in prose, in a batch that has already failed with exit 1. Pinning it
    would add a clause to guard a sentence, and **a clause guarding prose is the thing this change spent
    sixteen rounds dismantling.**
  - **Batches 16-20's recorded figures** - their logs were not supplied to round 18 and it declined to
    repeat them unverified. It did verify that all six named SHAs resolve and form the linear chain above.
  - **`openspec verify` does not exist as a subcommand**, so the verification-workflow step this change
    mandates has never been run as specified. The six independent rounds above were run by hand instead.
  - No browser verification of any kind. CI unobserved on this branch. Root `scripts/` and both
    archived `release-gate.mjs` copies remain outside every gate. The `encoding-integrity` BOM timeout's
    cause, the `vitest list` phantom-line mechanism, and the `readSteps` loudness trade remain unverified
    or open by decision. The lyrics `2 in 10` / `0 in 40` figures are observations, not proof.
  - Six sequential runs are **not a contention test**, and no batch's provenance is proved by its stamp.

## 8.42 Batch 22 at `bcebb1e`, and the rule that was unsatisfiable

  ```
  commit under test: bcebb1e7f28b
  run 1  exit 0   83s  files 182  tests 3342  motion-budget 21
  run 2  exit 0   84s  files 182  tests 3342  motion-budget 21
  run 3  exit 0   85s  files 182  tests 3342  motion-budget 21
  run 4  exit 0   83s  files 182  tests 3342  motion-budget 21
  run 5  exit 0   85s  files 182  tests 3342  motion-budget 21
  run 6  exit 0   84s  files 182  tests 3342  motion-budget 21
  ```

  Corroborator exit **0**, `corroborated`, six distinct whole-log digests, `commits named across the
  logs: bcebb1e7f28b (1 distinct of 6)`, `182` files asserted, `motion-budget 21` asserted, `3342`
  tests stability-only, enumeration `3020/3342 = 0.904` against a 0.8 floor.

  **The last finding of the milestone was found by me, after round 18 accepted the change.** Not in a
  verifier's report: in the five minutes between "the verifier says merge" and merging, while checking
  the precondition the new rule depended on. `ROADMAP.md` said the live batch is *"whichever entry's
  commit equals `main`'s merge commit"*. **A merge commit is a new commit — its SHA is by
  construction not any batch's SHA** — so the rule evaluated to *never*, and the file asserted that
  M21's completion criterion can never be met at the merge commit. The paragraph also claimed *"this
  is the last place in this file that will need amending on this account"*, on the sentence directly
  below the claim.

  **The tree is the invariant, not the commit.** Measured before the merge:
`git merge-base --is-ancestor origin/main HEAD` exits **0**, so merging PR #100 cleanly adds no tree
  change, and the merge commit's tree equals `bcebb1e`'s tree,
  `e3c8bcd891c1845aa827925c9493162f0bcb1500`. The rule is now stated over trees:

  ```bash
  git rev-parse <batch-commit>^{tree}   ==   git rev-parse <merge-commit>^{tree}
  ```

  **Why this is the same defect the milestone spent eighteen rounds auditing, in its purest form.** A
  batch is evidence about a *tree*, and the criterion was always about a tree — "six runs of one
  unchanged tree", in the corroborator's own words. Stating it over commit identity instead of tree
  identity is **a claim about the artefact stated as a claim about its label**: true of every batch,
  useless for every batch, and wrong in the one case that mattered. It is also why round 18 could not
  catch it: it was asked whether 8.38 was self-consistent, and 8.38 *was*. The unsatisfiable rule was
  written afterwards, in the file round 18 had already passed, by the repair for round 18's own
  finding. **A verifier reviews a tree. The next edit happens after the verdict, and that edit gets no
  review at all** — which is the structural gap this milestone never closed, and the honest reason its
  own standard could not terminate itself.

  **What would have caught it, and did not exist.** Any post-verdict commit needs a machine check, not
  a human reading: a rule in prose that must be satisfiable should be satisfiable *by construction* —
  expressed over an invariant (the tree) rather than over a label (the SHA). Every rule this milestone
  wrote about *counts* — three rungs, seven escapes, six restarts — had the same exposure and got away
  with it only because the numbers happened to stay right.

## 8.43 Batch 23 at `58d216b` - the criterion batch, and a rule that was wrong twice

  ```
  commit under test: bcebb1e7f28b
  run 1  exit 0   83s  files 182  tests 3342  motion-budget 21
  run 2  exit 0   84s  files 182  tests 3342  motion-budget 21
  run 3  exit 0   85s  files 182  tests 3342  motion-budget 21
  run 4  exit 0   83s  files 182  tests 3342  motion-budget 21
  run 5  exit 0   85s  files 182  tests 3342  motion-budget 21
  run 6  exit 0   84s  files 182  tests 3342  motion-budget 21
  ```

  Corroborator exit **0**, `corroborated`, six distinct whole-log digests, `commits named across the
  logs: bcebb1e7f28b (1 distinct of 6)`, `182` files asserted, `motion-budget 21` asserted, `3342`
  tests stability-only, enumeration `3020/3342 = 0.904` against a 0.8 floor.

  **Batch 23, at `58d216b`, is the criterion batch. 6 of 6 green, corroborated, exit 0**, six distinct
  whole-file SHA-256 (`20342c030dbf bce34a750d3b ab05f22f8943 8d4d61a4a3e3 88ceedca1ca0 6e297eaebd0d`),
  six distinct durations, six distinct write times, every log stamped `commit 58d216b95e51`,
  182 files, 3342 tests, motion-budget 21, enumeration `3020/3342 = 0.904`.

  Verified **independently of `verify-gate-batch.mjs`**, 9 of 9, because a checker that misreads its
  input reports its own misreading and is therefore not evidence about the logs:
  `git merge-base --is-ancestor origin/main 58d216b` exits **0**, so the merge adds no tree change and
  the merge commit's tree is `f4883d26ee62b1eebd4f4c28bb7900a54ae8ebd6` **in advance** — the criterion is
  therefore satisfiable, and no commit may follow this batch.

  **The rule was wrong twice in two consecutive commits, and the second error is the interesting one
  because the first repair created it.** Version 1 required an entry whose commit *SHA* equalled the
  merge commit's SHA — unsatisfiable, because a merge commit is new. The repair moved the invariant from
  SHA to TREE, which fixed that and in doing so made the rule **circular**: any in-repo record of a batch
  is itself a commit, so its tree can never equal the batched tree. **A rule demanding such a record can
  only ever be unsatisfied, and obeying it re-runs the batch forever.** This is arithmetic rather than
  convenience, which is the distinction worth keeping: round 17's finding, that I had left a live
  pointer naming a stale record, was a removable defect; this is not removable by any wording.

  **So the tree carries the rule that verifies the criterion, and the criterion batch's own record
  lives in PR #100's body** — a file that is not a repository file and therefore cannot invalidate the
  commit it certifies. That is the resolution the previous seventeen rounds kept circling without
  stating, and it is a rule with a failure mode: if the rule's two commands disagree, the fix is a
  **batch**, not an edit to the rule. **A rule whose failure is repairable only by editing the rule is
  not a rule** — which is this milestone's own subject, found in the one place it had just been used to
  stop.

  **What nineteen rounds actually produced, stated plainly.** Not a proof that the gate cannot lie —
  that claim was retired at round 12 and CRITICAL 1 and 2 remain open. What it produced is a mechanism
  for *noticing* when the gate is lying: mutation-proven clauses, a corroborator that refuses rather
  than warns, a batch whose provenance is stated as unprovable, eighteen independent rounds that each
  reproduced the previous round's defect class, and one class of defect that a reader can now check with
  two git commands. **The last of those is the only one that scales**, because it does not require
  someone to run another round.

  **The last finding of the milestone was found by me, after round 18 accepted the change.** Not in a
  verifier's report: in the five minutes between "the verifier says merge" and merging, while checking
  the precondition the new rule depended on. `ROADMAP.md` said the live batch is *"whichever entry's
  commit equals `main`'s merge commit"*. **A merge commit is a new commit — its SHA is by
  construction not any batch's SHA** — so the rule evaluated to *never*, and the file asserted that
  M21's completion criterion can never be met at the merge commit. The paragraph also claimed *"this
  is the last place in this file that will need amending on this account"*, on the sentence directly
  below the claim.

  **The tree is the invariant, not the commit.** Measured before the merge:
`git merge-base --is-ancestor origin/main HEAD` exits **0**, so merging PR #100 cleanly adds no tree
  change, and the merge commit's tree equals `bcebb1e`'s tree,
  `e3c8bcd891c1845aa827925c9493162f0bcb1500`. The rule is now stated over trees:

  ```bash
  git rev-parse <batch-commit>^{tree}   ==   git rev-parse <merge-commit>^{tree}
  ```

  **Why this is the same defect the milestone spent eighteen rounds auditing, in its purest form.** A
  batch is evidence about a *tree*, and the criterion was always about a tree — "six runs of one
  unchanged tree", in the corroborator's own words. Stating it over commit identity instead of tree
  identity is **a claim about the artefact stated as a claim about its label**: true of every batch,
  useless for every batch, and wrong in the one case that mattered. It is also why round 18 could not
  catch it: it was asked whether 8.38 was self-consistent, and 8.38 *was*. The unsatisfiable rule was
  written afterwards, in the file round 18 had already passed, by the repair for round 18's own
  finding. **A verifier reviews a tree. The next edit happens after the verdict, and that edit gets no
  review at all** — which is the structural gap this milestone never closed, and the honest reason its
  own standard could not terminate itself.

  **What would have caught it, and did not exist.** Any post-verdict commit needs a machine check, not
  a human reading: a rule in prose that must be satisfiable should be satisfiable *by construction* —
  expressed over an invariant (the tree) rather than over a label (the SHA). Every rule this milestone
  wrote about *counts* — three rungs, seven escapes, six restarts — had the same exposure and got away
  with it only because the numbers happened to stay right.
