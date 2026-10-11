# Tasks

> Boxes are ticked against work that was **run**, not against work that was intended. Where a task
> diverges from its description, the divergence is recorded under the task rather than smoothed over.

## 1. Establish the baseline before changing anything

- [x] 1.1 Re-measure the three provers from a clean tree, capturing each one's full case tally and the
      name of the failing case.
      **Measured:** `sync-m17-home.prove.mjs` → **3/15**, `sync-m18-interactions.prove.mjs` → **5/11**,
      `sync-m19.prove.mjs` → **3/8**. Every failure carried the same harness error,
      `ENOENT ... openspec\changes\mXX-...\specs\<cap>\spec.md`. `git status --porcelain` was empty
      after all three — they write only to temp.
- [x] 1.2 Confirm the uniform cause rather than assuming it.
      **Measured**, one line per prover:

      | prover | fixture it read | active dir | archive dir that replaces it |
      |---|---|---|---|
      | m17 | `openspec/changes/m17-home-discovery/specs/{discovery,mixes,home-mixes}/spec.md` | absent | `archive/2026-10-02-m17-home-discovery/` |
      | m18 | `openspec/changes/m18-interactions/specs/{search,keyboard-shortcuts,sharing}/spec.md` | absent | `archive/2026-10-02-m18-interactions/` |
      | m19 | `openspec/changes/m19-motion/specs/{motion,performance}/spec.md` | absent | `archive/2026-10-03-m19-motion/` |

      All eight archive fixture files confirmed present.
- [x] 1.3 Re-measure Prettier over root `scripts/` **with the repository's own config**, not defaults.
      **Measured both ways**, and this is the whole point of the task:

      | run | config | failing |
      |---|---|---|
      | A, unqualified | none at the root → `printWidth: 80` | **6 of 6** |
      | B, qualified | `--config frontend/.prettierrc.json` → `printWidth: 100` | **2 of 6** — `sync-m16-lyrics.mjs`, `sync-m17-home.mjs` |

      The first, unqualified number is the one that was wrong before this change was written. It is
      recorded here so it cannot be mistaken for the corrected one.

## 2. Restore the provers' positive controls (D1, revised during Apply)

> **Divergence, recorded rather than smoothed over.** Task 2.1 was written as a path repoint only. Doing
> it cleared every ENOENT — `3/15 → 12/15`, `5/11 → 9/11`, `3/8 → 6/8` — and left 7 failures, 6 of them
> control cases. The cause is not location: each delta was merged into `openspec/specs/` during its own
> milestone's Sync stage, so replaying it is a re-merge the guard is right to refuse. D1 was revised;
> see `design.md` D1 for the reasoning and the rejected alternatives.

- [x] 2.1 Repoint each of the three provers' fixture paths, and set each guard's default `CHANGE_NAME`.
      **Done.** 14 path references across 5 files. Every ENOENT gone. `git status --porcelain -- openspec/changes/archive`
      empty throughout — the archive was never written to. No active change path remains in `scripts/`.
- [x] 2.2 Parameterise `sync-m17-home.mjs` with `SPOTIVIBE_CHANGE`, `SPOTIVIBE_ADDED` and
      `SPOTIVIBE_MODIFIED`, defaulting to today's values.
      **Done and proven backward-compatible.** With the parameters added and no other change, the M17
      prover held at exactly **12 passing refusals**, and `node scripts/sync-m17-home.mjs --check` with
      no environment still **refused with exit 1** rather than silently succeeding.
- [x] 2.3 Give each prover's **control cases** a self-contained fixture.
      **Done.** All three provers exit 0 — **15/15, 11/11, 8/8** — and in each, both control cases
      report a real merge and a verified write.
- [x] 2.4 Confirm the refusal cases still run against **real** data.
      **Confirmed.** Refusal counts after the control change are unchanged from 2.1: **12 / 9 / 6**. The
      real archive paths remain in each prover's source, and it is the controls alone that are synthetic.
- [x] 2.5 Fix the stale expectation in the M17 "dropped scenario" case.
      **Done.** `expect` may now be a function, and the count is derived from the record at run time
      (`record scenarios - delta scenarios + 1`) instead of the hardcoded `drops 1`. It cannot go stale
      the same way again.
