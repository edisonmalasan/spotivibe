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

- [ ] 4.1 Run six `npm run gate` runs and the corroborator from the canonical home
- [ ] 4.2 Require corroborator exit 0, six distinct digests, one commit, 0 skipped
- [ ] 4.3 Confirm the batch commit's **tree** equals the merge commit's tree — five batches were
      invalidated during M24 by the tree moving after measurement, and the rule is the reason
- [ ] 4.4 Record commit, tree and `merge-base` result in the **PR body**, not in this file

## 5. Statements

- [ ] 5.1 State that M21 CRITICAL 1 and CRITICAL 2 remain open and are not closed here
- [ ] 5.2 State that fixing this flake does not make the gate trustworthy, and that a run that
      happened to avoid it was never evidence of determinism

## 6. Close out

- [ ] 6.1 `openspec validate --specs --strict`
- [ ] 6.2 Commit, push, open PR, merge with a merge commit, delete the branch
- [ ] 6.3 Archive, and record the outcome in `ROADMAP.md`
