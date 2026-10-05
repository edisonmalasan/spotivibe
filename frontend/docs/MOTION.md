# M19 — Motion and interaction polish: the evidence

This file is the written record the milestone's completion criteria ask for: **a decision on
`framer-motion` with measurements behind it**, and **no motion without a reduced-motion path**.
Both are below, with the numbers, the method, and what would reverse the decision.

It is written here rather than under `openspec/changes/m19-motion/` because that tree holds the
OpenSpec artefacts — the proposal, the design, the tasks, and the spec deltas — and those are not
this milestone's to edit.

---

## 1. The dependency decision: **no `framer-motion`**, and no other animation library

### What was measured, and how

A spike branch installed `framer-motion`, imported the parts a real implementation would use —
`motion` for an entrance transition and `AnimatePresence` for an exit — and rendered it from
`HomeView`. **Rendering it matters**: a dependency that is installed but never imported is
tree-shaken away, measures zero, and proves nothing. Rendering from `HomeView` puts it in the
shared client chunk rather than behind a route boundary.

Both builds were measured on the emitted chunks, gzipped at **level 9** — which is what a CDN
applies before serving a file. `next build` under Turbopack prints the route table with **no size
columns at all**, so there was nothing in the build log to read; the measurement is
`node scripts/measure-client-bundle.mjs`, and the same script produced every figure below. Sizes are
reported in kB on the script's own 1 kB = 1024 B convention, and the byte figures in this file are
the script's exact output.

| Measurement | CSS only | With `framer-motion` | Delta |
|---|---:|---:|---:|
| Client JS, total gzipped | 375.8 kB (384,831 B) | 417.2 kB | **+41.4 kB (+11.0%)** |
| Largest single chunk, gzipped | 94.4 kB (96,644 B) | — | — |
| Emitted chunks | 24 | 25 | **+1** |
| `/` first load, gzipped | 221.9 kB (227,266 B, 12 chunks) | 263.4 kB | **+41.5 kB (+18.7%)** |
| `/settings`, `/search`, `/queue`, and the other eight routes | — | — | **0 kB, byte-identical** |

The spike branch was deleted. `framer-motion` is absent from `node_modules`, from
`frontend/package.json`, and from `frontend/package-lock.json`, and the rebuild returned to the
baseline exactly.

### Why CSS can express what this milestone needs

Everything in scope is opacity and transform — neither triggers layout, both are compositor-friendly.
The one thing CSS historically could not do is **animate an exit**, and it now can:

- `@starting-style` supplies the "from" state for an arrival, and
- `transition-behavior: allow-discrete` keeps a leaving element transitionable while its `display`
  flips.

Both are Baseline since 2024, comfortably inside this project's "current evergreen" target. A 41 kB
dependency to reimplement what a `@starting-style` block expresses is not a trade worth making, and
the honest cost of the alternative is **18.7% more JavaScript on the first screen**.

### What would reverse this

Recorded rather than left open-ended. Either of these would need re-measuring, and the `performance`
delta's assertions would fail loudly while the change was being made:

1. **A spring, or a gesture-driven animation that must be interruptible mid-flight.** CSS genuinely
   cannot express either; they are the one thing the vocabulary does not provide.
2. **An exit on an element removed from the DOM, where the discrete-transition route is measurably
   janky in a real browser.** The `Dialog` exit is the case in point today, and it is the case that
   would be measured first.

## 2. What the milestone cost, measured

The budget is not "motion is free because it is CSS" — it is a number, taken from a real build before
and after, in the same way.

| Measurement | Before M19 | After M19 | Delta |
|---|---:|---:|---:|
| Client JS, total gzipped | 384,831 B (375.8 kB) | 385,238 B (376.2 kB) | **+407 B (+0.11%)** |
| Largest single chunk, gzipped | 96,644 B (94.4 kB) | 96,644 B (94.4 kB) | **0 B** |
| Emitted chunks | 24 | 24 | **0** |
| `/` first load, gzipped | 227,266 B (221.9 kB, 12 chunks) | 227,577 B (222.2 kB, 12 chunks) | **+311 B** |
| `/settings` first load | 309,460 B | 309,740 B | +280 B |

Reproduce either figure with:

```bash
cd frontend
npm run build
node scripts/measure-client-bundle.mjs
```

**The +407 bytes are honest and accounted for.** The vocabulary itself is CSS and costs **nothing**:
nine custom properties and three classes, no JavaScript, no measurable byte in any chunk. The 407
bytes are the `Dialog` primitive's leave lifecycle — one piece of state, one `transitionend` listener,
and the safety net that reads the element's own computed `transition-duration`. A CSS exit cannot
survive a React unmount on its own, and task 3.3 requires an exit.

