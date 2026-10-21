# Tasks

## 0. Baseline

- [x] 0.1 Record a green full-suite run before anything is changed: file count, test count, exit
      code. The counts are compared at §6 against this baseline, so a test lost to a refactor cannot
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
      a presentational consumer of it, and the onboarding dialog and the Settings section consume it
      too. "The same artists" SHALL be true by construction.
- [x] 1.2 The hook SHALL take the provider tracks as an argument and SHALL NOT issue requests
      itself, so Home does not double its discovery traffic (D1.1).
- [x] 1.3 `deriveQuickPicks` SHALL remain a pure function with unchanged behaviour. The hook is
      plumbing; the derivation is not in scope.

## 2. Carry the settled state, not just the entries (D2)

- [x] 2.1 `onRailChange` SHALL carry the rail's settled state as well as its entries.
- [x] 2.2 `settled` SHALL be true only when **both** the provider has settled **and** the local
      stores have hydrated. A rail that settled against un-hydrated stores would report "no artists"
      for a device that has liked tracks it has not read yet — the same defect, one level down.
- [x] 2.3 The `empty` state SHALL mean: provider settled, stores hydrated, derivation produced
      nothing. That is the only state in which "there are no artists" is true.

## 3. Give the dialog its three states (D3)

- [x] 3.1 `pending` — the rail has not settled. The surface shows a loading affordance and **offers
      no dismissal control at all**, because a dismissal is an answer and the question has not been
      asked. Not a disabled dismissal; no dismissal.
- [x] 3.2 `offering` — the artist grid, dismissible, as today.
- [x] 3.3 `nothing` — the settled-and-empty case: the surface says so and names the place where
      artists can be chosen later. Dismissible, because the answer is true.
