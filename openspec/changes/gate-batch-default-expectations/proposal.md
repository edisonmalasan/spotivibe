# Why

The gate-batch corroborator asserts two figures against hard-coded defaults — `--expect-files 182` and
`--expect-budget 21` — and those constants describe the **M21** tree. Every milestone since has added
test files, so the default is stale by construction, and the checker's own failure message says so:

```
found 185, expected 182. this default is stale — it is the M21 tree (182 files at 6f86211), not this tree.
```

The tool knows. It still exits 1. And `run-gate-batch.ps1`, having just measured the real figures it
prints in its own run table, ends by printing a follow-up command that omits both flags — so **following
the apparatus's own printed instruction fails a perfect batch.** Measured today against
`qpo-batch2`, which is 6 of 6 green at the merged commit `f70ba3186d85`:

```
run1 … files 185  tests 3440  budget 25  skipped none  exit 0  ASSERTED MISMATCH
…
FAIL Test Files across the logs: 185 (asserted 182)
FAIL motion-budget across the logs: 25 (asserted 21)
8 problem(s) unresolved          exit 1
```

Every run was green, distinct, complete, and unskipped. The apparatus reports exit 1 anyway.

This has now cost four separate sessions. The M22 and M24 batches both needed manual overrides. The
`quick-picks-first-rail` batch needed `--expect-files 183 --expect-budget 24`; the
`quick-picks-onboarding` batch needed `--expect-files 185 --expect-budget 25`. Each session rediscovered
the override, and no documentation anywhere records it — the only place the knowledge lived was a prior
session's summary. That is a defect, not a usage quirk.

The check is not merely inconvenient. A constant that every current tree invalidates is a check that
**cannot pass**, and the repository already has a standing requirement about that class. Worse, the
figure it guards has effectively been *unasserted* for several milestones: the batches were real, but
the check that describes them was bypassed rather than obeyed.

# What Changes

- **The default is removed as a source of truth.** When `--expect-files` / `--expect-budget` are absent,
  the checker derives the expectation from the batch and asserts what is actually verifiable without a
  constant: that all N logs **agree** on the figure, and that the figure is **consistent with the live
  tree**. The cross-tree half is exact, not approximate — `vitest list --filesOnly` enumerates precisely
  **185** files on this tree, matching the batch's own figure. So the teeth the constant was providing —
  catching a batch taken on the wrong tree — are preserved by a mechanism that cannot fall behind.

- **A caller-supplied figure that disagrees still fails.** Removing the default must not quietly delete
  the assertion. When a caller states `--expect-files N` and the batch says something else, that is a
  real disagreement about the batch and stays exit 1.

- **A run with no stated expectation says so.** The closing verdict states in words that tree agreement
  was not asserted by the caller, and reports the derived figure and whether it matches the live tree.
  Silence about what was and was not checked is the failure mode this whole apparatus exists to prevent.

- **The driver prints a command that works.** `run-gate-batch.ps1` already observes the real figures and
  prints them; its printed follow-up command will now carry `--expect-files <N> --expect-budget <N>`
  bound to those observed figures, so the instruction is correct by construction and cannot drift from
  the batch it describes.

- **The documented defaults and the asserted defaults stop being two separate claims.** An existing test
  already couples the header comment to `?? "182"` / `?? "21"`. With the constants gone, that coupling
  test is replaced by one that asserts the printed command carries the observed figures, which is the
  property that actually matters.

- **The override is documented.** The figures a caller should pass are derivable from the driver's own
  output; `AGENTS.md` will record that the corroborator must be run with the flags the driver prints, and
  that omitting them no longer asserts tree agreement.

No breaking change to the application. The checker keeps its exit-code contract: 0 only when the batch is
corroborated and every asserted figure holds.

# Capabilities

- **New Capabilities**: none.

- **Modified Capabilities**:
  - `verification-integrity` — requirements are **added**, not changed in substance. Existing
    requirements ("A check that cannot fail is fixed or retired, not left in place", "A documented
    limitation of a guard is checked rather than described", "The recorded state of a claim matches the
    code") already cover the *class*; this change adds the specific standing rules for a self-defeating
    verification tool.

# Impact

- `frontend/scripts/gate-batch/verify-gate-batch.mjs` — remove the two hard-coded defaults; add
  derivation from the logs and the `vitest list --filesOnly` cross-check; refine the verdict text.
- `frontend/scripts/gate-batch/run-gate-batch.ps1` — printed follow-up command carries the observed
  figures.
- `frontend/tests/evidence-scripts.test.ts` — replace the defaults-coupling test; add tests for the
  printed command, for a stale-free default run, and for a caller-supplied disagreement still failing.
- `AGENTS.md` — record how the corroborator is invoked and what omitting the flags now means.

Risk is contained to the verification apparatus. No application source, no spec behaviour, and no
product code is touched, so the change cannot affect the shipped app.
