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

- [ ] 5.1 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`, `npm test`,
      `npm --prefix frontend run icons:check`, `npm --prefix frontend run ps:check` — each run, each exit 0.
- [ ] 5.2 `openspec validate close-gate-coverage-gaps --strict` and `openspec validate --specs --strict`.
- [ ] 5.3 Prove the guard's own cost: record how long the coverage check adds to `npm test`, since it
      spawns ESLint. Verify: the number is recorded whether or not it is acceptable, and if it is not,
      the design is revisited rather than the number reinterpreted.
- [ ] 5.4 Six `npm run gate` runs plus the corroborator, run as the driver prints it, recording the commit
      and tree the batch measured.
- [ ] 5.5 Record commit, tree and merge-base in the **PR body**, not in this file.
- [ ] 5.6 Commit, push, PR, merge with a merge commit, delete the branch.
- [ ] 5.7 Sync the delta into `openspec/specs/`, archive, and record the outcome in `ROADMAP.md`.

> **Known limitation, recorded not resolved:** no browser is attached in this environment, so nothing here
> is visually verified. This change touches no application source, which bounds the claim rather than
> satisfying it — recorded as UNVERIFIED in the PR body.
