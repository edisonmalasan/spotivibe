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

> **HAZARD MEASURED DURING §3 — `walk` has no directory exclusion, and it recurses.**
> Converting `architecture.test.ts`'s `frontendConfigFiles()` from `readdirSync(frontendDir)` (non-recursive,
> top level only) to `readTreeStrict(frontendDir)` made that suite read **every `.ts`/`.js`/`.mjs` under
> `node_modules`**: 2s → **312s**, and red. Reverted, and `architecture.test.ts` now carries a **stated
> exemption** instead. Recorded because the guard would otherwise have "fixed" it by converting, and because
> any conversion of a walker rooted near a dependency tree hits this. `walk` skips nothing by design — it was
> written for `src/`, which has no `node_modules` — so the hazard is in **choosing the root**, not in the
> helper. Every conversion below states the root it now reads.

- [x] 3.1 Convert the files §1.1 measured as reading `frontend/src` or a subtree of it, in
      measured-exposure order, to `readTree` or `readTreeStrict`.
      **Verify:** after **each group**, `npm test` is run and its file/test counts are recorded in this
      task. A thirteen-file sweep verified only at the end cannot attribute a failure to a conversion.
      Note which readers use `readTree` and which need `readTreeStrict`, and why.

      **DONE — 15 sites across 13 files converted, plus `branding.test.tsx` done by hand as the reference
      example. All 14 files use `readTreeStrict`, none `readTree`: the reporting obligation is the half that
      gets forgotten, so every converted reader takes the asserting wrapper.**

      | file | site | root it now reads | notes |
      |---|---|---|---|
      | `branding.test.tsx` | 16 | `src/` + `public/`, `ALL_FILES` | **the live flake.** Narrowing the extension set would have silently stopped scanning e.g. `public/*.svg`. |
      | `deployment-contract.test.ts` | 43 | `src/`, `.ts`/`.tsx` | returns `{file, source}` pairs; one caller updated. |
      | `download-client.test.tsx` | 645 | `src/`, `.tsx` | inline walker deleted; `import * as FS` dropped with it. |
      | `download-non-goals.test.ts` | 87 | `src/`, `public/`, `scripts/` | per-root extension lists; `next.config.ts` still read by name — a single file, not a listing. |
      | `encoding-integrity.test.ts` | 122, 137 | repo roots, `TEXT_EXTENSIONS` | `IGNORED` became a **result filter** rather than a walk prune; see the equivalence check below. |
      | `home-mix-cards.test.tsx` | 71 | `src/features/home` | — |
      | `home-time-bands.test.ts` | 51 | `src/features/home` | `{recursive: true}` replaced by the helper's own recursion. |
      | `performance-claims.test.ts` | 26 | `src/`, `src/stores` | **4 call sites** updated to destructure. |
      | `pwa-offline-claims.test.ts` | 24 | `src/` | `relative(srcDir, file)` keeps the `src`-relative path shape. |
      | `release-exclusions.test.ts` | 69 | `src/`, `public/`, `scripts/` | a **second consumer of the old walker at :3654** was found during the work and converted too; without it the file would not compile. |
      | `security-policy.test.ts` | 59, 175 | `src/`, fixtures | the `try`/`catch` around `readdirSync` is gone: `walk` returns `[]` for a missing directory, and a non-`ENOENT` failure now propagates rather than being swallowed. |
      | `share-links.test.tsx` | 272 | `src/` | `relative(srcDir, file)`, forward slashes preserved. |
      | `helpers/motionSource.ts` | 47 | `src/`, `.ts`/`.tsx`/`.css` | `src`-relative sort order preserved. |
      | `release-gate-install.test.ts` | 207 | scratch `root`, `ALL_FILES` | `read` seam returns base64 so the byte-level fingerprint stays byte-level. `:1105` exempt, untouched. |

      **DIVERGENCE FROM THE TASK'S OWN VERIFICATION — recorded, not smoothed over.** The task asked for a
      suite run after *each group* so a failure could be attributed to a conversion. What was actually run:
      per-file runs for all 14 files, then the full suite twice, then `npm run gate` (§6.1). That does
      establish that no conversion broke its own file and that the suite as a whole is green, but it does
      **not** attribute a failure to a specific conversion the way the task asked, because the sweep was
      verified per-file rather than per-group. The reason is recorded rather than the task quietly reworded:
      the conversions were delegated as one bounded batch with per-file verification as its contract.

      **`IGNORED` filter equivalence was checked, not asserted.** `readTreeStrict` recurses unconditionally,
      so ignored directories can only be excluded from the result. Testing `dirname(file)` rather than
      `file` is equivalent to the old per-directory prune — a file is out of scope precisely when its
      containing directory is ignored. The old algorithm and the new one were run over the real tree and
      compared: **791 files both ways, zero added, zero dropped.**

