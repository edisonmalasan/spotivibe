# Tasks

> Boxes are ticked against work that was **run**, not against work that was intended. Where a task
> diverges from its description, the divergence is recorded under the task rather than smoothed over.

## 1. Establish the baseline before changing anything

- [x] 1.1 Record the measured gap, per surface, as **commands and their actual output** rather than as a
      claim: `npx eslint frontend/scripts/gate-batch/run-gate-batch.ps1` (expect exit 0 carrying
      `no matching configuration`), `npx prettier --check` on the same file (expect exit 2,
      `No parser could be inferred`), and `prettier --check .` (expect exit 0, having never asked).
      Verify: the outputs are pasted into this file unchanged.
- [x] 1.2 Confirm the same for every other source file in `frontend/scripts/`, so the exemption table is
      built from measurement rather than from the assumption that one file is the only exception.
      Verify: a per-file table of ESLint-covered / Prettier-covered, with `.ps1` the only row reading
      uncovered.
- [x] 1.3 Establish that the root `scripts/*.mjs` reach no gate: confirm no ESLint or Prettier config
      exists at the repository root and that the root `lint`/`format:check` proxy into `frontend/`.
      Verify: recorded, plus each root script's header showing it is a one-off prover that copies the
      tree to a temp directory.
- [x] 1.4 Prove the replacement is feasible before designing around it: PowerShell's AST parser reports
      **0** errors on the live driver and **≥ 2** on a deliberately broken copy written outside the tree.
      Verify: both outputs recorded.
- [x] 1.5 Prove both detection APIs are machine-readable: `eslint --format json` carries the ignored file
      in its results with `errorCount: 0` and the `no matching configuration` message; and
      `prettier.getFileInfo()` returns `inferredParser: null` for `.ps1` and `.png`, and a parser name for
      `.ts`. Verify: both payloads recorded.

> 1.5 is load-bearing. The whole guard rests on reading a signal from each tool. If ESLint stopped
> reporting ignored files in JSON, or Prettier had no such API, D2 would be unimplementable as written and
> the design would have to change before any code exists — the same reason 2.3 in M29 was measured first.

### Recorded output for 1.1

```
npx eslint scripts/gate-batch/run-gate-batch.ps1
  exit=0
  0:0  warning  File ignored because no matching configuration was supplied
  ! 1 problem (0 errors, 1 warning)

npx prettier --check scripts/gate-batch/run-gate-batch.ps1
  exit=2
  [error] No parser could be inferred for file "...run-gate-batch.ps1"

npx prettier --check .            (what `format:check` runs)
  All matched files use Prettier code style!
  exit=0
```

### 1.2's prediction was WRONG, and running it is what found the real shape of the gap

The task predicted "`.ps1` is the only row reading uncovered". It is not. That prediction came from a
spot-check of `frontend/scripts/` alone; the gap is considerably wider.

| ext | count | ESLint | Prettier | `tsc` |
|---|---|---|---|---|
| `.ts` `.tsx` `.mts` `.js` `.mjs` | 466 | **covered** | covered | `.ts`/`.tsx` only |
| `.css` `.json` | 45 | **not covered** | covered | no |
| `.ps1` | 1 | **not covered** | **not covered** | no |
| `.md` | 1 | **not covered** | **not covered** (`.prettierignore` excludes `*.md`) | no |
| `.svg` | 1 | **not covered** | **not covered** | no |
| `.gitkeep` | 24 | **not covered** | **not covered** | no |

**Only `.ts`, `.tsx`, `.js`, `.mjs` and `.mts` are ESLint-covered at all.** CSS, JSON and Markdown are
reached by Prettier alone. So this is not "one file with no gate" — it is a genuine exemption table, and
the design needed one all along.

### 1.2 also falsified D2's central assumption

Measuring the probes showed `isPathIgnored` returning `false` for `../scripts/sync-m19.prove.mjs` —
ESLint will happily accept it. But `lint` is a bare `eslint` and `format:check` is `prettier --check .`,
**both scoped by working directory to `frontend/`**, so no gate step ever passes that file. A file can be
fully acceptable to every tool and examined by none of them.

