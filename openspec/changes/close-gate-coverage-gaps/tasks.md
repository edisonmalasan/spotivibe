# Tasks

> Boxes are ticked against work that was **run**, not against work that was intended. Where a task
> diverges from its description, the divergence is recorded under the task rather than smoothed over.

## 1. Establish the baseline before changing anything

- [ ] 1.1 Record the measured gap, per surface, as **commands and their actual output** rather than as a
      claim: `npx eslint frontend/scripts/gate-batch/run-gate-batch.ps1` (expect exit 0 carrying
      `no matching configuration`), `npx prettier --check` on the same file (expect exit 2,
      `No parser could be inferred`), and `prettier --check .` (expect exit 0, having never asked).
      Verify: the outputs are pasted into this file unchanged.
- [ ] 1.2 Confirm the same for every other source file in `frontend/scripts/`, so the exemption table is
      built from measurement rather than from the assumption that one file is the only exception.
      Verify: a per-file table of ESLint-covered / Prettier-covered, with `.ps1` the only row reading
      uncovered.
- [ ] 1.3 Establish that the root `scripts/*.mjs` reach no gate: confirm no ESLint or Prettier config
      exists at the repository root and that the root `lint`/`format:check` proxy into `frontend/`.
      Verify: recorded, plus each root script's header showing it is a one-off prover that copies the
      tree to a temp directory.
- [ ] 1.4 Prove the replacement is feasible before designing around it: PowerShell's AST parser reports
      **0** errors on the live driver and **≥ 2** on a deliberately broken copy written outside the tree.
      Verify: both outputs recorded.
- [ ] 1.5 Prove both detection APIs are machine-readable: `eslint --format json` carries the ignored file
      in its results with `errorCount: 0` and the `no matching configuration` message; and
      `prettier.getFileInfo()` returns `inferredParser: null` for `.ps1` and `.png`, and a parser name for
      `.ts`. Verify: both payloads recorded.

> 1.5 is load-bearing. The whole guard rests on reading a signal from each tool. If ESLint stopped
> reporting ignored files in JSON, or Prettier had no such API, D2 would be unimplementable as written and
> the design would have to change before any code exists — the same reason 2.3 in M29 was measured first.

## 2. The PowerShell parse gate

- [ ] 2.1 Write `frontend/scripts/powershell-parse-check.mjs`: enumerate tracked `.ps1` files outside the
      frozen roots, parse each with PowerShell's AST parser, and on any parse error print the file, the
      line and the error id, then exit non-zero. Verify: exits 0 on the current tree.
- [ ] 2.2 Prove it fails on a malformed script rather than only passing on a well-formed one: copy the
      driver outside the tree, break it, and point the check at the copy. Verify: non-zero exit, and the
      message names the file and the error id.
- [ ] 2.3 Prove the no-interpreter path reports rather than passes: run with no PowerShell reachable.
      Verify: prints a stated "not run" reason and exits 0 — never a silent pass, per *A run that is
      skipped is never reported as a pass*.
- [ ] 2.4 Wire `ps:check` into `frontend/package.json`, the root proxy, and `.github/workflows/ci.yml`.
      Verify: `tests/root-commands.test.ts` extended to require the proxy and passes;
      `tests/ci-workflow.test.ts` passes.
- [ ] 2.5 Document `ps:check` in `AGENTS.md` alongside the other verified commands, including that it
      reports rather than passes when no interpreter is present. Verify: `npm run format:check` exit 0.

## 3. The coverage guard

- [ ] 3.1 Write `frontend/tests/gate-coverage.test.ts`: enumerate tracked source files under the covered
      roots with `git ls-files`, group them by extension. Verify: the test runs and the file counts it
      reports match the measured tree.
- [ ] 3.2 Probe ESLint per extension with `--format json` and treat a result carrying
      `no matching configuration` as uncovered. The exit code SHALL NOT be the signal — record in the test
      why, since a passing exit code over an unexamined file is the defect this change exists to remove.
      Verify: `.ps1` is reported uncovered.
- [ ] 3.3 Probe Prettier per extension with `getFileInfo()` and treat `inferredParser === null` as
      uncovered. Verify: `.ps1` and `.png` reported uncovered; `.ts`, `.tsx`, `.mjs`, `.json`, `.css`
      reported covered.
- [ ] 3.4 Add the exemption table keyed by **(step, extension)** per D1, and require every tracked source
      file to be covered by at least one step. `.ps1` is exempt from ESLint and Prettier and covered by
      `ps:check`. Verify: the table explains each exemption, and the guard passes.
- [ ] 3.5 Declare the frozen roots — root `scripts/` and `openspec/changes/archive/` — and pin the
      declared set exactly, so a new file there fails until it is covered or declared with a reason.
      Verify: a new file under a frozen root makes the guard fail with both options named.
- [ ] 3.6 Prove every detection can fail by mutation, restoring each source byte-for-byte and verifying by
      SHA-256. At minimum: revert the ESLint probe to trusting the exit code, and remove the `ps:check`
      entry from the exemption table. Verify: each mutation turns the suite red; each restore is
      byte-identical.

> The second mutation is the one that matters most. If `ps:check` were deleted and the table still claimed
> `.ps1` was covered, the guard would pass over a file no gate reads — the original defect, rebuilt.

## 4. Discharge the documented limitation rather than restating it

- [ ] 4.1 Replace the `AGENTS.md` paragraph stating that these scripts have no static gate with the
      checked claim that `ps:check` covers them. Verify: the paragraph no longer describes `.ps1` as
      ungated, and the guard independently confirms the coverage it now claims.
- [ ] 4.2 Assert the **positive** documentation claim — that `AGENTS.md` lists `ps:check` among the
      verified commands and does not carry the old no-static-gate statement — rather than string-matching
      prose that could be reworded. Verify: the case fails when the claim is removed.
- [ ] 4.3 Record in the archived change that this requirement (*A documented limitation of a guard is
      checked rather than described*) was already in the spec and was being violated by the paragraph M29
      added. Verify: the note states the violation and the fix.

> This is why the change is framed as discharging an existing requirement rather than adding a new one.
> M29 documented the gap correctly and completely, and that documentation is itself the thing
> `verification-integrity` says must not be left as prose.

## 5. Verify and close out

- [ ] 5.1 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`, `npm test`,
      `npm --prefix frontend run icons:check`, `npm --prefix frontend run ps:check` — each run, each exit 0.
- [ ] 5.2 `openspec validate close-gate-coverage-gaps --strict` and `openspec validate --specs --strict`.
- [ ] 5.3 Prove the guard's own cost: record how long the coverage check adds to `npm test`, since it
      spawns ESLint. Verify: the number is recorded whether or not it is acceptable, and if it is not,
      the design is revisited rather than the number reinterpreted.
- [ ] 5.4 Six `npm run gate` runs plus the corroborator, run as the driver prints it, recording the commit
      and tree the batch measured.
- [ ] 5.5 Record commit, tree and merge-base in the **PR body**, not in this file.
- [ ] 5.6 Commit, push, PR, merge with a merge commit, delete the branch.
- [ ] 5.7 Sync the delta into `openspec/specs/`, archive, and record the outcome in `ROADMAP.md`.

> **Known limitation, recorded not resolved:** no browser is attached in this environment, so nothing here
> is visually verified. This change touches no application source, which bounds the claim rather than
> satisfying it — recorded as UNVERIFIED in the PR body.