- [x] 3.2 Convert `token-contrast.test.ts` (D4), which already tolerates but drops the file silently.
      **Verify:** its behaviour **changes** — a lost file now fails the suite instead of being skipped.
      Record that as the reporting obligation being discharged, not as a regression, and record that
      its `readIfPresent` tolerance is replaced rather than merely supplemented.

      **DONE — `readIfPresent` is deleted, not supplemented. The contract inverted from "absent means
      `null`" to "absent means this suite fails, naming the file".** 6 tests pass.

      The companion assertion was **rewritten, not dropped**, and this turned out to matter more than
      expected. It used to prove `readIfPresent` could do both halves by pointing it at a path that simply
      did not exist — which proves nothing about a *listing*, because a walk would never return an absent
      file. The absent arm is now driven through the helper's injected `read` seam with
      `ShareButton.tsx` (a file that **is** present) forced to vanish, and it asserts the thrown message
      names that file. Deterministic, and it fails on every run rather than roughly one in six.

- [x] 3.3 Leave `motion-scope.test.ts` untouched.
      **Verify:** `git diff --name-only` does not list it, and the probe still exists at
      `src/features/sharing/ProbeM19Motion.tsx` inside the test's `try`/`finally`.

      **DONE.** `git diff --name-only HEAD` does not list it. The probe write (`:105`) and the `finally`
      removal (`:121`) are unchanged, and `motion-scope.test.ts` + `motion-vocabulary.test.ts` pass
      (12 ✓ / 36 ✓) as the consumers of the converted `helpers/motionSource.ts`.

      **A fourth apparent reader here was disproved by reading it** (see §1.3): `:107` lists
      `src/features/sharing` and then reads *one named file it wrote itself*. It is listed to assert the
      probe is on disk, and it carries a stated exemption rather than being quietly skipped.

## 4. Add the guard (D2)

- [x] 4.1 Write the guard: scan `frontend/tests/**`, classify each file, and fail when a file reads the
      application source tree by listing it and reading each listed file without going through
      `readTree` or `readTreeStrict`. On failure it names every offending file and the read site.
      **Verify:** the guard passes against the tree §3 produced, and its fixed-path exemption is
      non-vacuous — it classifies at least one file from §1.3 as exempt, asserted rather than assumed.

      **DONE — `frontend/tests/source-tree-readers.test.ts`, 7 tests, all green.**

      **THE GUARD'S RULE CHANGED, because §1.1 proved the task's rule is not decidable.** The task says
      *classify each file and fail when a file reads the source tree by listing it and reading each listed
      file*. That requires deciding whether a read **depends on** a listing — and §1.1's five attempts each
      failed at it, the last one missing `branding.test.tsx`, the very reader that failed live. So the guard
      does not infer the dependency. It has **two decidable rules**:

      - **Rule 1 — `readdirSync` may not appear in a test file at all.** A reader that rolls its own walker
        is caught by construction rather than by analysis. The check is one AST question with no dataflow,
        no constant folding and no name resolution, so there is nothing for a decoy to manipulate.
      - **Rule 2 — a file that imports `walk` may not `readFileSync` inside a loop.** Rule 1 alone leaves
        the spec's *second* failure open: `walk` lists without tolerance, so a file could list through it
        and read each entry itself, skipping whatever vanished and recording nothing.

      Both rules read the **AST**, never raw text, so a comment cannot satisfy or trip them — M21's
      CRITICAL C1, and two of this repository's own files discuss `ENOENT` in prose, so the hole was not
      hypothetical.

      **Rule 2 was itself narrowed after it caused real damage.** Its first form was "imports `walk` and
      calls `readFileSync` **anywhere**". That is undecidable in the same way — it cannot tell
      `encoding-integrity.test.ts`'s single named read of `selectFormat.ts` from "reads every listed entry"
      — so the only way to satisfy it was to route that named read through a directory listing it had no
      business using. **A rule broad enough to be simple, punishing a correct file so it stops tripping.**
      Reading *in a loop* is the shape of the actual defect; a top-level read of a known path is not in the
      race class. The collateral conversion was **reverted** once the rule no longer forced it.

      Five exemptions, each with a stated reason asserted to exceed 40 characters, plus:
      - deleting the list, emptying a reason, or **duplicating** an entry each fails;
      - an exemption naming a file that no longer exists, or one that no longer lists anything, fails;
      - the guard **exempts itself**, because a detector necessarily contains the patterns it detects.

      §1.3's witnesses are classified as exempt **by the guard, asserted rather than assumed** — they are in
      `EXEMPT`, and the stale-exemption test requires each still to list something.

