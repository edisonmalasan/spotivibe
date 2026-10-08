# Tasks: synchronise the Settings test on the condition the UI depends on

## 1. Proposal and design

- [x] 1.1 Write `proposal.md` with the captured failure from batch 31
- [x] 1.2 Write `design.md`, including the four-step ordering that opens the window and the five
      options considered
- [x] 1.3 Write the `verification-integrity` spec delta: a test waits on the condition it asserts,
      and an unsynchronised wait is a verification defect
- [x] 1.4 `openspec validate fix-settings-hydration-wait --strict`

## 2. Implementation

- [x] 2.1 Change `renderSettings()` to wait for the control being enabled rather than for
      `usePreferencesStore.getState().hydrated`
- [x] 2.2 Leave the product component, the store, and every assertion untouched
      — `git diff --name-only HEAD -- frontend/src` is **empty**. One file changed, and it is a test.
- [x] 2.3 `npm run format:check` and `npm run lint` clean via `npm run gate` exit 0

## 3. Verification

- [x] 3.1 Prove the corrected wait can still fail
      — Mutating `AutofillSettingsSection` to `disabled={true}` turns the file **red: 4 failed, 7
      passed**, exit 1. Source restored and **verified byte-for-byte**: SHA-256
      `d0033592cbff34094b4f4a29f7c0211266cad049e9ed4bdb2c562f8c36ce8e71` before and after.
- [x] 3.2 Record that the failure **names the control**
      — Under the mutation the failure is `expect(element).toBeEnabled()` with the DOM printing
      `aria-label="Keep playing when the queue ends"`. It is raised from the wait at
      `autofill-setting.test.tsx:90`, inside `renderSettings` — so a genuine defect surfaces as *the
      control that never became usable*, which is the whole reason option A was chosen over the old
      wait on a store flag. Under the old wait this same defect would have surfaced as a **timeout on
      `hydrated`**, naming something unrelated to the fault.
- [x] 3.3 Run the file alone many times
      — 10 trials, **0 failures**. Recorded as a sanity check and **explicitly not as evidence**: the
      flake needs full-suite load, and the isolated file reproduced it 0 times before the fix too. An
      isolated green here would have meant nothing, and is not offered as though it meant something.
- [x] 3.4 Run `npm run gate` to completion
      — exit 0, **183 files, 3412 tests**, 0 skipped.

## 4. Batch evidence

**This section was deliberately left unfilled through the Apply PR and is completed here.** Writing it
during Apply would have committed a new tree and invalidated the batch by exactly the mechanism that
cost M24 four batches — the criterion requires the batch commit's **tree** to equal the merge
commit's tree, and the record is itself a commit. The archive is where a further tree change is
expected, so the record belongs here.

- [x] 4.1 Run six `npm run gate` runs and the corroborator from the canonical home
      — Batch 32 at commit `2b263080c7bf`, tree `8e0fd35ca181`. Six runs, exit 0 each.
- [x] 4.2 Require corroborator exit 0, six distinct digests, one commit, 0 skipped
      — Corroborator **exit 0**: `corroborated: all 6 logs are distinct runs, each green, and every
      asserted figure was found in all of them, with the independent enumeration anchored and in the
      same order of magnitude`. **6 distinct digests of 6**, **1 distinct commit of 6**, 183 files,
      3412 tests, motion-budget 24, **0 skipped** in every run, enumeration 3084/3412 = **0.904** over
      the 0.8 floor. The detector was re-proven able to fail on this same batch immediately after it
      passed — defaults only, no `--expect-*`, exit **1**, all six rows `ASSERTED MISMATCH`, naming
      `found 183, expected 182` and `found 24, expected 21` as stale M21 figures.
- [x] 4.3 Confirm the batch commit's **tree** equals the merge commit's tree
      — Batch tree `8e0fd35ca181277c11f0dad23c6e72d7f5cfa998`; **merge commit `546bb31`'s tree is
      byte-identical**, checked after the merge rather than assumed. `git merge-base --is-ancestor
      origin/main 2b26308` exits **0**.
- [x] 4.4 Record commit, tree and `merge-base` result in the **PR body**, not in this file
      — Done in PR #117. This section is a record of the measurement, not the criterion itself; the
      authoritative batch record is the PR body, because an in-tree record is a commit whose tree can
      never equal the tree it describes.

## 5. Statements

- [x] 5.1 State that this change does **not** retroactively certify M25
      — Stated in PR #117 and in `ROADMAP.md`. M25's batch was **5 of 6** and stays recorded as unmet.
      Batch 32 is evidence about *this* tree; it is not a repair of that record, and the two claims
      are kept apart.
- [x] 5.2 State that M21 CRITICAL 1 and CRITICAL 2 remain open
      — An unsynchronised wait produces a red that means nothing. Removing one instance of that does
      not mean the gate cannot lie, and 6 of 6 is a real measurement rather than proof of determinism:
      batch 26 and batch 31 each failed 1 of 6, and **neither defect was visible in isolation**.

## 6. Close out

- [ ] 6.1 `openspec validate --specs --strict`
- [ ] 6.2 Commit, push, open PR, merge with a merge commit, delete the branch
- [ ] 6.3 Archive, and record the outcome in `ROADMAP.md` — including whether M25's criterion can
      now be satisfied, and on what evidence
