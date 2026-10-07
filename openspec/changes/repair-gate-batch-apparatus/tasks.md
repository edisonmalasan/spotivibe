# Tasks

Each task states how it is verified. Verification evidence must distinguish an automated test, a
static check, a runtime command, and an inference; and a task is not complete because its code
compiles.

**Standing constraint for every group:** the archived originals under
`openspec/changes/archive/2026-10-05-harden-post-v1-verification/evidence/` are frozen and must remain
byte-for-byte unchanged. Any group that touches the canonical copies re-verifies the archived hashes
rather than assuming it did not.

## 1. Canonical home

- [x] 1.1 Copy `run-gate-batch.ps1` and `verify-gate-batch.mjs` to `frontend/scripts/gate-batch/`, and
      verify by SHA-256 that each copy is byte-identical to its archived original
      — **DONE.** Both `identical=True` against the archived originals.
- [x] 1.2 Record the archived pair's hashes in this file, and verify `git status` shows no modification
      to anything under `openspec/changes/archive/` — the copies are new files, not a move
      — **DONE.** Hashes recorded under §1.2 below; `git diff --name-only HEAD -- openspec/changes/archive`
      returned nothing, and `git status --porcelain` shows only `?? frontend/scripts/gate-batch/`.

### 1.2 Archived originals — frozen, SHA-256 as of `073a441`

```
openspec/changes/archive/2026-10-05-harden-post-v1-verification/evidence/run-gate-batch.ps1
  1eefeeeb5bba598cfbea273f7a79a2bb6f8143250c40569c615c9b28277799fd
openspec/changes/archive/2026-10-05-harden-post-v1-verification/evidence/verify-gate-batch.mjs
  65c81e956e16cc9da64a475839280b2c98668fb57d57fffab5cb8ce08a22f451
```

**These are the frozen record and must not change.** The canonical copies at
`frontend/scripts/gate-batch/` are *expected* to differ from these hashes from task 1.3 onward, and
every later group re-checks that the two hashes above still match the files on disk rather than
assuming no group touched the archive.
- [x] 1.3 Add a header to each canonical copy naming the canonical path and stating that the archived
      copies are M21's frozen record and are deliberately unrepaired, and verify by test that the
      archived pair does **not** carry that header (which is what proves the archive was not edited)
      — **DONE.** Headers added to both canonical copies. `gate-batch-apparatus.test.ts` asserts the
      header's **presence** in each canonical copy and its **absence** in each archived one; the
      negative direction is load-bearing, because a header on both pairs would satisfy the positive
      assertion while silently rewriting M21's record.

> **A defect this milestone's own tooling caught in me.** While writing the usage block I added
> `[-NoLogo]` to the printed invocation. **The script has no such parameter.** Running the printed
> interface verbatim — which task 2.4 requires — failed immediately. That is precisely the defect
> class this milestone repairs (a printed path that nothing can run), reproduced in the repair itself,
> and it was removed rather than documented as intended-but-unimplemented.

## 2. Driver: resolution, dry mode, interface

- [x] 2.1 Replace the four-`Split-Path -Parent` root computation with a walk upward from
      `$PSScriptRoot` until a directory containing `frontend\package.json` is found, preserving the
      fail-loud guard, and verify by running the driver with `-Runs 0` from the canonical home and
      observing the reported root is the repository root
      — **DONE.** Observed root `C:\Users\Edison\Desktop\Projects\spotivibe`, having examined
      `frontend\scripts\gate-batch -> frontend\scripts -> frontend -> <repo>`. The guard is preserved
      and now reports what it searched.
