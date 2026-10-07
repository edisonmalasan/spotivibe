# Design

## Context

See `proposal.md` — Why for the motivation. What constrains the approach:

- The driver is PowerShell. `tsconfig.json` includes only `.ts`/`.tsx`/`.mts`, and neither ESLint nor
  Prettier handles `.ps1`, so **no static gate can prove anything about the driver.** Repair claims
  about it must be executable tests.
- The corroborator is `.mjs`. A file under `frontend/` is subject to `format:check`; a file under
  `openspec/` is not, because `format:check` runs `prettier --check .` with its working directory at
  `frontend/`. Relocation therefore changes what is gated, and which gates actually apply must be
  measured rather than assumed.
- The two scripts carry the reasoning from M21 verification rounds 10–18: three syntactic rungs and
  seven escapes around the commit stamp, a `$header` frozen outside the loop because reassigning
  `$commit` inside it is now inert rather than merely detected, UTF-8 log writes because `Tee-Object`
  emits UTF-16LE on 5.1. That reasoning is load-bearing and is why the approach copies rather than
  rewrites.
- One gate run takes roughly 100–200s, and a batch is six of them. Any test that invokes a real batch
  cannot run in the unit suite, so the driver needs a mode that exercises its resolution and its
  printed interface without invoking the gate.
- The archived copies are frozen evidence and stay that way. `frontend/tests/evidence-scripts.test.ts`
  resolves them by globbing active-then-archived and asserts ~590 lines against their text; that suite
  already treats "the path moved" as a real hazard.

## Goals / Non-Goals

**Goals:**

- The documented route to the `DONE` criterion runs from its canonical home, and from at least one
  other nesting depth, with no dependence on where the tool is stored.
- The driver exposes a fast, side-effect-free mode that exercises resolution and prints the completion
  command, so both are testable in seconds.
- The printed completion command runs verbatim on a documented interpreter.
- An asserted-default mismatch is diagnosable without re-deriving the measurement.
- Coverage of every claim above is a test that has been observed to fail when the claim is untrue.

**Non-Goals:**

- Rewriting the driver or the corroborator. Both are copied and repaired.
- Making the gate itself trustworthy. `ROADMAP.md`'s M21 CRITICAL 1 and CRITICAL 2 remain open and are
  not touched here; repairing the batch apparatus does not close them and must not be reported as if
  it did.
- Wiring batch execution into CI. A six-run batch is minutes of CI per pull request and the criterion
  is a per-milestone claim, not a per-commit one.
- Reformatting or otherwise altering the archived copies.
- Repointing `evidence-scripts.test.ts`. See the decision below.

## Decisions

### The canonical home is `frontend/scripts/gate-batch/`, and the scripts are copied rather than moved

The alternatives were the repository-root `scripts/` (a known residual: outside every gate), a new
top-level `tools/` (same problem), and repairing the archived copies in place (forbidden — they are
frozen evidence of what M21 shipped).

`frontend/scripts/` is the only candidate that both survives the OpenSpec lifecycle and sits inside
an existing gate's reach. It already holds `measure-client-bundle.mjs` (read by `motion-budget.test.ts`)
and `generate-icons.mjs` (wired to `npm run icons:check`), so it is an established home for tooling
rather than a new convention.

*Trade-off:* this duplicates roughly 53KB. The alternative — a minimal rewrite — would discard the
verification history embedded in the comments, which is the reason the driver is shaped as it is. A
reader who needs to know why `$header` is frozen cannot get it from a rewrite. Divergence is the
price, and it is bounded: the archived copies are frozen and so cannot drift, and only the canonical
copies are maintained. Both carry a header naming the canonical path and stating that the archived
copies are M21's record and are deliberately unrepaired.

### The driver resolves the root by walking up to a marker, not by counting parents

`Split-Path -Parent` is applied repeatedly until a directory containing `frontend\package.json` is
found, starting at `$PSScriptRoot`. If the walk reaches the filesystem root without finding one, the
driver exits non-zero naming the directory it started from and every directory it examined.

*Alternative considered:* `git rev-parse --show-toplevel`, which is authoritative and would be the
usual answer. Rejected for two reasons. The driver deliberately tolerates `git` being absent — it
falls back to a commit stamp of `unknown` rather than failing — so making root resolution depend on
`git` would introduce a hard dependency the tool currently does not have. More importantly, the marker
walk is testable without a repository: a fixture can place `frontend/package.json` in a temporary tree
and drop a copy of the script at several depths beneath it, which is what makes "resolves the same
from more than one depth" an assertion rather than an aspiration. A `git`-based resolver would force
every such test to build a real repository.