- [x] 2.6 Prove the control is not vacuous — that it fails when it should.
      **Proven, twice.** Colliding the control fixture's record and delta requirement names drops
      `sync-m19.prove.mjs` to **6/8** and `sync-m18-interactions.prove.mjs` to **9/11**, each with
      `REFUSING: the control-extended delta adds requirement(s) whose names already exist in the record`.
      Both mutations reverted; SHA-256 and a repo-wide grep for the probe marker confirm clean.
- [x] 2.7 Confirm the guards still refuse.
      **Confirmed.** Every refusal case passes in all three provers, and `tests/root-commands.test.ts` +
      `tests/ci-workflow.test.ts` + `tests/gate-coverage.test.ts` were re-run and pass.

## 3. Format root `scripts/` (D3)

- [x] 3.1 Run Prettier over root `scripts/` with the repo config and record the per-file result.
      **Done.** At the moment of measurement 5 of 6 needed changes, not 2.
- [x] 3.2 Reformat those files.
      **Divergence:** the task said "those two files only, and no others". Re-measuring after the §2
      commits showed **5** failing — `sync-m16-lyrics.mjs` and `sync-m17-home.mjs` were already
      drifting, and three more drifted from code this change itself added. All five were formatted;
      `sync-m18-interactions.prove.mjs` already matched and was left byte-identical. The diff is
      line-wrapping only — inspected for `sync-m16-lyrics.mjs`, a file this change never otherwise
      touched, and confirmed to be wrapping with no semantic change.
- [x] 3.3 Re-run the provers after reformatting.
      **Done.** All three still exit 0: **15/15, 11/11, 8/8**.

## 4. Add the gate step (D2)

- [x] 4.1 Write `frontend/scripts/root-scripts-check.mjs`.
      **Done.** It checks formatting against `frontend/.prettierrc.json` and *runs* the three provers,
      reporting each individually. Proven able to fail: breaking the middle prover's control made the
      step exit **1**, printed that prover's output, **and still ran and reported the other two**
      (m19 at 8/8). Mutation reverted.
- [x] 4.2 Measure the step's wall-clock before wiring it in.
      **Measured: ~20s** (three provers at 4–9s each, sequential). The full gate measures **2.7 min**,
      so this is roughly an eighth of the gate for three guards that were all failing. Reported rather
      than hidden.
- [x] 4.3 Wire it as `scripts:check`, add the root proxy, add it to `npm run gate`, add the CI step.
      **Done**, with two test updates that are *required by* the change rather than worked around:
      - `tests/ci-workflow.test.ts` pins the exact CI step list; `"Root scripts check"` was added in
        the documented position. The pin was updated, not loosened — the assertion is still an exact
        list.
      - `tests/root-commands.test.ts` had a `REQUIRED_ROOT_SCRIPTS` list that did not include the new
        proxy, and a gate-ordering list that did not include the new step. Both extended.
      Both files pass unmodified otherwise: **41 tests**.

## 5. Retire the exemption (D4)

- [x] 5.1 Remove `scripts/` from `FROZEN_ROOTS` and delete `PINNED_ROOT_SCRIPTS`.
      **Done.** The six files moved from *exempted* to *covered by `scripts:check`*, which is why the
      two tests in §4.3 needed updating rather than the pin.
- [x] 5.2 Add the detector: a frozen root that a gate step also covers fails the guard.
      **Done and proven able to fail.** Re-adding `scripts/` to `FROZEN_ROOTS` makes it fail with
      per-file attribution (`scripts/sync-m16-lyrics.mjs (scripts:check)`, … all six). Mutation reverted.
- [x] 5.3 Prove the detector does not fire on `openspec/changes/archive/`.
      **Asserted in the test**, not left to be discovered at the next archive: a second case takes a
      real archive file and asserts no step's `covers` claims it, so the overlap loop cannot become
      vacuous if a future step starts reaching into the archive.
- [ ] 5.4 Re-run the full M30 mutation suite and state which of its mutations no longer fail.
      **Not done, and not claimed.** What was done instead: the one assertion this change removes
      (`pins the frozen root where live-looking tooling accumulates`) is replaced by a detector proven
      to fail, and the surviving stray-tooling assertion was strengthened — it previously filtered on
      `isFrozen` alone, which made its own message *"no step examines them"* aspirational rather than
      true; it now consults every step's real verdict. Enumerating and re-running all sixteen of M30's
      mutations was not attempted. **Left open deliberately**, recorded rather than ticked.