- [x] 2.2 Verify the "no marker found" path still fails loudly: drop a copy of the driver into a
      temporary tree with no `frontend\package.json` above it, run it, and confirm a non-zero exit that
      names the directory it started from and the directories it examined
      — **DONE.** `EXIT=1`, and the message enumerated all ten directories walked, `…\a\b\c` through
      `C:\`. Verified first that no temp ancestor contains the marker, so the case cannot pass for the
      wrong reason.
- [x] 2.3 Make `-Runs 0` an explicit dry mode that resolves the root, prints the completion command,
      prints a `DRY RUN — no gate was invoked — this is not criterion evidence` line, and exits 0,
      and verify by test that the line is present when `$Runs` is below 1 and absent otherwise
      — **DONE.** Line observed, `EXIT=0`, and a dry run writes **no** logs (asserted), so it cannot
      corroborate anything. "Absent otherwise" is asserted **structurally** on the `$Runs -lt 1` guard,
      because asserting it at runtime would mean running a real gate.
- [x] 2.4 Correct the usage block so it names an interpreter that is actually installed and does not
      claim a PowerShell edition the implementation does not target, and verify by **executing the
      printed usage verbatim** — not by comparing text against a second copy of the same claim
      — **DONE.** The `pwsh -File` line is now `powershell -File`, which runs here; `pwsh` is documented
      as also acceptable. Executing the printed line is what exposed the `[-NoLogo]` defect recorded
      under 1.3.
- [x] 2.5 Add tests that resolve the root from at least three nesting depths — the canonical home, an
      active-change-shaped tree, and an archive-shaped tree one level deeper — and require the same
      root from each; verify by reverting the walk-up to parent-counting and confirming the
      archive-shaped case turns red
      — **DONE.** **Four** depths, not three: canonical home, active-change, archived-change, and a
      six-deep unrelated shape. All resolve the same fake root.
      **Mutation proved the detector can fail** — reverting to the four-parent count turned **3 of 13**
      red: the depth case resolved `…\Local\Temp` instead of the fake root, the no-marker case exited
      **0** instead of non-zero, and the structural detector lost its `while ($true)`. Source restored
      and confirmed.
- [x] 2.6 Verify `frontend/tests/evidence-scripts.test.ts` still passes unmodified, which is the check
      that the frozen archive remains intact and that this change did not repoint it
      — **DONE.** Both suites together: **2 files, 41 tests passed**. Archived SHA-256 re-checked
      against §1.2 after every mutation.

> **Interpreter gating, stated rather than hidden.** CI runs `ubuntu-latest`, where PowerShell 7 exists
> as `pwsh` but the `powershell` binary named by the usage block does not. The behavioural cases
> therefore resolve an available interpreter at runtime (`named -> pwsh -> powershell`) and **skip with
> a stated reason where none exists**. All 13 cases ran here on Windows PowerShell 5.1. A skipped case
> is reported as skipped, never as a pass.

## 3. Corroborator: diagnosable asserted defaults

- [ ] 3.1 Change the figure-mismatch diagnostic to name the figure observed, the figure expected, and
      that the built-in default belongs to a named earlier tree, and verify by test that a provoked
      mismatch on a fixture contains all three
- [ ] 3.2 Verify an explicitly supplied `--expect-files`/`--expect-budget` is asserted against and
      never falls back to the default, by test
- [ ] 3.3 Prove the diagnostic cannot be silently weakened: remove each of the three named elements in
      turn, confirm the corresponding assertion turns red, and restore the source byte-for-byte
- [ ] 3.4 Verify the corroborator still refuses a batch whose logs are not distinct, and one whose
      six logs do not all name a single commit, so the repair did not weaken any existing refusal

## 4. Gate coverage and usage note

- [ ] 4.1 **Measure** which gates actually cover each new file — `format:check`, `lint`, and
      `typecheck` — by running them and observing, rather than by inference from config; record the
      result in `frontend/docs/`, including that `.ps1` is covered by none of them
- [ ] 4.2 Write the usage note naming the canonical path, the exact driver and corroborator commands,
      the supported interpreter, and the `-Runs 0` dry mode, and verify by **running every command in
      the note as written** and confirming each succeeds
- [ ] 4.3 Confirm the canonical corroborator passes `format:check` after formatting, and record
      whether formatting changed its behaviour (a behavioural change would be a finding, not a
      formatting nuisance)

## 5. Integration: prove the route is runnable

- [ ] 5.1 Run the documented route end to end from the canonical home: six `npm run gate` runs, then
      the corroborator, and verify the corroborator exits 0 with six distinct log digests, one frozen
      commit, and 0 skipped
- [ ] 5.2 Record the batch commit, its tree, and the `git merge-base --is-ancestor` result in the **PR
      body**, not in a repository file, because the rule at `ROADMAP.md` makes an in-tree batch record
      circular
- [ ] 5.3 State explicitly in this file and in the PR body that M21 CRITICAL 1 and CRITICAL 2 remain
      open and are **not** closed by this change, and that repairing the apparatus is not a claim that
      the gate cannot lie
- [ ] 5.4 Run `npm run gate` to completion and `openspec validate --specs --strict`, and record the
      actual figures rather than asserting the change is green
- [ ] 5.5 Update the `ROADMAP.md` M23 evidence note to name the canonical apparatus path, superseding
      the workaround it currently records, and remove that note's claim that repairing the driver is
      future work now that this change has done it