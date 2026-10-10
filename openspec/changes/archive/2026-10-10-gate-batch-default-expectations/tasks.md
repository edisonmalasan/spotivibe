# Tasks: make the gate-batch checker stop failing correct evidence

> **Reading this file:** boxes are ticked against work that was *run*, not against work that was intended.
> Three places where the plan turned out to be wrong are recorded in §9 rather than quietly corrected,
> because each one changed what the evidence means.

## 1. Proposal, design, specs

- [x] 1.1 Write `proposal.md`, recording the measured failure: a 6-of-6 green batch exiting 1 with
      `8 problem(s) unresolved` when checked by the command the driver itself prints
- [x] 1.2 Write `design.md`, including D1–D4 and the four rejected alternatives, in particular
      "bump the constants to 185 and 25"
- [x] 1.3 Write the `verification-integrity` spec delta: the printed instruction must succeed, a default
      may not be a constant that falls behind the tree, and a run states what it did not assert
- [x] 1.4 `openspec validate gate-batch-default-expectations --strict`

## 2. Establish the baseline, before changing anything

- [x] 2.1 Record the current behaviour as a **failing** run, not as a claim: check the known-good
      `qpo-batch2` logs (6 of 6 green at `f70ba3186d85`) with **no** `--expect-*` flags and capture the
      exact output, including the exit code and the `ASSERTED MISMATCH` per row
- [x] 2.2 Confirm the per-run facts that make that output wrong rather than merely strict: all six runs
      `exit 0`, six distinct digests, `skipped none`, `files 185`, `budget 25`
- [x] 2.3 Confirm the live-tree figure the fix will compare against:
      `npx vitest list --filesOnly` returns exactly **185** lines, matching the batch's own figure, so
      the cross-tree check is an equality rather than a lower bound
- [x] 2.4 Record the SHA-256 of `verify-gate-batch.mjs`, `run-gate-batch.ps1` and
      `evidence-scripts.test.ts` before any edit, so each can be restored byte-for-byte

> 2.3 is the load-bearing measurement. If `--filesOnly` did not exist or did not agree with the batch,
> D1's cross-tree half would be a floor rather than an equality and the design would have to change
> before any code is written.

**Recorded output for 2.1** — the exact command from 8.2, run before any edit:

```
FAIL Test Files across the logs: 185 (asserted 182)
  found 185, expected 182. this default is stale — it is the M21 tree (182 files at 6f86211), not this tree.
FAIL motion-budget across the logs: 25 (asserted 21)
  found 25, expected 21. this default is stale — it is the M21 tree (21 motion-budget tests at 6f86211), not this tree.
8 problem(s) unresolved
EXIT: 1
```

## 3. Prove each new assertion can fail

- [x] 3.1 A checker run with **no stated expectation** over fixture logs whose file count does not match
      the live tree SHALL fail — `m29fix/crosstree`, six logs all reporting 200 against a tree of 185
- [x] 3.2 A checker run where the logs **disagree with each other** SHALL fail — `m29fix/disagree`, run3
      perturbed to 200 while the other five stay at 185
- [x] 3.3 A checker run with an explicit `--expect-files` that the evidence contradicts SHALL still fail
- [x] 3.4 The driver's printed follow-up command SHALL be shown to exit 1 on a correct batch as printed

> 3.3 is a regression guard for D2. It must be proven green-to-stay-green, and its failure mode must be
> a *disagreement* rather than the *stale default* the current script also produces for that input.

> **3.1 could not be proven before the fix**, and this is recorded rather than glossed: the cross-tree
> check did not exist, so there was nothing to fail. It is proven against the built checker instead. 3.2,
> 3.3 and 3.4 *were* proven against the unfixed checker, with `--expect-files`/`--expect-budget` supplied
> so the stale default could not be mistaken for the cause.

**A first attempt at 3.2/3.3 proved nothing and was discarded.** Both runs were issued through a
PowerShell helper whose third parameter was named `$args` — an automatic variable — so the flags never
bound and both runs silently fell back to `182`/`21`. Both still failed, and reporting that as a proof
would have been reporting the stale default under a different heading. Re-run inline: 3.2 fails with
`FAIL Test Files across the logs: 185, 200 (asserted 185)`, 3.3 fails with `(asserted 999)` and the
caller-attribution sentence.

## 4. Fix the checker

- [x] 4.1 Remove the `"182"` and `"21"` literal defaults from `parseArguments`
- [x] 4.2 When `--expect-files` is absent, derive the expectation from the logs and assert that all N
      logs agree on it
- [x] 4.3 Cross-check the derived figure against `vitest list --filesOnly` on the live tree; a mismatch
      SHALL fail as a cross-tree batch, naming the batch and both figures
- [x] 4.4 Preserve the stated-expectation path: an explicit figure that disagrees SHALL still fail
- [x] 4.5 Rewrite the verdict so it names the derived figure, states that no expectation was stated, and
      states whether it matches the live tree; distinguish asserted from reported figures
- [x] 4.6 Rewrite the header comment to describe the derived mechanism, **preserving** the round-12
      history that records why the constant approach was adopted and why it was wrong

