# M17 — Apply stage evidence

Recorded 2026-10-02. Node `v24.21.0`, npm `11.19.0`, Windows/PowerShell, run from the repository
root with the Node 24 toolchain on `PATH`.

## What this records

Every number below was produced by a command that was actually run in this stage. Where a check could
not be run, or a check that was run did not behave as claimed, that is stated rather than smoothed
over.

## Gates

| Gate | Exit |
|---|---|
| `npm run lint` | 0 |
| `npm run format:check` | 0 |
| `npm run typecheck` | 0 |
| `npm run test` | 0 |
| `npm run build` | 0 |
| `frontend/scripts/lyrics-induced-violations.mjs` | 0 — `36/36 induced violations were caught by their named test` |
| `openspec validate m17-home-discovery --strict` | 0 — valid |
| `openspec validate m17-home-discovery --specs --strict` | 0 — `Totals: 21 passed, 0 failed (21 items)` |
| `scripts/sync-m17-home.mjs --check` | 0 — 0 dropped, 0 reworded |

## Suite

Nine recorded full runs, each **157 files / 2639 tests**, all exit 0.

One further run exited non-zero during this stage and **its failing test was not captured** — the
command that reported it parsed the summary with a regex that did not survive ANSI colouring. An
independent verification pass had separately observed `tests/settings-ui.test.tsx` fail once in seven
runs (that file already sets `asyncUtilTimeout: 5000`; the failure is load sensitivity on a
`waitFor` for the local-data connection, not a missing timeout). Both flakes predate M17 and are
carried to M21. This is recorded as an unexplained observation, not as a clean bill of health.

## Detectors proven able to fail

A detector that has only ever passed is a claim. Each case below breaks one property and requires a
**non-zero** exit from the named test; every file was restored byte-for-byte and the tree re-verified
green afterwards.

### The band wiring (orchestrator's own mutations, independent of the implementation agent)

| Mutation | Result |
|---|---|
| `bandTasteProfile` returns `base.seedTerms` instead of the band's | 4 tests failed in `tests/home-time-bands.test.ts` |
| The activation composes nothing | 11 tests failed in `tests/home-time-shelf.test.tsx` |
| `onServer()` returns `true`, so the band renders during the static prerender | 1 test failed in `tests/home-time-shelf.test.tsx` |
| Control: restored tree | green |

### The no-motion guard's coverage hole, now closed

Dropping `src/features/home/ProbeM17Motion.tsx` containing
`export const PROBE = "animate-pulse";` used to leave the guard **4/4 green**. It now fails:

```
AssertionError: M17 must not introduce animation: expected [ { …(2) } ] to deeply equal []
+     "file": "features/home/ProbeM17Motion.tsx",
```

The guard's coverage is now the recursive walk of `src/features/home` plus the one module outside it
the milestone edited, rather than a hand-typed list.

### `data-band` reaching the DOM

`Shelf` renders a fixed attribute set with no spread, so `data-band` was silently dropped — TypeScript
skips hyphenated JSX attribute names, so `typecheck` never noticed. Fixed with one typed prop; a test
now reads the attribute at four injected hours, and removing it fails.

### The spec-preservation guards

`scripts/sync-m17-home.prove.mjs`: **15/15** refusal cases, each run against a sandboxed *copy* in a
temp directory. The two that matter most here are new:

- a scenario **body** rewritten while its name is kept → refused;
- a sentence of requirement **prose** dropped → refused.

Run against M17's original delta (the one the proposal merged), the strengthened guard refuses with:

```
REFUSING: the delta REWRITES the body of 8 existing scenario(s) in "Home discovery feed" …
REFUSING: the delta LOSES 6 sentence(s) of the requirement prose for "Home discovery feed" …
REFUSING: the delta REWRITES the body of 3 existing scenario(s) in "Local-only personalization inputs" …
REFUSING: the delta LOSES 3 sentence(s) of the requirement prose for "Local-only personalization inputs" …
```

That delta kept every scenario **name** while deleting *"with no liked-track, playlist, or history
payload"*, *"shaped like the cards it will replace"*, *"and the circular section appears within the
first four rendered sections"*, and the keyboard/focus/accessible-name clause. Five requirements
enforced by passing tests would have vanished from the specs of record, and `openspec validate` would
have reported nothing. Both MODIFIED deltas were rewritten to carry the record's prose and every
existing scenario body over verbatim.

## Hydration

`/` is statically prerendered, so a band computed during the server render is a band computed at
**build** time. `TimeShelf` now gates itself behind `useSyncExternalStore`, whose server snapshot is
`false`. Verified against two real build artifacts made at 16:03 and 16:12:

```
Morning present=False   Afternoon present=False   Evening present=False
Late night present=False   data-band present=False   Matched to the present=False
time-shelf-mix-action present=False
```

`MixCards` is deliberately **not** gated, and the reasoning was checked rather than assumed: its
output is derived from local IndexedDB data, so a data-free build renders nothing for it to get
wrong. `TimeShelf` needed the gate precisely because its band label depends on the clock alone.

## Scoped claims, stated precisely

- **"No motion"** means M17 *declares* no motion vocabulary. A DOM walk cannot answer this: the
  `Button`, `Shelf`, and `ShelfTrackCard` primitives it reuses carry their own motion. The time
  shelf's action uses the design system's Ghost Text Button, which DESIGN.md defines **with** a
  `transition` — so the rendered control fades on hover. `HomeFilterBar` in this same milestone
  already used `variant="ghost"`. This is reuse of the design system's own documented behaviour, not
  a new vocabulary, and it is stated in the guard's documentation rather than left to be discovered.
- **`MIX_CARDS_EMPTY`** is unreachable: the row returns `null` when `!profile.hasSignal`, and whenever
  `hasSignal` is true at least one plan is derived. Retained as the shelf-level half of "an empty mix
  is explained"; the composition-time explanation is the branch that actually runs.
- The `no-signal` branch of the time shelf's `noticeFor` is reachable only through the generator spy,
  because the action is not offered when `hasSignal` is false. Stated in the test's comment.

## Not verified

- **No browser verification.** Home was not opened at 1280×900 or 390×844; the filter was not
  switched by hand; no card was pressed in a real browser. The action's layout is reasoned from the
  existing `mb-8`/`gap-8` rhythm, not seen.
- **No hydration-mismatch check in a real browser.** The claim rests on `renderToStaticMarkup`
  emitting nothing plus `useSyncExternalStore`'s documented behaviour, and on the build artifact.
- **The parked 1×1 IFrame player remains unobserved** — unchanged since M4 and blocked by CSP.
- Task 6.2's compact-viewport property is asserted by unit-level layout assertions, not by a
  screenshot.