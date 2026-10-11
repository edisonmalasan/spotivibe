# Tasks

> Boxes are ticked against work that was **run**, not against work that was intended. Where a task
> diverges from its description, the divergence is recorded under the task rather than smoothed over.
> `design.md` records that the reader count is re-measured here rather than fixed in the design, so the
> enumeration in §1 is the authority and §3's list is whatever §1 actually found.

## 1. Measure the real reader set

- [ ] 1.1 Enumerate every file under `frontend/tests/` that reads `frontend/src` by listing it and
      reading each listed file, and record each one's tree root, read site, and current tolerance.
      **Verify:** the list is pasted into this file with `file:line` for both the listing and the read,
      and each entry states whether it reads `frontend/src`, a subtree of it, or a directory outside
      it — the last of which is recorded as lower exposure rather than omitted, because the rule says
      *every* reader and a guard that silently exempts a category is how M31's predecessor happened.
- [ ] 1.2 Confirm the writer set is still exactly one.
      **Verify:** re-run the search for `writeFileSync` / `rmSync` / `mkdirSync` / `cpSync` /
      `renameSync` / `unlinkSync` targeting `frontend/src` or `frontend/public` from test code, and
      record the result. If a second writer exists, the design's Context is wrong and this task fails
      rather than being reworded to match.
- [ ] 1.3 Record the fixed-path readers that are **not** in the race class.
      **Verify:** at least one is named — `evidence-scripts.test.ts` is the expected witness — with the
      reason it reads only named paths. This list is what makes the guard's exemption non-vacuous in
      §4, so it must exist before the guard is written.

## 2. Add the asserting wrapper (D1)

- [ ] 2.1 Add `readTreeStrict(directory, options)` to `frontend/tests/helpers/sourceTree.ts`, built on
      the existing `readTree`: it collects raced paths and throws an error naming **every** one.
      **Verify:** it exists and `readTree`'s exported behaviour is unchanged — `source-tree-race.test.ts`
      passes without modification, which is the regression check.
- [ ] 2.2 Extend `source-tree-race.test.ts` to cover the new wrapper on all three arms: a vanished file
      is reported and fails the read; several vanished files are **all** named; a non-`ENOENT` read
      failure still propagates and is **not** reported as a race.
      **Verify:** each arm is driven through the injected `read` seam, not through a real filesystem
      race, so all three execute on every run. Prove the third arm can fail by making `read` throw a
      non-`ENOENT` error and observing the suite go red.
- [ ] 2.3 Confirm `architecture.test.ts` is unaffected and still proves its own tolerance.
      **Verify:** it passes unmodified, and its `no file vanished between being listed and being read`
      assertion is still present. D1 explicitly declines to migrate it; record that it was left alone
      rather than merely noting that no diff appeared.

## 3. Convert the readers

- [ ] 3.1 Convert the files §1.1 measured as reading `frontend/src` or a subtree of it, in
      measured-exposure order, to `readTree` or `readTreeStrict`.
      **Verify:** after **each group**, `npm test` is run and its file/test counts are recorded in this
      task. A thirteen-file sweep verified only at the end cannot attribute a failure to a conversion.
      Note which readers use `readTree` and which need `readTreeStrict`, and why.
- [ ] 3.2 Convert `token-contrast.test.ts` (D4), which already tolerates but drops the file silently.
      **Verify:** its behaviour **changes** — a lost file now fails the suite instead of being skipped.
      Record that as the reporting obligation being discharged, not as a regression, and record that
      its `readIfPresent` tolerance is replaced rather than merely supplemented.
- [ ] 3.3 Leave `motion-scope.test.ts` untouched.
      **Verify:** `git diff --name-only` does not list it, and the probe still exists at
      `src/features/sharing/ProbeM19Motion.tsx` inside the test's `try`/`finally`.

## 4. Add the guard (D2)

- [ ] 4.1 Write the guard: scan `frontend/tests/**`, classify each file, and fail when a file reads the
      application source tree by listing it and reading each listed file without going through
      `readTree` or `readTreeStrict`. On failure it names every offending file and the read site.
      **Verify:** the guard passes against the tree §3 produced, and its fixed-path exemption is
      non-vacuous — it classifies at least one file from §1.3 as exempt, asserted rather than assumed.
- [ ] 4.2 Witness the guard's classification on synthetic inputs **before** trusting it with the real
      tree (the rule M30 established for its own predicates).
      **Verify:** a synthetic compliant reader is classified compliant, a synthetic non-compliant one
      is classified non-compliant, and a synthetic fixed-path reader is classified exempt.
- [ ] 4.3 Prove the guard fails when a non-compliant reader exists.
      **Verify:** add a temporary test file that lists `frontend/src` and reads each listed file with a
      bare `readFileSync`; the guard must fail and name it. Revert, and prove the revert by SHA-256 —
      the file must not exist afterwards, and `git status` must be clean.
- [ ] 4.4 Prove the guard fails when a reader tolerates but does not report.
      **Verify:** replace one converted reader's `readTreeStrict` with a bare `try`/`catch` that skips
      on `ENOENT` and records nothing; the guard must fail. Revert, proved the same way.

## 5. Record the limits honestly (D3)

- [ ] 5.1 Record in `tasks.md` what the guard does **not** detect, and confirm the spec delta claims no
      more than that.
      **Verify:** the recorded limit and the delta's wording are quoted side by side here and shown not
      to overreach. A guard described in prose as stronger than it is is the defect this repository
      has already paid for twice.
- [ ] 5.2 Record that no claim of "the race is now impossible" is made anywhere in the change.
      **Verify:** grep the change's own artifacts for that claim and show its absence.

## 6. Verify the whole change

- [ ] 6.1 `npm run gate` from the repository root.
      **Verify:** exit 0, with the file and test counts recorded. Compare against the pre-change counts
      and explain any difference rather than letting a changed number pass unremarked.
- [ ] 6.2 Confirm the full suite count did not drop.
      **Verify:** a reader count is a **gain** of tests, and a conversion that silently dropped a suite
      would show up here.
- [ ] 6.3 `openspec validate race-tolerant-tree-readers --strict` and `openspec validate --specs
      --strict`.
      **Verify:** both exit 0.
- [ ] 6.4 Record out-of-scope findings rather than absorbing them.
      **Verify:** see §7.

## 7. Out of scope, recorded not absorbed

- Moving the probe out of `frontend/src` — rejected by M25 with reasons that survive re-reading, and
  contradicted by the requirement's own scenario.
- A lock or any inter-worker coordination — rejected by M25; vitest workers share a filesystem and do
  not coordinate.
- Policing readers of directories other than `frontend/src` — a scope expansion, answered by not
  expanding into it.
- The `ENOTDIR` case (a path that was a file when listed and a directory when read). Not reachable from
  the one writer that exists, and adding a tolerance for it would widen what `readTree` tolerates
  beyond the requirement.
