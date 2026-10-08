# Tasks: repair the cross-test-file scan race in the contrast guard

## 1. Proposal and design

- [x] 1.1 Write `proposal.md` naming the captured failure, the mechanism, and the observed rate
- [x] 1.2 Write `design.md`, including the six options considered and why five were rejected
- [x] 1.3 Write the `app-shell` spec delta: the guard reads once at listing time and survives
      concurrent writes, and its tolerance cannot become silence
- [x] 1.4 Validate the change with `openspec validate fix-contrast-guard-scan-race --strict`

## 2. Implementation

- [x] 2.1 Change `componentFiles()` to return `{ file, source }` pairs, reading each file inside
      the walk immediately after its directory entry is seen
- [x] 2.2 Skip a file that is listed and then cannot be opened, rather than letting `ENOENT`
      propagate out of the guard
      — `readIfPresent()` returns `null` on `ENOENT` and **rethrows every other error**, so
      "tolerant" cannot quietly widen into "silent". A permission or I/O failure is a real problem.
- [x] 2.3 Update both call sites to consume the pairs instead of re-reading
      — the source comes from the pair, never from a second `readFileSync`; a later read would
      reintroduce the exact window this change closes.
- [x] 2.4 `npm run format:check` and `npm run lint` clean as part of `npm run gate` exit 0

## 3. Verification

- [x] 3.1 Add a test establishing **both** halves at once: a path that does not exist is reported
      absent without throwing, **and** a path that does exist still yields its contents
      — one test, not two. Two separate tests would each be satisfied by the wrong reader: "absent
      is tolerated" by one returning `null` for everything, "present still reads" by the reader this
      change replaced. Together they pin it from both sides. It reads a **real** component
      (`ShareButton.tsx`), not a fixture, so the assertion is about the production tree.
- [x] 3.2 Prove the new tolerance can fail
      — Mutating `readIfPresent` to `return null` turns the suite **red in two places**:
      `a path that exists must yield its contents, not null: expected null not to be null`, and
      `the walker must reach the components: expected 0 to be greater than 30`. Exit 1. Source
      restored and **verified byte-for-byte**: SHA-256
      `b2762338939956ed950ed32b0e7d247dab3a1c8aed71198c046f0f5c172b63c1` before and after, 6 tests
      green again.
- [x] 3.3 Prove the existing non-vacuity assertions still bite
      — the mutation above is the proof: the pre-existing `>30` assertion went red on its own, so a
      reader returning nothing cannot pass quietly. `>10` components using the type scale is
      asserted by `finds the text elements in the components`, which reads the pair.
