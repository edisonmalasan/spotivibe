# Tasks

> Boxes are ticked against work that was **run**, not against work that was intended. Where a task
> diverges from its description, the divergence is recorded under the task rather than smoothed over.

## 1. Establish the baseline before changing anything

- [ ] 1.1 Re-measure the three provers from a clean tree, capturing each one's full case tally and the
      name of the failing case: `node scripts/sync-m17-home.prove.mjs`,
      `scripts/sync-m18-interactions.prove.mjs`, `scripts/sync-m19.prove.mjs`. Expect `3/15`, `5/11`,
      `3/8` with the positive control failing in each.
      Verify: the three tallies are pasted into this file unchanged, and the repo is still clean
      afterwards (`git status --porcelain` empty) — the provers must write only to temp.
- [ ] 1.2 Confirm the uniform cause rather than assuming it: for each prover, read the fixture path it
      resolves and show that the change directory it names is absent while
      `openspec/changes/archive/<dated-name>/…` is present.
      Verify: one line per prover naming the exact fixture path and the archive path that replaces it.
- [ ] 1.3 Re-measure Prettier over root `scripts/` **with the repository's own config**, not defaults.
      Prettier resolves config per file and the root has none, so an unqualified run silently measures
      `printWidth: 80`. Expect 2 of 6 failing — `sync-m16-lyrics.mjs`, `sync-m17-home.mjs`.
      Verify: both the qualified and unqualified counts are recorded, with the difference explained, so
      the corrected measurement cannot be mistaken for the first one.

## 2. Restore the provers' positive controls (D1)

- [ ] 2.1 Repoint each of the three provers' fixture constant from `openspec/changes/<name>/…` to
      `openspec/changes/archive/<dated-name>/…`.
      Verify: each prover exits 0 with every case passing, and the archived change directories are
      untouched (`git status` shows no modification under `openspec/changes/archive/`).
- [ ] 2.2 Confirm the refusal guards still refuse. The bug was that the positive control failed, not
      that the guards misbehaved; fixing evidence of success must not weaken evidence of refusal.
      Verify: all refusal cases still pass, and the guard-test cases in `frontend/tests/` are re-run
      unmodified and still pass.
- [ ] 2.3 Assert the fixture paths resolve, so a future archive or removal fails loudly instead of
      letting a prover skip.
      Verify: a mutation deleting a referenced archive directory makes the assertion fail; the directory
      is restored and its SHA-256 matches the pre-mutation value.

## 3. Format root `scripts/` (D3)

- [ ] 3.1 Run Prettier over root `scripts/` with `--config frontend/.prettierrc.json` and record the
      per-file result.
      Verify: exactly the two files measured in 1.3 are named.
- [ ] 3.2 Reformat those two files only, and no others.
      Verify: `git diff --stat` names two files; the other four are byte-identical to `main` (SHA-256
      compared).
- [ ] 3.3 Re-run the provers after reformatting, since two of the six edited files are scripts the
      syncs use.
      Verify: all three still exit 0.

## 4. Add the gate step (D2)

- [ ] 4.1 Write `frontend/scripts/root-scripts-check.mjs` to invoke all three provers in sequence and
      exit non-zero if any does, reporting each prover's result individually.
      Verify: a deliberate failing prover makes the step exit non-zero *and* the other two still report;
      the mutation is reverted.
- [ ] 4.2 Measure the step's wall-clock before wiring it in.
      Verify: recorded, with a statement of whether it is a sane share of the gate — reported, not
      hidden if it is not.
- [ ] 4.3 Wire it as `scripts:check` in `frontend/package.json`, add the root proxy, add it to
      `npm run gate` **after** the other checks, and add the CI step in the documented position.
      Verify: `frontend/tests/root-commands.test.ts` and `frontend/tests/ci-workflow.test.ts` pass
      unmodified, having been written by M30 to detect exactly this wiring.

## 5. Retire the exemption (D4)

- [ ] 5.1 Remove `scripts/` from `FROZEN_ROOTS` and delete `PINNED_ROOT_SCRIPTS` in
      `frontend/tests/gate-coverage.test.ts`.
      Verify: the guard's uncovered-file count drops by exactly the six files, and no other count moves.
- [ ] 5.2 Add the detector: a path under a frozen root that a gate step also covers fails the guard.
      M30's guard pins `scripts/` file-by-file and so detects a *new* file there, but cannot detect the
      frozen root becoming covered, because the pin is satisfied either way.
      Verify: a mutation marking `scripts/` as covered fails the new detector.
- [ ] 5.3 Prove the detector does not fire on `openspec/changes/archive/`, the other frozen root, which
      is deliberately unpinned because it accumulates.
      Verify: asserted in the test, not left to be discovered at the next archive.
- [ ] 5.4 Confirm the guard does not merely trade one blind spot for another: re-run the full M30
      mutation suite and state which, if any, of the sixteen mutations no longer fail.
      Verify: recorded explicitly; any mutation that stops failing is repaired before this task closes.

## 6. Record what is deliberately not covered (D5)

- [ ] 6.1 Record root `scripts/` as **not linted**, with the specific blocker: no ESLint-resolvable
      toolchain at the root, and none may be added without a second lockfile. Note that `.mjs` is
      unlinted repository-wide, so these files are consistent with the tree rather than exceptional.
      Verify: asserted by a check, so it cannot drift.
- [ ] 6.2 Record `.mjs` as **not typechecked anywhere**, with the blocker: `tsconfig.json` includes
      `**/*.mts` but not `**/*.mjs`, and adding it would pull in every `.mjs` in the repository.
      Verify: asserted by a check. Prove the assertion can fail.
- [ ] 6.3 Confirm neither record became a silent return of the drift it describes.
      Verify: re-run 1.1 after everything above; the provers are green and are executed by the gate,
      not merely recorded.

## 7. Verify the whole change

- [ ] 7.1 `npm run gate` from the repository root, exit 0, with `scripts:check` visibly executing all
      three provers.
      Verify: pasted output.
- [ ] 7.2 `openspec validate cover-root-scripts --strict`, exit 0.
- [ ] 7.3 OpenSpec strict validation of the change **and** the main specs after sync.
- [ ] 7.4 Confirm CI green on the PR, all steps, not only the job.
      Verify: run URLs recorded in the PR body.
- [ ] 7.5 Record out-of-scope findings rather than absorbing them: `icons:check` still has no root proxy
      and is still absent from gate and CI; `sync-m18-interactions.mjs` exists as a parameterised sync
      guard that M30's Sync stage did not use; the gate still does not assert its own working tree.
      Verify: each appears in the evidence report with its status, none silently dropped.

## 8. Out of scope, recorded not absorbed

- Linting root `scripts/` (D5) — recorded as a checked fact with its blocker.
- Typechecking `.mjs` (D5) — recorded as a checked fact with its blocker.
- Making `openspec` sync itself a gate step — a separate change with its own ordering questions.
- Asserting which branch and tree `npm run gate` runs against — M30 recorded this and deliberately did
  not absorb it; it is a different question from which files the gate reads.