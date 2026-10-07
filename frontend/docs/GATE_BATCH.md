# The gate-batch apparatus

`ROADMAP.md` defines a milestone as `DONE` only when **six consecutive green full gate runs** are
measured at the tree being merged. This note is the route to that measurement.

The apparatus exists because the criterion is otherwise unverifiable by a reader: `openspec/specs/
verification-integrity` requires that a claim of independent corroboration be checkable by someone
other than the tool that produced it, and a script that is not in the repository cannot be run by
anyone else.

## Where it lives

```
frontend/scripts/gate-batch/run-gate-batch.ps1      the driver: runs the gate N times, writes the logs
frontend/scripts/gate-batch/verify-gate-batch.mjs   the corroborator: checks the logs independently
```

**A byte-identical pair also exists at
`openspec/changes/archive/2026-10-05-harden-post-v1-verification/evidence/`, and those copies are
deliberately NOT repaired.** They are M21's frozen record of what that milestone shipped. Editing
them would destroy that record while making the defect below invisible to the next reader.

**Do not run the archived copies.** They cannot run. They resolve the repository root by applying
`Split-Path -Parent` a fixed four times to their own location — a count that was correct while the
owning change sat at `openspec/changes/<change>/evidence`, and that archiving made wrong by inserting
`archive/` beneath `changes/`. From their actual location the same arithmetic resolves to
`<root>/openspec` and the script's own guard exits 1.

The canonical copies resolve the root by **walking upward until they find `frontend/package.json`**, so
wherever the tool is stored it finds the same repository.

## Interpreter

Run the driver with **`powershell`** (Windows PowerShell 5.1), which is what its body is written for —
it avoids `` `e `` and `Tee-Object` for exactly the 5.1 failures documented in its own header. `pwsh`
(PowerShell 7+) also runs it and is fine if that is what you have.

CI runs `ubuntu-latest`, where `powershell` is absent and `pwsh` is present. This is why
`tests/gate-batch-apparatus.test.ts` resolves an available interpreter at runtime and **skips with a
stated reason** when there is none. A skipped case is reported as skipped, never as a pass.

## Measuring the criterion

From the **repository root**:

```bash
# 1. Drive six gate runs, writing run1.log … run6.log
powershell -File frontend/scripts/gate-batch/run-gate-batch.ps1 -LogDir <log-directory>

# 2. Corroborate the logs the driver printed a command for — run that command verbatim
node frontend/scripts/gate-batch/verify-gate-batch.mjs <log-directory> --frontend frontend --runs 6 --expect-files 182 --expect-budget 24
```

A batch is roughly **twenty minutes**. Six runs of a build-and-test gate is not a fast operation, and
the criterion is a per-milestone claim rather than a per-commit one, so it is deliberately not wired
into CI.

### Expectation figures

Pass `--expect-files` and `--expect-budget` explicitly, as above. The checker also has built-in
defaults, and **those are stale**: they are the M21 tree's figures (`182` files, `21` motion-budget
tests). A tree that legitimately gains tests fails against them.

A caller-stated figure that disagrees is reported differently from a stale default, precisely so the
two are not confused:

```
FAIL Test Files across the logs: 24 (asserted 182)
      found 24, expected 182. this default is stale — it is the M21 tree (182 files at 6f86211), not
      this tree. Re-run with --expect-files 24 to assert this batch's own figure.
```

The expected figure must be independent of the batch being checked. If the driver printed the figures
it had just measured and the checker asserted those, the corroboration would be the driver agreeing
with itself.

### Recording the result

**The batch's record must not live in the repository tree.** Any in-tree record is itself a commit, so
its tree can never equal the tree the batch measured — the criterion could then never be satisfied by
the rule that points at it. Record the batch commit, its tree, and the
`git merge-base --is-ancestor origin/main <commit>` result in the **pull request body**.

## Checking it without waiting twenty minutes

```bash
# Resolve the root, print the completion command, invoke nothing. Exits 0.
powershell -File frontend/scripts/gate-batch/run-gate-batch.ps1 -LogDir <log-directory> -Runs 0
```

`-Runs 0` writes **no logs** and prints `DRY RUN — no gate was invoked — this is not criterion
evidence`. It exists because the two things most likely to break — where the tool thinks the
repository is, and what command it tells you to run next — should be checkable in about a second. A
dry run can never corroborate anything, because the corroborator still demands as many logs as it is
told to.

## Which gates cover this, measured rather than assumed

Measured by running each gate against these files on 2026-10-07 at `a478da3`:

| File | `format:check` | `lint` | `typecheck` |
|---|---|---|---|
| `verify-gate-batch.mjs` | **yes** | no | no |
| `run-gate-batch.ps1` | **no** — Prettier has no parser for PowerShell | no | no |

How each cell was established, because "no errors" is not the same as "checked":

- **prettier / `.mjs`**: `prettier --check scripts/gate-batch/verify-gate-batch.mjs` exits 1 on the
  unformatted file and 0 after `prettier --write`. It is covered.
- **prettier / `.ps1`**: exits 2 with `No parser could be inferred`. It is **not** covered, and this is
  an error rather than a pass — the gate ignores it entirely.
- **eslint**: a probe file exporting a call to an undeclared identifier, dropped into the directory,
  still exited 0. ESLint is **not** linting `.mjs` here; `eslint-config-next` scopes itself to
  TypeScript.
- **typecheck**: `tsconfig.json` includes `**/*.ts`, `**/*.tsx` and `**/*.mts`. `.mjs` is not included,
  so neither file is type-checked.

**Consequence, stated rather than smoothed over:** the driver's repair cannot be proven by the type
checker or the formatter. It is proven by *running* it —
`tests/gate-batch-apparatus.test.ts` executes the script from four different nesting depths and
requires the same repository root from each, and proves a detector can fail by confirming that
reverting to the level count turns the suite red.

The corroborator being newly subject to `format:check` is a genuine gain: it is the first time this
file has been formatted by any gate, since everything under `openspec/` sits outside the working
directory `format:check` runs from.

## What this does not do

Repairing the apparatus by which a milestone's completion is claimed is **not** a claim that the gate
cannot lie. `ROADMAP.md`'s M21 **CRITICAL 1** and **CRITICAL 2** remain open and are not closed by
anything here.