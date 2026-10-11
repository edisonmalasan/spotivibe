# Proposal

## Why

The six scripts in the repository-root `scripts/` directory are read by no gate step — not linted,
not format-checked, not type-checked, not tested — and all three of their provers **currently fail**:
`3/15`, `5/11` and `3/8`. They have been outside every gate since M16 and nothing noticed, because
M30's coverage guard recorded the directory as frozen evidence with an accurate reason (*"nothing in any
manifest or test references them"*) — an exemption that described the absence of a check as though it
justified one.

The provers fail for one uniform reason: each reads its fixture from an active change path
(`openspec/changes/m19-motion/specs/motion/spec.md`), and every one of those changes has since been
archived. The **positive control** case fails; the refusal cases pass. The guards still refuse
correctly — what broke is the evidence that they can succeed.

## What Changes

- Repoint each prover's fixture from `openspec/changes/<name>/` to the archived
  `openspec/changes/archive/<dated-name>/`, restoring all three positive controls.
- Add a `scripts:check` gate step that runs all three provers, wired into `frontend/package.json`,
  the root proxy, `npm run gate`, and CI.
- Add a Prettier check over root `scripts/` using the repository's own `.prettierrc.json`, and fix the
  two files that fail it (7 and 2 lines respectively).
- Retire `scripts/` as a frozen root in M30's coverage guard, and add a detector asserting that a
  frozen root is not also covered by a step — the staleness M30's guard could not currently see.
- Record, as checked facts rather than prose, that root `scripts/` are **not linted** and that `.mjs`
  is **not typechecked anywhere in the repository**, with the specific blocker for each.

**Not in scope:** linting root `scripts/`, and adding `.mjs` to any `tsconfig`. Both are recorded
instead, with reasons — see `design.md` D5.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `release-validation`: close the frozen-evidence escape hatch in *"Every source type in the application
  home has a gate step or a recorded exemption"*. It currently permits exemption via *"recorded as
  frozen evidence with a stated reason"*, which is the clause that let four milestones of drift through
  an accurately-worded record. A stated reason SHALL NOT by itself justify an exemption; the frozen
  evidence's subject SHALL be demonstrated still to run.
- `verification-integrity`: strengthen *"A stated coverage limitation becomes a checked fact or is
  removed"*. It requires a limitation to be asserted rather than described, but not that an exemption's
  **subject** still works — which is the distinction this change found by running the exempted evidence
  and watching it fail.

## Impact

**Files**

- `scripts/*.prove.mjs` (3) — fixture paths repointed to archive paths
- `scripts/sync-m16-lyrics.mjs`, `scripts/sync-m17-home.mjs` — Prettier formatting
- `frontend/scripts/root-scripts-check.mjs` — new; runs the provers
- `frontend/package.json`, `package.json`, `.github/workflows/ci.yml` — new gate step
- `frontend/tests/gate-coverage.test.ts` — frozen root retired, staleness detector added
- `frontend/tests/ci-workflow.test.ts`, `frontend/tests/root-commands.test.ts` — extended
- `openspec/specs/{release-validation,verification-integrity}/spec.md` — via sync

**No application source is touched**, and no dependency is added. The root manifest still declares no
dependencies, and `npm install` at the root remains forbidden.

**Ordering consequence:** this change makes the gate **red on arrival**. Covering files that currently
fail is the point; the gate stays red until the provers are fixed, and the two are landed together.