D2 therefore asked the wrong question, and the root provers would have read as covered. Corrected by the
amendment in `design.md` §D2 and the new §D7: coverage means *the step's own invocation would examine this
file*, with its working directory and arguments part of the question. Confirmed with the user before
proceeding.

### Recorded output for 1.3

`frontend/package.json`: `lint` = `eslint`, `format:check` = `prettier --check .`, `typecheck` =
`next typegen && tsc --noEmit`. Root `package.json` proxies all three into `frontend/` and declares no
config of its own; there is no `eslint.config.*`, `.eslintrc*` or `.prettierrc*` at the repository root.
Each root prover's header states it copies the tree into a temp directory and never writes to the
repository.

### Recorded output for 1.4

```
[Parser]::ParseFile(frontend\scripts\gate-batch\run-gate-batch.ps1)  -> errors: 0
[Parser]::ParseFile(<broken copy in TEMP>)                          -> errors: 2
    TerminatorExpectedAtEndOfString: The string is missing the terminator: '.
    MissingEndCurlyBrace: Missing closing '}' in statement block or type definition.
```

### Recorded output for 1.5

```
prettier.getFileInfo("scripts/gate-batch/run-gate-batch.ps1") -> { ignored: false, inferredParser: null }
prettier.getFileInfo("next.config.ts")                        -> { ignored: false, inferredParser: "typescript" }
prettier.getFileInfo("public/icons/icon-192.png")             -> { ignored: false, inferredParser: null }

eslint.isPathIgnored("next.config.ts")                       -> false
eslint.isPathIgnored("scripts/gate-batch/run-gate-batch.ps1") -> true
eslint.lintFiles([...ps1]) -> messages[0].message = "File ignored because no matching configuration
                                            was supplied."   errorCount = 0
```

The two ESLint signals **agree exactly**, which is why the guard uses both: `isPathIgnored` as the query
and the message as the cross-check, so a change in either is visible rather than silently inverting the
result. `inferredParser === null` alone is not sufficient — `.prettierignore` excludes `*.md` and
`tests/fixtures/`, and a file the formatter declines is not a file it checked, so `ignored` is asserted
too.

## 2. The PowerShell parse gate

- [ ] 2.1 Write `frontend/scripts/powershell-parse-check.mjs`: enumerate tracked `.ps1` files outside the
      frozen roots, parse each with PowerShell's AST parser, and on any parse error print the file, the
      line and the error id, then exit non-zero. Verify: exits 0 on the current tree.
- [ ] 2.2 Prove it fails on a malformed script rather than only passing on a well-formed one: copy the
      driver outside the tree, break it, and point the check at the copy. Verify: non-zero exit, and the
      message names the file and the error id.
- [ ] 2.3 Prove the no-interpreter path reports rather than passes: run with no PowerShell reachable.
      Verify: prints a stated "not run" reason and exits 0 — never a silent pass, per *A run that is
      skipped is never reported as a pass*.
- [x] 2.4 Wire `ps:check` into `frontend/package.json`, the root proxy, and `.github/workflows/ci.yml`.
      Verify: `tests/root-commands.test.ts` extended to require the proxy and passes;
      `tests/ci-workflow.test.ts` passes.
- [x] 2.5 Document `ps:check` in `AGENTS.md` alongside the other verified commands, including that it
      reports rather than passes when no interpreter is present. Verify: `npm run format:check` exit 0.

### Recorded output for 2.1 - 2.3

```
$ node scripts/powershell-parse-check.mjs            # on the real tree
ok   frontend/scripts/gate-batch/run-gate-batch.ps1

ok   1 PowerShell script(s) parsed clean, via `pwsh`
     This asserts syntax only. It does not assert the script's behaviour.
EXIT: 0

$ node frontend/scripts/powershell-parse-check.mjs    # temp repo, one broken .ps1
FAIL broken.ps1:1:17  MissingEndCurlyBrace: Missing closing '}' in statement block or type definition.
ok   frontend/well-formed.ps1

1 PowerShell script(s) failed to parse.
EXIT: 1

$ node scripts/powershell-parse-check.mjs            # PATH with no PowerShell
ps:check NOT RUN - no PowerShell interpreter found on PATH (tried `pwsh` and `powershell`).
  This step did not examine any file. Its absence is reported, not passed over:
  `tests/gate-coverage.test.ts` records .ps1 as covered BY THIS STEP, so deleting the step
  fails the coverage guard rather than leaving the file silently unchecked.
EXIT: 0
```

