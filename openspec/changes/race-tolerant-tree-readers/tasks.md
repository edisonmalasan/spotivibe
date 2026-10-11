# Tasks

> Boxes are ticked against work that was **run**, not against work that was intended. Where a task
> diverges from its description, the divergence is recorded under the task rather than smoothed over.
> `design.md` records that the reader count is re-measured here rather than fixed in the design, so the
> enumeration in §1 is the authority and §3's list is whatever §1 actually found.

## 1. Measure the real reader set

- [x] 1.1 Enumerate every file under `frontend/tests/` that reads `frontend/src` by listing it and
      reading each listed file, and record each one's tree root, read site, and current tolerance.
      **Verify:** the list is pasted into this file with `file:line` for both the listing and the read,
      and each entry states whether it reads `frontend/src`, a subtree of it, or a directory outside
      it — the last of which is recorded as lower exposure rather than omitted, because the rule says
      *every* reader and a guard that silently exempts a category is how M31's predecessor happened.

      **MEASURED — five passes, and the earlier four were wrong.** Recorded in full because the method
      matters more than the number, and because each pass was correct about what it could see.

      | pass | method | what it got wrong |
      |---|---|---|
      | 1 | text search for `ENOENT` | called **3 readers tolerant**; all three mentions were **comments** (M21 CRITICAL C1 — a comment satisfies a `toContain`). Only `token-contrast.test.ts:146` has it in code. |
      | fix | TypeScript comment scanner | **failed on real input**: stopped after 12,767 tokens on `release-exclusions.test.ts`, never reached line 3401, so the comment survived "stripping" and the file stayed misclassified. A stripper that quietly gives up restores the hole it was added to close. |
      | 2 | AST, "calls `readdirSync`" | right about tolerance, wrong about **roots**: flagged `gate-batch-apparatus.test.ts` as app-src because the file mentions `src` somewhere. |
      | 3 | AST, "read inside a loop" | too loose: loops over **constant arrays** (`CASES`, `ICON_FILES`, `claims`, `NON_GOALS`) counted as listings; and reads reached through a **helper function** (`token-contrast`'s `readIfPresent`) are not textually inside a loop, so a genuinely exposed reader vanished from the list. |
      | 4 | transitive resolution through local bindings and helpers | over-corrected and **missed `branding.test.tsx`** — the one reader that failed live in M31 — because its `files` const is function-local and the resolver only tracked module-level bindings. |

      **Conclusion reached, and it is a design input rather than a fact:** inferring the listing→read
      dependency is not decidable by any of the five attempts, each of which was blind to the next
      thing. That is M21's twelve rounds arriving from a different direction, so §4 stops inferring it.

      **What is decidable instead, and was measured:** `readdirSync` call sites under `frontend/tests/`.

      ```
      23 call sites across 20 files  (21 sites / 18 files in *.test.*, 2 in helpers/)
      ```

      Every site, by the shape it needs:

      | file | line | shape | disposition |
      |---|---|---|---|
      | `helpers/sourceTree.ts` | 103 | `{withFileTypes}` recursive | **the helper itself** — the sanctioned implementation |
      | `helpers/motionSource.ts` | 47 | `{withFileTypes}` | convert to the helper's `walk` |
      | `architecture.test.ts` | 532 | `{withFileTypes}` | already compliant; `readTree` at 3310 etc. D1 declines to migrate |
      | `branding.test.tsx` | 16 | `{withFileTypes}` recursive | **convert — the live flake** |
      | `deployment-contract.test.ts` | 43 | `{withFileTypes}` | convert |
      | `download-client.test.tsx` | 645 | names only, non-recursive | convert |
      | `download-non-goals.test.ts` | 87 | names only | convert |
      | `encoding-integrity.test.ts` | 122, 137 | names only | convert |
      | `evidence-scripts.test.ts` | 46 | names only, over `archive/` | list only — **exempt, stated reason** |
      | `gate-batch-apparatus.test.ts` | 288 | `existsSync(logDir) ? readdirSync(logDir) : []` | asserts a log dir is **empty**; no read follows — **exempt** |
      | `home-mix-cards.test.tsx` | 71 | names only | convert |
      | `home-time-bands.test.ts` | 51 | `{withFileTypes, recursive}` | convert |
      | `motion-scope.test.ts` | 107 | lists `features/sharing` to assert its probe is on disk | **the writer; §3.3 leaves it untouched** |
      | `performance-claims.test.ts` | 26 | `{withFileTypes}` | convert |
      | `pwa-offline-claims.test.ts` | 24 | `{withFileTypes}` | convert |
      | `release-exclusions.test.ts` | 69 | `{withFileTypes}` | convert |
      | `release-gate-install.test.ts` | 207, 1105 | names only; 1105 asserts a tmp dir is **empty** | convert 207; **exempt 1105** |
      | `security-policy.test.ts` | 59, 175 | `{withFileTypes}` | convert |
      | `share-links.test.tsx` | 272 | `{withFileTypes, recursive}` | convert |
      | `token-contrast.test.ts` | 175 | `{withFileTypes}` | convert — tolerates but **does not report** (D4) |

      **Exposure, recorded rather than flattened.** All 18 converted readers walk a tree that contains
      `src/features/sharing/`, where the probe lands. `evidence-scripts.test.ts` (`openspec/changes/
      archive/`), `gate-batch-apparatus.test.ts` (a log directory) and `release-gate-install.test.ts:1105`
      (an `mkdtemp` scratch tree) are **lower exposure** — nothing writes there at test time — and are
      named as such rather than dropped, because a guard that exempts a category silently is exactly how
      M25's predecessor happened.

- [x] 1.2 Confirm the writer set is still exactly one.
      **Verify:** re-run the search for `writeFileSync` / `rmSync` / `mkdirSync` / `cpSync` /
      `renameSync` / `unlinkSync` targeting `frontend/src` or `frontend/public` from test code, and
      record the result. If a second writer exists, the design's Context is wrong and this task fails
      rather than being reworded to match.

      **MEASURED — one writer file, two calls. The design's Context holds.**

      Scanned **199 mutating calls** (`writeFileSync`, `appendFileSync`, `rmSync`, `rmdirSync`,
      `unlinkSync`, `renameSync`, `cpSync`, `copyFileSync`, `mkdirSync`) across every `.ts`/`.tsx`/
      `.mts`/`.mjs`/`.js`/`.cjs` in the repository, `node_modules`/`.next`/`.git` excluded. Exactly **two**
      name the application source tree, and both are the same test:

      ```
      frontend/tests/motion-scope.test.ts:105   writeFileSync(probe, ...)   -> src/features/sharing/ProbeM19Motion.tsx
      frontend/tests/motion-scope.test.ts:121   rmSync(probe, ...)         -> in a finally
      ```

      **A third site was flagged and then disproved by reading it, rather than assumed away.**
      `architecture.test.ts:3647` writes a probe file and looks like a second writer from a text search.
      It is not: line 3645 creates it under `mkdtempSync(join(tmpdir(), "spotivibe-race-"))`. Recorded
      because the flag was raised, not because it changed the answer — a measurement pass that quietly
      drops an inconvenient candidate is the pass that cannot be trusted.

- [x] 1.3 Record the fixed-path readers that are **not** in the race class.
      **Verify:** at least one is named — `evidence-scripts.test.ts` is the expected witness — with the
      reason it reads only named paths. This list is what makes the guard's exemption non-vacuous in
      §4, so it must exist before the guard is written.

      **MEASURED — three named witnesses, each with its reason.** These are the files §4's guard
      classifies as *not in the class*, and the guard must be shown to classify them that way rather
      than merely be told to.

      | witness | listing site | reads listed files? | why it is not in the class |
      |---|---|---|---|
      | `evidence-scripts.test.ts` | 46, over `openspec/changes/archive/` | **no** | lists directory **names** to locate the archive, then reads a small set of fixed paths. Its two reads are `:71` and the driver constants, not one-per-entry. |
      | `gate-batch-apparatus.test.ts` | 288, over a log directory | **no** | `expect(existsSync(logDir) ? readdirSync(logDir) : []).toEqual([])` — asserts a directory is **empty**. There is no read at all. |
      | `release-gate-install.test.ts` | 1105, over `tmpRoot` | **no** | `expect(readdirSync(tmpRoot)).toEqual([])` — asserts a scratch directory is empty. No read follows. |

      A fourth apparent witness was **disproved**: `motion-scope.test.ts:107` lists
      `src/features/sharing` and then reads **one named file it wrote itself** (`:114`). Listing a
      directory to assert a specific file is on disk is not listing-then-reading-each-entry, and pass 3
      of §1.1 counted it as a reader until it was read.

## 2. Add the asserting wrapper (D1)

- [x] 2.1 Add `readTreeStrict(directory, options)` to `frontend/tests/helpers/sourceTree.ts`, built on
      the existing `readTree`: it collects raced paths and throws an error naming **every** one.
      **Verify:** it exists and `readTree`'s exported behaviour is unchanged — `source-tree-race.test.ts`
      passes without modification, which is the regression check.
- [x] 2.2 Extend `source-tree-race.test.ts` to cover the new wrapper on all three arms: a vanished file
      is reported and fails the read; several vanished files are **all** named; a non-`ENOENT` read
      failure still propagates and is **not** reported as a race.
      **Verify:** each arm is driven through the injected `read` seam, not through a real filesystem
      race, so all three execute on every run. Prove the third arm can fail by making `read` throw a
      non-`ENOENT` error and observing the suite go red.

      **DONE — 16 tests pass (was 11), and all four arms are proven able to fail.** A fifth case was added
      beyond the three asked for: `readTreeStrict` must **override** a caller-supplied `onRace`, or a caller
      could pass a dead callback while the wrapper's own report went to a channel it controls.

      ```
      CAUGHT  non-ENOENT failure swallowed instead of propagated
      CAUGHT  the wrapper's throw removed, so a vanished file passes silently
      CAUGHT  only the first raced file is named
      CAUGHT  onRace override removed, so a caller's dead callback is honoured
      ```

      Each requires a non-zero exit **and** the expected test named in the output; exit code alone would
      not prove the right assertion fired. Baseline green first — a probe whose baseline fails proves
      nothing.

      **The probe itself failed twice before it worked, and both failures looked like verdicts.**
      (a) Sandboxed in the system temp directory: every run died at startup with `ERR_MODULE_NOT_FOUND`
      for `vitest/config`, and all four mutations reported `MISSED` — four lines that read as evidence
      when the suite had never started. (b) Sandboxed under `frontend/`, the filter was built by slicing an
      absolute path, producing `tests/C:/Users/...`; vitest matched nothing and exited 1 with
      "No test files found", which is indistinguishable from a caught mutation. Both are now impossible
      by construction: the sandbox sits under `tests/` where the real `include` glob finds it, and a
      baseline run is required to pass before any verdict is reported.
- [x] 2.3 Confirm `architecture.test.ts` is unaffected and still proves its own tolerance.
      **Verify:** it passes unmodified, and its `no file vanished between being listed and being read`
      assertion is still present. D1 explicitly declines to migrate it; record that it was left alone
      rather than merely noting that no diff appeared.

      **DONE — untouched, and recorded as deliberately left alone.** `git diff --name-only HEAD --
      frontend/tests/architecture.test.ts` is **empty**. Its own tolerance wiring is still present and
      intact: `racedFiles` at `:95`, `onRace: (file) => racedFiles.add(file)` at `:104`, and the
      forced-miss case at `:3649-3660`. `architecture.test.ts` + `source-tree-race.test.ts` together:
      **152 passed**.

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