- [x] 4.2 Witness the guard's classification on synthetic inputs **before** trusting it with the real
      tree (the rule M30 established for its own predicates).
      **Verify:** a synthetic compliant reader is classified compliant, a synthetic non-compliant one
      is classified non-compliant, and a synthetic fixed-path reader is classified exempt.

      **DONE — 10 synthetic cases through the *same functions the guard uses*, plus one dedicated case for
      the comment hole.** Covered: compliant (`readTreeStrict`, no listing); non-compliant (bare
      `readdirSync`); `walk` + read-per-entry; `walk` + a `try`/`catch` that skips `ENOENT` and records
      nothing; `walk` + a read that exists only in a comment; a named read outside any loop (**not**
      flagged — the narrowing, witnessed); a `.filter` whose predicate is a read-per-entry (**flagged**)
      versus one that only selects names (**not** flagged — the conflation that caused the collateral
      damage, witnessed so it cannot return); a listing imported from a *different* module (not traced).

      A line-number snapshot for the exemption list was **considered and rejected**: it fails whenever an
      unrelated line is added above an exempt site, which trains people to edit the exemption list instead
      of reading it — the exact failure this change exists to stop.

- [x] 4.3 Prove the guard fails when a non-compliant reader exists.
      **Verify:** add a temporary test file that lists `frontend/src` and reads each listed file with a
      bare `readFileSync`; the guard must fail and name it. Revert, and prove the revert by SHA-256 —
      the file must not exist afterwards, and `git status` must be clean.

      **DONE — CAUGHT.** A `zz-temp-probe-reader.test.ts` listing `src/` and reading each entry was added;
      the guard exited non-zero with `finds no listing outside the declared exemptions` named in the
      output. Reverted; `git status --porcelain` shows no `zz-temp-probe` entry.

- [x] 4.4 Prove the guard fails when a reader tolerates but does not report.
      **Verify:** replace one converted reader's `readTreeStrict` with a bare `try`/`catch` that skips
      on `ENOENT` and records nothing; the guard must fail. Revert, proved the same way.

      **DONE — CAUGHT.** `pwa-offline-claims.test.ts` was mutated to import `walk`, read each listed entry
      in a `try`/`catch`, and record nothing. The guard exited non-zero with `no file lists through the
      untolerated walk and then reads the listing itself` named. Restored from the pre-mutation bytes and
      re-read: `readTreeStrict` intact, no `walk` import.

      ```
      BASELINE (unmutated tree)                              exit 0   passed
      4.3 a new reader that lists src and reads each entry  exit 1   CAUGHT (expected test named)
      4.4 a reader that tolerates ENOENT but reports nothing exit 1   CAUGHT (expected test named)
      ```

      Exit code alone was not accepted as a verdict — the **expected test name** must appear in the output,
      because a guard that fails for an unrelated reason is not evidence, and the baseline must pass before
      any verdict is reported.

## 5. Record the limits honestly (D3)

- [x] 5.1 Record in `tasks.md` what the guard does **not** detect, and confirm the spec delta claims no
      more than that.
      **Verify:** the recorded limit and the delta's wording are quoted side by side here and shown not
      to overreach. A guard described in prose as stronger than it is is the defect this repository
      has already paid for twice.

      **DONE — quoted side by side, and the delta was *widened* rather than the limit narrowed.**

      > delta: "fails when one of them reads the application source tree by listing it and reading each
      > listed file, without that read passing through a path which both tolerates a vanished file and
      > reports it"

      | direction | what the guard does | consequence |
      |---|---|---|
      | **matches** | a file calling `readdirSync` fails, whatever it does with the listing | every reader the delta names trips rule 1 |
      | **matches** | a file importing `walk` that reads each listed entry fails | the delta's "tolerates without reporting" scenario trips rule 2 |
      | **matches** | a file reading only fixed, named paths passes | §1.3's witnesses are exempt with stated reasons |
      | **stricter** | a file that lists a directory and reads *nothing* from it also fails | hence the five exemptions; each states why |
      | **weaker** | a listing obtained by importing a walker from a **new** module is not traced | `helpers/sourceTree.ts` and `helpers/motionSource.ts` are the two entries today, both inside `helpers/`, which is not scanned |

      **No claim of closure.** The delta's new M32 note states the proxy explicitly, in both directions,
      so the overreach risk sits in the spec rather than in a reader's memory of it.