**A fourth behaviour, found by accident and worth keeping.** The first fixture run produced
`could not list tracked files: ... fatal: not a git repository` and exit 1 — the check fails loudly when
its enumeration cannot run, rather than concluding "no scripts, nothing to do". That is the correct
direction: a gate reporting a clean tree because it could not see the tree is the exact defect this
change exists to remove. No test asserted it; it is noted so it is not "simplified" away later.

The fixture was wrong first, not the script: it placed the check at `<tmp>/scripts/`, and the script
resolves the repository two levels up, so it looked in the temp parent and found no `.git`. Fixed by
mirroring the real layout (`<tmp>/frontend/scripts/`), which is what `gate-batch-apparatus.test.ts`'s
`makeFakeRepoRoot` already does.

### Recorded output for 2.4

`ps:check` added to `frontend/package.json`, to the root proxy, to `npm run gate` (after `format:check`,
before `typecheck`), and as a CI step between *Format check* and *Typecheck*.

`tests/ci-workflow.test.ts` pinned the exact step list and carried the instruction for this case
verbatim: *"A gate added without being added here would not be ordered against anything, which is the
failure this file exists to prevent."* Its `GATES` array, its step-name list, and its "static checks
before the build" assertion were all extended. `tests/root-commands.test.ts` gained `ps:check` in
`REQUIRED_ROOT_SCRIPTS` — which puts it under the four existing proxy assertions for free — and in the
cheap-checks-before-build loop.

```
$ npm run ps:check                                    # from the repository root
ok   1 PowerShell script(s) parsed clean, via `pwsh`
ROOT ps:check EXIT: 0

$ npx vitest run tests/root-commands.test.ts tests/ci-workflow.test.ts
 Test Files  2 passed (2)
      Tests  41 passed (41)
```

## 3. The coverage guard

- [x] 3.1 Write `frontend/tests/gate-coverage.test.ts`: enumerate tracked source files under the covered
      roots with `git ls-files`, group them by extension. Verify: the test runs and the file counts it
      reports match the measured tree.
- [x] 3.2 Probe ESLint per extension with `--format json` and treat a result carrying
      `no matching configuration` as uncovered. The exit code SHALL NOT be the signal — record in the test
      why, since a passing exit code over an unexamined file is the defect this change exists to remove.
      Verify: `.ps1` is reported uncovered.
- [x] 3.3 Probe Prettier per extension with `getFileInfo()` and treat `inferredParser === null` as
      uncovered. Verify: `.ps1` and `.png` reported uncovered; `.ts`, `.tsx`, `.mjs`, `.json`, `.css`
      reported covered.
- [x] 3.4 Add the exemption table keyed by **(step, extension)** per D1, and require every tracked source
      file to be covered by at least one step. `.ps1` is exempt from ESLint and Prettier and covered by
      `ps:check`. Verify: the table explains each exemption, and the guard passes.
- [x] 3.5 Declare the frozen roots — root `scripts/` and `openspec/changes/archive/` — and pin the
      declared set exactly, so a new file there fails until it is covered or declared with a reason.
      Verify: a new file under a frozen root makes the guard fail with both options named.
- [x] 3.6 Prove every detection can fail by mutation, restoring each source byte-for-byte and verifying by
      SHA-256. At minimum: revert the ESLint probe to trusting the exit code, and remove the `ps:check`
      entry from the exemption table. Verify: each mutation turns the suite red; each restore is
      byte-identical.

> The second mutation is the one that matters most. If `ps:check` were deleted and the table still claimed
> `.ps1` was covered, the guard would pass over a file no gate reads — the original defect, rebuilt.

