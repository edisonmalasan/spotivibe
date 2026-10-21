# Tasks

## 0. Baseline

- [ ] 0.1 Record a green full-suite run before anything is changed: file count, test count, exit
      code. The counts are compared at §6 against this baseline, so a test lost to a refactor cannot
      be mistaken for a test that no longer exists.
- [ ] 0.2 Record the **current first-run behaviour** as a measured fact, not a recollection: a green
      baseline does not say when the dialog appears, so record the render order — specifically,
      **whether the first paint of the first-run surface carries an empty artist list**. This is the
      defect, and the fix's first task is to make it measurably different, so the difference has to
      be measured rather than asserted.

## 1. Establish the shared derivation (D1)

- [ ] 1.1 Extract `useQuickPickArtists()` so **one** place derives the rail. `QuickPicksShelf` becomes
      a presentational consumer of it, and the onboarding dialog and the Settings section consume it
      too. "The same artists" SHALL be true by construction.
- [ ] 1.2 The hook SHALL take the provider tracks as an argument and SHALL NOT issue requests
      itself, so Home does not double its discovery traffic (D1.1).
- [ ] 1.3 `deriveQuickPicks` SHALL remain a pure function with unchanged behaviour. The hook is
      plumbing; the derivation is not in scope.

## 2. Carry the settled state, not just the entries (D2)

- [ ] 2.1 `onRailChange` SHALL carry the rail's settled state as well as its entries.
- [ ] 2.2 `settled` SHALL be true only when **both** the provider has settled **and** the local
      stores have hydrated. A rail that settled against un-hydrated stores would report "no artists"
      for a device that has liked tracks it has not read yet — the same defect, one level down.
- [ ] 2.3 The `empty` state SHALL mean: provider settled, stores hydrated, derivation produced
      nothing. That is the only state in which "there are no artists" is true.

## 3. Give the dialog its three states (D3)

- [ ] 3.1 `pending` — the rail has not settled. The surface shows a loading affordance and **offers
      no dismissal control at all**, because a dismissal is an answer and the question has not been
      asked. Not a disabled dismissal; no dismissal.
- [ ] 3.2 `offering` — the artist grid, dismissible, as today.
- [ ] 3.3 `nothing` — the settled-and-empty case: the surface says so and names the place where
      artists can be chosen later. Dismissible, because the answer is true.