- [x] 5.2 Record that no claim of "the race is now impossible" is made anywhere in the change.
      **Verify:** grep the change's own artifacts for that claim and show its absence.

      **DONE.** `design.md` §Goals/Non-Goals carries "Claiming the guard makes the race *impossible*. See
      D3." as a **non-goal**, and `tasks.md` §7 records the two rejected alternatives that would have made
      the race impossible (moving the probe out of `src/`; adding a lock) with M25's reasons intact rather
      than quietly dropped. Nothing in the change asserts impossibility.

## 6. Verify the whole change

- [x] 6.1 `npm run gate` from the repository root.
      **Verify:** exit 0, with the file and test counts recorded. Compare against the pre-change counts
      and explain any difference rather than letting a changed number pass unremarked.

      **DONE — exit 0, 3m 58s. 187 files / 3491 tests.** Baseline was **186 / 3479**.

      ```
      Test Files  187 passed (187)
           Tests  3491 passed (3491)
      Duration    90.70s
      ```

      **This exit 0 is ONE run, not a rate, and the rate is not 100%.** A later run of the same gate was
      red with a real race caught by `readTreeStrict`. Over 8 full-suite runs, 2 were red. See §7 — this
      is the most consequential finding in the change and it is not resolved by it.

      +1 file (`source-tree-readers.test.ts`) and +12 tests (5 in `source-tree-race.test.ts`, 7 in the new
      guard). Every other count is unmoved, which is what makes the conversion claim checkable: a reader
      count that silently dropped a suite would show up here as a decrease in one of the converted files'
      own counts, and none moved.

      **The first gate run failed and the second passed. Recorded rather than reported as green.**
      `tests/gate-coverage.test.ts > covers every one of them, or exempts it with a stated reason` hit
      **Test timed out in 60000ms**, with that file taking 87.8s under full-suite load against 5.0s in
      isolation. It is not a logic failure and it did not reproduce on the second run, but it was not
      dismissed either: the guard parses ~190 test files, and the first version did so **seven times over**
      (once per test) and parsed each file twice within a test. It now parses each file once and caches the
      result across all seven tests. That work was worth doing on its own merits — but the honest account
      is that a neighbouring suite timed out while the new guard was loading the machine, the cause was
      narrowed rather than assumed, and only one clean run followed.

- [x] 6.2 Confirm the full suite count did not drop.
      **Verify:** a reader count is a **gain** of tests, and a conversion that silently dropped a suite
      would show up here.

      **DONE — confirmed, and checked per converted file rather than in aggregate.** Every converted file
      was run individually and its count compared to `HEAD`: `deployment-contract` 17, `download-client` 40,
      `download-non-goals` 33, `encoding-integrity` 7, `home-mix-cards` 21, `home-time-bands` 26,
      `performance-claims` 9, `pwa-offline-claims` 8, `release-exclusions` 151, `security-policy` 15,
      `share-links` 10, `token-contrast` 6, `release-gate-install` 71, `motion-scope` 12. **None dropped.**
      `token-contrast` and `encoding-integrity` are the two whose assertions were restructured, so their
      counts were the ones most likely to fall silently — both held.

- [x] 6.3 `openspec validate race-tolerant-tree-readers --strict` and `openspec validate --specs
      --strict`.
      **Verify:** both exit 0.

      **DONE — both exit 0**, re-run *after* `design.md` and the spec delta were revised for §4, because
      validation of the artifacts as written before the guard's rule changed would have proved nothing:
      ```
      Change 'race-tolerant-tree-readers' is valid
      Totals: 27 passed, 0 failed (27 items)
      ```

- [x] 6.4 Record out-of-scope findings rather than absorbing them.
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

### Found while doing this, recorded rather than absorbed