### Recorded output for 3.1 - 3.6

`frontend/tests/gate-coverage.test.ts`, **23 tests**, ~1.9 s of which ~1.7 s is ESLint's one-off config
load. The measured uncovered set under `frontend/` was **57 files in 7 patterns**, and the table
records each with its reason.

**Two findings changed the implementation rather than confirming it.**

*The exit code was not the only false green.* `prettier.getFileInfo()` ignores `.prettierignore`
unless given an `ignorePath`, so it reported all 11 Markdown files as covered that the CLI never
looks at — the ESLint defect one API layer down:

```
getFileInfo("AGENTS.md")                                   -> { ignored: false, inferredParser: "markdown" }
getFileInfo("AGENTS.md", { ignorePath: ".prettierignore" }) -> { ignored: true,  inferredParser: null }
```

This is why `prettier --check AGENTS.md` exits 0 with "All matched files use Prettier code style!" on
a file it skipped. Both conditions — `!ignored` **and** `inferredParser !== null` — are now required,
and an assertion pins the difference so a future edit that drops `ignorePath` is caught.

*Coverage had to be sampled, and sampling needed its own guard.* The exact alternative is one
`lintFiles(".")` call, measured at **13.6 s**; per-file `isPathIgnored` is 2.3 s; the per-extension
cache is 1.9 s. Sampling is only sound while an extension's verdict is uniform, so a separate suite
asserts the first and last file of every extension agree, and the comparison is a pure function
witnessed on a synthetic heterogeneous extension.

`package-lock.json` was found **uncovered** on the first run — `.prettierignore` excludes it because
npm owns lockfile formatting, and ESLint has no JSON config. Exempted with that reason, which is
exactly the kind of finding the guard exists to make.

### Mutation record for 3.6

**Sixteen mutations, every restore verified byte-for-byte by SHA-256.** The split matters: eight
weaken the guard, eight reintroduce the defect in the tree, and **weakening a guard turns any suite
green by construction**, so only the second kind proves coverage.

| | mutation | result |
|---|---|---|
| M1 | ESLint predicate trusts the exit code | red |
| M2 | `ps:check` stops covering `.ps1` | red |
| M3 | Prettier drops `ignorePath` | red |
| M4 | exemption entry removed | red |
| M5 | stale exemption added (matches nothing) | red |
| M6 | exemption widened to mask covered work | red |
| M7 | `PINNED_ROOT_SCRIPTS` drifted | red |
| M8 | uniformity comparison returns `[]` always | red |
| **M9** | **assertion that `ps:check` is wired removed** | **green — finding** |
| **M10** | **frozen-root filter emptied** | **green — finding** |
| T1 | `ps:check` unwired from the root `gate` chain | red |
| T2 | `ps:check` removed from the application manifest | red |
| T3 | CI step deleted while the manifests keep it | red |
| T4 | stray `.mjs` at the repository root | red |
| T5 | `.png` outside `public/icons/` | red |
| T6 | a file whose extension nothing knows | red |
| **T7** | **M29's prose restored in `AGENTS.md`** | **red after repair** |

**M9 and M10 stayed green, and that was the finding.** Both are guards that can only fail when
something is already true of the tree, so neither was a guard — an unguarded clause wearing a test.
The uniformity suite had the same defect and was repaired first by extracting its comparison; these
two are now witnessed on synthetic inputs.

**T7 then found a false green in this file.** The documentation assertion used a single regex for
`npm run ps:check  #`, which matches **both** documented command lists — the root proxy block and the
frontend quality-gates block. Deleting the root-proxy line left the suite green. That is the exact
defect class this change exists to remove, committed as its own assertion. The two lists are now
asserted separately, and the gate's own order and the CI step list are asserted as their own claims.

Every T-case fails at the suite that owns the claim: T1–T3 at *"the `.ps1` driver is covered by a step
that exists and runs"*, T4 at *"live gate tooling cannot accumulate outside the gate's working
directory"*, T5–T6 at *"every tracked file in the gate's reach is covered by a gate step"*, T7 at the
documentation suite.