- [x] 3.4 Run `npm run gate` to completion
      — exit 0, **183 files, 3412 tests** (3411 + this change's one new test), 0 skipped.
- [x] 3.5 Record the targeted-pair rate alongside the batch rate
      — targeted pair, 8 trials: **0 failures**, and no probe left behind. Full suite: roughly
      **1 in 6**. The two must not be confused; the pair run cannot see this defect at all, which is
      exactly why it survived.
- [x] 3.6 Prove the **restructure** matters, not only the tolerance
      — A throwaway harness reproduced the interleaving deterministically (a file deleted while the
      walk is in progress, as the parallel writer's `finally` does):

      | Structure | entries | threw |
      |---|---|---|
      | OLD — list then read, no tolerance | 6 | **`ENOENT`** (this is batch 26) |
      | OLD + tolerance only (option C, rejected) | 6 | nothing |
      | NEW — read inside walk + tolerance | **5** | nothing |

      Option C stops the throw but **keeps the phantom path in the list**, so the race would survive
      as a rarer flake — which is why it was rejected. The new structure never lists the vanished
      file at all. Harness lives outside the repository and is not committed.

## 4. Batch evidence

- [x] 4.1 Run six `npm run gate` runs and the corroborator from the canonical home
      — Batch 31 at commit `d8fe9f439cf9`, tree `fe663b3a8bd3`.
- [ ] 4.2 Require corroborator exit 0, six distinct digests, one commit, 0 skipped
      — **NOT MET. Batch 31 is 5 of 6 and is recorded as unmet.** It was not re-run for green.
- [ ] 4.3 Confirm the batch commit's **tree** equals the merge commit's tree
      — moot: there is no green batch to compare, so no criterion can be certified by this change.
- [ ] 4.4 Record commit, tree and `merge-base` result in the **PR body**, not in this file
      — done in the PR body; `git merge-base --is-ancestor origin/main d8fe9f4` exits 0.

**What batch 31 actually recorded, in full:**

| Run | Gate exit | Files | Verdict |
|---|---|---|---|
| 1 | 0 | 183 | green |
| 2 | 0 | 183 | green |
| 3 | 0 | 183 | green |
| 4 | 0 | 183 | green |
| **5** | **1** | **182** | **`tests/autofill-setting.test.tsx` — 1 failed** |
| 6 | 0 | 183 | green |

The corroborator **refused to certify it**, exit non-zero, and said why in its own output:

```
run5 … files null  tests ?  exit 1  ASSERTED MISMATCH
      the gate reported exit 1, so this run is not green.
      the log also carries a failing summary - "Tests  1 failed" - so it holds two
      verdicts and which one the gate meant is not decidable from the file.
ok   log digests across the logs: 6 distinct of 6
```

Six distinct digests and one commit — the apparatus worked. It declined to certify a batch
containing a red run, which is the behaviour the milestone exists to produce.

**The failing run is not this change's defect, and the log is the evidence.** In run 5 itself:

```
✓ tests/token-contrast.test.ts (6 tests) 133ms
✓ tests/motion-scope.test.ts (12 tests) 52ms
❯ tests/autofill-setting.test.tsx (11 tests | 1 failed) 971ms
```

Both files involved in the race this change fixes **passed in the very run that failed**.
`autofill-setting.test.tsx` is not in this change's diff; its last commit is `cb46391`.

**The defect that failed the batch** (`autofill-setting.test.tsx:82`, "renders as enabled on a
fresh Settings page"): `AutofillSettingsSection` disables its toggle on `status === "loading"`,
where `status` is the component's **own local** `useState`, flipped to `"ready"` only when *its
own* `hydrate()` promise settles and React commits the re-render. The test's `renderSettings()`
instead waits on `usePreferencesStore.getState().hydrated` — a **store-level** flag. Those are two
different signals, so `hydrated === true` can hold while the component still reads `"loading"`,
and under full-suite load the promise chain plus render commit lands after the assertion.

**The test waits on the wrong condition.** It is not a product defect and not this change's; it is
an unsynchronised wait in a different capability (the preferences/Settings surface). It is
recorded here and filed as separate work rather than absorbed into this change, per the rule that
a change is not broadened by an opportunity discovered during it.

## 5. Statements

- [x] 5.1 State that M21 CRITICAL 1 and CRITICAL 2 remain open and are not closed here
- [x] 5.2 State that fixing this flake does not make the gate trustworthy
      — This change removes **one** known flake from **one** guard's data flow. It says nothing
      about whether the gate would catch a regression, and it makes the gate no more able to. A run
      that happened to avoid the contrast race was never evidence of determinism, and batch 31 —
      which avoided it six times out of six while failing for an unrelated reason — is a concrete
      demonstration of the point: the race was gone and the batch was still red.

## 6. Close out

- [x] 6.1 `openspec validate --specs --strict` — 27 passed, 0 failed
- [ ] 6.2 Commit, push, open PR, merge with a merge commit, delete the branch
- [ ] 6.3 Archive, and record the outcome in `ROADMAP.md`

**This change must not be recorded as `DONE`.** The `DONE` criterion is six consecutive green full
gate runs at the merged tree, and this change has 5 of 6. The defect it fixes is real, reproduced
and verified; the criterion is not met, and the two statements are kept apart on purpose.