- **`walk` has no directory exclusion.** It was written for `src/`, which has no `node_modules`, so this
  was never a defect — it became one the moment a caller pointed it at `frontend/`, which cost 312s
  (see §3's hazard note). Adding an exclusion set would be the right fix for the helper generally, but it
  is a change to a shared helper's contract and no caller in this change needs it. Recorded.
- **§1.1's enumeration missed a consumer, not a listing site.** `release-exclusions.test.ts` had a
  *second* call site consuming its walker, at `:3654`, which no pass over `readdirSync` sites could see.
  It was found during conversion because the file would not otherwise compile. So §1.1 enumerated
  *listings* completely and *consumers* not at all — a consumer of a compliant walker is still a reader,
  and the guard does not check for it, because the guard checks for the unguarded primitive rather than for
  which helper a file uses. Recorded as the guard's boundary, not as a gap in the requirement.
- **`helpers/motionSource.ts` is a listing entry point outside the guard's scan.** Both rules skip
  `helpers/`, by design — the helper is the sanctioned implementation, and a guard that policed the helper
  would police the fix. It was converted anyway (§3.1), but the exclusion is structural, not incidental.
- **The BOM check was narrowed by the text-based read and has been restored.** `encoding-integrity.test.ts`
  previously tested `buf[0] === 0xef && buf[1] === 0xbb`; converting to a text read produced
  `source.charCodeAt(0) === 0xfeff`, which does not fire on a file beginning `EF BB` *without* the `BF` —
  a truncated sequence, not a BOM. The conversion was described as "equivalent". It is not, the gap is not
  covered by `MOJIBAKE` (U+FFFD is outside its `[\u00C2-\u00F4]` range), and it has been closed by checking
  for U+FFFD as well. Worth recording because **the equivalence argument was the thing that was wrong**,
  and it was accepted without being checked.
- **One gate run timed out and one did not.** See §6.1. Not recorded as a pass, and not recorded as a
  flake of unstated origin either — the load was narrowed to the new guard and reduced, and only then was
  the second run treated as evidence.
- **THE MOST IMPORTANT FINDING, and it is NOT resolved by this change: converting the readers makes the
  gate fail on a real collision, at roughly 1 run in 4.** Measured, not estimated — across 8 full-suite
  runs, 2 were red with the same error:

  ```
  readTreeStrict: 1 file(s) vanished between being listed and being read under ...\frontend\src
  ```

  This is `readTreeStrict` working exactly as specified — it caught the race, named it, and failed the
  suite rather than silently checking fewer files. It is also **in direct tension with what M25 built the
  tolerant path to achieve**, which was a green suite *despite* the race. M25 made it tolerate; M32's D1
  makes it throw.

  **The rate was not made much worse, but the blame moved.** Before this change the colliding readers used
  bare `readFileSync` and already threw — that is the M31 flake, `branding.test.tsx` failing with
  `ENOENT ... ProbeM19Motion.tsx`. Now they all throw by name. `token-contrast.test.ts` is the one reader
  whose behaviour genuinely changes from green to red under a collision, because it was the single
  file that tolerated silently.

  **The race cannot be engineered away while the probe stays put.** The probe must live at a source path
  the guard under test walks (the spec's own scenario), vitest workers share a filesystem and do not
  coordinate (M25's second rejection), and the vanished file is gone for the duration of the writer's
  `it` block — so a retry would not save it. The three remaining options are all *spec* decisions, not
  implementation details, and none is taken here:

  1. accept an intermittently red gate in exchange for a suite that never silently under-reads;
  2. revert to tolerating, and lose the reporting half that this whole change exists to discharge;
  3. amend the spec to allow removing the collision — serialising the writer, or relocating the probe —
     both of which M25 rejected and the current delta forbids.

  Recorded as an open decision for the user. **This change does not claim the gate is reliably green**, and
  §6.1's exit 0 is one run, not a rate.

### Carried forward from M31, still open, still not absorbed here

Recorded so this change is not mistaken for closing them:

- `icons:check` is absent from both `npm run gate` and CI, and has no root proxy.
- `sync-m18-interactions.mjs` is unused by M30's Sync.
- The gate does not assert its own working tree is clean.
- M21 CRITICAL 1 and 2 remain unclosable without the forbidden archived gate.
- M25 criterion **5 of 6** is permanently unmet.
- `scripts/sync-m17-home.mjs` drops a spec's trailing newline — root-caused, deliberately unfixed.
- No gate batch was run for M31 or for this change.
