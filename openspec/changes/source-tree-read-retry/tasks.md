# Tasks

## 0. Baseline

- [x] 0.1 Record a green full-suite run before anything is changed: file count, test count, exit code.
      The counts are compared at §6 against this baseline, so a test lost to a refactor cannot be
      mistaken for a test that no longer exists.
      **187 files / 3491 tests, exit 0**, on `main@684d988`.
- [x] 0.2 Confirm the working tree is clean afterwards. **Two untracked entries, both pre-existing and
      neither written by these runs:** a root `pnpm-lock.yaml` and a two-entry root `node_modules/`
      (see §7.1). Nothing under `frontend/` was touched by a run.

## 1. Establish the starting flake rate

- [x] 1.1 Repeat the full suite **N times** and count red runs, recording the error text of each.
      **N = 24** on `main@684d988`, in three batches of 6, 8 and 10.
- [x] 1.2 Record N, the number of runs, alongside the rate. **1 red of 24.**
- [x] 1.3 If the measured rate is materially different from M32's 2-of-8, record that difference in the
      task rather than proceeding as though the baseline were known. **It is materially different, and
      the difference is the most important thing §1 found.**

      | | M32 | This change, `main@684d988` |
      |---|---|---|
      | Runs | 8 | 24 |
      | Red | 2 | 1 |
      | Vanished-file signature | present in both | **0 of 24** |

      **The race this change targets did not occur once in 24 runs**, where M32 recorded it twice in
      eight. Both figures were measured on different trees under different machine load — M32's ran
      alongside its Apply work, this one on an otherwise-idle box. Neither number is wrong and the
      difference is not explained here.

      **The one red is unidentified, and that is a finding rather than a footnote.** It came from the
      first batch, where I did not retain per-run detail — a mistake, since corrected: the following 18
      runs each wrote a full log that survives. Its vanished-file signature was **empty**, so it was not
      this race. **There may therefore be a second intermittent failure in this repository that M32
      never saw and that this change does not address.** Recorded under §7.

      **Consequence for the evidence this change must produce:** a local before/after flake-rate delta
      would read **0 → 0** and prove nothing in either direction. The case for the retry therefore rests
      on the deterministic arms at §3 and the measured window at §4, not on a rate. See `design.md` D7.

## 2. Implement the bounded repetition (D1, D2)

- [x] 2.1 Add the repetition **inside `readTree`**, wrapping the whole listing-and-reading cycle, not
      inside `readTreeStrict` — `architecture.test.ts`'s local reader calls the shared `readTree` and
      must be covered by the same change.
- [x] 2.2 Invoke `onRace` **only on exhaustion**. Its meaning changes from "this happened" to "this is
      still happening after the budget"; update the helper's documentation to say so, because a
      callback whose contract silently changed is how the next reader reintroduces the original defect.
- [x] 2.3 Collect raced paths across **every** attempt, so the failure names the union rather than only
      the last attempt's paths.
- [x] 2.4 Wait with `Atomics.wait` on a `SharedArrayBuffer`. **No new dependency**, and no
      `setTimeout`, which would make the reader async and change fourteen call sites for nothing.
- [x] 2.5 Cap the backoff rather than using a fixed wait, and export the total budget as a named
      constant so §3 and §5 can assert against the same number instead of a copy of it.
- [x] 2.6 **Make the budget overridable per call** (`design.md` D2.1). Five existing tests in
      `source-tree-race.test.ts` manufacture a permanent `ENOENT` and would each otherwise spend the
      whole production budget before asserting anything — at a two-second default that is ten seconds
      of the suite asleep, in a suite whose per-test timeout is already a source of red runs.
- [x] 2.7 A non-`ENOENT` read failure still propagates immediately and is **never** retried and never
      reported as a race. That narrowing is the reason `isMissing` exists and it must survive.

## 3. Prove both arms, and prove the detector can fail (D2.1)

- [x] 3.1 Green baseline first, through the `afterList`/`read` seams `source-tree-race.test.ts` already
      uses, before any mutation.
- [x] 3.2 **Convergence arm:** a read that succeeds on a later attempt returns the complete listing and
      invokes `onRace` **zero** times.
- [x] 3.3 **Exhaustion arm:** a read that never succeeds retries the stated number of times, then
      invokes `onRace` with **every** raced path and `readTreeStrict` throws naming all of them.
- [x] 3.4 **Each new assertion proven CAUGHT** by mutating the implementation and observing the
      expected test fail — non-zero exit **and** the expected test name in the output. A mutation run
      is not evidence unless the suite it ran actually started; two probe designs in M32 reported
      verdicts from a suite that never launched.
- [x] 3.5 Every source mutated for 3.4 restored **byte-for-byte**, proven by SHA-256 before and after,
      with the tree confirmed clean afterwards.
