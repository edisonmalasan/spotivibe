# Design — `first-run-gates-the-feed`

## D1 — The gate is a render decision, and the feed is not rendered

`HomeView` renders five things: the filter bar, the artist rail, the mix cards, the time shelf, and
the section list. The dialog is the sixth.

The gate is: **while the first run is up, none of the five is rendered.** Not hidden, not
`opacity-0`, not behind the surface — **not in the document.** A test asserts their test ids are
absent, so "the feed is not presented" is a statement about the DOM rather than about a z-index.

**The app shell is outside `HomeView`** — the sidebar, the header, the persistent player — so it stays.
The requirement says *"the discovery feed SHALL NOT be presented"*, and the shell is not the feed.

**The filter bar is gated with the rest.** A filter over an absent feed is a control for nothing, and
the first run should present one thing. That is a judgement, and it is recorded here so a reader can
disagree with it explicitly rather than discover it in the diff.

## D2 — The surface gets its artists from the derivation, not from the rendered rail

This is the part that would not have worked before M35, and M35 is what made the gate possible.

`HomeView` currently learns the rail's contents from the shelf, which reports upward through
`onRailChange`. **On first run the shelf is not rendered, so there is nothing to report.** The surface
would be handed an empty list — and the gate would have replaced one dead end with another.

The way out is the shared hook M35 built. `useQuickPickArtists` is the single derivation site, and
M35's design already anticipated this shape:

> *the rail, the first-run surface, and the Settings re-entry all read **this** hook, so "the same
> artists" is true by construction rather than by two call sites agreeing.*

`HomeView` reads it directly and hands the surface the same artists the rail would have shown. The
shelf reads it too, and both are handed the **same two inputs** — the provider tracks and the
provider state — so the two derivations cannot differ.

**The provider requests still fire on first run.** The shelves are hooks in `HomeView`'s body, and
hooks run whether or not their output is rendered. That is what lets the surface offer the provider's
artists *with their artwork* — the same cards the rail would have shown, minus the rendering. The
requirement says the feed is not **presented**; this change does not extend that to **fetched**, and
that limit is recorded in the proposal rather than decided here.

## D3 — The `onRailChange` report is retired, and that is a finding

The report goes, because the surface no longer needs it. Three things make that cheap:

- **No test in the repository references `onRailChange`, `railReport`, or `QuickPickRailReport`.**
- **No requirement mandates the mechanism.** M34's requirement says the surface offers *"artist
  selections **derived from** the Quick Picks rail"* — a statement about the derivation, not about how
  two components talk to each other.
- The shelf is rendered by `HomeView` alone, so there is one consumer to move.

**And the more interesting fact is that M34 specified the report in detail and never tested it.** D2
described its shape, the "settled" half was the milestone's load-bearing signal, and the mechanism
carried a name and a type — and **nothing could fail if it broke.** That is the same defect class
`verification-integrity` exists to catch, in the milestone whose subject was verification integrity.

**So the report is not replaced with another untested mechanism.** The derivation is read directly
from the hook, and the hook is already the thing M35 covered with 34 mutation probes. There is no
intermediate channel left to be wrong.

## D4 — The gate belongs to the first run, not to the surface

The first-run surface and the on-demand picker are **the same component**, and they must behave
differently:

| | Feed | Why |
|---|---|---|
| **first run** | not rendered | the listener has expressed no preference yet, and M28's proposal named the populated dashboard behind the dialog as the defect |
| **opened on demand** | rendered | the listener is revising a choice they already made, and the feed is what they are revising |

So the gate is keyed on **`!onboardingSeen`** — the first-run state — and not on *"is the surface
open"*. A surface opened from the rail appears over a feed the listener is looking at, which is the
whole point of opening it from there.

**The distinction is in the requirement, not only in the code**, because the two cases share a
component and a reader cannot tell them apart from the component alone.

## D5 — `discovery`'s stale requirement is removed and its true half restated

The requirement *"Language catalog and first-run onboarding"* says first run is a language choice.
It has been wrong since M28 and it contradicts `home-mibes`.

**A MODIFIED block cannot fix it**, because OpenSpec refuses a MODIFIED block that drops a scenario —
so the two stale scenarios would have to be *reworded* rather than removed, and the requirement's
**title** would still claim coverage of a first run it no longer describes.

So the shape is M23's, which is the precedent in this repository:

- **`## REMOVED Requirements`** — the stale requirement, with a **Reason** (it describes a deleted
  dialog and contradicts `home-mixes`) and a **Migration** (the true half moves to the requirement
  added below; the first-run surface stays specified in `home-mixes` only).
- **`## ADDED Requirements`** — *"Language catalog and language preference"*: the catalog, the
  preference's persistence, its changeability, and no account. **It states the language catalog and
  the language preference and not a first-run surface**, so the two capabilities cannot come to
  disagree about one again.

**The added requirement points at `home-mixes` rather than restating the first-run behaviour.**
Duplication is what produced the contradiction: two capabilities each describing first run, one of
them from before M28.

## D6 — What the change does not touch

- **No other route.** The gate is `HomeView`'s.
- **No request.** The feed's requests already fire; the gate is about rendering.
- **No provider, no manifest, no dependency, no gate step, no CI change.**
- **The app shell.** Outside `HomeView`.
- **The first-run surface's own behaviour** — its three states, its pending bound, its copy. M34 and
  M35 own those and this change does not reopen them.

## D7 — Rejected alternatives, with the reasons kept

| Alternative | Why not |
|---|---|
| Hide the feed with CSS instead of not rendering it | "Not presented" would be a claim about a z-index, and the content would still be in the document — in the accessibility tree, in the tab order, and in the payload. A test can assert absence; it cannot assert invisibility. |
| Gate the feed only in the first-run case and leave the on-demand case alone | That **is** the design (D4). The alternative — gating on "is the surface open" — would make the rail vanish when a listener opens the picker from it. |
| Keep `onRailChange` and render the rail invisibly so it can report | That is the hidden-feed alternative, and it keeps a feed the listener did not ask for. |
| Correct `discovery` by rewording its two stale scenarios in place | OpenSpec refuses a MODIFIED block that drops a scenario, so the stale ones would be *reworded* rather than removed, and the requirement's title would still claim a first run it no longer describes. REMOVE + ADD is the shape M23 used. |
| Restate the first-run behaviour in both capabilities | Duplication is what produced the contradiction. One capability states the first run; the other points at it. |
| Delete the whole `discovery` requirement and lose the catalog scenarios | The catalog stays broad and the preference stays changeable — both are true, both are needed, and both are asserted elsewhere. |
| Make the feed's requests not fire on first run | The surface is offered the provider's artists *with their artwork*, which is the better first-run content. The requirement says the feed is not **presented**. |
