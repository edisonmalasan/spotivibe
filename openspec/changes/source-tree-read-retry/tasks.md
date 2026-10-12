# Tasks

## 0. Baseline

- [ ] 0.1 Record a green full-suite run before anything is changed: file count, test count, exit code.
      The counts are compared at §6 against this baseline, so a test lost to a refactor cannot be
      mistaken for a test that no longer exists.
- [ ] 0.2 Confirm the working tree is clean afterwards. The build the gate performs writes to `.next`,
      which is ignored; anything else appearing means something in the run wrote to the repository.

## 1. Establish the starting flake rate

- [ ] 1.1 Repeat the full suite **N times** and count red runs, recording the error text of each.
      M32's recorded figure is **2 red of 8**; this is the number this change has to be compared
      against, and quoting M32's figure without re-measuring would be exactly the shortcut this
      repository's `verification-integrity` spec exists to prevent.
- [ ] 1.2 Record N, the number of runs, alongside the rate. **One green run is not a rate**, and §6.1
      of M32 says so in its own record; the same rule applies here.
- [ ] 1.3 If the measured rate is materially different from M32's 2-of-8, record that difference in the
      task rather than proceeding as though the baseline were known.

## 2. Implement the bounded repetition (D1, D2)

- [ ] 2.1 Add the repetition **inside `readTree`**, wrapping the whole listing-and-reading cycle, not
      inside `readTreeStrict` — `architecture.test.ts`'s local reader calls the shared `readTree` and
      must be covered by the same change.
- [ ] 2.2 Invoke `onRace` **only on exhaustion**. Its meaning changes from "this happened" to "this is
      still happening after the budget"; update the helper's documentation to say so, because a
      callback whose contract silently changed is how the next reader reintroduces the original defect.
- [ ] 2.3 Collect raced paths across **every** attempt, so the failure names the union rather than only
      the last attempt's paths.
- [ ] 2.4 Wait with `Atomics.wait` on a `SharedArrayBuffer`. **No new dependency**, and no
      `setTimeout`, which would make the reader async and change fourteen call sites for nothing.
- [ ] 2.5 Cap the backoff rather than using a fixed wait, and export the total budget as a named
      constant so §3 and §5 can assert against the same number instead of a copy of it.
- [ ] 2.6 A non-`ENOENT` read failure still propagates immediately and is **never** retried and never
      reported as a race. That narrowing is the reason `isMissing` exists and it must survive.

## 3. Prove both arms, and prove the detector can fail (D2.1)

- [ ] 3.1 Green baseline first, through the `afterList`/`read` seams `source-tree-race.test.ts` already
      uses, before any mutation.
- [ ] 3.2 **Convergence arm:** a read that succeeds on a later attempt returns the complete listing and
      invokes `onRace` **zero** times.
- [ ] 3.3 **Exhaustion arm:** a read that never succeeds retries the stated number of times, then
      invokes `onRace` with **every** raced path and `readTreeStrict` throws naming all of them.
- [ ] 3.4 **Each new assertion proven CAUGHT** by mutating the implementation and observing the
      expected test fail — non-zero exit **and** the expected test name in the output. A mutation run
      is not evidence unless the suite it ran actually started; two probe designs in M32 reported
      verdicts from a suite that never launched.
- [ ] 3.5 Every source mutated for 3.4 restored **byte-for-byte**, proven by SHA-256 before and after,
      with the tree confirmed clean afterwards.
- [ ] 3.6 Re-read every existing test that asserts on `onRace` rather than keeping it. A test that
      passed because a raced file was skipped on first contact may now be passing for a different
      reason, and keeping it would hide that.

## 4. Measure the writer's window (D3, D4)

- [ ] 4.1 `motion-scope.test.ts` measures its own probe window: immediately before `writeFileSync` and
      immediately after `rmSync`, inside the `it` block that owns the probe.
- [ ] 4.2 Assert that window against the reader's exported budget, with **both figures** in the failure
      message. This is the check that makes the design's load-bearing assumption a fact.
- [ ] 4.3 The writer gains the measurement and **nothing else**: no lock, no relocation, no change to
      what it asserts or to when the probe exists on disk (D4).
- [ ] 4.4 **Proven CAUGHT**: raise the asserted budget to a value below the measured window and confirm
      the new test fails, then restore.

## 5. Re-measure (D1 in the tasks, not the design)

- [ ] 5.1 Repeat the full suite the same number of times as §1 and record the red count.
- [ ] 5.2 Report both rates, with both denominators. A lower rate is an improvement; **zero** is the
      only figure that would justify claiming the collision is gone, and nothing here claims it is.

## 6. Verify the whole change

- [ ] 6.1 `npm run gate` exit 0.
- [ ] 6.2 Test file and test counts compared against §0.1; no converted file lost a test.
- [ ] 6.3 `openspec validate source-tree-read-retry --strict` exit 0.
- [ ] 6.4 `openspec validate --specs --strict` exit 0.
- [ ] 6.5 Diff reviewed for scope: test files, `frontend/tests/helpers/sourceTree.ts`, and the spec
      delta. **No production code, no dependency, no manifest, no gate step, no client-bundle change.**
- [ ] 6.6 Evidence reports only what was run. Anything not run is recorded as UNVERIFIED with the
      reason, rather than omitted.

## 7. Out of scope, recorded not absorbed

Found while reconciling the tree before this change began:

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