- [ ] 3.4 The surface SHALL be reachable in `pending` on a **failed or slow** provider request, and
      SHALL NOT be able to strand the listener (D7's first limit): `pending` SHALL have a time bound,
      after which the surface proceeds to `nothing` and offers the dismissal. **A surface that will
      not let someone leave is worse than the defect this change fixes.**

## 4. Add the re-entry (D4)

- [ ] 4.1 A Settings section beside Languages, showing the current selection and a control that
      opens the same dialog — the direct analogue of `LanguagesSettingsSection` reopening the shared
      `LanguagePicker`.
- [ ] 4.2 The empty rail SHALL offer the same affordance, so the settled-and-empty case leads
      somewhere instead of being a dead end.
- [ ] 4.3 The Settings section SHALL have its own provider feed (D1.1, D4), and that cost SHALL be
      recorded in the change rather than discovered later.
- [ ] 4.4 The one-shot first-run behaviour SHALL NOT change: the dialog does not re-present itself.

## 5. Wire the reset, and make the copy true (D5, D6)

- [ ] 5.1 "Reset Spotivibe data" SHALL clear the first-run gate, so the next visit to Home asks
      again. The gate and the picked artists are two halves of one answer held in two stores; a reset
      that clears one and not the other is a reset that cannot be repeated.
- [ ] 5.2 `clearOnboardingSeen()`'s docstring currently claims a wiring that does not exist. After
      5.1 the claim is true; if 5.1 is not done, the claim and the function are both removed.
      **One or the other, never neither.**
- [ ] 5.3 The empty state's copy SHALL name the place where artists can be chosen, so "You can pick
      them later" is true rather than a promise the application does not keep.

## 6. Prove the new behaviour, and prove each detector can fail

- [ ] 6.1 Green baseline first, before any mutation.
- [ ] 6.2 A test proving the surface does **not** report "no artists" and does **not** offer a
      dismissal before the rail has settled, and **does** reach the settled states.
- [ ] 6.3 A test proving the Settings entry opens the picker and that a selection made there
      persists across reload and feeds the Quick Picks rail — the *"Languages are changeable later"*
      scenario, for artists.
- [ ] 6.4 A test proving "Reset Spotivibe data" clears the gate and the next Home visit asks again.
- [ ] 6.5 A test proving the `pending` state has a time bound and cannot strand the listener (3.4).
- [ ] 6.6 **Each new assertion proven CAUGHT** by mutating the implementation and observing the
      expected test fail — non-zero exit **and** the expected test name in the output. A mutation
      probe that exits non-zero because the suite never started is not a verdict.
- [ ] 6.7 Every source mutated for 6.6 restored **byte-for-byte**, proven by SHA-256 before and
      after, with the tree confirmed clean afterwards.
- [ ] 6.8 **Re-read every existing onboarding test rather than keeping it.** A change to when the
      surface presents will make some of them pass for a different reason, and keeping them hides
      that. `artist-onboarding.test.tsx` has a test that renders `artists={[]}` directly and asserts
      the empty message — **that test now describes a state that must be distinguished from
      "not settled yet", and it has to say which one it is.**
- [ ] 6.9 No existing test may be weakened to make this change pass.

## 7. Verify the whole change

- [ ] 7.1 `npm run gate` exit 0.
- [ ] 7.2 Test file and test counts compared against §0.1.
- [ ] 7.3 `openspec validate artist-picks-reentry --strict` exit 0.
- [ ] 7.4 `openspec validate --specs --strict` exit 0.
- [ ] 7.5 Diff reviewed for scope: `features/onboarding/`, `features/home/`, `app/settings/`,
      `features/backup/` (the reset path), `features/preferences/` (the Settings section pattern),
      and the spec delta. **No dependency, no manifest, no gate step, no CI change.**
- [ ] 7.6 **This change touches production code**, unlike M32 and M33 which were test-only. The
      diff SHALL be reviewed against the design's four decisions, and any production behaviour that
      the delta does not describe SHALL be recorded rather than absorbed.
- [ ] 7.7 Evidence reports only what was run. Anything not run is recorded as UNVERIFIED with the
      reason. **UNVERIFIED unless a browser is attached:** anything visual.

## 8. Out of scope, recorded not absorbed

- [ ] 8.1 **A contradiction between two capabilities, and between one of them and the code.**
      `openspec/specs/discovery/spec.md` still carries **"First run offers language selection"** —
      *"THEN language selection is offered with the full catalog."* **The code does not do this.**
      M28 replaced the language dialog with the artist picker; `home-mixes/spec.md` says so in terms
      (*"SHALL NOT present a language-selection dialog"*), and M28's delta landed in `home-mixes` and
      `local-data` and never corrected `discovery`. **Two capabilities now contradict each other and
      one contradicts the code.** This is a real defect and it is not this change's to fix quietly,
      because correcting `discovery`'s requirement text is a different claim about the product from
      adding a re-entry path. It needs a change that owns the first-run requirement as a whole.
- [ ] 8.2 The root lockfile guard gap (M33 §7.1): `root-commands.test.ts` asserts *"the application
      lockfile is the only one"* while checking only `package-lock.json`, so `pnpm-lock.yaml`,
      `yarn.lock`, `bun.lock` and `bun.lockb` at the root each pass. **Live** — an untracked root
      `pnpm-lock.yaml` and a two-entry root `node_modules/` are in the working tree, and **they are
      not this change's to delete.**
- [ ] 8.3 The unidentified intermittent failure (M33 §7.0).
- [ ] 8.4 Carried forward from M31–M33: `icons:check` absent from the gate and CI with no root
      proxy; `sync-m18-interactions.mjs` unused by M30's Sync; the gate does not assert its own
      working tree; M21 CRITICAL 1 and 2 unclosable without the forbidden archived gate; M25's
      criterion 5 of 6 permanently unmet; `scripts/sync-m17-home.mjs` drops a spec's trailing
      newline; no gate batch run for M31, M32 or M33.