For comparison, the `framer-motion` spike cost **+41.4 kB gzipped (42,394 bytes at this
measurement's 1 kB = 1024 B convention) — roughly a hundred times this milestone's entire cost.**

### 2a. M20 re-recorded the ceiling, and what that cost

M20 (personal-use media downloading) added a download action to four surfaces, which meant adding the
client half of a request. The ceiling in `scripts/measure-client-bundle.mjs` is therefore recorded
again, measured on 2026-10-03 from a build of the M20 tree on the same toolchain:

| Measurement | After M19 (M19's own record) | After M20 | Delta |
|---|---:|---:|---:|
| Client JS, total gzipped | 384,831 B | 387,992 B | **+3,161 B** |
| Largest single chunk, gzipped | 96,644 B | 96,667 B | **+23 B** |
| Emitted chunks | 24 | 25 | **+1** |
| `/` first load, gzipped | 227,266 B (12 chunks) | 230,555 B (13 chunks) | +3,289 B |

**M19's record is preserved, not overwritten.** `PRE_M19_CLIENT_BUDGET` still holds the figures above
and is asserted on its own terms, so a reviewer asking what M20 cost has two records and the delta
rather than one number and a commit message.

**No dependency was added to the client at all.** The 3,161 bytes are first-party source: the overflow
menu shell lifted out of `ResultMenu`, the download affordance it now appears in, and the client half
of the download request. `@distube/ytdl-core` is the milestone's only new dependency and it is reached
only through a dynamic `import()` inside `src/server/download/sources.ts`, a server module —
`tests/download-non-goals.test.ts` asserts both that the import is dynamic and that nothing outside
`src/server/` names the package.

That is the distinction this budget exists to draw, and the re-recording does not weaken it:
`totalGzippedBytes` keeps its 4,096-byte tolerance on top of the new figure, M20 spent less than that
tolerance of its own code, and the `framer-motion` spike would still fail by a factor of ten.

### 2b. M22 re-recorded the ceiling again, and what that cost

M22 (Quick Picks cold start) completed the Quick Picks rail from provider results the Home feed had
already fetched. That is first-party code in `src/features/home/quickPicks.ts` and adds no dependency
and no new import edge to the client graph, so the ceiling is recorded once more — measured
2026-10-05 from a clean `.next` on the same toolchain:

| Measurement | After M19 | After M20 | After M22 | M22's delta |
|---|---:|---:|---:|---:|
| Client JS, total gzipped | 384,831 B | 387,992 B | 389,572 B | **+1,580 B** |
| Largest single chunk, gzipped | 96,644 B | 96,667 B | 96,667 B | **0 B** |
| Emitted chunks | 24 | 25 | 26 | **+1** |
| `/` first load, gzipped | 227,266 B (12 chunks) | 230,555 B (13 chunks) | 232,135 B (14 chunks) | +1,580 B |

**`main` was measured as a control, and it reproduced M20's record byte for byte** — 25 chunks,
387,992 B, largest 96,667 B, `/` 230,555 B across 13 chunks. So these figures are attributable to
M22's own change and not to build drift on this machine. Without that control, a re-record is an
assumption wearing a measurement's clothes.

**Both earlier records are preserved, not overwritten.** `PRE_M19_CLIENT_BUDGET` and
`M20_CLIENT_BUDGET` each hold their own figures and are asserted on their own terms, so each
milestone's cost is measured against the record it replaced. Measuring M20's delta from M19's record
would now report the sum of two milestones and read as though M20 had spent M22's money.

**What was measured about the extra chunk, and what was not.** M22's move is one additional emitted
chunk, which is the same *shape* the declined `framer-motion` spike produced — so the shape alone
distinguishes nothing. Two probes were run, each on a clean build:

- Reverting `HomeView`'s wiring, so that nothing passes `providerTracks` at all and the new code path
  is unreachable, still emitted **26 chunks and 389,564 B**. The split is therefore caused by the code
  being *present*, not by the new behaviour being reachable.
- Replacing the one added `import type { Track }` with a type alias borrowed from `LocalTaste`, to
  remove that import edge entirely, changed **nothing**: 26 chunks, 389,564 B, byte-identical.

Both probes were taken before the rail's description line was reworded to name its third source,
which accounts for the final 8 bytes (389,564 → 389,572). The table above is from the finished tree.

The mechanism behind Turbopack's chunking decision is **not established**, and is not claimed here.
Chasing it further would have meant writing worse code — duplicating the artist and release passes
inline to nudge a chunk graph — so it was left unattributed rather than dressed up as understood.

**What separates this from the spike is size and origin, not shape.** 1,580 bytes is the project's
own source and sits inside the 4,096-byte tolerance that existed before any of this;
`framer-motion` measured **+41.4 kB**, which is more than ten times the whole tolerance and 26 times
M22's entire move. The manifest assertion (`an animation library in the manifest fails the budget`)
continues to be the check that no such library is present at all, so the byte comparison is not the
only thing standing between this record and a weakened budget.

### 2c. M23 re-recorded the ceiling a third time, and the record went *down*

M23 (artist Quick Picks and artwork parity) consolidated `popular-artists` into the Quick Picks
rail. The two were measured on production to be the same seven artists, in the same order, from the
same `groupArtistsByIdentity(trending.tracks)` call, and the `discovery` spec permits one circular
artist section — so one of them was removed rather than kept beside the other. Measured 2026-10-06
from a clean `.next` on the same toolchain:

| Measurement | After M22 | After M23 | M23's delta |
|---|---:|---:|---:|
| Client JS, total gzipped | 389,572 B | 388,571 B | **−1,001 B** |
| Largest single chunk, gzipped | 96,667 B | 96,667 B | **0 B** |
| Emitted chunks | 26 | 25 | **−1** |
| `/` first load, gzipped | 232,135 B (14 chunks) | 231,133 B (13 chunks) | −1,002 B |

**`main` was measured as a control, and it reproduced M22's record byte for byte** — 26 chunks,
389,572 B, largest 96,667 B, `/` 232,135 B across 14 chunks, from `e3c39a4`. So these figures are
attributable to M23's own change and not to build drift.

**A negative delta is the reason the control matters here more than in §2b.** A ceiling left at the
old figure would have reported green: a *smaller* bundle is inside any budget, so every ceiling test
in `motion-budget.test.ts` passes on a stale record. `states what M23 cost, in bytes, and the
direction of the move` therefore asserts the sign and the exact figure, not just the ceiling.

**The reduction is not the whole of what M23 added.** `deriveMixPreviewCollage` in
`src/features/home/mixes/collage.ts` is new first-party code and it is inside these figures — 1,001
bytes is the *net* of that addition against the removed section, not the addition alone. No
dependency was added to the client, and the manifest assertion is unchanged.

**All three earlier records are preserved, not overwritten.** `PRE_M19_CLIENT_BUDGET`,
`M20_CLIENT_BUDGET`, and `M22_CLIENT_BUDGET` each hold their own figures and are asserted on their
own terms, so each milestone's cost is measured against the record it replaced. Measuring M22's
delta from M19's record would report the sum of two milestones; measuring M23's from M19's would
report three.

## 3. No motion without a reduced-motion path

The floor already existed before this milestone: `src/app/globals.css` sets `animation-duration`,
`animation-iteration-count`, `transition-duration`, and `scroll-behavior` under
`prefers-reduced-motion: reduce`, for `*`, `*::before`, and `*::after`, with `!important`, plus a
carve-out that cancels the Now Playing marquee outright.

What M19 changed is that the floor now has something to collapse. Every duration the vocabulary
declares is written **into** a `transition` or `animation` declaration, so the `!important` longhand
overrides it application-wide. **That is why no component declares its own gate**, and why the
vocabulary and the accessibility floor cannot drift apart: a duration that only ever appeared as a
custom property's value would survive the override, and one written into a shorthand cannot.
`tests/motion-vocabulary.test.ts` asserts exactly that, per step.

There is one legitimate exception, and it is not a motion gate:
`src/hooks/usePrefersReducedMotion.ts` exists because the CSS net cannot reach an **imperative**
`scrollTo({ behavior: "smooth" })`. Its one consumer is the lyrics panel, and the one thing it does
with the answer is choose a `ScrollBehavior`. A test asserts that, so a future surface cannot use
the hook to suppress a CSS motion instead.

## 4. Where the motion is, and where it deliberately is not

The named surfaces are the five the roadmap lists — shelf and card entrances, hover and tap feedback,
dialog and sheet transitions, player and Now Playing transitions, and Home's content changes — and they
are enumerated in `src/styles/motionTokens.ts` as `MOTION_ALLOWED` — a module path to the **exact** set
of motion markers it may carry, with the reason it may. The set is finite in both directions: a module
not named may declare no motion, and a module named must carry exactly its markers, so deleting the
motion this milestone added fails just as loudly as adding motion somewhere new.

The one rule worth restating here is the non-goal. **Animating everything is the easiest thing to
lose**, so the milestone is not a programme of animating everything: 32 modules may carry motion, the
ceiling is asserted, and the two state-bound loops this milestone inherited are named with the reason
they were left alone.

Four modules carry motion that predates M19, on surfaces the milestone does not name. Each is recorded
in `MOTION_ALLOWED` with its exact marker:

| Module | Marker | Why it was left |
|---|---|---|
| `components/design-system/Skeleton.tsx` | `animate-pulse` | M1's loading placeholder. It reports that a load is in flight rather than decorating anything, it is pinned by `tests/feedback.test.tsx`, and rewriting M1's placeholder is not this milestone's work. Already reduced-motion-safe by the global floor. |
| `components/design-system/Button.tsx`, `features/mixes/MixList.tsx` | `animate-spin` | The busy indicator on a control that is loading. Same reasoning: state, not decoration. |
| `features/lyrics/LyricsPanel.tsx` | `transition-colors` | M16's synced-lyrics active-line highlight. It is a **colour** transition; expressing it on this vocabulary would mean re-presenting the lyrics panel as an opacity ramp, which is a change to M16's presentation that no M19 requirement asks for. |

### What the vocabulary changed, and why that is a *behaviour* change

Recorded here because the change documents describe M19's edits to existing classes as spelling
normalisation — `transition hover:scale-105` becoming `motion-feedback` — and "the scale in two" reads
as though the scale survived. **It did not.** Two controls changed how they respond to a pointer:

| Control | Before | After | Difference |
|---|---|---|---|
| `Button`'s pill button (`pillButtonClassName`) | `hover:scale-105` | `motion-feedback` → `translateY(calc(-1 * var(--motion-travel-press)))` | scaled to 1.05; now **lifts 2px** |
| `features/search/TopResultCard.tsx`, the track top's play button | `hover:scale-105` | `motion-feedback` | scaled to 1.05; now **lifts 2px** |

That is a change in what a listener sees, not a change in how the class is spelled, and it is
**deliberately kept** rather than reverted:

- `DESIGN.md` — the canonical UI reference for this project — specifies no hover scale on either
  control. The scale was house style, not a requirement, so there is nothing to be un-faithful to.
- A vocabulary whose members disagree with each other is not a vocabulary. Every other control, row,
  and card in the application lifts 2px on hover; keeping the scale on these two would have made the
  pill button the only control in the application that grows.
- Re-adding `hover:scale-105` would *not* restore the old behaviour. Tailwind v4 emits it as the
  standalone `scale:` property inside `@layer utilities`, which composes with
  `.motion-feedback:hover`'s `transform` in `@layer components` — so the control would lift **and**
  scale, which is neither what it did before nor what anything else does.

**What was deliberately not changed, and why.** `IconButton` still carries `hover:scale-105` on its
accent and light tones. That is *not* a conflict — the same layering means it composes with the lift
rather than replacing it — so it was left alone rather than "fixed" under a rule that would have been
wrong. It is recorded as a known asymmetry, not silently normalised.

`tests/motion-surfaces.test.tsx` pins the two controls above, per control rather than
application-wide, so this consequence cannot be reverted or re-applied without a failing assertion.

## 5. What this milestone could not verify here

Stated plainly, because the automated half is strong and the visual half is not.

- **No transition was seen.** There is no browser and no automation dependency in this repository.
- **No frame or responsiveness measurement was taken.** That needs a browser and a trace. The
  roadmap's "before/after frame behaviour" is therefore *unmeasured* — which matters, because
  "motion never blocks input" is enforced structurally (only `opacity` and `transform` are ever
  transitioned, and a leaving surface is `inert` and `pointer-events: none` from its first frame)
  rather than measured.
- **No visual review at either viewport.**
- **`prefers-reduced-motion` is asserted by test but never observed** as a media query resolving. jsdom
  resolves no cascade, so every assertion about the floor is structural: the rule's presence, its
  `!important`, and the fact that every declared duration is written somewhere the rule can override.
- **The production and Preview Vercel origins are both behind Deployment Protection** — every path
  answers `302` to `vercel.com/sso-api` — so neither could be used as a substitute.

The result is a *reviewed* motion system rather than a *seen* one. M20's browser-sensitive work is
affected in the same way, and M21's performance measurement has the same constraint.

## 6. One gap in the specification, recorded rather than papered over

Task 3.5 asks for Home's content change "using the discrete-transition route so a leaving surface is
not removed abruptly". The arriving half is implemented and asserted: the presented stack is keyed on
the filter, so `@starting-style` gives the new content the vocabulary's entrance.

**The leaving half cannot be implemented on Home**, and the reason is an existing M17 contract:
`tests/home-view.test.tsx` asserts that a section dropped by the filter is *not in the document*
immediately after the click. The only way to fade a section out is to keep it mounted for the length
of the fade, which would double every `home-section-*` test id and every section landmark. So the
removal stays immediate — which is the half that keeps the requirement that actually matters true: no
listener loses content to a motion, because no action waits for one. The discrete route
(`transition-behavior: allow-discrete`) is in the vocabulary and is load-bearing on the `Dialog`
primitive, where the leave *is* expressible.

A second, smaller one: the spec scenario "Motion is declared only on animatable properties" says the
properties are "opacity and transform". This milestone also transitions `display`, once, and only ever
with `allow-discrete` — which is a discrete property with no interpolation at all, and therefore cannot
animate a layout. It is listed separately in `MOTION_DISCRETE_PROPERTIES` and asserted separately, so
it can never become a real animation of `display`.