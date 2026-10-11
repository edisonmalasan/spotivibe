# Design

## Context

See `proposal.md` — Why for the motivation. What constrains the approach:

```
repo root                        frontend/
├─ package.json  no deps         ├─ package.json  445 packages, installed
├─ node_modules  DOES NOT EXIST  ├─ node_modules  exists
├─ .prettierrc  none             ├─ .prettierrc.json  printWidth 100
├─ eslint.config none            ├─ eslint.config.mjs  eslint-config-next
└─ scripts/  6 files             └─ tsconfig.json  includes **/*.mts, NOT **/*.mjs

CI: defaults.run.working-directory: frontend
    → every step runs inside frontend/ and never sees the root
```

Three constraints follow, and each one closes off an option:

1. **No toolchain at the root, by design.** The root manifest declares no dependencies so that
   `frontend/` remains the only manifest with a lockfile. `npm install` at the root is forbidden
   because it would create a second lockfile nothing installs from. So any root-scoped check must
   reach a binary that lives in `frontend/node_modules`.
2. **`eslint-config-next` is the wrong linter here.** `frontend/eslint.config.mjs` is 90 rules of
   Next.js/React policy. Applying it to plain Node spec-sync scripts would be a category error.
3. **`.mjs` is typechecked nowhere.** `tsconfig.json` includes `**/*.mts` but not `**/*.mjs`, so
   `scripts/*.mjs`, `frontend/scripts/*.mjs`, and M30's own `powershell-parse-check.mjs` are all
   outside it. Adding `.mjs` would be a repository-wide decision, not this change's.

Measured, not assumed: at the repository's real Prettier config, **2 of 6** root scripts fail
(`sync-m16-lyrics.mjs` by 7 lines, `sync-m17-home.mjs` by 2). At Prettier's *defaults* all 6 appear
to fail with a 12–18% reflow — because Prettier resolves config relative to each file and the root
has none, so it silently falls back to `printWidth: 80`. The first measurement of this gap was wrong
for that reason and was corrected before being recorded.

## Goals / Non-Goals

**Goals:**

- Every tracked file in root `scripts/` is examined by a gate step that would actually examine it.
- The three provers pass again, so the sync guards are demonstrated able to succeed as well as refuse.
- The exemption that allowed the drift is retired rather than re-justified.
- The two things this change deliberately does **not** cover are recorded as checked facts.

**Non-Goals:**

- Linting root `scripts/` (D5).
- Typechecking `.mjs` anywhere (D5).
- Making `openspec` sync itself automated as a gate step. `sync-m18-interactions.mjs` is a
  parameterised sync guard that would apply to a change like this one, and it is worth noticing that
  M30's Sync stage merged its delta by hand without it. Wiring sync into the gate is a separate change
  with its own ordering questions, and is recorded rather than absorbed.

## Decisions

### D1 — Repoint the archive paths, and give the control cases self-contained fixtures

> **Revised during Apply.** This decision was originally "repoint the fixture paths only", with
> self-contained fixtures explicitly rejected. That reasoning was sound about *location* and wrong about
> *staleness*, and implementing it proved it. The revision and the evidence are below rather than
> smoothed over.

**Part 1 — repoint the paths.** Change each fixture path from `openspec/changes/<name>/…` to
`openspec/changes/archive/<dated-name>/…`, and set each guard's default `CHANGE_NAME` accordingly.

**Part 2 — the control cases get synthetic fixtures.** Part 1 alone is not sufficient, and the original
design was wrong to think it was. Measured after Part 1: the ENOENT class is fully gone
(`3/15 → 12/15`, `5/11 → 9/11`, `3/8 → 6/8`), and every remaining failure except one is a **control**
case, failing with:

```
REFUSING: the performance delta adds requirement(s) whose names
already exist in the record: "A motion budget holds the client bundle"
```

That is the guard being **correct**. Each milestone's delta was merged into `openspec/specs/` during
that milestone's own Sync stage, so replaying the archived delta against today's record is a re-merge
the guard is right to refuse. The control asserts the opposite — it exists to prove the guard is not
*vacuously* refusing, and it can only pass in a state where a merge is genuinely pending. No such
state exists in the repository any more, and it cannot be reconstructed from the record alone.

So each prover builds its **own** delta *and* its **own** minimal record in a throwaway sandbox:
capabilities the delta creates are absent from the record, and the capability it extends exists with a
requirement the delta does not name. That state is pending by construction, depends on nothing outside
the prover, and cannot rot the way the replayed delta did.

**What is deliberately kept on real data.** The **refusal** cases still run against the real record and
the real archived delta. That is where the strong claim lives — "this guard refuses *this* actual
milestone's actual defect" — and all of them pass today. Only the controls, which claim nothing about
any specific milestone, become synthetic. D1's original concern was that synthetic fixtures weaken the
claim; scoping synthesis to the controls leaves the strong claim intact.

**Consequence — the M17 guard is parameterised.** `sync-m18-interactions.mjs` already takes
`SPOTIVIBE_CHANGE` / `SPOTIVIBE_NEW` / `SPOTIVIBE_EXTENDED`, with its own milestone as the default.
`sync-m17-home.mjs` hardcodes all three, so it cannot be pointed at a synthetic fixture without that
support. The parameters are added with today's values as defaults, so no existing invocation changes.
This follows the direction the codebase already took once, in the M18 guard's own header: *"it reuses
this guard rather than adding a third near-identical copy of the same refusal logic."*