## 5. Fix the driver

- [x] 5.1 `run-gate-batch.ps1` binds the printed follow-up command to the `--expect-files` and
      `--expect-budget` values it already parsed for its own run table
- [x] 5.2 Confirm by running the driver that with `-Runs 0` it prints no figure at all, and says why,
      rather than inventing one

## 6. Update the coupling tests

- [x] 6.1 The case pinning documented defaults to `?? "182"` / `?? "21"`
- [x] 6.2 Extend the printed-command case so the printed line is required to carry the measured figures,
      not merely `--runs`
- [x] 6.3 A checker run with no stated expectation exits 0 on a correct batch
- [x] 6.4 The cross-tree mismatch still fails
- [x] 6.5 A stated expectation that disagrees still fails
- [x] 6.6 Prove **every** new case can fail by mutation, and restore each mutated source byte-for-byte,
      verifying by SHA-256

> 6.1 was expected to be a deletion. It was not, and the reason is in §9.2 — the suite that guards the
> canonical scripts is a different file from the one this task assumed, and its corresponding case was
> rewritten rather than removed.

**Mutation results for 6.6** — each applied, measured, and reverted with `git checkout` plus a SHA-256
check against the committed blob:

| # | Mutation | Result |
|---|---|---|
| M1 | `againstFiles` back to the literal `"182"` | **3 failed** (was 1 before §9.1) |
| M2 | the `what was asserted` block disabled | **2 failed** |
| M3 | the unreadable-phase charge `+= 0` | **1 failed** (was **0** before §9.3) |
| M4 | disagreement and caller-stated diagnoses swapped | **2 failed** |
| M5 | `$expectFlags` dropped from the printed command | **1 failed** |
| M6 | the `Count -eq 1` gate replaced by `$true` | **2 failed** |

Two of these six mutations initially broke **nothing**. Both are recorded in §9.1 and §9.3, and both were
fixed before the change was accepted — an unbreakable mutation is an unguarded clause wearing a test.

## 7. Document

- [x] 7.1 Record in `AGENTS.md` how the corroborator is invoked, that the driver prints the figures to
      pass, and what omitting them now means for the verdict
- [x] 7.2 Update the checker's own usage text so it does not imply the flags are required to obtain a
      meaningful result

## 8. Verify and close out

- [x] 8.1 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`, `npm test`,
      `npm --prefix frontend run icons:check` — each run, each exit 0
- [x] 8.2 Re-run the baseline from 2.1 **verbatim**, with no flags, and require exit 0
- [x] 8.3 `openspec validate gate-batch-default-expectations --strict` and
      `openspec validate --specs --strict`
- [x] 8.4 Six `npm run gate` runs plus the corroborator, from the canonical home
- [ ] 8.5 The batch tree equals the merge tree — **NOT SATISFIED, and unsatisfiable as written.** See below.
- [x] 8.6 Record commit, tree and `merge-base` in the **PR body**, not in this file
- [x] 8.7 Commit, push, PR, merge with a merge commit, delete the branch
- [x] 8.8 Sync the delta into `openspec/specs/`, archive, and record the outcome in `ROADMAP.md`

**Recorded result for 8.4** — batch `m29-batch`, six runs, all `exit 0`, `skipped none`:

| run | time | files | tests | motion-budget |
|---|---|---|---|---|
| 1 | 123s | 185 | 3447 | 25 |
| 2 | 127s | 185 | 3447 | 25 |
| 3 | 115s | 185 | 3447 | 25 |
| 4 | 114s | 185 | 3447 | 25 |
| 5 | 147s | 185 | 3447 | 25 |
| 6 | 180s | 185 | 3447 | 25 |

Corroborator, run as the driver printed it — **exit 0**:

```
node …\verify-gate-batch.mjs …\m29-batch --frontend …\frontend --runs 6 --expect-files 185 --expect-budget 25

