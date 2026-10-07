# Proposal

## Why

`ROADMAP.md` defines a milestone as `DONE` only when six consecutive green full gate runs are
measured at the tree being merged, and it points at a driver and a corroborator that ship in the
repository so the criterion is checkable by a reader rather than by assertion. **Those two scripts
cannot be run from the only place they exist.**

`run-gate-batch.ps1` finds the repository root by applying `Split-Path -Parent` four times to its own
directory. That count was correct while the change sat at `openspec/changes/<name>/evidence`.
Archiving inserted `archive/` beneath `changes/`, so the identical arithmetic now resolves to
`<root>/openspec` and the script's own guard exits 1:

```
FAIL the computed repository root is not a repository root: C:\...\spotivibe\openspec
```

The guard is right to refuse — it fails loud rather than printing a plausible wrong path. But the
consequence is that **the documented route to the milestone criterion has been unrunnable for every
archived change since M21.** M23 is the first milestone to discover this, and the only reason it was
discovered rather than assumed is that M23's batch had to be measured after M23's own archive.

Measuring M23's batch surfaced two further defects in the same apparatus. The corroborator's
`--expect-budget` default is `21` while the current tree executes `24`; because the default is
*asserted*, a batch on a newer tree fails with no indication that the constant is stale rather than
that the tree regressed. And the driver's usage line names `pwsh -File`, which does not run on the
Windows PowerShell 5.1 that the script's own body is carefully written for — its avoidance of `` `e ``
and `Tee-Object` is documented as 5.1 accommodation, so its prose and its code disagree about the
interpreter.

## What Changes

- **A canonical, lifecycle-independent home for the apparatus.** Repaired copies of the driver and
  the corroborator move to `frontend/scripts/gate-batch/`, beside the code they exercise and outside
  the OpenSpec change lifecycle that made the archived copies unreachable. This also brings the
  corroborator under `format:check`, which nothing in `openspec/` is subject to.
- **Location-independent root resolution.** The driver locates the repository root by walking up from
  its own location until it finds a known marker (`frontend/package.json`), instead of counting
  parents. The count was a property of one storage layout; the marker is a property of the repository.
- **A testable dry mode.** `-Runs 0` resolves the root and prints the completion command without
  invoking the gate, so the resolution and the printed interface can be asserted by tests in seconds
  rather than inferred from a comment.
- **A self-explaining asserted default.** A corroborator figure mismatch names the figure found, the
  figure expected, and that the default belongs to a named earlier tree, so an operator can tell a
  stale constant from a real regression.
- **A correct printed interface.** The usage block names the interpreter that actually runs here, and
  the requirement is stated once rather than contradicted between prose and code.
- **The archived copies are left byte-for-byte untouched.** They are M21's frozen record of what it
  shipped. The existing `frontend/tests/evidence-scripts.test.ts` continues to guard *those*; a new
  suite guards the canonical copies. Neither suite is repointed at the other's subject.

No product code, no runtime behaviour, and no shipped feature changes. This repairs the machinery by
which a milestone's completion is claimed, which is the one part of this repository whose correctness
every other part depends on.

## Capabilities

### New Capabilities

None. `verification-integrity` already governs the integrity of the repository's own verification
machinery, and the defect shape here — a documented limitation that was described rather than checked,
and a guard whose ability to run depended on something unobserved — is already named by that
capability. Introducing a second capability would fragment a requirement that belongs in one place.

### Modified Capabilities

- `verification-integrity`: adds requirements that a shipped verification tool's ability to run does
  not depend on the directory depth it is stored at, that an interface a tool prints names an
  invocation that executes, and that a default a checker asserts cannot fail in a way indistinguishable
  from a real regression. The existing requirements are unchanged and remain in force — in particular
  *"A documented limitation of a guard is checked rather than described"*, which the driver's
  `FOUR parents, not three` comment already violated and which no test caught.

## Impact

**Affected**

- `frontend/scripts/gate-batch/run-gate-batch.ps1`, `frontend/scripts/gate-batch/verify-gate-batch.mjs`
  — new canonical copies; the archived originals are not modified.
- `frontend/tests/gate-batch-apparatus.test.ts` — new suite covering resolution from several nesting
  depths, the `-Runs 0` dry mode, the printed interface, and the mismatch diagnostic.
- `frontend/docs/` — a short usage note, since the criterion's repeatability currently depends on a
  reader reconstructing the invocation.

**Unaffected**

- `openspec/changes/archive/2026-10-05-harden-post-v1-verification/evidence/*` — frozen, byte-for-byte.
- `frontend/tests/evidence-scripts.test.ts` — keeps guarding the archived record.
- Every product module, route, component, and domain type. No dependency is added, removed, or moved.

**Known constraints this change accepts**

- `.ps1` is covered by **no** static gate: `tsconfig.json` includes only `.ts`/`.tsx`/`.mts`, and
  neither ESLint nor Prettier handles PowerShell. The driver's repair therefore cannot be proven by
  the type checker or the formatter and is proven by runtime tests instead. This is stated rather
  than papered over, and is the same reason `evidence-scripts.test.ts` asserts on script text today.
- Acceptance includes one real six-run batch executed through the repaired route from the canonical
  home, corroborated by the repaired corroborator. That is the only evidence that the criterion is
  runnable rather than merely repaired in source.