`frontend\package.json` alone is the marker. The existing guard already uses it, and requiring a
second marker would complicate fixtures without preventing a realistic false positive.

### `-Runs 0` is a supported dry mode that states it is not evidence

The loop `for ($run = 1; $run -le $Runs; ...)` already does nothing when `$Runs` is 0. That behaviour
is currently implicit and undocumented, and it is exactly what the tests need. It becomes explicit:
when `$Runs` is less than 1 the driver resolves the root, prints the completion command, and prints a
`DRY RUN — no gate was invoked — this is not criterion evidence` line before exiting 0.

*Risk and mitigation:* a dry run could be mistaken for a batch, which would be a claim of six green
runs from zero work. The `DRY RUN` line exists for that, and it is asserted by a test that requires the
line to be present whenever `$Runs` is below 1 and absent otherwise. The corroborator is unaffected —
it still requires as many logs as it is told to, so a dry run produces no logs and cannot corroborate
anything.

### The corroborator keeps its default, and the default names its own provenance

*Alternative considered:* remove the defaults and require `--expect-files` and `--expect-budget`
explicitly. Rejected. The expected figures must be supplied independently of the batch being checked —
if the driver printed the expectations it had just measured, the corroboration would be vacuous,
because the checker would be asserting the driver's own claim back at it. A hardcoded default is
genuinely independent.

The real defect is not that the default exists but that its failure is undiagnosable: `FAIL
motion-budget across the logs: 24 (asserted 21)` reads identically whether 21 is a stale constant or
the tree has regressed. The repair keeps the assertion and its fail-closed behaviour, and changes only
the diagnostic: the message names the figure found, the figure expected, and that the default belongs
to a named earlier tree. A caller who states the figure explicitly is asserted against that figure and
never falls back to the default.

### Each suite guards its own subject, and neither is repointed

`evidence-scripts.test.ts` keeps asserting against the archived copies, because that is what it is
for: the integrity of M21's recorded evidence. A new `gate-batch-apparatus.test.ts` guards the
canonical copies and their runtime behaviour.

*Alternative considered:* repoint the existing suite at the canonical copies. Rejected. Its assertions
are written against the archived text; the canonical copies are reformatted and repaired, so the
assertions would fail spuriously or have to be weakened to accommodate the move. Weakening tests so a
refactor passes is precisely the failure mode this repository's own
`verification-integrity` capability exists to prevent. Two suites with two explicit subjects is
cheaper than one suite that lies about what it covers.

### Gate coverage is measured, not asserted

Because `.ps1` escapes every static gate, the design does not claim the driver's repair is
type-checked, linted, or formatted. The implementer records which gates actually cover each new file,
by measurement, in `tasks.md` and in the usage note. A coverage claim in this repository that was not
measured is the defect family this milestone exists to remove.

## Risks / Trade-offs

- **A reader runs the archived copy and hits the original failure** → The canonical copies' headers
  name the canonical path and state that the archived copies are deliberately unrepaired;
  `ROADMAP.md` and the usage note name the canonical path as the one to run; the archived copies are
  left exactly as they are so the two are never confused by content.

- **The dry mode is mistaken for criterion evidence** → An explicit `DRY RUN` line whenever `$Runs`
  is below 1, asserted present-then-absent by a test; and the corroborator still demands its logs, so
  a dry run cannot corroborate.

- **The repair is mistaken for editing frozen evidence** → The archived files are byte-for-byte
  unchanged, and the implementer records a hash comparison of archive versus canonical to show the
  difference is confined to the repaired concerns.

- **Duplication drifts** → Only the canonical copies are maintained; the archived pair is frozen and
  cannot drift. The archived suite continues to guard the record.

- **`format:check` reformats the canonical corroborator** → Expected and desirable — it brings a
  39KB file that was never formatted under a gate for the first time. If formatting it breaks the
  checker, that is a real finding, not a formatting nuisance.

- **Repairing the apparatus is reported as closing the gate's untrustworthiness** → `tasks.md` states
  explicitly that M21 CRITICAL 1 and CRITICAL 2 are untouched and open, and the milestone's own
  acceptance wording avoids the word "trustworthy".