ok   live tree file count: 185 test files, from `vitest list --filesOnly`
ok   log digests across the logs: 6 distinct of 6
ok   commits named across the logs: a9b5e3c19dc8 (1 distinct of 6)
ok   Test Files across the logs: 185 (asserted 185 - the figure you supplied with --expect-*)
ok   Tests across the logs: 3447 (stability only - nothing asserted beyond the logs agreeing)
ok   motion-budget across the logs: 25 (asserted 25 - the figure you supplied with --expect-*)
what was asserted: both the file count and the motion-budget count were supplied by you; the file count
was NOT checked against the live tree; the motion-budget count was checked for stability only…
corroborated: …
```

**The same batch with no `--expect-*` at all — exit 0**, which is the path the driver used to fail:

```
ok   Test Files across the logs: 185 (asserted 185 - the live tree, because you supplied none)
what was asserted: no figure was supplied, so both were derived from the batch; the file count was
additionally checked against the live tree…
corroborated: …
```

### 8.5 is unsatisfiable as written, and the reason is structural

Batch commit `a9b5e3c` (tree `e1672c5`) versus HEAD `a942f41` (tree `2241838`) differ in exactly one file:

```
$ git diff --name-only a9b5e3c HEAD
openspec/changes/gate-batch-default-expectations/tasks.md
```

A batch measured at commit X, followed by ticking 8.4–8.8 in the change's own `tasks.md`, produces a
merge commit whose tree necessarily differs from X's. **Any** change that records its own batch evidence
in-repo cannot satisfy this task as written. The batch record therefore lives in the PR body (8.6), and
this line stays unticked rather than being ticked against a comparison that does not hold.

What does hold, and is the property the task was reaching for: **no file any gate step reads changed
between the measurement and the merge.** `tasks.md` is Markdown under `openspec/changes/`; it is not in
the vitest include set, not linted (ESLint covers `.ts`/`.tsx`), not type-checked (`tsconfig.json` admits
`.ts`/`.tsx`/`.mts`), not built, and not an input to `icons:check`. So all six runs executed identical
inputs, and the six distinct digests measure gate nondeterminism rather than a moving tree.

This is a divergence from the task text, recorded rather than absorbed. Re-running the batch at the final
merge commit was available and would have produced a byte-identical tree — at the cost of one more
25-minute batch, to defend an invariant this particular file makes unachievable.

> 8.2 is the acceptance test for the whole change, and it is deliberately the exact command from 2.1.
> If the change works, the command that produced `8 problem(s) unresolved` and exit 1 produces exit 0.

**Recorded result for 8.2:**

```
ok   live tree file count: 185 test files, from `vitest list --filesOnly`
ok   Test Files across the logs: 185 (asserted 185 - the live tree, because you supplied none)
ok   Tests across the logs: 3440 (stability only - nothing asserted beyond the logs agreeing)
ok   motion-budget across the logs: 25 (stability only - nothing asserted beyond the logs agreeing)
what was asserted: no figure was supplied, so both were derived from the batch; the file count was
additionally checked against the live tree; the motion-budget count was checked for stability only, as
no live-tree equivalent of it exists; the executed-test total is reported and never asserted.
corroborated: all 6 logs are distinct runs, each green, and every asserted figure was found in all of
them, with the independent enumeration anchored and in the same order of magnitude
EXIT: 0
```

## 9. Where reality diverged from this plan

Three findings, each of which changed the evidence rather than merely the schedule. They are recorded here
instead of being absorbed silently, because in each case the original task text described work that
would have produced a false green.

### 9.1 The expectation was resolved twice, and only one copy was guarded

M1 — reverting `againstFiles` to the literal — broke **1** of 25 cases, not the several it should have.

The cause was a duplication this file's own §3 warned against in prose and which the implementation then
committed: the per-row check and the aggregate check each derived the expectation independently. A
mutation touching only the per-row one left the aggregate still reporting the live tree, so a batch would
fail while its own summary claimed the check it had just lost.

Fixed by resolving the expectation once (`againstFiles` / `againstBudget`) and reading it in both places.
Re-measured: **3** cases fail under M1. No behaviour change; 25 passed before and after.

### 9.2 The suite this task named guards a frozen record, not the shipped scripts

6.1 assumed `evidence-scripts.test.ts` was where the canonical checker's tests live. It is not. That
suite resolves its subject through `resolveChangeDir()` and asserts against the **archived**
`2026-10-05-harden-post-v1-verification` copies — 12,121 B and 39,395 B, against the canonical
`frontend/scripts/gate-batch/` files' 17,856 B and 50,903 B.

New cases were written there first and failed, because they were being run against the 2026-10-05
checker, which still has `?? "182"`. That suite's purpose is guarding M21's recorded evidence, and its
header says so; `gate-batch-apparatus.test.ts` is the suite that declares it "Guards the canonical
gate-batch apparatus at `frontend/scripts/gate-batch/`".

`evidence-scripts.test.ts` was restored byte-for-byte and **is untouched by this change** — correctly,
because its defaults-coupling test guards a frozen record that this change does not modify. The case in
`gate-batch-apparatus.test.ts` that asserted the stale-default wording was **rewritten, not deleted**:
its durable claim ("a figure mismatch is diagnosable rather than merely fatal") survives, and only its
third element changed. Two further cases there asserted merely `not.toContain("this default is stale")`,
which became vacuous the moment that phrase stopped existing; each now asserts positive evidence.

### 9.3 A case I had just written proved nothing, and its subject was unguarded

M3 — reducing the unreadable-file-count phase's charge to `+= 0` — broke **no** case at all. Two separate
faults, both mine, both now fixed:

- **The phase's charge was not load-bearing**, because the per-row check was comparing each log's file
  count against `null` and charging six mismatches for one unreadable phase. A run failed for a reason its
  own output contradicted. A null expectation is now skipped rather than compared.
- **The fixture was wrong.** It replaced the stub outright with a one-line script, which also collapsed
  the enumeration anchor, so `status 1` was satisfied by a *different* failing phase. The case passed for
  a reason unrelated to its name. It now answers plain `list` correctly and returns nothing for
  `--filesOnly`, and asserts exactly one problem and no `ASSERTED MISMATCH` rows.

Re-measured after both fixes: M3 now fails the case. Both faults were invisible to "the suite is green",
which is the only reason they are written down.