**Alternative rejected — reconstruct the pre-merge record.** Delete from the sandbox exactly the
requirements the delta contributed, so the real delta becomes replayable. Rejected: for M17 the delta
*modified* requirement bodies rather than adding them, so "exactly what it contributed" is not
recoverable from the record. The reduction would be circular — it assumes the answer it is trying to
verify — and would be wrong the first time a capability changed shape for an unrelated reason.

**Alternative rejected — drop the controls.** A prover with only refusal cases cannot distinguish a
guard that refuses for the right reason from one that refuses for every reason. That is precisely what
a control is for, and removing it would trade a visible failure for an invisible one.

**Alternative rejected — re-archive or resurrect the changes.** Prohibited:
`openspec/changes/archive/` is never edited, and un-archiving would rewrite M30's history.

**Still rejected — re-archive M17–M19 under stable names.** Archived names are date-stamped by
construction, so this cannot be done without editing the archive, and it would still not fix a control
whose delta has already been absorbed.

### D2 — One `scripts:check` step that runs all three provers, not a step per prover

**Chosen.** A single `frontend/scripts/root-scripts-check.mjs` invokes all three provers in sequence
and fails if any exits non-zero.

Three separate steps would give per-prover granularity in the CI log for free. Rejected because it
triples the surface M30's `ci-workflow.test.ts` has to pin, and because a failure in one prover
currently tells you nothing about the others anyway — they share a root cause. The combined step
reports each prover's result individually, which preserves the granularity without the surface.

### D3 — Prettier over root `scripts/`, run with the repository's config explicitly

**Chosen.** The check passes `--config frontend/.prettierrc.json` rather than relying on resolution.

This is the detail the measurement above turned on. Prettier resolves config per file, and a file
under the root finds no config and silently uses defaults. Relying on that would make the check assert
a 12–18% reflow that the repository has never claimed for these files. Naming the config makes the
step's actual standard explicit and matches `frontend/`'s.

### D4 — Retire the `scripts/` frozen root, and assert a frozen root cannot also be covered

**Chosen.** Two parts:

1. Remove `scripts/` from `FROZEN_ROOTS` in M30's guard and delete `PINNED_ROOT_SCRIPTS`. Once the
   directory is genuinely covered, the exemption is not a declaration of a gap — it is a declaration
   that overlaps the truth, and M30's own *"no exemption masking covered work"* rule is about exactly
   that.
2. Add a detector: **a path under a frozen root that a gate step also covers fails the guard.** M30's
   guard pins `scripts/` file-by-file, so it detects a *new* file appearing there — but it cannot
   detect the frozen root becoming covered, because the pin is satisfied either way. That is the blind
   spot this change found by running the exempted evidence.

The detector is proven able to fail by a mutation, as with every M30 guard.

### D5 — Lint and typecheck: recorded, not performed

**Chosen.** Add no ESLint config and touch no `tsconfig`. Record both as checked facts with their
specific blockers:

- *Root `scripts/` are not linted.* Blocker: there is no ESLint-resolvable toolchain at the root and
  none can be added without a second lockfile. Note this is not a new gap — `.mjs` is unlinted
  nowhere in the repository, so the scripts are consistent with the rest of the tree.
- *`.mjs` is not typechecked anywhere.* Blocker: adding `**/*.mjs` to `tsconfig.json` would pull in
  every `.mjs` in the repository, including M30's `powershell-parse-check.mjs` and
  `measure-client-bundle.mjs`. That is a repository-wide decision with its own blast radius.

Recorded as guard assertions rather than roadmap prose, so neither can drift.

## Risks / Trade-offs

- **The gate is red on arrival.** Covering files that currently fail means CI goes red the moment the
  step lands. → The provers are fixed in the same change, and the ordering within it puts the fix
  before the step is added to the gate. If the two must ship apart, the step ships second or not at
  all.
- **A future archive could re-break a fixture.** The archive path is stable, so this is low, but a
  *new* prover written against an active change would inherit the M19 bug. → The fixture paths are
  asserted to resolve by the coverage guard, so a missing fixture fails rather than silently skipping.
- **Provers are slow.** Three Node processes, each copying the tree into temp. → Measured before
  wiring in; if the combined step exceeds a sane share of the gate it is reported, not hidden.
- **The frozen-root detector could fire on the archive.** `openspec/changes/archive/` is the other
  frozen root and is deliberately not pinned. → The detector must exempt a root whose own reason says
  it accumulates, or it would fail on every archive step. This is asserted, not assumed.

## Migration Plan

Single change, no data migration, no rollback concern: reverting the commit restores the previous
state exactly. The gate step is additive and its CI wiring is asserted by
`frontend/tests/ci-workflow.test.ts`, so removing the script without removing the step fails a test.

## Open Questions

None that would change the specs, the approach, or the task breakdown.

One is recorded rather than deferred because it is a *different* change: whether `npm run gate` should
assert which branch and tree it is running against. M30 recorded that after `git checkout main` left
three commits on `main` and the gate passed repeatedly against a tree missing its central test file.
It is out of scope here because this change's subject is *which files the gate reads*, and folding in
*what tree it reads* would be the broadening M30 deliberately declined.