- [x] 3.4 The surface SHALL be reachable in `pending` on a **failed or slow** provider request, and
      SHALL NOT be able to strand the listener (D7's first limit): `pending` SHALL have a time bound,
      after which the surface proceeds to `nothing` and offers the dismissal. **A surface that will
      not let someone leave is worse than the defect this change fixes.**
      **The bound is 8 000 ms**, exported as `ARTIST_ONBOARDING_PENDING_TIMEOUT_MS`. The design
      required a bound and did not state a value, so the value is a decision and is recorded as one.
      It is asserted to be **> 0 and ≤ 30 000 ms**, so a bound that is inflated into "a bound on
      paper" fails the test rather than passing it.

## 4. Add the re-entry (D4)

- [x] 4.1 A Settings section beside Languages, showing the current selection and a control that
      opens the same dialog — the direct analogue of `LanguagesSettingsSection` reopening the shared
      `LanguagePicker`.
- [x] 4.2 The empty rail SHALL offer the same affordance, so the settled-and-empty case leads
      somewhere instead of being a dead end.
- [x] 4.3 The Settings section SHALL have its own provider feed (D1.1, D4), and that cost SHALL be
      recorded in the change rather than discovered later.
      **The cost was narrowed below what D4 requires.** The feed is **enabled only while the picker
      is open** (`useDiscoveryShelf`'s own `enabled` gate), so a visit to Settings costs nothing and
      opening the picker costs the two feeds the rail reads. The design accepted the cost of every
      Settings visit; the implementation does not pay it, and this records the difference rather than
      letting the design overstate what was built.
- [x] 4.4 The one-shot first-run behaviour SHALL NOT change: the dialog does not re-present itself.

## 5. Wire the reset, and make the copy true (D5, D6)

- [x] 5.1 "Reset Spotivibe data" SHALL clear the first-run gate, so the next visit to Home asks
      again. The gate and the picked artists are two halves of one answer held in two stores; a reset
      that clears one and not the other is a reset that cannot be repeated.
- [x] 5.2 `clearOnboardingSeen()`'s docstring currently claims a wiring that does not exist. After
      5.1 the claim is true; if 5.1 is not done, the claim and the function are both removed.
      **One or the other, never neither.**
- [x] 5.3 The empty state's copy SHALL name the place where artists can be chosen, so "You can pick
      them later" is true rather than a promise the application does not keep.

## 6. Prove the new behaviour, and prove each detector can fail

- [x] 6.1 Green baseline first, before any mutation.
      **187 files / 3498 tests**, with the one load-dependent `gate-coverage` timeout recorded at
      §0.1 rather than hidden.
- [x] 6.2 A test proving the surface does **not** report "no artists" and does **not** offer a
      dismissal before the rail has settled, and **does** reach the settled states.
      *"reports no artists and offers no dismissal while the rail is still in flight"* and *"does not
      settle while the local stores are still hydrating"*.
- [x] 6.3 A test proving the Settings entry opens the picker and that a selection made there
      persists across reload and feeds the Quick Picks rail — the *"Languages are changeable later"*
      scenario, for artists.
      *"offers the same artists in Settings, stores the choice, and feeds the rail"*, *"feeds the
      Quick Picks rail with the artist chosen in Settings"*, and *"replaces the stored selection, and
      the new one is the one that survives"*.
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
      **Every render in that file now states which of the three states it is.** The `artists={[]}` case
      was reframed as the *settled* case and strengthened rather than merely kept: it now also asserts
      the Settings link and the dismissal. `home-view.test.tsx`'s first-run case now waits for the
      rail to settle before dismissing, because dismissing a `pending` surface is no longer possible
      and the old test was relying on it.
- [x] 6.9 No existing test may be weakened to make this change pass.
      **No test was removed and none was loosened.** The count went 3498 → 3516, and the arithmetic
      accounts for it exactly: **+11** (the new file) **+7** (`artist-onboarding.test.tsx`, 12 → 19).

## 7. Verify the whole change

- [x] 7.1 `npm run gate` exit 0.
- [x] 7.2 Test file and test counts compared against §0.1.
- [x] 7.3 `openspec validate artist-picks-reentry --strict` exit 0.
- [x] 7.4 `openspec validate --specs --strict` exit 0.
- [x] 7.5 Diff reviewed for scope: `features/onboarding/`, `features/home/`, `app/settings/`,
      `features/backup/` (the reset path), `features/preferences/` (the Settings section pattern),
      and the spec delta. **No dependency, no manifest, no gate step, no CI change.**
- [x] 7.6 **This change touches production code**, unlike M32 and M33 which were test-only. The
      diff SHALL be reviewed against the design's four decisions, and any production behaviour that
      the delta does not describe SHALL be recorded rather than absorbed.
- [x] 7.7 Evidence reports only what was run. Anything not run is recorded as UNVERIFIED with the
      reason. **UNVERIFIED unless a browser is attached:** anything visual.

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
      done that. **The spec text has never been met, and this change neither meets it nor weakens
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
- [x] 8.4 **A coupling the implementation introduced and the spec does not describe: the Settings
      picker writes the first-run gate.** `ArtistOnboarding`'s `finish()` and `dismiss()` both call
      `markOnboardingSeen()`, and the Settings section opens *that same component*. So choosing
      artists in Settings marks the first run as answered — which is sensible — **and dismissing the
      Settings picker without choosing also marks the first run as answered**, on a surface that is
      not the first run. The delta says the re-entry *"SHALL NOT re-present the first-run surface to a
      listener who has already answered it"*, which this does not violate, and **no listener is
      stranded** because the empty rail offers the same affordance. But the flag's meaning has
      widened from *"has this been seen"* to *"has this question been answered anywhere"*, and that
      widening is a consequence of sharing one component, not something the delta asked for. Recorded
      here because the flag's docstring still describes the narrower meaning.
- [x] 8.5 The root lockfile guard gap (M33 §7.1): `root-commands.test.ts` asserts *"the application
      lockfile is the only one"* while checking only `package-lock.json`, so `pnpm-lock.yaml`,
      `yarn.lock`, `bun.lock` and `bun.lockb` at the root each pass. **Live** — an untracked root
      `pnpm-lock.yaml` and a two-entry root `node_modules/` are in the working tree, and **they are
      not this change's to delete.**
- [x] 8.6 Carried forward from M31–M33: `icons:check` absent from the gate and CI with no root
      proxy; `sync-m18-interactions.mjs` unused by M30's Sync; the gate does not assert its own
      working tree; M21 CRITICAL 1 and 2 unclosable without the forbidden archived gate; M25's
      criterion 5 of 6 permanently unmet; `scripts/sync-m17-home.mjs` drops a spec's trailing
      newline; no gate batch run for M31, M32 or M33.
