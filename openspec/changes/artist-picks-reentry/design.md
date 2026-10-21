# Design — `artist-picks-reentry`

## D1 — One derivation, one place

`deriveQuickPicks(input)` is already a pure function over
`{ languages, taste: { likedTracks, events }, providerTracks, picks }`. It is called once, in
`QuickPicksShelf`, and the shelf reports its result **upward** to `HomeView`, which passes it to the
onboarding dialog.

That wiring was deliberate, and the reason is recorded in the shelf's own comment:

> *Deriving them a second time inside the dialog would let the two disagree — and the dialog is the
> surface whose whole claim is "these are the artists you are choosing between".*

**This change adds a third consumer, and the honest way to add it is to make the shared thing
shared.** A Settings surface that derived its own list would reintroduce exactly the disagreement
M28's design refused to allow, one component later.

So: extract a hook, `useQuickPickArtists()`, that owns the derivation and returns

```ts
{ artists: readonly QuickPick[]; settled: boolean; state: "loading" | "ready" | "empty" | "error"; retry(): void }
```

`QuickPicksShelf` becomes a thin presentational consumer of it; `HomeView` passes it to the dialog;
the Settings section consumes it too. **"The same artists" is then true by construction rather than
by convention** — which is the only kind of claim that survives a second consumer.

### D1.1 Who owns the provider request

The hook must not own the request, because Home's feed already owns two of them (`trending` and
`collections`) and issuing them twice would double the network cost of every Home visit.

So the hook takes the provider tracks as an argument and adds only what it can add itself — the
stores' contents and the derivation:

```ts
useQuickPickArtists({ providerTracks, providerSettled })
```

Home passes `[...feed.trending.tracks, ...feed.collections.tracks]`. **Settings must therefore have
its own provider feed**, which D4 addresses. This is the seam where the cost lives, and it is stated
here rather than discovered later.

## D2 — `settled` is the load-bearing new signal

**The information that distinguishes "not known yet" from "nothing to offer" is currently thrown
away.** `QuickPicksShelf` computes it:

```ts
const state: ShelfState =
  picks.length > 0 ? "ready" : providerState === "ready" ? "empty" : providerState;
```

and then reports only the *entries* upward:

```ts
useEffect(() => { onRailChangeRef.current?.(picks); }, [railKey]);
```

`onRailChange` is typed `(entries: readonly QuickPick[]) => void`. The consumer cannot tell an empty
rail that has settled from one that has not, because the settled-ness was never handed over.

**The report carries both from here on.** `onRailChange` becomes
`(report: { artists: readonly QuickPick[]; settled: boolean }) => void`, and the rail's `state`
becomes the source of `settled`.

### D2.1 What `settled` means, exactly

`settled` is true when the rail has **finished deciding what it holds** — the provider has settled
(resolved, failed, or been disabled) **and** the local stores have hydrated. It is false while
either is outstanding.

The local half matters as much as the provider half. `storedPicks` is empty until
`hydratePicks()` resolves, and `likedTracks` and `events` are empty until *their* hydrations resolve.
**A rail that settled against empty stores would settle on the wrong answer** — it would report "no
artists" for a device that has three liked tracks and simply has not read them yet. That is the same
class of bug as the one this change exists to fix, one level down, and the guard is the same.

### D2.2 The empty case, correctly

`state === "empty"` means: the provider settled, the stores hydrated, and the derivation produced
nothing. That is the **only** state in which "there are no artists" is a true statement, and
therefore the only state in which the surface may say so — or offer a dismissal.

## D3 — The dialog has three states, and only two of them are answers

| State | What it shows | Can it be dismissed? |
|---|---|---|
| `pending` | the rail has not settled | **No** |
| `offering` | the artist grid | Yes |
| `nothing` | "no artists yet", and where to choose later | Yes |

**`pending` is the whole point.** A dismissal is an answer — `markOnboardingSeen()` is called on
dismissal, deliberately. So a surface that shows an empty grid before it has asked, and offers a
dismissal, is collecting an answer to a question it never asked. That is exactly the defect.

In `pending` the dialog shows a loading affordance and **no dismissal control**. Not "a dismissal
that does nothing" — no dismissal, because a control that looks available and is not is worse than
its absence.

