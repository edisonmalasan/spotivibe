# M18 — Apply stage evidence

Recorded 2026-10-02. Node `v24.21.0`, npm `11.19.0`, Windows/PowerShell, run from the repository root
with the Node 24 toolchain on `PATH`.

## Gates

| Gate | Exit |
|---|---|
| `npm run lint` | 0 |
| `npm run format:check` | 0 (after one round: a case-file edit needed reformatting) |
| `npm run typecheck` | 0 |
| `npm run test` | 0 |
| `npm run build` | 0 |
| `frontend/scripts/lyrics-induced-violations.mjs` | 0 — `64/64 induced violations were caught by their named test` |
| `openspec validate m18-interactions --strict` | 0 — valid |
| `openspec validate --specs --strict` | 0 — `Totals: 22 passed, 0 failed (22 items)` |

## Suite

Five full runs green at **164 files / 2750 tests**, then three more at **164 files / 2753 tests** after
this stage's own additions. Neither pre-existing flake (`podcast-playback-history`, `settings-ui`)
appeared in any run.

### One unexplained observation, and one measurement that resolved it

One harness run reported **59/60**; the next four reported 60/60. I could not attribute it, because I
filtered the harness output with `^\s+FAIL`, which also matched vitest's own output *inside* the harness,
so the failing case was never named. Recorded as an unexplained one-off rather than as benign.

The verification agent then ran `tests/search-suggestions.test.tsx` **22 consecutive times** — all exit
0 — and established the suite's timing is deterministic by construction: only `setTimeout`/`clearTimeout`
are faked, and `flush()` drains a fixed 12 `setImmediate` turns, a load-independent count. It also noted
the most load-sensitive M18 test is a *negative* assertion (assert absent after a window), which a slow
machine can only make **more** likely to pass.

**Suite duration.** I observed 79s, 138s and 127s on identical code, against a ~63s baseline, and flagged
it as unattributable. The verification agent measured four further runs at **67.8s, 67.8s, 69.7s,
66.0s**, and — using the JSON reporter, which does carry per-file wall time — M18's seven test files
contribute **10.7s of 147.5s summed per-file time (7.3%)**. Two later runs of mine on a quiet machine
came in at **51.2s and 50.7s**. The spikes were environmental, not M18.

## Independent verification

An independent read-only agent returned **`NOT MERGEABLE`** with one CRITICAL, one process CRITICAL, and
six warnings. All are resolved below.

### CRITICAL 1 — a spec scenario of mine had zero coverage, and the whole suite proved it

`keyboard-shortcuts/spec.md` "A shifted key still fires its shortcut" — a scenario **I added** in
response to an earlier review — had **no test at all**. The verifier proved it: adding `event.shiftKey`
to the platform-chord exclusion left the entire 2750-test suite green, while making `?` unreachable.

That mutation is worse than a missing test. The help key is `Shift+/`, so `?` arrives as `key: "?"`
with `shiftKey: true`. Treating shift as a chord removes **the only way to discover that the other
shortcuts exist** — the feature deletes its own documentation. Capitalised letters arrive with
`shiftKey` true too, so `M` and `L` break for anyone holding shift or with caps lock on.

**Fixed.** Three tests added to `shortcut-bindings.test.ts`: a whole-table sweep asserting every binding
answers nothing under `ctrlKey`/`metaKey`/`altKey`; a whole-table sweep asserting every binding still
answers under `shiftKey`; and a dispatcher-level test that `?` with shift held actually reaches
`setHelpOpen(true)` — the matcher alone would pass while the dispatcher dropped the key.

The earlier test named only `M` and `L`. That is the exact defect this milestone exists to prevent,
reappearing inside its own evidence, which is why the sweep is now over the table.

Re-proven against the fixed tree, restores SHA256-verified:

| Mutation | Result |
|---|---|
| shift treated as a chord | 2 tests failed |
| a binding opts out of the chord rule | 1 test failed |
| a binding stops answering entirely | 2 tests failed |

### CRITICAL 2 — `tasks.md` was 0 of 27 against a complete implementation

Now **27 of 27**, each ticked only where its verification ran, with task 7.4's numbers recorded inline.

### WARNING 2 — the `Escape` row documented a mechanism that is not the mechanism

The help row read *"Closes the shortcut list and nothing else"*, which reads as though that binding does
the closing. It does not: the row is printed **inside the dialog whose own handler closes it**, and while
that dialog is open `Dialog` calls `stopPropagation()` and the guard would decline anyway. The binding is
a genuine backstop for the focus-stolen case, and it is tested — but the copy overstated it.

