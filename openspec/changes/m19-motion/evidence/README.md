# M19 — Apply stage evidence

Recorded 2026-10-03. Node `v24.21.0`, npm `11.19.0`, Windows/PowerShell, from the repository root.

## Gates

| Gate | Exit |
| --- | --- |
| `npm run lint` | 0 |
| `npm run format:check` | 0 |
| `npm run typecheck` | 0 |
| `npm run test` | 0 |
| `npm run build` | 0 |
| `lyrics-induced-violations.mjs` | 0 — **70/70 caught**, stable across repeated runs |
| `openspec validate m19-motion --strict` | 0 — valid |
| `openspec validate m19-motion --specs --strict` | 0 — 24 passed, 0 failed |

## The dependency decision, measured

A spike branch installed `framer-motion`, imported `motion` and `AnimatePresence`, and rendered them
from `HomeView` so the library landed in the shared client chunk rather than being tree-shaken away.
Both builds measured on the emitted chunks, gzip level 9.

| Measurement | CSS only | With `framer-motion` | Delta |
| --- | ---: | ---: | ---: |
| Client JS, total gzipped | 375.8 kB | 417.2 kB | **+41.4 kB (+11.0%)** |
| `/` first-load gzipped | 221.9 kB | 263.4 kB | **+41.5 kB (+18.7%)** |
| The other ten routes | — | — | **0 kB, byte-identical** |

**Decision: no `framer-motion`.** The spike branch was deleted; it is absent from `node_modules`,
`package.json` and `package-lock.json`, and the rebuild returned to 375.8 kB exactly.

**Reversed on evidence, not opinion:** an interruptible spring or a gesture-following drag would need
re-measuring. The bundle budget fails loudly if motion ever starts costing JavaScript.

## What motion actually cost

| Measurement | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Client JS, total gzipped | 384,831 B | 385,238 B | **+407 B (+0.11%)** |
| Largest single chunk | 96,644 B | 96,644 B | 0 B |
| Emitted chunks | 24 | 24 | 0 |
| `/` first load | 227,266 B | 227,577 B | +311 B |
| `/settings` first load | 309,460 B | 309,740 B | +280 B |

The vocabulary is CSS and costs **no JavaScript at all**. The +407 B are the `Dialog` leave lifecycle:
one piece of state, one `transitionend` listener, and a computed-duration safety net — which a CSS exit
needs, because the element must stay mounted through its leave.

**This attribution is prose, not a measurement.** The spike branch is deleted and no pre-M19 build is
retained, so the 407 B cannot be re-derived per-component. The totals are reproducible; the split is
not. Recorded rather than asserted.

## Independent verification

Returned **`NOT MERGEABLE`**: 4 criticals, 6 warnings. Two criticals were defects in this milestone's
own spec amendments, and one was an obligation that nothing enforced. All resolved.

### The two that were mine

**A binding scenario's text is what a test is written against.** Two requirements were amended during
Apply to admit two inherited state-bound loops and a 407-byte allowance — and both
`#### Scenario:` lines were left asserting the opposite. A suite passed that was testing the reverse
of the scenario it claimed to cover. Both scenario texts are now amended to match.

**A SHALL with no assertion behind it is a comment.** The `allow-discrete` obligation added with
amendment #1 was enforced by a test that skipped `property === "transition"` — the only form `display`
is written in. Removing `allow-discrete` changed **nothing across 7 test files**. The skip is now
narrowed, and the same mutation fails:

```
AssertionError: styles/motion.css: transition: display var(--motion-surface) animates a
  discrete property without allow-discrete: expected [ 'display', 'var(--motion-surface)' ] to
  include 'allow-discrete'
```

### The others

- **Inline styles escaped the vocabulary rule.** A component could write
  `style={{ transitionDuration: "220ms" }}` and pass. The walker now reads inline object literals
  and `style="…"` attributes, and reports the file. *Residual hole, stated in the helper's own doc:*
  `style={helper(flag)}` and a hoisted `const s = { transitionDuration: "220ms" }` resolved through
  a variable resolve to no declarations — closing that means evaluating the module.
- **An unrecorded behaviour change.** The pill button and the search play control changed from
  `hover:scale-105` to a 2px lift. Recorded in `docs/MOTION.md` as a behaviour change, not spelling,
  and pinned by a test. Kept rather than reverted: `DESIGN.md` specifies no hover scale on either
  control, so nothing is un-faithful to, and re-adding the class would not restore the old behaviour
  anyway — Tailwind v4 emits it as standalone `scale:` in `@layer utilities`, which composes with
  `.motion-feedback:hover`'s transform.

## Mutations proven able to fail

Six M19 induced cases, each caught by the implementation agent's own mutations; five more by the
verifier; three more below. All restores hash-proven.

| Mutation | Result |
| --- | --- |
| `allow-discrete` dropped from the display transition | **1 failed** (orchestrator, re-run after repair) |
| a component invents a duration | 4 assertions failed |
| motion outside the named surfaces | 2 assertions failed |
| a component gates its motion on reduced motion | 1 assertion failed |
| a motion transitions a layout property | 2 assertions failed |
| the dialog's exit never runs | 2 assertions failed |
| an animation library in the manifest | 1 assertion failed |
| the inline-style reader broken | 2 assertions failed |
| `hover:scale-105` re-added, and 407→406 in the docs | 2 assertions failed, 2 files |

## Recorded, not fixed

- **The size half of the budget skips in CI.** `.github/workflows/ci.yml` runs `npm test` **before**
  `npm run build`, so six assertions that need a build report skipped and the run reports green for a
  file whose headline is a budget. Disclosed in the file header. Fixing it means changing CI, which is
  repository governance and therefore out of scope for this milestone. The manifest and import rules
  — the "no animation library" half — are unconditional and do run in CI; verified by hiding the
  chunk directory and observing `11 passed | 6 skipped` with the manifest assertions among the 11.
- **An animation library not on the 17-name list** is caught only by the size rule, and so slips past
  in CI. Narrow, and stated in the test's own comment.

## Not verified — no browser was available

Only Edge is installed, no browser-automation dependency exists, and **both the production and Preview
Vercel origins sit behind Deployment Protection** — every path on either answers `302` to
`vercel.com/sso-api`. So: **no transition was seen**, no frame or responsiveness measurement was
taken, `prefers-reduced-motion` was never observed resolving, and no layout was reviewed at either
viewport. The result is a **reviewed** motion system rather than a **seen** one.

What could be made structural instead of visual was made structural: only `opacity` and `transform`
ever transition (so nothing triggers layout), a leaving dialog is `inert` and `pointer-events: none`
from its first frame, and nothing waits on `transitionend`.

## A hazard worth knowing

Killing `lyrics-induced-violations.mjs` mid-case leaves its mutation **applied** — the harness
restores in a `finally`, which a killed process never reaches. The next run then reports
`69/70 … ANCHOR NOT FOUND`, which reads as a broken detector and is actually a corrupted tree.