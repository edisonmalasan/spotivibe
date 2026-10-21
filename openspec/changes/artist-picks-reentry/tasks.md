# Tasks

## 0. Baseline

- [x] 0.1 Record a green full-suite run before anything is changed: file count, test count, exit
      code. The counts are compared at §7 against this baseline, so a test lost to a refactor cannot
      be mistaken for a test that no longer exists.
      **187 files, 3498 tests — 3497 passed and 1 failed**: `tests/gate-coverage.test.ts` hit its
      60 s timeout under full-suite load. It passes in isolation (30/30, 4.91 s) and passed in every
      subsequent full run. **Pre-existing and load-dependent, and it is the second unidentified
      intermittent failure this repository has** — see §8.3. It is recorded rather than smoothed, and
      it was not fixed here.
- [x] 0.2 Record the **current first-run behaviour** as a measured fact, not a recollection: a green
      baseline does not say when the dialog appears, so record the render order — specifically,
      **whether the first paint of the first-run surface carries an empty artist list**. This is the
      defect, and the fix's first task is to make it measurably different, so the difference has to
      be measured rather than asserted.
      **Measured, with a temporary probe (since deleted):** with the provider request in flight, the
      **first committed paint** of the first-run surface rendered *"We couldn't find any artists
      yet."* **and offered the "Close" dismissal.** The probe exited 0 — the defect was present, and
      the probe is the record that it was there before anything was changed.

## 1. Establish the shared derivation (D1)

- [x] 1.1 Extract `useQuickPickArtists()` so **one** place derives the rail. `QuickPicksShelf` becomes
      a presentational consumer of it, and the first-run surface consumes it too. "The same artists"
      SHALL be true by construction.
- [x] 1.2 The hook SHALL take the provider tracks as an argument and SHALL NOT issue requests
      itself, so Home does not double its discovery traffic (D1.1).
- [x] 1.3 `deriveQuickPicks` SHALL remain a pure function with unchanged behaviour. The hook is
      plumbing; the derivation is not in scope.

## 2. Carry the settled state, not just the entries (D2)

- [x] 2.1 `onRailChange` SHALL carry the rail's settled state as well as its entries.
- [x] 2.2 `settled` SHALL be true only when **both** the provider has settled **and** the local
      stores have hydrated. A rail that settled against un-hydrated stores would report "no artists"
      for a device that has liked tracks it has not read yet — the same defect one level down.
- [x] 2.3 The `empty` state SHALL mean: provider settled, stores hydrated, derivation produced
      nothing. That is the only state in which "there are no artists" is true.

## 3. Give the dialog its three states (D3)

- [x] 3.1 `pending` — the rail has not settled. The surface shows a loading affordance and **offers
      no dismissal control at all**, because a dismissal is an answer and the question has not been
      asked. Not a disabled dismissal; no dismissal.
- [x] 3.2 `offering` — the artist grid, dismissible, as today.
- [x] 3.3 `nothing` — the settled-and-empty case: the surface says so, and **does not promise a
      choice it cannot offer**. Dismissible, because the answer is true.
