# Proposal: M19 — Motion and interaction polish

## Why

Spotivibe has motion, and it has *inconsistent* motion. `globals.css` collapses every animation and
transition under `prefers-reduced-motion` — a real, load-bearing accessibility floor — and individual
primitives carry their own `transition` and `hover:scale-105` declarations. But there is no shared
vocabulary: a duration chosen in one component has no relationship to a duration chosen in another, and
nothing in the repository states what a motion is *for*.

Two milestones have now deferred motion on the record rather than doing it badly. M17 added surfaces and
declared "no motion in M17", noting that M19 should "establish one vocabulary deliberately rather than
standardising four". M18 found that the existing no-motion guard covers only `features/home`, so nothing
stops motion appearing in `features/shortcuts`, `features/sharing`, `features/search`, or `Dialog.tsx`.
Those two debts point at the same missing thing, and this milestone is where it gets paid.

And the milestone's stated centre of gravity is a dependency decision, not a pile of animations.

## The dependency decision: **no `framer-motion`**

The roadmap says this milestone must answer whether `framer-motion` is justified, that the default
expectation is CSS-only, and that adding the dependency requires evidence CSS cannot express what is
needed. So the question was measured rather than argued.

**Method.** A spike branch installed `framer-motion`, imported the parts a real implementation would use
— `motion` for an entrance transition and `AnimatePresence` for an exit — and rendered it from
`HomeView`, so the library landed in the shared client chunk rather than being tree-shaken away. A
dependency that is installed but never imported would have measured zero and proved nothing. Both builds
were measured on the emitted chunks, gzipped at level 9, because that is what a CDN serves.

| Measurement | CSS only | With `framer-motion` | Delta |
|---|---|---|---|
| Client JS, total gzipped | 375.8 kB | 417.2 kB | **+41.4 kB (+11.0%)** |
| `/` first-load gzipped | 221.9 kB | 263.4 kB | **+41.5 kB (+18.7%)** |
| `/settings`, `/search`, `/queue`, and the other eight routes | — | — | **0 kB, byte-identical** |
| Chunk count | 24 | 25 | +1 |

The cost is real, it is confined to the routes that render it, and it is paid on Home — the first
surface a listener sees.

**Why CSS can express what this milestone needs.** Everything in scope is opacity and transform on a
compositor-friendly property: shelf and card entrances, hover and tap feedback, dialog and sheet
transitions, player and Now Playing transitions. Exit animations — the one thing CSS historically could
not do — are now expressible with `@starting-style` and `transition-behavior: allow-discrete`, both
Baseline since 2024 and comfortably inside this project's "current evergreen" target. **A 41 kB
dependency to reimplement what a `@starting-style` block expresses is not a trade worth making**, and
the honest cost of the alternative is 18.7% more JavaScript on the first screen.

**What would reverse this.** Recorded rather than left open-ended: a spring or gesture-driven animation
that must be interruptible mid-flight, or an exit transition on an element removed from the DOM, where
the discrete-transition route is measurably janky in the browser. Either would need re-measuring, and the
`performance` delta below would fail loudly.

The spike branch was deleted; `framer-motion` is absent from `node_modules`, from `package.json`, and from
`package-lock.json`, and the rebuild returned to 375.8 kB exactly.

## What Changes

- **One motion vocabulary.** A single place defining durations, easings, and the distance a transition
  travels — so a 120 ms hover and a 180 ms dialog are two points in one system rather than two habits.
  Expressed as CSS custom properties, so it costs no JavaScript.
- **Every motion gated on `prefers-reduced-motion`, asserted by test.** The global floor already exists;
  what is missing is a test that fails when a new motion is added without one. A motion without a
  reduced-motion path is a defect, not a preference.
- **Motion where it earns its place**, on the surfaces the roadmap names: shelf and card entrances, hover
  and tap feedback, dialog and sheet transitions, player and Now Playing transitions, and Home's content
  changes. Deliberately not everywhere — the roadmap's own non-goal is animating everything.
- **The M18 guard gap closed.** The no-motion detector learns to cover the whole source surface, so a
  motion utility cannot land outside `features/home` unnoticed.
- **A bundle budget, as a requirement.** Motion is CSS, so it must stay free at the client: the measured
  baseline becomes an assertion rather than a memory.

## Impact

- **Affected specs:** `motion` (new), `performance` (one added requirement), `pwa` and `app-shell` are
  **not** modified.
- **All deltas are `ADDED` only**, as in M18 — nothing existing is replaced, so the Sync stage has no
  lossy-merge surface.
- **New dependencies:** none. No `framer-motion`.
- **No migration, no store, no schema.**
- **Risk, stated plainly:** motion cannot be *seen* from this environment. The automated half is strong —
  every motion has a reduced-motion test, the vocabulary is asserted to be used rather than reinvented,
  and the bundle budget fails if anything grows. The half that is not available is whether any individual
  transition looks or feels right, which needs a browser at both viewports.

## What this milestone cannot verify here

Recorded now rather than discovered later, because it shapes what the evidence file has to say:

- **No frame or responsiveness measurement.** The roadmap asks for before/after frame behaviour. It
  needs a browser and a trace; no browser automation dependency exists in this repository and the
  production and Preview origins are both behind Vercel Deployment Protection.
- **No visual review at either viewport.**
- **`prefers-reduced-motion` can be asserted by test but not observed** as a media query resolving in a
  real browser.

These will be recorded as limits. They do not block the milestone's stated completion criteria — a written
decision with measurements behind it, and no motion without a reduced-motion path — but they do mean the
result is a *reviewed* motion system rather than a *seen* one, and the evidence will say so.