`design.md` also contradicted itself in consecutive sentences ("does not own `Escape` dismissal at all"
followed by "it owns `Escape` only to close the help surface"). Both fixed: the row now says what is true
from the listener's side, and the design says owning it is a *fallback* rather than the mechanism.

### WARNING 3 — a docstring claimed "exact" key values

`bindings.ts` said `keys` holds "the exact `KeyboardEvent.key` values". `"Space"` is the legacy spelling
no current engine emits; a real spacebar arrives as `" "`. The field is help copy first and `"Space"` is
what platforms call that key in their own documentation. Corrected.

### WARNING 4 — the guard's preferred branch is unreachable under jsdom

`localMeaning.ts:95` prefers `element.isContentEditable`, and **jsdom does not implement it** — verified
empirically (`'isContentEditable' in el` is `false`). Every test therefore exercises the attribute-walk
fallback. The `isContentEditable === true` path is correct by inspection and **has never been run**. No
browser is available here.

### WARNING 6 — two dormant guard branches had no induced case

`contenteditable` and `role="spinbutton"` match nothing in `src` today, which is exactly why a reviewer
would not notice one being removed. Cases added for both, plus the shift rule and the chord rule.

## Detector integrity

**64/64 caught**, exit 0, stable across repeated runs. One of the four cases I added had to be rewritten:
its anchor string did not exist, and the harness reported `ANCHOR NOT FOUND` — the guard was never
applied. The harness was right and the case was wrong, which is MEMORY.md lesson 42 arriving by a
different route.

## Scoped claims

- **`"No motion"` is about vocabulary, not the rendered DOM.** The dialog, help trigger and share button
  reuse `IconButton`, which carries `hover:scale-105`. No M18 line *adds* a transition — `git diff -U0`
  over `frontend/src` finds no added line containing `transition-`, `animate-`, `duration-` or `ease-`.
  The three `transition-` hits in M18-touched files are all on pre-existing lines.
- **There is no motion guard covering `features/shortcuts`, `features/sharing`, `features/search`, or
  `design-system/Dialog.tsx`.** M17's `home-m17-no-motion.test.ts` scopes only to `features/home` plus
  `Shelf.tsx`. The check above was run by hand and is not automated — recorded as a gap, not a pass.

## Not verified — no browser was available

Edge is the only engine present; `playwright`, `cypress` and `webdriver` are all absent. Unverified:

- real `KeyboardEvent.key` values from real keys, so `"Space"`'s legacy branch is untested against any engine;
- real `Tab` focus movement — the trap tests assert the **cycle the code performs**, because jsdom does not move focus on `Tab`. A containment-only assertion would pass on a dialog with no trap at all;
- the `isContentEditable === true` branch (above);
- screen-reader announcement of `aria-activedescendant`, `role="listbox"`, and the dynamically-mounted `role="status"`;
- `navigator.share` OS-sheet cancel semantics and `navigator.clipboard`, both of which need a user gesture;
- that `preventDefault` actually cancels scrolling on Space and the arrows;
- the layout claim at `GlobalShortcuts.tsx:65` that `fixed bottom-32 right-4` clears the compact shell's mini player and bottom nav;
- one stacking detail left unresolved: the combobox popup and the `Dialog` backdrop are **both `z-40`**, so the winner is DOM order.

## Boundaries

`frontend/package.json`, `frontend/package-lock.json`, `frontend/vitest.config.mts`, `frontend/src/data/**`,
`frontend/src/stores/**`, `openspec/specs/**`, `openspec/changes/archive/**`, `.github/**` and
`frontend/tests/architecture.test.ts` are byte-identical to HEAD (`git diff --exit-code` over all of them
returns 0). `frontend/src/features/search/useSearchController.ts` is byte-identical — nothing at all
changed, which is the strongest available form of task 4.5.

`MEMORY.md` **is** modified in this stage: lessons 43 and 44, appended by the orchestrator. That file is
orchestrator-owned and the change is documentation, not code; it is called out here rather than left for a
reviewer to find.

Token usage across all 22 new or modified files resolves to the four declared type-scale members,
`text-pure-white`, `text-mist`, and `text-fog` on two `aria-hidden="true"` icons. `text-body` — the dead
utility — appears nowhere in M18.