# Tasks

## 1. The vocabulary, before any motion uses it

- [x] 1.1 Declare the motion steps as CSS custom properties in one module — a bounded set of durations,
      easings, and travel distances, each named for what it is for rather than how long it is — verify: a
      test reading the declarations and asserting the set is bounded and every entry is named (spec: `motion`
      — "The vocabulary is declared in one place"; "The vocabulary is small").
- [x] 1.2 Assert **every** duration literal in the source is one of the declared steps, so a component
      cannot invent one — verify: a test walking the source tree for `transition`/`animation` declarations
      and failing on any literal that is not a declared step, naming the file (spec: `motion` — "No
      component invents a duration").
- [x] 1.3 Assert the vocabulary transitions only opacity and transform — verify: a test pairing each
      declared step with the properties it may be used on, so a `transition` on `height` or `top` has
      nowhere to come from (spec: `motion` — "Motion is declared only on animatable properties").

## 2. The reduced-motion floor, held by construction

- [x] 2.1 Confirm the application-level `prefers-reduced-motion` rule collapses the declared durations,
      so a motion is reduced without declaring anything — verify: a test asserting the rule's presence and
      its effect on a declared step's computed transition duration (spec: `motion` — "The preference
      collapses every motion").
- [x] 2.2 Assert **no** component defines its own reduced-motion gate, because that would be a second
      mechanism and the global one already covers it — verify: a test over the source tree (spec: `motion`
      — "The reduced-motion rule cannot be narrowed by a component").
- [x] 2.3 Assert no motion is load-bearing: every animated surface presents its information and stays
      operable when its transition is removed — verify: a test per animated surface rendering without
      motion and asserting the content and the controls (spec: `motion` — "A motion is never load-bearing").

## 3. Motion on the named surfaces, and nowhere else

- [x] 3.1 Add entrance transitions to shelves and cards from the vocabulary — verify: a test asserting the
      declared transition on the shelf and card roots (spec: `motion` — "The named surfaces carry motion").
- [x] 3.2 Add hover and tap feedback to interactive cards, keeping every affected control reachable by
      keyboard with a visible focus state — verify: a test asserting the feedback is hover-scoped and that
      focus styling is unchanged by it (spec: `motion` — "The named surfaces carry motion").
- [x] 3.3 Add dialog and sheet transitions to the `Dialog` primitive, **including the exit**, using the
      discrete-transition route rather than a runtime — verify: a test asserting both the enter and the
      leave declaration, and that dismissal is not delayed by the exit (spec: `motion` — "The named surfaces
      carry motion").
- [x] 3.4 Add player and Now Playing transitions from the vocabulary — verify: a test per surface
      (spec: `motion` — "The named surfaces carry motion").
- [x] 3.5 Add Home's content-change transition for **arrival**, and leave removal immediate — verify: a
      test asserting the declaration and that content is present throughout. **Amended during Apply:**
      the leaving half is not achievable here. `tests/home-view.test.tsx` asserts the M17 surfaces are
      gone *immediately* after a filter click, and keeping a leaving copy would double every
      `home-section-*` test id and every landmark on the page. The arrival half is implemented and
      asserted; removal stays immediate, which is the half that keeps "content is present throughout"
      true (spec: `motion` — "The named surfaces carry motion").
- [x] 3.6 Assert the milestone animated **nothing** outside its named set — verify: a test over the source
      tree failing on any motion declaration in a module outside the allowed set (spec: `motion` — "Nothing
      else is animated"; "Motion never loops").

## 4. The detector

- [x] 4.1 Generalise the no-motion detector so its coverage is discovered from the source tree rather than
      typed, closing the gap M18's verification found — verify: a probe module carrying a motion utility
      dropped anywhere under `src/` fails the detector, wherever it is dropped (spec: `motion` — "The named
      surfaces carry motion").
- [x] 4.2 Invert the detector's default so it asserts motion **is** present where the milestone puts it,
      so "no motion anywhere" cannot pass as a milestone that claims to add some — verify: removing one
      named surface's motion fails the detector (spec: `motion` — "The named surfaces carry motion").
- [x] 4.3 Add induced-violation cases for: a component inventing a duration, a motion added outside the
      named set, a component defining its own reduced-motion gate, a motion on a layout property, a dialog
      whose exit is missing, and an animation library added to the manifest — verify: every case caught by
      its named test, and the harness's anchor guard still resolving for all cases.

## 5. The budget

- [x] 5.1 Record the measured pre-milestone baseline as gzipped bytes with the route it was measured on, so
      the ceiling is a measurement and not an estimate — verify: a test asserting the recorded figure
      matches a measured build within a stated tolerance (spec: `performance` — "The recorded ceiling is a
      measurement, not an estimate").
- [x] 5.2 Assert the emitted client bundle does not exceed that ceiling — verify: a test measuring the
      emitted chunks (spec: `performance` — "The ceiling is asserted against a measurement").
- [x] 5.3 Assert an animation library in the manifest fails the budget, so the decision cannot be made
      silently — verify: a test that adds a library name to a parsed manifest and requires a failure
      (spec: `performance` — "A dependency that grows the client bundle is visible").
- [x] 5.4 Record the `framer-motion` measurement and the decision in the evidence, including what would
      reverse it — verify: the evidence file carries the before/after table and the reversal conditions.

## 6. Verification

- [x] 6.1 Run the quality gates from the repository root under Node 24 — verify: each exits `0`, with the
      interpreter version recorded.
- [x] 6.2 Run the suite repeatedly and record the run count, distinguishing any pre-existing flake from a
      regression — verify: the counts recorded, and `tests/podcast-playback-history.test.ts` and
      `tests/settings-ui.test.tsx` named explicitly if either appears.
- [x] 6.3 State plainly what could not be verified here: no transition was seen, no frame or
      responsiveness measurement was taken, and `prefers-reduced-motion` was asserted by test but never
      observed resolving in a real browser — verify: the claim is recorded as a limit, not as a pass.
      **Recorded as a limit, not a pass.** No transition was seen: there is no browser, no automation dependency, and **both the production and Preview Vercel origins sit behind Deployment Protection** — every path on either answers `302` to `vercel.com/sso-api`. No frame or responsiveness measurement was taken, so the roadmap's before/after frame behaviour is *unmeasured*. `prefers-reduced-motion` is asserted structurally and never observed resolving. "Input is never blocked" and "content is present throughout" are enforced structurally instead — only opacity/transform ever transition, a leaving dialog is `inert` and `pointer-events: none` from its first frame, and nothing waits on `transitionend`.
- [x] 6.4 Confirm no dependency was added, in either manifest — verify: `git diff` over both manifests
      returns empty.