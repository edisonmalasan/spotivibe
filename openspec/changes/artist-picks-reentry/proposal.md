# Proposal — M34: make the artist picker re-enterable, and stop it asking with an empty list

## Why

**The artist Quick Picks picker is implemented and it works. It asked once, and it will never ask
again — and there is no way in the entire application to pick artists by hand.**

The gate is one `localStorage` key, `spotivibe:quick-picks-onboarding-seen`, written by
`markOnboardingSeen()` at exactly two call sites in `ArtistOnboarding.tsx`: line 59, on **dismissal**,
and line 105, on **confirmation**. A dismissal therefore counts as an answer, deliberately — the
comment says *"Re-asking someone who has already answered — or who chose to skip — is nagging, not
onboarding."*

That reasoning is sound for a surface that offers a **choice the listener can also make later**. The
artist picker offers no such alternative, and the difference is the whole of this change.

### The asymmetry, stated precisely

`LanguagePicker` is rendered in exactly one place: `LanguagesSettingsSection.tsx`, inside Settings.
`ArtistOnboarding` is rendered in exactly one place: `HomeView.tsx`, on Home, behind a one-shot flag.

The `discovery` spec carries the scenario **"Languages are changeable later"** — *"WHEN the user
changes the selected languages from Settings THEN the new selection persists across reload and feeds
follow it."* The `home-mixes` spec carries **"First run asks for artists, not languages"**, and
preserves the language half of that promise in the same breath: *"The language preference SHALL remain
available and editable in Settings."*

**There is no equivalent scenario for the artist picks.** Not in `discovery`, not in `home-mixes`, not
in `local-data`. The one first-run choice in this application that cannot be changed afterwards is
also the one the spec never protected.

### The likely way this was hit

The dialog renders on the **first paint** of Home — `showOnboarding = !onboardingSeen` — but its
artist list is fed from `QuickPicksShelf`, which derives from `feed.trending.tracks` and
`feed.collections.tracks`. Those arrive from `useDiscoveryShelf`, an **asynchronous** effect that
takes a queue slot (`acquireShelfSlot`) and then issues a request.

So the dialog's **first render always has an empty list**, and `ArtistOnboarding.tsx:138` renders
exactly this when `artists.length === 0`:

> *"We couldn't find any artists yet. You can pick them later."*

**"You can pick them later" is a promise the application does not keep.** There is no "later". If the
listener closes the dialog in that window — or the request was slow, failed, or the device was
offline — the flag is set and the picker is gone permanently. The artist list fills in a moment later,
on the rail behind a dialog that has already been dismissed.

## What

Four changes, each small, each closing one of the four gaps:

1. **The dialog must not present its empty state before the rail has resolved.** "We haven't asked yet"
   and "there are no artists" are different states and the current code renders them identically. The
   first must not offer a dismissal, because a dismissal is an answer.

2. **A re-entry path.** A Settings section that opens the same dialog, for the same reason the
   Languages section exists: a first-run choice stays changeable. And the empty rail offers the same
   affordance, so "we couldn't find any artists yet" has somewhere to lead.

3. **"Reset Spotivibe data" clears the gate.** `clearOnboardingSeen()` exists, is exported, and its
   own docstring says *"Exists for 'Reset Spotivibe data' and for tests."* **Nothing in production
   calls it.** `resetStores` clears IndexedDB stores only. The documented escape hatch is not wired, so
   this change wires it — or deletes the claim. Wiring it is the honest option: the function is
   already written, already tested, and already says what it is for.

4. **The copy stops promising what the app cannot deliver**, once (1) and (2) land. "You can pick them
   later" becomes true, or it goes.

## What this does not do

- It does **not** change what the picker *is* — the same artists, the same selection, the same
  IndexedDB dataset, the same backup envelope.
- It does **not** make the picker ask again on its own. The one-shot first-run behaviour is
  deliberate and stays; this adds a **reachable** way to change the answer, not a nag.
- It does **not** touch the discovery derivation, the provider calls, or the rail's contents.
- It does **not** touch accounts, auth, or any cloud surface.

## Evidence this change must produce

- A test proving the dialog **does not present its empty state** before the rail has resolved, and
  that the "nothing found" state is reachable only once it has.
- A test proving the Settings entry opens the picker and that a selection made there **persists and
  feeds the rail** — the "Languages are changeable later" scenario, for artists.
- A test proving "Reset Spotivibe data" clears the gate, so the next visit to Home asks again.
- Each new detector **proven CAUGHT** by mutation, with SHA-256 before/after proving restoration.
- The **existing** onboarding tests re-read rather than kept, because a change to when the dialog
  presents will make some of them pass for a different reason.

## A spec contradiction found while reconciling, and recorded not absorbed

`openspec/specs/discovery/spec.md` still carries **"First run offers language selection"** — *"WHEN a
user opens the app with onboarding not yet completed THEN language selection is offered with the full
catalog."*

**The code does not do this.** M28 replaced the language dialog with the artist picker, and
`home-mixes/spec.md` says so in terms: *"SHALL present a first-run surface offering **artist**
selections … and SHALL NOT present a language-selection dialog."* M28's delta landed in `home-mixes`
and `local-data` and never corrected `discovery`, so **two capabilities now contradict each other and
one of them contradicts the code.**

This is a real defect and it is **not** this change's to quietly fix, because correcting
`discovery`'s requirement text is a different claim about the product from adding a re-entry path. It
is recorded here, and it belongs with a change that owns the first-run requirement as a whole.

## Out of scope, recorded not absorbed

- The `discovery` / `home-mixes` contradiction above.
- The root lockfile guard gap (M33 §7.1): `root-commands.test.ts` asserts *"the application lockfile
  is the only one"* while checking only `package-lock.json`, so `pnpm-lock.yaml`, `yarn.lock`,
  `bun.lock` and `bun.lockb` at the root each pass. **Live** — an untracked root `pnpm-lock.yaml` and a
  two-entry root `node_modules/` are in the working tree, and **they are not this change's to delete**.
- The unidentified intermittent failure (M33 §7.0).
- Everything carried forward from M31–M33: `icons:check` absent from the gate and CI with no root
  proxy; `sync-m18-interactions.mjs` unused; the gate does not assert its own working tree; M21
  CRITICAL 1 & 2 unclosable; M25's criterion 5 of 6 permanently unmet; `sync-m17-home.mjs` drops a
  spec's trailing newline; no gate batch run for M31, M32 or M33.

## Scope

`frontend/src/features/onboarding/`, `frontend/src/features/home/`, `frontend/src/app/settings/`,
`frontend/src/features/backup/` (the reset path), `frontend/src/features/preferences/` (the Settings
section pattern), and the spec delta. **This change touches production code** — unlike M32 and M33,
which were test-only. No dependency, no manifest, no gate step, no CI change.