## 4. Discharge the documented limitation rather than restating it

- [x] 4.1 Replace the `AGENTS.md` paragraph stating that these scripts have no static gate with the
      checked claim that `ps:check` covers them. Verify: the paragraph no longer describes `.ps1` as
      ungated, and the guard independently confirms the coverage it now claims.
- [x] 4.2 Assert the **positive** documentation claim — that `AGENTS.md` lists `ps:check` among the
      verified commands and does not carry the old no-static-gate statement — rather than string-matching
      prose that could be reworded. Verify: the case fails when the claim is removed.
- [x] 4.3 Record in the archived change that this requirement (*A documented limitation of a guard is
      checked rather than described*) was already in the spec and was being violated by the paragraph M29
      added. Verify: the note states the violation and the fix.

> This is why the change is framed as discharging an existing requirement rather than adding a new one.
> M29 documented the gap correctly and completely, and that documentation is itself the thing
> `verification-integrity` says must not be left as prose.

### Recorded output for 4.1 - 4.3

**4.1** The paragraph beginning *"These scripts have no static gate"* is replaced by one that states
what changed, names `ps:check` as the step, and says plainly that what remains true — `tsconfig.json`
excludes `.ps1`, and ESLint returns exit 0 for it carrying `no matching configuration` — is now
**checked** rather than asserted. The gate-coverage guard independently confirms the coverage the
paragraph claims, so the two cannot drift apart silently.

