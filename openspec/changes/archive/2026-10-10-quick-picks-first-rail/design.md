# Design: putting the artist rail first

## The two declarations that must agree

`HomeView` states the feed order **twice**, in two different forms:

- the JSX, which produces document order;
- `M17_SURFACE_ROWS`, which `assertShelfRhythm` reads.

They are separate because the components render their own `shape` internally, so the check cannot read
it back without depending on a render. The constant is therefore a *declaration* that must be kept in
step by hand — and the existing comment says so: "a future surface that is added to the JSX but not
here is a gap the tests below are written to catch."

Reordering the JSX without reordering the constant would leave the rhythm guard checking a list that
does not match the page. Both move together. That coupling is the reason this is a two-line change
with a real failure mode, not a one-liner.

## Options considered

**A. Move `QuickPicksShelf` above `MixCards` and `TimeShelf`.**

Chosen. It is the smallest change that makes the artist's rail the first content, and it leaves the
rhythm contract satisfiable.

**B. Move Quick Picks above the filter bar.**

Rejected. The filter bar is the control that governs which shelves are presented at all; putting a
shelf above it separates the control from the content it filters and reads as a layout error.

**C. Drop `MixCards` from Home.**

Rejected, and worth naming because it is what "make it like Lyrix" could be taken to mean. Mix cards
start playback from a named mix and are a distinct capability with their own spec
(`home-mixes`: "Mix cards start playback and name honestly"). Deleting a specified capability to
satisfy an ordering request would be a scope change disguised as a layout fix, and it would trade a
real feature for a presentational preference.

**D. Reorder only `M17_SURFACE_ROWS` and leave the JSX.**

Rejected. It would make the rhythm guard assert a fiction — a page order that is not the page order —
which is strictly worse than either doing the change properly or not at all. A guard that checks a
list nobody renders is the exact failure mode M23 had to repair.

**E. Leave the order and fix the documentation.**

Rejected. The documentation was not wrong in isolation; it said the M17 rows precede the *section
stack*, which is true. The defect was that nobody checked the rendered order at all. Editing prose
would have left the rail third.

## Why the tightened assertion is part of the change, not extra

The existing route test reads:

```ts
expect(circularIndex).toBeLessThan(CIRCULAR_WINDOW);  // 4
```

At index 2 today, and at index 3 after an unrelated edit, this stays green. The rule it encodes —
"the artist rail sits near the top" — was satisfied by the very arrangement being reported as wrong.
A bound that the defect does not cross cannot detect the defect.

The replacement asserts `circularIndex === 0`, which is the requirement actually being adopted. It is
strictly stronger, and it fails on today's arrangement — so it is proven able to fail before the
reorder lands, not after.

## Scope

Two source files (`HomeView.tsx` JSX order and `M17_SURFACE_ROWS`) and one test assertion. No
component behaviour, no derivation, no styles, no capabilities.