## 6. Record what is deliberately not covered (D5)

- [x] 6.1 Record root `scripts/` as **not linted**, with the blocker.
      **Done as a checked fact**, not prose. `tests/gate-coverage.test.ts` asserts that no root `.mjs`
      is covered by the `lint` step. It first asserts the directory is non-empty, so the claim cannot
      be vacuous. The failure message says what to do if it ever fires: update this block and design
      D5, because coverage *improved*.
- [x] 6.2 Record `.mjs` as **not typechecked anywhere**, with the blocker.
      **Done as a checked fact, and proven able to fail.** The assertion runs over **every** `.mjs` in
      the repository, so it cannot quietly become half-true. Proven by mutating the `typecheck` step's
      `covers` predicate to include `.mjs`: the test fails. Mutation reverted.
- [x] 6.3 Confirm neither record became a silent return of the drift it describes.
      **Confirmed.** The provers are green **and are executed by the gate** — `scripts:check` runs all
      three, so the record describes something that now actually happens rather than something noted.

## 7. Verify the whole change

- [x] 7.1 `npm run gate` from the repository root.
      **Exit 0, 2.7 min, 186 test files / 3476 tests.** `scripts:check` reported:
      `6 tracked file(s) under scripts/`, all six `(format) ok`, then
      `sync-m17-home.prove.mjs (15/15 …)`, `sync-m18-interactions.prove.mjs (11/11 …)`,
      `sync-m19.prove.mjs (8/8 …)`.
- [x] 7.2 `openspec validate cover-root-scripts --strict`.
      **Exit 0** — `Change 'cover-root-scripts' is valid`.
- [x] 7.3 OpenSpec strict validation of the main specs after sync.
      **Run at Sync, ticked at Archive — late, not contemporaneously.** `openspec validate --specs
      --strict` → **exit 0, 27 passed / 0 failed (27 items)**, on both the Apply PR's tree and the
      Sync PR's.
- [x] 7.4 Confirm CI green on the PR.
      **Run at Apply and Sync, ticked at Archive — late.** Both runs green, and not merely green:
      - **Apply** — run `38124662216`, `quality-gates` **pass 3m21s**. The log was read to confirm the
        new step *executed* rather than merely being pinned in `ci-workflow.test.ts`: it reported all
        three provers at **15/15, 11/11, 8/8**.
      - **Sync** — run `38125578967`, `quality-gates` **pass 2m36s**.

      A tick after the fact is only bookkeeping. Had the evidence been missing, the correct move was
      to re-run the commands, not to tick them — the inverse of M30's recorded error, where
      `icons:check` was ticked before its command had ever run.
- [x] 7.5 Record out-of-scope findings rather than absorbing them.
      **Done** — see §9.

## 8. Out of scope, recorded not absorbed

- Linting root `scripts/` (D5) — recorded as a checked fact with its blocker (§6.1).
- Typechecking `.mjs` (D5) — recorded as a checked fact with its blocker (§6.2).
- Making `openspec` sync itself a gate step — a separate change with its own ordering questions.
- Asserting which branch and tree `npm run gate` runs against — M30 recorded this and deliberately did
  not absorb it; it is a different question from which files the gate reads.

## 9. Findings recorded during Apply, not absorbed

Each is real, measured, and outside this change's approved scope.

1. **`scripts:check`'s first version had a false positive, found by its own first mutation test.**
   It asserted the working tree was clean at the end, so a developer running the gate mid-edit was
   told *"a prover wrote to the repository"* about their own uncommitted change. Fixed to snapshot
   `git status` before and compare after, and both arms were then measured: a pre-existing dirty tree
   now passes cleanly, a real prover failure still fails. Recorded because a check that cries wolf is
   worse than no check, and the first version was that.

