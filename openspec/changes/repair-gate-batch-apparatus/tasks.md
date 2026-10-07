# Tasks

Each task states how it is verified. Verification evidence must distinguish an automated test, a
static check, a runtime command, and an inference; and a task is not complete because its code
compiles.

**Standing constraint for every group:** the archived originals under
`openspec/changes/archive/2026-10-05-harden-post-v1-verification/evidence/` are frozen and must remain
byte-for-byte unchanged. Any group that touches the canonical copies re-verifies the archived hashes
rather than assuming it did not.

## 1. Canonical home

- [ ] 1.1 Copy `run-gate-batch.ps1` and `verify-gate-batch.mjs` to `frontend/scripts/gate-batch/`, and
      verify by SHA-256 that each copy is byte-identical to its archived original
- [ ] 1.2 Record the archived pair's hashes in this file, and verify `git status` shows no modification
      to anything under `openspec/changes/archive/` — the copies are new files, not a move
- [ ] 1.3 Add a header to each canonical copy naming the canonical path and stating that the archived
      copies are M21's frozen record and are deliberately unrepaired, and verify by test that the
      archived pair does **not** carry that header (which is what proves the archive was not edited)

## 2. Driver: resolution, dry mode, interface

- [ ] 2.1 Replace the four-`Split-Path -Parent` root computation with a walk upward from
      `$PSScriptRoot` until a directory containing `frontend\package.json` is found, preserving the
      fail-loud guard, and verify by running the driver with `-Runs 0` from the canonical home and
      observing the reported root is the repository root
- [ ] 2.2 Verify the "no marker found" path still fails loudly: drop a copy of the driver into a
      temporary tree with no `frontend\package.json` above it, run it, and confirm a non-zero exit that
      names the directory it started from and the directories it examined
- [ ] 2.3 Make `-Runs 0` an explicit dry mode that resolves the root, prints the completion command,
      prints a `DRY RUN — no gate was invoked — this is not criterion evidence` line, and exits 0,
      and verify by test that the line is present when `$Runs` is below 1 and absent otherwise
- [ ] 2.4 Correct the usage block so it names an interpreter that is actually installed and does not
      claim a PowerShell edition the implementation does not target, and verify by **executing the
      printed usage verbatim** — not by comparing text against a second copy of the same claim
- [ ] 2.5 Add tests that resolve the root from at least three nesting depths — the canonical home, an
      active-change-shaped tree, and an archive-shaped tree one level deeper — and require the same
      root from each; verify by reverting the walk-up to parent-counting and confirming the
      archive-shaped case turns red
- [ ] 2.6 Verify `frontend/tests/evidence-scripts.test.ts` still passes unmodified, which is the check
      that the frozen archive remains intact and that this change did not repoint it

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