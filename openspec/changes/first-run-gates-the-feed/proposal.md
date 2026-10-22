# Proposal — M36: make the first run present one thing, and retire the stale language-dialog requirement

## Why

**The `discovery` capability and the `home-mixes` capability currently contradict each other about
what first run is, and the code contradicts both.**

`openspec/specs/discovery/spec.md` says:

> *"A user who has not completed onboarding SHALL be offered **language selection** on first run,
> presented as an explicit, dismissible-or-confirmable choice that can be completed with one or more
> languages. Completing it SHALL persist the selected languages and the completed state through the
> local preferences repository."*

**The code does none of that.** M28 replaced the language dialog with an artist picker, and the
`home-mixes` capability says so in terms: *"SHALL present a first-run surface offering **artist**
selections … and SHALL NOT present a language-selection dialog."* M28's delta landed in `home-mixes`
and `local-data` and **never corrected `discovery`**, so the two have said opposite things about first
run since October. This has been carried and deferred twice — M34 §8.1 and M35 §8.1 both record it as
*"needs a change that owns the first-run requirement as a whole"*. **This is that change.**

## And the second half: the feed has never been gated

`home-mixes` says:

> *"The first-run surface SHALL gate the dashboard: the discovery feed SHALL NOT be presented until
> onboarding is completed or dismissed."*

**`HomeView.tsx` renders the feed and the dialog side by side.** The rail at line 490, the mix cards
at 521, the time shelf at 529, the sections at 559, and the dialog at 576 — the whole feed is in the
document while the first-run surface is up.

This is not a recent regression. `git log -S "showOnboarding"` finds exactly **one** commit, the one
that built the feed: **the feed has never been gated.** M28's own archived task 6.3 says *"Dismissal
with nothing selected **reaches the dashboard**"*, and M28's own proposal gave the reason the overlay
was wrong in the first place:

> *"Asking for languages first means the dashboard renders behind a dialog before anyone has expressed
> a preference at all."* and *"It covers content that is already there. The screenshot showed the
> dialog over a populated Home — a full Quick Picks rail and an Evening shelf. Nothing was hidden
> behind it that the dialog was helping the listener choose."*

**So the requirement is right and the code is wrong** — and it has been wrong since the feed was
built. M28 identified the defect, wrote a requirement that forbids it, and shipped the defect anyway.
Two milestones have since noticed the contradiction between the two capabilities and deferred it,
because neither was the change that owns the first-run requirement.

**What M28's proposal identified, M35 made fixable.** M28's reason for disliking the overlay was that
the dashboard rendered *before anyone had expressed a preference* — but the dialog had nothing to
offer, so gating the feed would have meant gating it behind an empty dialog. **M35 fixed that**: the
curated popular artists guarantee the first-run surface always has real artists to offer, from
*every* language, with no request. The gate is now possible, and the dead end that prevented it is
gone.

## What

1. **The first run presents one thing.** While the first-run surface is up, the feed is **not
   rendered** — not hidden, not behind the surface. The feed appears when the surface completes or is
   dismissed. The app shell stays; the feed content does not.

2. **The first-run surface gets its artists without the feed being presented.** `useQuickPickArtists`
   is the shared derivation M35 built, and M35's own design anticipated this: *"the rail, the
   first-run surface, and the Settings re-entry all read **this** hook"*. `HomeView` reads it directly,
   and the surface is handed the same artists the rail would have shown.

3. **`discovery`'s stale requirement is retired and its true half is restated.** The requirement
   *"Language catalog and first-run onboarding"* says first run is a language choice. It is removed, and
   a requirement that covers only what is true — the catalog, and the language preference being
   changeable and persistent — is added in its place, pointing at `home-mixes` for the first-run
   surface so the two capabilities **agree** rather than contradict.

## What the surface mechanism costs

`HomeView` currently learns the rail's contents from the shelf, which reports upward through
`onRailChange`. **That report has to go**, because on first run the shelf is not rendered and there is
nothing to report.

It goes cheaply: **no test in the repository references `onRailChange`, `railReport`, or
`QuickPickRailReport`**, and no requirement mandates the mechanism — M34's requirement says the surface
offers *"artist selections **derived from** the Quick Picks rail"*, which is a statement about the
derivation and not about how the two components talk to each other.

**And that is itself a finding worth recording:** M34's design made the report the way the surface
learns the rail, and specified its shape in detail, and **nothing ever asserted it**. A mechanism
that no test can fail is a mechanism nobody knows is doing anything — the exact defect
`verification-integrity` exists to catch, and M34's own subject.

## Evidence this change must produce

- The feed is asserted **absent** from the document while the first-run surface is up — the section
  test ids, the rail's test id, the mix cards and the time shelf — and **present** once the surface
  completes or is dismissed.
- The first-run surface is asserted to **still offer real artists** while the feed is gated, which is
  the case M35 made possible and the case a naive gate would break.
- The on-demand picker is asserted **not** to gate the feed: a listener revising their picks from the
  rail keeps the rail behind them.
- The `discovery` requirement is asserted **gone** and its replacement **present**, so the two
  capabilities cannot drift back into contradicting each other.
- Each new assertion proven **CAUGHT** by mutation, with SHA-256 proving byte-for-byte restoration.

## Out of scope, recorded not absorbed

- **The Settings host for the artist re-entry** (M34 §8.5): 6,987 gzipped bytes and a 26th chunk
  against a 4,096-byte tolerance. It needs a change that owns the client budget. **M35 has made this
  less pressing, not more**: the rail's own control is always reachable now, so the Settings host is
  parity with Languages rather than the only way in.
- The root lockfile guard gap (M34 §8.6) — **live**, and the stray files are not this change's to
  delete.
- The unidentified intermittent failure (M34 §8.3), and M31–M35's carried-forward items.
- **Whether the feed's provider requests should still fire on first run.** They do, because the hooks
  are in `HomeView`'s body and the surface is offered the same artists the rail would have shown. The
  requirement says the feed is not *presented*, and this change does not extend that to *fetched*.

## Scope

`frontend/src/features/home/` (`HomeView.tsx`, `QuickPicksShelf.tsx`), the two spec deltas, and
`ROADMAP.md`. **No new route, no provider request, no dependency, no manifest, no gate step, no CI
change, and no change to any other route.**