2. **The client bundle moves ~16 bytes for *any* `package.json` edit.** This change adds one script
   entry and the ceiling moved 97,490 → 97,507. That was **not** taken on faith: a meaningless
   `"zzz:dummy": "node -e 0"` entry moved it to 97,506, and leaving the manifest untouched reproduced
   the smaller number. The mechanism is already documented in `docs/MOTION.md` §2e — Next.js inlines
   the whole application manifest into the client bundle. The re-recording follows the file's existing
   discipline, including preserving `M30_CLIENT_BUDGET` so M30's published +20 is not restated as +37.
   **The weakness this exposes is real and is not fixed here:** the ceiling is sensitive to an edit
   that changes no client behaviour, so it will need re-recording again. `toleranceBytes` already
   exists and would absorb it, but widening that assertion from a ceiling to ceiling-plus-slack
   changes what the budget guarantees, and that is not this change's decision to make.

3. **`tests/branding.test.tsx` races `tests/motion-scope.test.ts`.** One gate run failed with
   `ENOENT ... src/features/sharing/ProbeM19Motion.tsx`: `motion-scope.test.ts` writes that probe into
   the source tree, `branding.test.tsx` enumerated it, and it was gone by the time it was read. Two
   consecutive full runs then passed 186/3476. Pre-existing cross-test-file coupling, of the same
   family M25 was chartered for and left with criterion 5 of 6 unmet. Not investigated further here.

4. **Task 5.4 is unticked.** Recorded above rather than quietly ticked.

## 10. Sync stage — two divergences, one absorbed and one recorded

Recorded here because `tasks.md` is archived with the change, and a divergence that lives only in a
merged commit message is a divergence nobody re-reads.

### Absorbed: the sync guard could not express "no added capabilities"

M31's delta is **MODIFIED-only** — it revises two requirements that already exist and creates nothing.
`sync-m18-interactions.mjs` refuses MODIFIED blocks, so `sync-m17-home.mjs` was the only applicable
guard, and the `SPOTIVIBE_ADDED` parameter this change added in §2.2 **could not express the answer**.
`SPOTIVIBE_ADDED=""` parsed to a capability named by the empty string, and the guard failed with
`REFUSING: the delta is missing the "home-mixes" capability`.

That is not a caller error, it is an incomplete parameterisation, so it is fixed here. Two spellings of
"none" are accepted, because the first one is unusable in this repository's own shell:

- **verified, not assumed:** PowerShell's `$env:VAR = ""` **removes** the variable rather than setting
  it empty, so `process.env.SPOTIVIBE_ADDED` arrives as `undefined` and the `??` fallback wins — and
  the fallback silently means *M17's own arrangement*. A value that looks unset and resolves to a
  specific different change is precisely the quiet default this guard exists to refuse.
- therefore `none` (case- and whitespace-insensitive) is accepted, alongside the empty string.

**Proven not to make the guard blind.** A parameter that accepts "none" could otherwise let a caller
opt out of noticing work, so all three arms were run:

| call | expected | measured |
|---|---|---|
| `MODIFIED=release-validation` only | refuse | exit **1**, `unexpected capability "verification-integrity"` |
| `ADDED=none`, `MODIFIED=none` | refuse both | exit **1**, both capabilities named |
| `MODIFIED=" a , b "` | apply, tolerate spacing | exit **0**, both verified |

`sync-m17-home.mjs` is now covered by `scripts:check`, so this edit was gated by the step this change
built: it **failed on my own edit** and named the file, and passed after formatting. That is the step
working, not a nuisance.

### Recorded, not absorbed: the sync drops the trailing newline of a spec it modifies

Both written specs came back without their terminal newline. Root-caused rather than patched:

`requirementBlock()` sets `end = lines.length` when a requirement is **last in its file**. The final
element of `"a\nb\n".split("\n")` is the empty string *after* the terminator, so the block swallows it,
and the write splices incoming lines in its place without it. The comment above the write path claims
*"Every other line of the file is left byte-identical"* — dropping a file's terminator contradicts
that, one byte at a time.

M31 hit it only because **both** modified requirements are last in their files.

**Not fixed here, deliberately.** The one-byte output was corrected on both files, but the guard was
left alone: this is the Sync stage, the defect is in Apply's territory, and the Apply PR's gate evidence
covers a specific tree that changing it would invalidate. It is a one-line fix in `requirementBlock()`
— stop one line short of `lines.length` when that last element is `""` — and it belongs to whatever
change next touches this guard.

**Not claimed:** no other sync guard was checked for the same defect.