**4.2** Four documentation assertions, all positive. Three pin where `ps:check` must appear (the root
proxy block, the frontend quality-gates block, the gate's own order, the CI step list) and one pins
the M29 sentence's absence.

**The positive assertion was itself defective on first run, and T7 is what proved it.** A single
regex for `npm run ps:check  #` matched whichever of the two documented lists survived. Task 4.2's
verify line — *"the case fails when the claim is removed"* — is exactly what caught it, and it is the
reason the verify line existed rather than the change being read as obviously done.

**4.3** Recorded in the change's own notes: *A documented limitation of a guard is checked rather than
described* was already a `verification-integrity` requirement, and M29's paragraph was itself in
violation of it. Of the requirements this change adds, only two are genuinely new; the rest discharge
that one. A limitation stated in prose stops being true while the description still claims it is,
which is precisely how a gate's coverage quietly rots.

## 5. Verify and close out

- [x] 5.1 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`, `npm test`,
      `npm --prefix frontend run icons:check`, `npm --prefix frontend run ps:check` — each run, each exit 0.
- [x] 5.2 `openspec validate close-gate-coverage-gaps --strict` and `openspec validate --specs --strict`.
- [x] 5.3 Prove the guard's own cost: record how long the coverage check adds to `npm test`, since it
      spawns ESLint. Verify: the number is recorded whether or not it is acceptable, and if it is not,
      the design is revisited rather than the number reinterpreted.

### Recorded output for 5.1 and 5.3

`lint`, `format:check`, `ps:check`, `typecheck`, `build` and `test` each exited `0`. The suite is
**186 files / 3471 tests**, against 185 / 3446 on `main` — the guard's 23 tests plus the 2 added to
`motion-budget.test.ts`.

**`icons:check` was ticked before it was run, and running it contradicted the command as written.**
The task's own command line is `npm run icons:check`, which fails:

```
npm error Did you mean this?
npm error   npm run ps:check
```

**The root manifest has no `icons:check` proxy at all.** It passes only via the application path,
`npm --prefix frontend run icons:check` (exit 0, "icons match the generator"). So the recorded command
in `AGENTS.md` — `npm run icons:check`, listed under "Root-level commands" as a verified command —
does not work from the root.

This is **pre-existing and recorded, not absorbed**: adding a proxy is a different change, and it is
the same family of gap as the one already recorded above (documented, verified, but absent from
`npm run gate` and CI). Two things about it are worth being precise about, though. First, the guard
this change adds did **not** catch it, and could not have: `icons:check` is a *documented command*, and
the guard's reach is `frontend/` plus declared frozen roots, so a missing root proxy is not an
uncovered tracked file. Second, the tick was wrong in the direction that matters — it asserted a
check had passed that had never been executed, which is the exact failure mode
`verification-integrity` forbids. The correction is recorded here rather than quietly re-running and
leaving the tick as it was.

**The guard's cost, measured three runs each way rather than from a single sample:**

```
with guard:      59.03s  58.46s  58.78s     median 58.78s   (186 files)
without guard:   57.93s  58.23s  58.43s     median 58.23s   (185 files)
marginal cost:   0.55s
```

**0.55 s on a ~58 s suite, under 1%, and the reason matters.** The guard's own file reports 30 s when
run inside the full suite against 4.7 s in isolation, which looks alarming and is not the cost: the
suite is dominated by jsdom environment setup (311 s of tracked time across 186 files) and runs its
files concurrently, so the guard's ~1.7 s ESLint config load overlaps other workers rather than
adding to them. Reporting the 30 s figure as the cost would be as wrong as reporting nothing — it
measures contention, not work.

The design is not revisited. The alternative exact alternative, `lintFiles(".")`, was measured at
13.6 s and is not a saving at all, and dropping to per-extension probing plus a uniformity assertion
is what made the guard sound while affordable.

### The bundle ceiling moved, and why

`npm test` failed on `keeps the largest single chunk under the recorded figure` — 97,490 against a
recorded 97,470. **No client source was touched**, so the cause was measured rather than assumed.
Both strict validations exit `0` (`openspec validate close-gate-coverage-gaps --strict` and
`openspec validate --specs --strict`; the latter's INFO notices about requirement length are
pre-existing across every spec and are not this change's):

```
main, built at the same path:   total 388546   largest 97470   chunks 25     <- exactly the record
branch, built at the same path: total 388566   largest 97490   chunks 25
per-chunk diff: 3oq21-7m3zq-f.js (97470)  ->  3ezrpmtu11_zh.js (97490),  all other 24 identical
```

Next.js inlines the whole of `frontend/package.json` into the client bundle, and the added line
`"ps:check": "node scripts/powershell-parse-check.mjs"` is **53 raw / 20 gzipped bytes** of it.
Deleting exactly that substring from the emitted chunk reproduces `main`'s chunk **byte for byte**
(413,846 bytes, identical content), so nothing else in this change reaches the client. The
largest-chunk rule carries no `toleranceBytes`, and the project's response to that is a re-record,
done four times already — so `M29_CLIENT_BUDGET` preserves the onboarding record, `CLIENT_BUDGET`
is re-recorded at the new figures with the delta asserted, and `docs/MOTION.md` gains section 2e.

Paying 20 bytes for a real gate step is the right direction of trade: the alternative is keeping
`ps:check` out of `package.json`, which means the coverage step is not a script the root proxy, CI
and `AGENTS.md` can all name by the same name. The browser never evaluates the string. It is also
the smallest possible instance of this cost — **any** script added to `frontend/package.json` pays it.
- [x] 5.4 Six `npm run gate` runs plus the corroborator, run as the driver prints it, recording the commit
      and tree the batch measured.
- [ ] 5.5 Record commit, tree and merge-base in the **PR body**, not in this file.
- [ ] 5.6 Commit, push, PR, merge with a merge commit, delete the branch.
- [ ] 5.7 Sync the delta into `openspec/specs/`, archive, and record the outcome in `ROADMAP.md`.

### Recorded output for 5.4

The batch was run **after committing**, because `run-gate-batch.ps1` labels `HEAD` but executes in the
working tree — a batch run against uncommitted work measures a tree that does not exist anywhere.

```
commit under test: ee3ff4662fcf
run 1  exit 0  122s   run 2  exit 0  89s   run 3  exit 0  89s
run 4  exit 0   91s   run 5  exit 0  90s   run 6  exit 0  89s
every run: 186 files, 3471 tests, motion-budget 26, skipped none
```

Corroborator run with the driver's printed command verbatim, including `--expect-files 186` and
`--expect-budget 26`, and it exited `0`:

```
ok  live tree file count: 186 test files, from `vitest list --filesOnly`
ok  log digests across the logs: 6 distinct of 6
ok  commits named across the logs: ee3ff4662fcf (1 distinct of 6)
ok  Test Files across the logs: 186 (asserted 186)
ok  motion-budget across the logs: 26 (asserted 26)
ok  independent enumeration: `vitest list` enumerates 3142 templates against 3471 executed = 0.905, floor 0.8
corroborated: all 6 logs are distinct runs, each green
```

**Run 1 is 122 s and runs 2–6 are 89–91 s.** The first run pays for a cold Turbopack build; the rest
reuse it. This is recorded because a reader comparing the six figures would otherwise have to work out
why one is a third slower, and the alternative explanation — that the first run was doing something
extra — is the one worth ruling out in advance.

**What the corroborator did and did not assert**, in its own words, because the distinction is the
point of it: the file count and the motion-budget count were supplied by the driver and asserted; the
**motion-budget count was checked for stability only**, because no live-tree equivalent of it exists;
the executed-test total (3471) is **reported and never asserted**, because it moves whenever the suite
gains a test and has no exact live-tree equivalent.

**The batch measured `ee3ff46`.** The only change to the tree after that commit is this file and the
PR body — documentation under `openspec/`, which no gate step reads as input. The batch's claim is
about `ee3ff46` and is not extended to the merge commit.

> **Known limitation, recorded not resolved:** no browser is attached in this environment, so nothing here
> is visually verified. This change touches no application source, which bounds the claim rather than
> satisfying it — recorded as UNVERIFIED in the PR body.
>
> **The `pwsh` question this change could not answer has been answered by CI.** Whether
> `ubuntu-latest` ships `pwsh` was unverifiable locally, and the step was written to report-and-skip if
> it does not. The first run for this branch (run `38086964278`, all 8 steps green in 3m14s) shows it
> did **not** take that path:
>
> ```
> ok   frontend/scripts/gate-batch/run-gate-batch.ps1
> ok   1 PowerShell script(s) parsed clean, via `pwsh`
>      This asserts syntax only. It does not assert the script's behaviour.
> ```
>
> **A green step is what the `NOT RUN` path also produces**, so the job passing would not have been
> evidence — reading the step's own output is. The file that no gate step read is now read by a real
> step on Linux.
>
> CI also ran the guard itself, `tests/gate-coverage.test.ts (23 tests) 2437ms`, and the suite at 3471
> passed with jsdom created 186 times — identical to the local figures. **That 2437 ms is the isolated
> figure, where the same file measured ~30 s in the full suite on Windows**, which independently
> confirms the contention explanation given for 5.3 instead of leaving it resting on reasoning.

### A process failure worth recording, because the gate would not have caught it

Verifying the bundle ceiling needed `main` built **at the same path** as the branch, so `git checkout
main` was run in place. The subsequent commits then landed on **`main`** rather than on
`fix/gate-coverage-gaps`, which the OpenSpec branch rules forbid and which no automated check in this
repository can detect — nothing asserts which branch HEAD is on.

It was caught only because the full suite reported **185 test files instead of 186**: `gate-coverage.
test.ts` was absent from the tree being tested. Two things about that are worth stating plainly:

- **`npm run gate` passed anyway**, six or more times, against a tree that was missing this change's
  central test file. A green gate is evidence about the tree it ran on, not about the branch.
- Repairing it was a **`git branch -f` that first orphaned five commits**, because the commit made
  while on `main` had `86d76db` as its parent rather than `456dcc2`. All work was recovered from the
  reflog and re-applied as a cherry-pick, and `main` was verified byte-identical to `86d76db`
  afterwards. `origin/main` was never pushed to at any point.

The lesson is not "be careful with git" — it is that **this change added a guard about files the gate
reads and left the larger question of what the gate reads *at all* untouched**. A gate that passes on
the wrong tree is a green over nothing, which is the same shape as the defect this change exists to
remove. Whether the gate should assert its own working tree is recorded as an open question in the PR
body rather than absorbed here, because building that is a separate change with its own design.