This also means a slow or failed provider request **cannot strand the listener**: the request
settles (resolved, failed, or disabled) and the surface reaches `offering` or `nothing`.

## D4 — Where the re-entry lives

**On Home, beside the rail. Not in Settings — and that was measured, not preferred.**

A Settings section was built first, and it was the obvious choice: the Languages section already
reopens the shared `LanguagePicker`, and "changeable later" is exactly what Languages guarantees.
It was measured, and **it did not fit the client budget**:

| | total gzipped | chunks | `/` first load |
|---|---|---|---|
| the tree before this change | 388,611 | 25 | 231,355 B / 13 chunks |
| **this change, re-entry on Home** | **389,548** | **25** | 232,000 B / **13 chunks** |
| this change, re-entry in Settings | 396,552 | **26** | 233,188 B / **14 chunks** |

Both figures are the same machine, the same toolchain (Node 24.21.0, the one every recorded budget
was measured on), and the same build procedure.

**The Settings host costs 6,987 gzipped bytes and adds a 26th chunk and a 14th chunk to Home's first
load.** The client budget's total tolerance is 4,096 bytes, and its chunk-count and largest-chunk
rules carry **no tolerance at all**. So the Settings host could only ship by re-recording the
ceiling — and the budget's own module says of exactly this situation:

> *`toleranceBytes` below already exists and would absorb it, but widening this assertion from a
> ceiling to ceiling-plus-slack changes what the budget guarantees, which is not this change's
> decision to make.*

**So it is not this change's decision to make, and it is not made.** The Settings section is deferred
to a change that owns the budget, and `tasks.md` §8.5 records it with the measurement above so the
next milestone starts from numbers rather than from a guess. The re-entry ships on Home, where it
costs **937 bytes and no new chunk**.

### D4.1 The affordance is offered when the rail holds artists

The rail's own control opens the picker, so the re-entry is next to the thing it revises.

**It is offered when the rail holds artists, not when the rail is empty** — and that is not a
detail. The candidates *are* the rail's entries, so an empty rail means opening the picker would
show an empty picker. An affordance offered exactly when there is nothing to choose would be
offering the dead end it is meant to end, and the first build of this change got that backwards: it
offered the control on the empty rail, which is where it is useless.

**The one-shot first-run behaviour does not change.** The dialog does not re-present itself. A
listener who answered does not get nagged; a listener who wants to change their mind has a place to
go.

## D5 — The reset clears the gate

`clearOnboardingSeen()` exists, is exported, and its docstring says:

> *Clear the gate. Exists for "Reset Spotivibe data" and for tests.*

**Nothing in production calls it.** `resetStores(db)` clears IndexedDB stores; `localStorage` is not
touched by any reset path. The documented escape hatch is not wired, and the docstring is the only
thing claiming it is.

The fix is to wire it, in the place the reset actually happens — the `DataControls` reset handler —
so that "Reset Spotivibe data" clears the IndexedDB stores **and** the first-run gate together.

**Why the gate belongs to the reset at all.** The spec's reasoning, written into the delta, is that a
reset that leaves the question answered but the answer deleted is a reset that cannot be repeated.
The picked artists live in IndexedDB and are cleared by the reset; the flag lives in `localStorage`
and would survive it. The two halves of one answer, split across two stores, with only one of them
reset. That is the defect.

**The flag and the picks are not the same store, and that is deliberate** — the comment on the gate
says so: the picks are user data and must survive a cache clear and travel through the backup
envelope, while the flag is a tiny boot-time preference. A reset clears *both*, because a reset
means "this device has no Spotivibe data", and the flag is Spotivibe data.

## D6 — The copy stops promising what the app cannot deliver

`ArtistOnboarding.tsx:140` currently says:

> *"We couldn't find any artists yet. You can pick them later."*

**"Later" did not exist**, and the first attempt at fixing it made it worse by pointing at a Settings
section that was then removed. The copy now says only what the surface knows:

> *"We couldn't find any artists yet. Artists appear as you listen."*

That is true, and it is the whole of it. The candidates are the rail's entries, so an empty rail
means there is **nothing to pick** — a surface that says "you can pick them later" over an empty
list is promising a choice it cannot offer, which is the same defect as asking before the rail has
settled, one layer down.

