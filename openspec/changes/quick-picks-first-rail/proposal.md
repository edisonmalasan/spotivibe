# Make the artist Quick Picks rail the first thing Home presents

## Why

M23 made Quick Picks artist-only, and that part worked: `QUICK_PICK_KINDS = ["artist"]`, so a language
entry is unrepresentable in the type. **But the rail is not first.** `HomeView`'s JSX renders:

1. `HomeFilterBar`
2. `MixCards` — "Start a mix", cards **derived from the selected languages**
3. `TimeShelf` — time-of-day band
4. **`QuickPicksShelf`** — the artist rail
5. the section stack (Recently Played, Trending Now, Made For You, Smart Mixes, …)

So the first thing below the filter bar is a rail of language-derived mix cards, and the artist rail
is **third**. Asked whether Quick Picks showed artists, the honest answer is "yes, third".

## What was actually wrong with the previous answer

An earlier report attributed this to a stale service worker and suggested a hard refresh. **That was
wrong**, and it is recorded here because the wrong answer was given confidently and twice. The
diagnosis came from reading `quickPicks.ts` — which *does* prove the rail is artist-only — and
stopping there, without checking where the rail sits in the feed. A comment in the same file claimed
the M17 surfaces render "before the section stack", which is true and irrelevant: three rails render
before Quick Picks, not none.

Checking the rendered order instead of the source of one module is what found this.

## What this changes

`QuickPicksShelf` moves above `MixCards` and `TimeShelf`, so the artist rail is the **first** content
the feed presents. `M17_SURFACE_ROWS` moves with it, because that declaration exists to mirror the
JSX for `assertShelfRhythm`.

Nothing else changes: no card content, no derivation, no filter, no capability to emit a language
entry. This is purely about which rail comes first.

## Why the rhythm rule permits it

`shelfRhythmViolations` has exactly two rules: a circular row must not be adjacent to another
circular row, and a circular row must render within the first `CIRCULAR_WINDOW` (4) rows. A circular
row at index 0 has no predecessor and is well inside the window, so reordering is legal by
construction rather than by luck.

## The test is tightened, not just satisfied

`routes.test.tsx` asserts `circularIndex < 4` — "the circular artist rail is inside the first four
rendered sections". That passes today at index 2 and would also pass if the rail moved to index 3. It
is therefore **too weak to detect the defect it exists to prevent**: it permits the artist rail to sit
behind two language-derived rails.

It is tightened to assert the rail is the **first** rendered row. A test that cannot fail on the
behaviour it names is not evidence for that behaviour, and leaving it would mean the next person to
move Quick Picks down would see green.

## What this does not claim

- It does not change what Quick Picks *contains*; M23's artist-only guarantee is untouched.
- It does not remove languages from the app. Languages remain legitimate inputs to mix plans, the
  time shelf, and the discovery sections. Only the artist rail's position changes.
- **It has not been verified in a browser.** No browser is attached to the authoring session, so this
  change is verified by tests over rendered document order — which is the same evidence the existing
  rhythm test rests on — and not by looking at the page. Stated plainly rather than implied.
