# Tasks

## 0. Baseline

- [ ] 0.1 Record a green full-suite run before anything is changed: file count, test count, exit
      code. The counts are compared at §7 against this baseline.
- [ ] 0.2 Record the **current first-run behaviour** as a measured fact, not a recollection, with a
      temporary probe (since deleted): on a device that has not completed onboarding, **which parts of
      the feed are in the document while the first-run surface is up**. The expected finding is that
      **all of them are**, which is the defect. The "before" has to be a fact and not a recollection,
      because the change makes the feed disappear.

## 1. Gate the feed (D1)

- [ ] 1.1 While the first run is up, **none** of the feed is rendered: the filter bar, the artist
      rail, the mix cards, the time shelf, and the section list. Not hidden — **not in the document**.
- [ ] 1.2 The app shell is outside `HomeView` and SHALL remain.
- [ ] 1.3 The gate SHALL be keyed on the **first-run state** (`!onboardingSeen`), and not on *"is
      the surface open"*, so a surface opened on demand does not gate the feed (D4).
- [ ] 1.4 The feed SHALL be presented once the first run completes or is dismissed.

## 2. Give the surface its artists without the feed (D2)

- [ ] 2.1 `HomeView` SHALL read the shared derivation — `useQuickPickArtists` — and hand the
      first-run surface the same artists the rail would have shown.
- [ ] 2.2 The derivation SHALL be handed the **same two inputs** the shelf is handed, so the two
      readings cannot differ.
- [ ] 2.3 The surface SHALL offer **real artists** while the feed is gated. A gate that emptied the
      surface would replace one dead end with another, and M35 is what made the gate possible at all.
- [ ] 2.4 The feed's provider requests SHALL still fire on first run — the shelves are hooks in
      `HomeView`'s body and hooks run whether or not their output is rendered — so the surface is
      offered the provider's artists with their artwork. The requirement is about what is
      **presented**, not what is **fetched**, and that limit is recorded rather than extended.

## 3. Retire the report (D3)

- [ ] 3.1 The upward report (`onRailChange` and the rail-report type) SHALL be removed: on first run
      the shelf is not rendered, and nothing needs it any more.
- [ ] 3.2 **No requirement mandates the mechanism** — the requirement says the surface offers artist
      selections *"derived from"* the Quick Picks rail — so the removal changes no stated behaviour.
- [ ] 3.3 The surface SHALL read the derivation **directly from the hook**, and NOT through a new
      intermediate channel: M34 specified that channel in detail and nothing could fail if it broke,
      and this change removes the last untested mechanism rather than replacing it with another.
- [ ] 3.4 The derivation SHALL stay a **single** derivation site. The shelf and the surface read the
      same hook with the same inputs, so "the same artists" is true by construction.

## 4. Correct the stale capability (D5)

- [ ] 4.1 `discovery`'s requirement *"Language catalog and first-run onboarding"* SHALL be removed,
      with a **Reason** and a **Migration** — the shape M23 used for the same job.
- [ ] 4.2 A requirement covering only what is true SHALL be added: the catalog, the preference's
      persistence, its changeability, and no account. It SHALL state the language catalog and the
      language preference and **not a first-run surface**.
- [ ] 4.3 The added requirement SHALL **point at** `home-mixes` for the first-run surface rather than
      restating it. Duplication is what produced the contradiction: two capabilities each describing
      first run, one of them from before M28.
- [ ] 4.4 The **scenarios** of the removed requirement that are still true — *"Languages are
      changeable later"* and *"Catalog stays broad"* — SHALL survive in the added requirement.

## 5. Prove the behaviour, and prove each detector can fail

- [ ] 5.1 Green baseline first, before any mutation.
- [ ] 5.2 A test proving **no part of the feed is in the document** while the first-run surface is
      up — the section test ids, the rail's test id, the mix cards, the time shelf and the filter bar.
- [ ] 5.3 A test proving the feed **is presented** once the surface completes or is dismissed.
- [ ] 5.4 A test proving the first-run surface **still offers real artists** while the feed is gated.
- [ ] 5.5 A test proving a surface opened **on demand does not gate the feed**.
- [ ] 5.6 A test proving the stale requirement is **gone** from `discovery` and its replacement is
      present, so the two capabilities cannot drift back into contradicting each other.
- [ ] 5.7 **Each new assertion proven CAUGHT** by mutating the implementation and observing the
      expected test fail — non-zero exit **and** the expected test name in the output.
- [ ] 5.8 Every source mutated for 5.7 restored **byte-for-byte**, proven by SHA-256 before and after,
      with the tree confirmed clean afterwards.
- [ ] 5.9 **Re-read every existing test that touches the feed's presence**, rather than keeping it.
      The feed's presence on first run is the thing this change alters, so a test that asserted the
      feed renders — or that dismissed the surface by clicking a feed element — may now be asserting
      something that is no longer true.
- [ ] 5.10 No existing test may be weakened to make this change pass.

## 6. Record the limits, honestly

- [ ] 6.1 The feed's provider requests still fire on first run. The requirement is about what is
      presented; this change does not extend it to what is fetched, and that is recorded in the
      proposal and the design rather than decided here.
- [ ] 6.2 The filter bar is gated with the feed. **That is a judgement**, and it is recorded in
      `design.md` D1 so a reader can disagree with it explicitly.
- [ ] 6.3 **M34's report mechanism was specified in detail and never tested.** That is a finding
      about M34, and it is recorded rather than fixed by adding a test for a mechanism this change
      retires.

## 7. Verify the whole change

- [ ] 7.1 `npm run gate` exit 0.
- [ ] 7.2 Test file and test counts compared against §0.1; no existing file lost a test.
- [ ] 7.3 `openspec validate first-run-gates-the-feed --strict` exit 0.
- [ ] 7.4 `openspec validate --specs --strict` exit 0.
- [ ] 7.5 Both deltas SHALL be checked for loss with a tool that distinguishes *modified* from
      *lost*, and the report read: every modification deliberate, nothing dropped. **The `home-mixes`
      delta is built FROM the main spec** rather than transcribed, because the first draft of it
      dropped three of M35's paragraphs and only the check caught it.
- [ ] 7.6 Diff reviewed for scope: `features/home/`, the two spec deltas, and `ROADMAP.md`. **No new
      route, no provider request, no dependency, no manifest, no gate step, no CI change, and no change
      to any other route.**
- [ ] 7.7 Evidence reports only what was run. Anything not run is recorded as UNVERIFIED with the
      reason. **UNVERIFIED unless a browser is attached:** anything visual — including what the first
      run looks like with the feed absent.

## 8. Out of scope, recorded not absorbed

- [ ] 8.1 **The Settings host for the artist re-entry** (M34 §8.5): 6,987 gzipped bytes and a 26th
      chunk against a 4,096-byte tolerance. It needs a change that owns the client budget. **M35 has
      made this less pressing, not more** — the rail's own control is always reachable now, so the
      Settings host is parity with Languages rather than the only way in.
- [ ] 8.2 The root lockfile guard gap (M34 §8.6) — **live**, and the stray files are not this
      change's to delete.
- [ ] 8.3 The unidentified intermittent failure (M34 §8.3), and M31–M35's carried-forward items,
      including no gate batch run for M31, M32, M33, M34 or M35.
