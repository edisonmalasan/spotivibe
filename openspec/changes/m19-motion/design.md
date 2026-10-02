# Design: M19 — Motion and interaction polish

## Context

| Question | Answer found in the tree |
|---|---|
| Is there a reduced-motion floor already? | **Yes.** `globals.css` sets `animation-duration`, `animation-iteration-count`, `transition-duration` and `scroll-behavior` to near-zero under `@media (prefers-reduced-motion: reduce)`, for every element, with `!important`. A specific carve-out cancels the Now Playing marquee outright. |
| Is there a `prefers-reduced-motion` hook? | **Yes.** `src/hooks/usePrefersReducedMotion.ts`, used by the lyrics panel. |
| Is there a shared vocabulary? | **No.** Every primitive declares its own `transition` / `hover:scale-105`. No duration token exists anywhere. |
| Is motion *absent* from most surfaces? | Deliberately. M17 and M18 both declared "no motion" and deferred it here, on the record. |
| Is the no-motion detector repo-wide? | **No.** `home-m17-no-motion.test.ts` scopes to `features/home` + `Shelf.tsx`. Found during M18's verification. |
| Is `framer-motion` present? | **No**, and after this milestone, deliberately. Measured at **+41.4 kB gzipped total, +41.5 kB on Home's first load (+18.7%)**. |
| What does the project target? | "Current evergreen desktop/mobile browsers". `@starting-style` and `transition-behavior: allow-discrete` are Baseline since 2024. |

## Goals / Non-Goals

**Goals**

- One vocabulary, expressed once, that a component cannot quietly opt out of.
- Every motion has a reduced-motion path, **asserted by test**, so a future motion cannot skip it.
- Motion on the surfaces the roadmap names, and nowhere else.
- The client bundle does not grow, as a requirement rather than an intention.

**Non-Goals**

- Animating everything. The roadmap names this as a non-goal and it is the one most easily lost.
- Long, looping, or decorative motion.
- Anything that costs responsiveness — which cannot be *measured* here, and is recorded as a limit.
- `framer-motion`, or any animation library.
- Converting the five existing hand-rolled dialogs. Only the new `Dialog` primitive is in scope, and only
  for motion.

## Decisions

### 1. No `framer-motion` — measured, not argued

The measurement is in the proposal. What matters for the design is that the decision is **reversible on
evidence** rather than on opinion: the `performance` delta below fails the build if motion ever starts
costing JavaScript, so a future spring or gesture requirement cannot be met by quietly adding the library.

### 2. The vocabulary is CSS custom properties, not JavaScript

Durations and easings live in `:root` as custom properties. That choice is what makes decision 1 true
rather than approximately true: a JS-based motion system would need a runtime to read the preference, and
the natural place for that runtime is a library.

The global reduced-motion rule already collapses durations, so a custom property used in a `transition`
is collapsed too — **the vocabulary inherits the accessibility floor for free**, with no per-component
gate. That is a real architectural consequence and the reason the floor is enforced globally rather than
per component.

### 3. Entrances and exits are CSS, including exits

Exits are the honest test of whether a library is needed. `@starting-style` supplies the "from" state and
`transition-behavior: allow-discrete` keeps a removed element transitionable while `display` flips. Both
are Baseline since 2024. **The one motion the vocabulary does not provide is a spring or a
gesture-following drag**, which CSS genuinely cannot express and which this milestone does not need.

### 4. Motion is scoped to named surfaces, and the scope is a list

The roadmap names six places. They are enumerated in `motionTokens` as the allowed set, and the vocabulary
test asserts that a duration is either one of the declared steps or is not in the file at all. That is
what makes "one vocabulary" checkable rather than aspirational: a component that invents `220ms` fails.

### 5. The detector learns the whole source surface

M17's guard had to be told the module list, and M18's verification found a module it did not cover. The
replacement walks the source tree the way the M16/M17/M18 detectors do, so a new module cannot be left out
by omission. It also inverts its default: it now asserts that motion **is** present where the milestone
puts it, so "no motion anywhere" cannot pass as a milestone that claims to add some.

### 6. Motion never blocks input

Every transition is on `opacity` and `transform` only. Neither triggers layout, and both are compositor-
friendly. This is a stated constraint rather than a convention, because a `transition` on `height`,
`width`, `top`, or `margin` is the ordinary way motion gets expensive — and the one thing this milestone
cannot measure for itself.

## Risks / Trade-offs

| Risk | Trade-off accepted |
|---|---|
| **Motion cannot be seen here.** No browser, and both production and Preview origins sit behind Vercel Deployment Protection. | Accepted and recorded. The automated half is strong; the visual half is a limit the evidence states rather than hides. M20's browser-sensitive work is equally affected. |
| `allow-discrete` needs a 2024 Baseline browser. | The project targets current evergreen. An older browser gets the element appearing and disappearing without the transition — degraded, not broken. |
| The vocabulary's "one duration set" could be gamed by declaring a duration per component. | The test requires every duration literal in a component to be a declared step, so declaring more steps means changing the vocabulary, which is reviewable. |
| Hover feedback is unavailable on touch. | Hover feedback is never the only affordance: every control it decorates is reachable by keyboard and by tap, and its focus state is already globally visible. |
| Custom-property durations do not animate smoothly when the property itself changes. | The vocabulary is used in `transition` declarations against animatable properties only. Verified by the token test, which pairs each duration with the properties it is permitted on. |

## Migration

None. No store, no schema, no route change, no new dependency. CSS custom properties in a stylesheet and
`transition` declarations on existing class names.

## Open Questions

- Whether the help trigger's `fixed bottom-32 right-4` placement is right was left unresolved by M18 for
  want of a rendered layout. This milestone cannot answer it either, and it is carried to M21 rather than
  guessed at.
- Whether the search combobox popup should animate its height is **deliberately not answered**. Animating
  height is exactly the layout-cost property decision 6 rules out, so the answer is no unless the popup is
  restructured — which is not this milestone's work.