- [x] 3.4 The surface SHALL be reachable in `pending` on a **failed or slow** provider request, and
      SHALL NOT be able to strand the listener (D7's first limit): `pending` SHALL have a time bound,
      after which the surface proceeds to `nothing` and offers the dismissal. **A surface that will
      not let someone leave is worse than the defect this change fixes.**
      **The bound is 8 000 ms**, exported as `ARTIST_ONBOARDING_PENDING_TIMEOUT_MS`. The design
      required a bound and did not state a value, so the value is a decision and is recorded as one.
      It is asserted to be **> 0 and ≤ 30 000 ms**, so a bound that is inflated into "a bound on
      paper" fails the test rather than passing it.

## 4. Add the re-entry (D4)

- [x] 4.1 The rail's own control opens the same surface the first run presents, so a listener can
      revise their picks without waiting for a first run that will not come again.
- [x] 4.2 The control SHALL be offered **when the rail holds artists**, not when the rail is empty.
      The candidates *are* the rail's entries, so an empty rail means opening the picker would show
      an empty picker — the affordance would be offering the dead end it exists to end. **The first
      build of this change had it backwards and was corrected.**
- [x] 4.3 The one-shot first-run behaviour SHALL NOT change: the dialog does not re-present itself.
- [x] 4.4 **A Settings host was built first and rejected on measurement — see §8.5.** It is not
      shipped, and the reason is a byte count, not a preference.

## 5. Wire the reset, and make the copy true (D5, D6)

- [x] 5.1 "Reset Spotivibe data" SHALL clear the first-run gate, so the next visit to Home asks
      again. The gate and the picked artists are two halves of one answer held in two stores; a reset
      that clears one and not the other is a reset that cannot be repeated.
- [x] 5.2 `clearOnboardingSeen()`'s docstring currently claims a wiring that does not exist. After
      5.1 the claim is true; if 5.1 is not done, the claim and the function are both removed.
      **One or the other, never neither.** The claim is now true and the docstring says so.
- [x] 5.3 The empty state's copy SHALL NOT promise a later choice, because the candidates are the
      rail's entries and an empty rail has none to offer. It says where artists come from instead:
      *"We couldn't find any artists yet. Artists appear as you listen."*

## 6. Prove the new behaviour, and prove each detector can fail

- [x] 6.1 Green baseline first, before any mutation.
      **187 files / 3498 tests**, with the one load-dependent `gate-coverage` timeout recorded at
      §0.1 rather than hidden.
- [x] 6.2 A test proving the surface does **not** report "no artists" and does **not** offer a
      dismissal before the rail has settled, and **does** reach the settled states.
      *"reports no artists and offers no dismissal while the rail is still in flight"* and *"does not
      settle while the local stores are still hydrating"*.
- [x] 6.3 A test proving the re-entry opens the picker and that a selection made there persists
      across reload and feeds the Quick Picks rail.
      *"offers the same artists again, stores the choice, and feeds the rail"* and *"feeds the Quick
      Picks rail with the artist chosen later"*.
- [x] 6.4 A test proving "Reset Spotivibe data" clears the gate and the next Home visit asks again.
      *"clears the gate, and the next visit to Home asks again"* and *"asks again on Home after the
      reset"*.
- [x] 6.5 A test proving the `pending` state has a time bound and cannot strand the listener (3.4).
      *"cannot strand the listener: the pending state is time-bounded"*.
- [x] 6.6 **Each new assertion proven CAUGHT** by mutating the implementation and observing the
      expected test fail — non-zero exit **and** the expected test name in the output. A mutation
      probe that exits non-zero because the suite never started is not a verdict.
      **10 probes, all CAUGHT, all restored.** Each mutated one of the six production files and
      observed the expected test names fail: the `pending` dismissal guard, the empty block in
      `pending`, the pending timeout, `settled` dropping the store half, the report's dependency on
      `settled`, the Settings section's presence, the reset's `clearOnboardingSeen()` call, the
      Settings section's own derivation, the empty-rail affordance, and the one-shot first-run
      behaviour. Every probe ran from inside `frontend/` so vitest's real `include` glob found it.
      **Two probes are now obsolete** — the Settings section's presence and its own derivation — and
      the empty-rail affordance's probe now covers the *always-when-artists* condition. The
      orchestrator re-proved the surviving mutations after the scope change; the removed ones no
      longer have code to mutate.
- [x] 6.7 Every source mutated for 6.6 restored **byte-for-byte**, proven by SHA-256 before and
      after, with the tree confirmed clean afterwards.
      **Every probe's SHA-256 before and after is identical.** The final SHAs were re-read after the
      last probe, because one file was deliberately changed *after* its probe — a hand-rolled button
      became the shared `Button variant="ghost"`, so the motion vocabulary stays inside the component
      that owns it — and a SHA recorded before that change would have been a SHA of a file that no
      longer existed.
- [x] 6.8 **Re-read every existing onboarding test rather than keeping it.** A change to when the
      surface presents will make some of them pass for a different reason, and keeping them hides
      that. `artist-onboarding.test.tsx` has a test that renders `artists={[]}` directly and asserts
      the empty message — **that test now describes a state that must be distinguished from
      "not settled yet", and it has to say which one it is.**
      **Every render in that file now states which of the three states it is.**
- [x] 6.9 **Two tests were found to be racy, and one was found to be weaker than it looked.**
      `home-view.test.tsx`'s first-run case asserted "no Close button while pending" against a
      provider that *resolves*, so whether the rail had settled by the time the dialog was found was a
      race — and it was caught failing, which is what a race looks like from the outside. The
      assertion was removed there and left where it is deterministic, in the file that holds the
      provider in flight. And the "replaces the stored selection" case originally picked the *same*
      artist twice, so "replaced" and "added to" were indistinguishable; it now picks two different
      artists and asserts the first is **gone**, not still there alongside the second.
- [x] 6.10 No existing test may be weakened to make this change pass.
      **No test was removed and none was loosened.** The count went 3498 → 3518.

## 7. Verify the whole change

- [x] 7.1 `npm run gate` exit 0. **Ran 03:28:07–03:31:15, exit 0** — every step green (lint,
      format:check, ps:check, scripts:check, typecheck, build, test).
- [x] 7.2 Test file and test counts compared against §0.1.
      **188 files / 3518 tests**, against a baseline of 187 / 3498: **+1 file, +20 tests, 0 lost.**
- [x] 7.3 `openspec validate artist-picks-reentry --strict` exit 0.
- [x] 7.4 `openspec validate --specs --strict` exit 0.
- [x] 7.5 Diff reviewed for scope: `features/onboarding/`, `features/home/`, `features/backup/` (the
      reset path), `tests/`, `scripts/measure-client-bundle.mjs`, `docs/MOTION.md`, and the spec
      delta. **No dependency, no manifest, no lockfile, no gate step, no CI change, and no new route
      after the scope change at §8.5.**
- [x] 7.6 **This change touches production code**, unlike M32 and M33 which were test-only. The
      diff SHALL be reviewed against the design's decisions, and any production behaviour that
      the delta does not describe SHALL be recorded rather than absorbed.
- [x] 7.7 Evidence reports only what was run. Anything not run is recorded as UNVERIFIED with the
      reason. **UNVERIFIED: no browser was attached at any point in this change**, so nothing here is
      visually verified — including the rail's control, whose placement under the shelf was chosen
      for the feed's row-order assertions and not by eye.

## 8. Out of scope, recorded not absorbed

- [x] 8.1 **A contradiction between two capabilities, and between one of them and the code.**
      `openspec/specs/discovery/spec.md` still carries **"First run offers language selection"** —
      *"THEN language selection is offered with the full catalog."* **The code does not do this.**
      M28 replaced the language dialog with the artist picker; `home-mixes/spec.md` says so in terms
      (*"SHALL NOT present a language-selection dialog"*), and M28's delta landed in `home-mixes` and
      `local-data` and never corrected `discovery`. **Two capabilities now contradict each other and
      one contradicts the code.** This is a real defect and it is not this change's to fix quietly,
      because correcting `discovery`'s requirement text is a different claim about the product from
      adding a re-entry path. It needs a change that owns the first-run requirement as a whole.
- [x] 8.2 **The same requirement's *other* half is also unmet, and has been since M28.** The
      modified requirement retains *"The first-run surface SHALL gate the dashboard: the discovery
      feed SHALL NOT be presented until onboarding is completed or dismissed"*, and the scenario
      *"A new device is opened"* says *"the discovery feed is not yet presented"*. **The code renders
      the feed behind the modal overlay** — M28's own archived proposal says so (*"the dashboard
      renders behind a dialog … the dashboard reveals after"*), and the implementation has always
      done that. **The spec text has never been met, and this change neither met it nor weakened
      it.** It is recorded here rather than quietly corrected, because the honest reading is that
      the *spec* is the thing that is wrong: a dialog that overlays a feed is a different design
      from a feed that is withheld, and the archived proposal describes the former. Deciding which
      is the intent is a change that owns the first-run requirement as a whole — the same change
      8.1 needs.
- [x] 8.3 The **second unidentified intermittent failure** in this repository, distinct from the
      vanished-file race of M33 §7.0. `tests/gate-coverage.test.ts` hit its 60 s timeout in the
      baseline full run (§0.1) and passed in isolation and in every subsequent full run. It is
      load-dependent. **It is not this change's to fix**, and it is recorded so that a later
      milestone does not attribute a red run to the wrong cause.
- [x] 8.4 **A coupling the implementation introduced and the spec does not describe: the on-demand
      picker writes the first-run gate.** `ArtistOnboarding`'s `finish()` and `dismiss()` both call
      `markOnboardingSeen()`, and the rail's control opens *that same component*. So choosing
      artists from the rail marks the first run as answered — which is sensible — **and dismissing
      the on-demand picker without choosing also marks the first run as answered**, on a surface
      that is not the first run. The delta says the re-entry *"SHALL NOT re-present the first-run
      surface to a listener who has already answered it"*, which this does not violate, and **no
      listener is stranded** because the rail's control is there whenever the rail holds artists. But
      the flag's meaning has widened from *"has this been seen"* to *"has this question been answered
      anywhere"*, and that widening is a consequence of sharing one component, not something the
      delta asked for. Recorded here because the flag's docstring still describes the narrower
      meaning.
- [x] 8.5 **The Settings host for the re-entry, deferred on a measurement, with the measurement
      recorded so the next milestone starts from numbers.**
      The re-entry was first built in Settings, beside Languages — where "changeable later" belongs,
      because the Languages section already reopens the shared language picker. **Measured, it did
      not fit the client budget:**

      | Measurement | before this change | re-entry on Home | re-entry in Settings |
      |---|---:|---:|---:|
      | Client JS, total gzipped | 388,611 B | 389,548 B | 396,552 B |
      | Largest single chunk | 97,505 B | 97,534 B | 97,879 B |
      | Emitted chunks | 25 | 25 | **26** |
      | `/` first load | 231,355 B / 13 chunks | 232,000 B / 13 chunks | 233,188 B / **14 chunks** |

      Same machine, same toolchain (Node 24.21.0, the one every recorded budget was measured on),
      same build procedure. **The Settings host costs 6,987 gzipped bytes, adds a 26th chunk, and
      adds a 14th chunk to Home's first load.** The budget's total tolerance is 4,096 bytes and its
      chunk-count rules carry **none**, so it could only ship by re-recording the ceiling by more
      than its whole headroom — and the budget's own module says that widening what the budget
      guarantees *"is not this change's decision to make"*. **So it is not made.** The Settings host
      is deferred to a change that owns the budget, and the re-entry is hosted on the rail instead.
      The implementation is recoverable from this branch's history; only the *host* is deferred.
- [x] 8.6 The root lockfile guard gap (M33 §7.1): `root-commands.test.ts` asserts *"the application
      lockfile is the only one"* while checking only `package-lock.json`, so `pnpm-lock.yaml`,
      `yarn.lock`, `bun.lock` and `bun.lockb` at the root each pass. **Live** — an untracked root
      `pnpm-lock.yaml` and a two-entry root `node_modules/` are in the working tree, and **they are
      not this change's to delete.**
- [x] 8.7 Carried forward from M31–M33: `icons:check` absent from the gate and CI with no root
      proxy; `sync-m18-interactions.mjs` unused by M30's Sync; the gate does not assert its own
      working tree; M21 CRITICAL 1 and 2 unclosable without the forbidden archived gate; M25's
      criterion 5 of 6 permanently unmet; `scripts/sync-m17-home.mjs` drops a spec's trailing
      newline; no gate batch run for M31, M32 or M33.