**The empty state is also allowed to be empty.** If there is genuinely nothing, saying so is honest.
What is not allowed is saying it too early, or promising something the list does not contain.

## D7 — Limits, stated rather than implied

- **The re-entry is on Home, and the Settings host is deferred** (D4). The budget owns that decision,
  not this change.
- **The `pending` state is unbounded in wall-clock time.** If the provider request hangs, the dialog
  waits. The request is abortable and settles on failure, but a request that never settles would
  leave the surface in `pending` — and, because `pending` offers no dismissal, that is a listener
  who cannot leave. **This is the one risk in the design and it needs its own guard**: the pending
  state must have a time bound, after which the surface proceeds to `nothing` and offers the
  dismissal. A surface that will not let someone leave is worse than the defect it fixes.
- **The one-shot gate remains a `localStorage` flag.** A device that clears site data but not
  `localStorage` — or the reverse — sees one half of the answer without the other. This is the
  pre-existing split and D5 does not change it.
- **This change does not make the rail better at finding artists.** It makes the existing rail
  reachable as a choice, which is a different thing.

## D9 — Two consequences of sharing one component, recorded because the spec does not describe them

Found while reviewing the implementation, and recorded here rather than left for a reader to
discover.

### D9.1 The on-demand picker writes the first-run gate

`ArtistOnboarding`'s `finish()` and `dismiss()` both call `markOnboardingSeen()`. The rail's
on-demand control opens **that same component**, so:

- choosing artists from the rail marks the first run as answered — sensible, and the reason a
  listener who picks that way is not asked again;
- **and dismissing the on-demand picker without choosing also marks the first run as answered** — on
  a surface that is not the first run.

The delta does not forbid this: it says the re-entry *"SHALL NOT re-present the first-run surface to
a listener who has already answered it"*, and the re-entry does not re-present anything. **No
listener is stranded**, because the rail's control is always there when the rail holds artists.

But the flag's meaning has widened from *"has this been seen"* to *"has this question been answered
anywhere"*, and that widening is a consequence of sharing one component rather than something the
delta asked for. The alternative — a second, on-demand-specific picker that does not touch the
gate —
would be the drift D1 exists to prevent, so sharing is right and the consequence is recorded.

### D9.2 The pending bound is 8 000 ms, and it is a number someone chose

D7 requires a bound and does not state a value. **8 000 ms** was chosen, exported as
`ARTIST_ONBOARDING_PENDING_TIMEOUT_MS`, and asserted to be **> 0 and ≤ 30 000 ms** — so a bound
inflated into "a bound on paper" fails a test rather than passing it. A rail that settles *after* the
bound still wins: the surface then shows the truth rather than the timeout.

## D8 — Rejected alternatives, with the reasons kept

| Alternative | Why not |
|---|---|
| Make the dialog never dismissible | A listener who does not want to pick artists would be trapped. D3 keeps dismissal for every state where the answer is true. |
| Re-present the dialog on every Home visit until artists are picked | This is the "nagging" the existing comment rules out, and it turns a one-shot into a tax. The re-entry is a *place*, not a pop-up. |
| Delete the `localStorage` flag and derive "seen" from the IndexedDB picks | The gate must be answerable before the repositories open, which is the reason `localStorage` was chosen. Deriving it from IndexedDB would reintroduce the flash the gate's own comment describes. |
| Move the picks out of IndexedDB into `localStorage` | The picks are user data and must survive a cache clear and travel through the backup envelope. The spec says so and the tests say so. |
| Let the Settings section show only already-known artists | It would make the re-entry useless for the listeners who need it — the ones with no local material. |
| Derive the Settings artist list independently of the rail | The disagreement M28's design refused to allow, reintroduced one component later. D1. |
| **Re-record the client budget to cover the Settings host** | The cost is 6,987 gzipped bytes and a 26th chunk, and the chunk-count rules carry no tolerance, so it could only ship by moving the ceiling. The budget's own module says that widening what the budget guarantees **"is not this change's decision to make"**. Deferred, not absorbed — see D4 and `tasks.md` §8.5. |
| **Ship the Settings host and let the budget fail** | A red gate is not a decision, it is an unfinished one. The same change that could have re-recorded the ceiling is the change that should have to justify it. |
