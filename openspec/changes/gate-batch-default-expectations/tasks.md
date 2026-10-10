# Tasks: make the gate-batch checker stop failing correct evidence

## 1. Proposal, design, specs

- [x] 1.1 Write `proposal.md`, recording the measured failure: a 6-of-6 green batch exiting 1 with
      `8 problem(s) unresolved` when checked by the command the driver itself prints
- [x] 1.2 Write `design.md`, including D1–D4 and the four rejected alternatives, in particular
      "bump the constants to 185 and 25"
- [x] 1.3 Write the `verification-integrity` spec delta: the printed instruction must succeed, a default
      may not be a constant that falls behind the tree, and a run states what it did not assert
- [x] 1.4 `openspec validate gate-batch-default-expectations --strict`

## 2. Establish the baseline, before changing anything

- [ ] 2.1 Record the current behaviour as a **failing** run, not as a claim: check the known-good
      `qpo-batch2` logs (6 of 6 green at `f70ba3186d85`) with **no** `--expect-*` flags and capture the
      exact output, including the exit code and the `ASSERTED MISMATCH` per row
- [ ] 2.2 Confirm the per-run facts that make that output wrong rather than merely strict: all six runs
      `exit 0`, six distinct digests, `skipped none`, `files 185`, `budget 25`
- [ ] 2.3 Confirm the live-tree figure the fix will compare against:
      `npx vitest list --filesOnly` returns exactly **185** lines, matching the batch's own figure, so
      the cross-tree check is an equality rather than a lower bound
- [ ] 2.4 Record the SHA-256 of `verify-gate-batch.mjs`, `run-gate-batch.ps1` and
      `evidence-scripts.test.ts` before any edit, so each can be restored byte-for-byte

> 2.3 is the load-bearing measurement. If `--filesOnly` did not exist or did not agree with the batch,
> D1's cross-tree half would be a floor rather than an equality and the design would have to change
> before any code is written.

## 3. Prove each new assertion can fail, BEFORE the fix

- [ ] 3.1 A checker run with **no stated expectation** over fixture logs whose file count does not match
      the live tree SHALL fail. Prove it by pointing the checker at a synthetic log directory reporting a
      different `Test Files` count, and record the message
- [ ] 3.2 A checker run where the logs **disagree with each other** SHALL fail. Prove it with a fixture
      whose `run2.log` reports a different count from `run1.log`
- [ ] 3.3 A checker run with an explicit `--expect-files` that the evidence contradicts SHALL still fail.
      Prove it before changing anything, so it is clear this behaviour already holds and is preserved
      rather than introduced
- [ ] 3.4 The driver's printed follow-up command SHALL be shown to exit 1 on a correct batch as printed.
      Prove it by extracting the printed command and running it

> 3.3 is a regression guard for D2. It must be proven green-to-stay-green, and its failure mode must be
> a *disagreement* rather than the *stale default* the current script also produces for that input.

## 4. Fix the checker

- [ ] 4.1 Remove the `"182"` and `"21"` literal defaults from `parseArguments`
- [ ] 4.2 When `--expect-files` is absent, derive the expectation from the logs and assert that all N
      logs agree on it
- [ ] 4.3 Cross-check the derived figure against `vitest list --filesOnly` on the live tree; a mismatch
      SHALL fail as a cross-tree batch, naming the batch and both figures
- [ ] 4.4 Preserve the stated-expectation path: an explicit figure that disagrees SHALL still fail
- [ ] 4.5 Rewrite the verdict so it names the derived figure, states that no expectation was stated, and
      states whether it matches the live tree; distinguish asserted from reported figures
- [ ] 4.6 Rewrite the header comment to describe the derived mechanism, **preserving** the round-12
      history that records why the constant approach was adopted and why it was wrong

## 5. Fix the driver

- [ ] 5.1 `run-gate-batch.ps1` binds the printed follow-up command to the `--expect-files` and
      `--expect-budget` values it already parsed for its own run table
- [ ] 5.2 Confirm by reading the printed command that it is correct for a batch whose figures differ from
      any figure compiled into the tool

## 6. Update the coupling tests

- [ ] 6.1 Remove `evidence-scripts.test.ts`'s case pinning the documented defaults to `?? "182"` /
      `?? "21"` — the constants it guards are gone, and leaving it would assert a fact that is no longer
      true
- [ ] 6.2 Extend the existing `:588` case so the printed line is required to carry the measured figures,
      not merely `--runs`
- [ ] 6.3 Add a case proving a checker run with no stated expectation exits 0 on a correct batch
- [ ] 6.4 Add a case proving the cross-tree mismatch still fails
- [ ] 6.5 Add a case proving a stated expectation that disagrees still fails
- [ ] 6.6 Prove **every** new case can fail by mutation, and restore each mutated source byte-for-byte,
      verifying by SHA-256 against the digests recorded in 2.4

> 6.1 is a test deletion, which the working rules forbid without cause. The cause is recorded: the test
> asserts that the header's stated defaults equal the code's defaults, and this change removes the
> defaults. Deleting it is the honest response; leaving it would mean restoring the defect.

## 7. Document

- [ ] 7.1 Record in `AGENTS.md` how the corroborator is invoked, that the driver prints the figures to
      pass, and what omitting them now means for the verdict
- [ ] 7.2 Update the checker's own usage text so it does not imply the flags are required to obtain a
      meaningful result

## 8. Verify and close out

- [ ] 8.1 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`, `npm test` —
      each run and each recorded with its exit code
- [ ] 8.2 Re-run the baseline from 2.1 **verbatim**, with no flags, and require exit 0
- [ ] 8.3 `openspec validate gate-batch-default-expectations --strict` and
      `openspec validate --specs --strict`
- [ ] 8.4 Six `npm run gate` runs plus the corroborator, from the canonical home, and record the
      **commit** and **tree** the batch measured
- [ ] 8.5 Confirm the batch commit's **tree** equals the merge commit's tree, with nothing committed
      between the measurement and the merge
- [ ] 8.6 Record commit, tree and `merge-base` in the **PR body**, not in this file
- [ ] 8.7 Commit, push, PR, merge with a merge commit, delete the branch
- [ ] 8.8 Sync the delta into `openspec/specs/`, archive, and record the outcome in `ROADMAP.md`

> 8.2 is the acceptance test for the whole change, and it is deliberately the exact command from 2.1.
> If the change works, the command that produced `8 problem(s) unresolved` and exit 1 produces exit 0.