- [x] 3.6 Re-read every existing test that asserts on `onRace` rather than keeping it. A test that
      passed because a raced file was skipped on first contact may now be passing for a different
      reason, and keeping it would hide that.

## 4. Measure the writer's window (D3, D4)

- [x] 4.1 `motion-scope.test.ts` measures its own probe window: immediately before `writeFileSync` and
      immediately after `rmSync`, inside the `it` block that owns the probe.
- [x] 4.2 Assert that window against the reader's exported budget, with **both figures** in the failure
      message. This is the check that makes the design's load-bearing assumption a fact.
- [x] 4.3 The writer gains the measurement and **nothing else**: no lock, no relocation, no change to
      what it asserts or to when the probe exists on disk (D4).
- [x] 4.4 **Proven CAUGHT**: raise the asserted budget to a value below the measured window and confirm
      the new test fails, then restore.

## 5. Re-measure (D1 in the tasks, not the design)

- [ ] 5.1 Repeat the full suite the same number of times as §1 and record the red count.
- [ ] 5.2 Report both rates, with both denominators. A lower rate is an improvement; **zero** is the
      only figure that would justify claiming the collision is gone, and nothing here claims it is.

## 6. Verify the whole change

- [x] 6.1 `npm run gate` exit 0. **Ran 04:19:18–04:21:28, 2m10s, exit 0**; every step green
      (lint, format:check, ps:check, scripts:check, typecheck, build, test).
- [x] 6.2 Test file and test counts compared against §0.1; no converted file lost a test.
      **187 files / 3498 tests**, against a baseline of **187 files / 3491 tests**. The file count is
      unchanged and the test count rose by exactly **7** — the seven tests in `describe("the repetition")`.
      Nothing was lost, and the count is arithmetic rather than an impression.
- [x] 6.3 `openspec validate source-tree-read-retry --strict` exit 0.
- [x] 6.4 `openspec validate --specs --strict` exit 0.
- [x] 6.5 Diff reviewed for scope: test files, `frontend/tests/helpers/sourceTree.ts`, and the spec
      delta. **No production code, no dependency, no manifest, no gate step, no client-bundle change.**
      **One file is in the diff that the design did not plan for:** `architecture.test.ts`. It carries
      the `budgetMs: 0` fix described in `design.md` D2.1 and is a test file, so it is inside the stated
      scope — but it was found by the worker, **reported** rather than fixed in place, and applied by the
      orchestrator. Recorded because "the diff contains only what the design predicted" would have been
      the easier sentence to write and would have been false.
- [x] 6.6 Evidence reports only what was run. Anything not run is recorded as UNVERIFIED with the
      reason, rather than omitted. **UNVERIFIED: no browser was attached at any point in this change**,
      so nothing here is visually verified and nothing visual is claimed.

## 7. Out of scope, recorded not absorbed

Found while reconciling the tree before this change began:

- [ ] 7.0 **An unidentified intermittent failure, distinct from this race.** §1's single red of 24
      carried **no** vanished-file signature, so on the evidence available it is a different defect.
      Its detail was not retained — the first batch captured only a pass/fail summary, and the 18 runs
      after it captured full logs. **Not diagnosed here, and not claimed to be the same defect wearing a
      different error.** It needs its own investigation with its own evidence, and any milestone that
      later attributes a red to "the race" should first rule this one out.
- [ ] 7.1 **The root lockfile guard detects one spelling, not the property.** `root-commands.test.ts`
      asserts *"the application lockfile is the only one"* while checking only `package-lock.json`.
      `AGENTS.md` states the only lockfile is `frontend/package-lock.json` and that a second root
      lockfile is exactly what must not exist — yet `pnpm-lock.yaml`, `yarn.lock`, `bun.lock` and
      `bun.lockb` at the root would each pass. **This is live, not hypothetical:** an untracked root
      `pnpm-lock.yaml` (114 bytes, empty `importers:`) and a two-entry root `node_modules/` are present
      in the working tree, both left by a `pnpm` run at the repository root, and neither caught by any
      check. Belongs to `verification-integrity`'s "a check's name does not overstate its scope" and
      "a guard detects a spelling, not the property". **Needs its own change**; recorded here so this
      change is not mistaken for closing it. The stray files are not this change's to delete.
- [ ] 7.2 Carried forward from M31 and M32, still open: `icons:check` absent from the gate and CI with
      no root proxy; `sync-m18-interactions.mjs` unused by M30's Sync; the gate does not assert its own
      working tree; M21 CRITICAL 1 and 2 unclosable without the forbidden archived gate; M25's
      criterion 5 of 6 permanently unmet; `scripts/sync-m17-home.mjs` drops a spec's trailing newline;
      no gate batch run for M31 or M32.
- [ ] 7.3 A stale merged local branch `spike/m19-framer-motion-decision` (fully merged, verified
      ancestor of `main`). Housekeeping, not a defect, and deliberately not deleted here — it was not
      created by this work.