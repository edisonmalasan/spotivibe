# Design

## Context

See `proposal.md` — Why. What shapes the approach here is only this: the gap was found by *invoking the
tools*, not by reading their configuration, and that is the property the design has to preserve.

Measured on this tree (2026-10-10, Node 24.21.0, Prettier 3.9.9):

| Probe | Signal available |
|---|---|
| `eslint <file> --format json` | the ignored file **is** in the JSON, with `errorCount: 0`, `warningCount: 1`, and `messages[0].message = "File ignored because no matching configuration was supplied."` |
| `prettier.getFileInfo(file)` (API, not CLI) | `{ ignored: false, inferredParser: null }` for `.ps1` and `.png`; `inferredParser: "typescript"` for `.ts` |
| `powershell -Command [Parser]::ParseFile` | 0 errors on the live driver; 2 errors on a broken file, each with `ErrorId`, message and extent |

Source-scope extensions under `frontend/src`, `frontend/tests`, `frontend/scripts` and root `scripts`:
`.ts` 275, `.tsx` 152, `.gitkeep` 24, `.json` 17, `.mjs` 11, `.css` 3, `.ps1` 1, `.md` 1, `.svg` 1.

## Goals / Non-Goals

**Goals:**

- A file no gate step reads cannot be added without a check failing.
- The driver gets a real parse check, with no new dependency.
- Existing gate behaviour is unchanged for files that are already covered.

**Non-Goals:**

- Formatting PowerShell. No Prettier plugin exists and none is proposed; parse validation is the whole of
  what this change claims for `.ps1`, and the spec delta says so rather than implying more.
- Bringing the frozen M16–M19 provers and archived evidence under lint or typecheck. See D5.
- Changing what `npm run gate` already checks, or the order of existing steps.

## Decisions

### D1 — Coverage is a relation between a gate step and a file type, not a property of a file

`run-gate-batch.ps1` is exempt from ESLint *and* from Prettier, and covered by a parse gate. Recording
it in a per-file allowlist as "uncovered" would be false, and recording it as covered would hide which
step covers it.

So the exemption table is keyed by **(step, extension)** and the guard requires each tracked source file
to be covered by at least one step, with per-step exemptions recorded and explained.

- *Alternative:* a single per-file allowlist. Rejected — it cannot express "exempt from two tools, covered
  by a third", so the `.ps1` would either be mislabelled uncovered or silently assumed covered.
- *Alternative:* make ESLint or Prettier handle `.ps1`. Rejected — no parser exists; forcing one adds a
  dependency to a repository that treats `.ps1` as ungated precisely because nothing can read it.

### D2 — Coverage is established by asking each tool, never by reading its configuration

The defect survived because the configuration *looked* like it covered everything. Any guard that reads
config to infer coverage re-implements each tool's matcher and inherits the same drift.

The guard therefore probes representative files:

- ESLint: run with `--format json`, and treat a result carrying `no matching configuration` as
  **uncovered**. The exit code is explicitly *not* the signal — it is 0 for a file ESLint never opened,
  which is the bug.
- Prettier: call `getFileInfo()` and treat `inferredParser === null` as **uncovered**. The CLI's exit 2
  is not machine-readable and is never used.

- *Alternative:* parse `eslint.config.mjs` globs and `.prettierignore`. Rejected — re-implements two
  matchers, and a mismatch between the re-implementation and the tool is indistinguishable from real
  coverage.
- *Alternative:* trust exit codes. Rejected — that is precisely the false green this change exists to
  remove.

### D3 — The coverage guard is a test, not a new npm script

It is an assertion about the tree, and `npm test` already runs inside `npm run gate`. A script would need
its own wiring in `frontend/package.json`, the root proxy, CI, and `tests/root-commands.test.ts` — four
places to keep in step, for a check with no non-zero exit path of its own.

Cost is bounded by probing **one representative file per (step, extension)** — 9 extensions in source
scope — not one per file, so the guard does not grow with the tree.

- *Alternative:* a standalone `coverage:check` script. Rejected on wiring cost; revisit if the guard ever
  needs to run where the test suite does not.

### D4 — `ps:check` is a separate gate step, following `icons:check`

`icons:check` is precedent: a check of a build input no other gate reads, wired as an explicit step rather
than folded into a formatting pass. `ps:check` is the same shape, and the same lesson applies — a command
that gates releases and is documented nowhere is how this repository lost four sessions in M29.

Wiring: `frontend/package.json`, the root proxy, `.github/workflows/ci.yml`, and `tests/root-commands.test.ts`
extended to require the proxy. CI must run it or it is not a gate.

### D5 — Frozen evidence is declared per directory, and the guard pins the declared set exactly

Root `scripts/*.mjs` are one-off milestone provers; their headers state they copy the tree into a temp
directory and never write to the repository. `openspec/changes/archive/**` holds recorded artifacts that
must stay byte-exact. Neither should be linted, typechecked or reformatted — that is work with no benefit
and, for archived evidence, a real risk of altering provenance.

But blanket-exempting a directory is how live code hides in it. So the guard asserts the frozen set is
*exactly* the declared one: a new file under a frozen root fails until it is either covered or declared
frozen with a reason.

- *Alternative:* cover root `scripts/` with the frontend config. Rejected — they are not application code,
  and the root has no config of its own; adding one is scope this change does not need.

### D6 — With no PowerShell, `ps:check` reports "not run" and exits 0 with a stated reason

`verification-integrity` already requires that a skipped run is never reported as a pass. The existing
`.ps1` behavioural cases in `gate-batch-apparatus.test.ts` skip with a stated reason; this applies the same
rule to a new step. The reason is **printed**, never silent, and the coverage guard records `.ps1` as
covered *by `ps:check`* — so removing that step makes the guard fail rather than quietly leaving `.ps1`
uncovered.

## Risks / Trade-offs

**[The guard passes because a tool changed its reporting, not its coverage]** → The probes assert
observable behaviour, so a change in either direction fails loudly. If a future ESLint stops reporting
ignored files in JSON, the guard fails rather than concluding coverage is complete.

**`ps:check` is absent on Linux CI, weakening the gate silently** → It prints the skip, and
`tests/root-commands.test.ts` requires the step to exist. If the workflow environment lacks `pwsh`, that
is a stated gap to resolve, not a pass — recorded as such rather than absorbed.

**Adding a gate step lengthens `npm run gate`** → Measured at milliseconds: parsing one 17.8 KB file is
not a cost worth measuring twice. The coverage guard's ESLint spawn is the larger term and is bounded by
extension count.

**The frozen-set assertion is a tripwire for legitimate new files** → Intended. Each trip is a decision to
cover the file or to declare it frozen; the failure message states both options rather than only refusing.

**The guard is itself un-gated tooling** → It is a `.ts` test file, so ESLint, Prettier and `tsc` all cover
it, and `gate-batch-apparatus.test.ts` is the existing precedent for behavioural coverage of gate tooling.

## Migration Plan

Additive. No application behaviour changes, no data migration, no deployment coupling. Rollback is
reverting one commit; the gate returns to its previous step list.

## Open Questions

None. Every question that would have changed the specs or the breakdown — where the guard lives, how
coverage is detected, what happens without PowerShell — is settled above.
