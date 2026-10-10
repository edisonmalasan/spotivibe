# Proposal

## Why

The gate reports success over a file it never opened. `npx eslint` on the gate-batch driver exits **0**
with `File ignored because no matching configuration was supplied`, and `prettier --check .` never asks
about it at all — so `npm run gate` is green over a file that no gate reads. That is the same defect class
M29 just closed one level up: a check whose green result does not mean what it appears to mean.

M29 made this gap visible by documenting it in `AGENTS.md`, which is the right disclosure and the wrong
endpoint. `verification-integrity` already requires that a stated coverage limitation become a *checked*
fact rather than a comment that can go stale; a paragraph in a documentation file is the comment.

## What Changes

- **A gate may not report success for a file it did not examine.** ESLint's exit 0 over an unconfigured
  file is the specific instance; the rule is general.
- **The gate's covered surface becomes asserted rather than assumed.** A check enumerates tracked files,
  asks each tool whether it would actually process them, and fails on any file no gate claims — so an
  uncovered file fails at commit time instead of being discovered in a later milestone.
- **PowerShell gets a real parse gate.** The driver `run-gate-batch.ps1` is currently checked only by
  behavioural tests that **skip** where no interpreter is present. PowerShell ships an AST parser, so the
  file can be parsed for real: measured, the live file yields 0 errors and a deliberately broken file
  yields 2, each naming file, line and error id. No new dependency.
- **Frozen evidence is declared, not left ambiguous.** Root `scripts/*.mjs` (6 files) sit outside every
  gate; their headers show they are one-off milestone provers that copy the tree to a temp directory and
  never write to the repository. The guard distinguishes *live code* from *frozen evidence* by
  declaration, so new live code cannot appear in a directory nobody is watching.

**Not breaking.** No application source changes. The gate gains a step; it does not lose one.

## Capabilities

### New Capabilities

None. This extends two existing capabilities rather than introducing a near-duplicate of either.

### Modified Capabilities

- `verification-integrity`: adds requirements for a tool that reports success without examining its
  input, and for a stated coverage limitation that stays prose. The latter is the existing *A documented
  limitation of a guard is checked rather than described* applied to a gap M29 documented but did not
  close; the former (*A run that is skipped is never reported as a pass*) covers a check skipping
  *itself*, which is adjacent but not the same thing as a tool declining an individual file while
  succeeding overall.
- `release-validation`: the release gate's requirement to report what it did not run gains an
  obligation that the set of files it covers is itself reported, and that a source type in the canonical
  application home has either a gate step or a recorded exemption.

## Impact

**Affected.** `frontend/scripts/gate-batch/run-gate-batch.ps1` gains a static check it never had.
`frontend/package.json` and the root proxy gain a gate step. `frontend/tests/` gains a coverage test.
`.github/workflows/ci.yml` gains the step, since a gate that does not run in CI is not a gate.

**Untouched.** No application source, no runtime dependency, no deployment config. PowerShell's parser
is invoked through the interpreter already required to run the driver, so a machine without one skips with
a stated reason rather than passing silently — the existing rule for skipped runs, applied to a new case.

**Evidence base.** Measured, not assumed:

| Surface | Files | ESLint | Prettier |
|---|---|---|---|
| `frontend/scripts/*.mjs` | 5 | covered | covered |
| `frontend/scripts/gate-batch/run-gate-batch.ps1` | 1 | **exit 0, ignored** | **exit 2 if asked; never asked** |
| `scripts/*.mjs` (repo root) | 6 | **no config exists at root** | **no config exists at root** |
| `openspec/changes/archive/**` | 3 | frozen evidence | frozen evidence |
