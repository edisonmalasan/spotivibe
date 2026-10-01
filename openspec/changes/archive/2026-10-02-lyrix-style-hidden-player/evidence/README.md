# Evidence: parked player, and the defects the verification pass found

## What the independent verification pass found, and what happened next

An independent read-only pass returned **NOT MERGEABLE** with six criticals, ten warnings, and
seven nits. Four of the six criticals were **detectors that could not fail** — checks that were
green over the defect they existed to prevent. That is the failure mode this repository has now
paid for three times, and the fourth occurrence is why the response was to rewrite the detectors
rather than to adjust the code until they went quiet.

### The four dead detectors, and what each was actually doing

| Dead check | Why it could not fail | Fix |
| --- | --- | --- |
| "the parked host has no tab stop" | The selector listed `a,button,input,select,textarea,[tabindex]` — no `iframe`. And the engine is `vi.mock`ed in that file, so no iframe ever existed. | Selector now includes every focusable element type, and a second test injects a real iframe because the mocked engine cannot produce one. |
| "never collapses to `display:none`" | Matched `/className=\{[\s\S]*?\}"/`. The ternary in `PlayerHost` closes with `}` then a newline, so the pattern had **zero** matches in the file it was written for and the token set was `[""]`. | Reads every string literal, and *requires* the extraction to have found the parked tokens, so an empty extraction fails instead of passing. |
| "exactly one player container" | Reduced to "the source contains `firstElementChild`", which a version that *also* appends a second container every run satisfies. | Asserts an append **count** of exactly 1, and that the append sits inside the `if (!target)` branch. |
| "no keep-alive of a hidden player" | Matched a play call only when inline within 200 characters of a trigger, so any indirection defeated it. | Two links — a trigger reaching a resume in the same scope, and a trigger resolving a resuming declaration by callback name or member call. |

### The two behavioural defects

**The parked player was a keyboard tab stop.** An `<iframe>` is a sequential focus navigation
target, and neither `aria-hidden` on the host nor `pointer-events: none` removes one from the
tab order. Measured in Edge 154: the last tab stop of the whole document was an `IFRAME` inside
the parked host, so a keyboard user tabbed through the entire application and landed in an
invisible video. `tabIndex = -1` now goes on the iframe itself — the host's own `tabIndex`
cannot help a descendant — applied through a `MutationObserver`, because `YT.Player` replaces the
container's contents *after* construction.

**Leaving Now Playing did not re-park.** The host lives in the shell, so navigating to Home
unmounted nothing: a branded 640×360 panel followed the user, and the only escape was playback
stopping entirely. "Off when idle" is not "off when you leave". Now watched with `usePathname`.

### Also corrected from the pass

- A detached engine container is now replaced rather than cached, so a second visit to Now
  Playing finds a live player instead of an empty box.
- The attach effect depends on the docked **boolean** again, so it no longer churns on every
  track change and clear the engine's retry timers.
- The visible host is `z-50`, and the comment says what that actually buys (the five `z-40`
  modals would otherwise tie and resolve under the video on DOM order).
- `openspec/specs/network` is amended: its "banner must not obscure the player" rule was
  unsatisfiable against a transparent 1×1 host, and was left as-is by the first draft.
- "Nothing renders in front of the surface" is rescoped to the visible state, because a parked
  host is skipped by hit-testing entirely and asserting it there is a tautology.
- A spec sentence claiming "the video's own controls are operable" is replaced, since `controls: 0`
  and `disablekb: 1` forbid exactly that.
- The requirement is renamed to **Parked playback surface** rather than keeping "Visible
  compliant" over a body that mandates a 1×1 non-compliant iframe.
- The roadmap's second, contradictory row and two stale "compliant watch link" comments.

## Every detector proven able to fail

Each violation was induced in the real file, the suite run, and the file restored from `HEAD`.
The exact assertion named is recorded, so a failure cannot be attributed to the wrong cause.

| Violation induced | Caught by | Message |
| --- | --- | --- |
| `tabIndex = -1` removed | `playerHost.test.tsx` | `expected +0 to be -1` |
| navigation re-park removed | `playerHost.test.tsx` | `leaving Now Playing must clear video mode: expected true to be false` |
| `hidden invisible` added to the parked class | `release-exclusions.test.ts` | `the parked host must stay laid out, not display-hidden: expected true to be false` |
| `requestAnimationFrame` keep-alive in `startPoll` | `release-exclusions.test.ts` | `parked playback must never be kept alive programmatically` |
| `setInterval(() => this.holdAudioOpen(), 200)` — unmute one call away | `release-exclusions.test.ts` | same assertion |
| `localStorage.setItem("spotivibe.videoMode", …)` in `setVisible` | `release-exclusions.test.ts` | `the video-mode store must not reach localStorage; it is a per-visit view state` |
| detached-container check reverted | `architecture.test.ts` | `a detached container must not be kept` |
| a second container appended per effect run | both suites | `exactly one container may be appended, on first mount` |
| `new (window as …).YT.Player(target, {})` in the host | `release-exclusions.test.ts` | `the host must not construct a player, by any spelling` |

**Two false proofs were caught and corrected while proving the others**, both worth recording
because each produced a confident wrong answer:

1. `$host` is a PowerShell reserved variable. The first probe script assigned to it, read
   nothing, and reported **PASS for every probe** — because the suite failed for an unrelated
   reason. A probe that cannot fail is not a probe.
2. The probe restored with `git checkout -- frontend`, which **reverted uncommitted work** —
   twice, silently. The third run then reported on code that was not the code under test. The
   script now restores only the file each probe writes, and every fix is committed before probing.

### Two limits, asserted rather than assumed

- **An aliased or destructured constructor cannot be detected statically.** `const P = YT.Player;
  new P(target, {})` and `const { Player } = YT; new Player(target, {})` both pass, because
  resolving an alias is what a type checker does. Both are fixtures that expect `false`, so the
  boundary is a decision with a stated cost rather than an unexamined gap. The load-bearing
  assertion is the *count* of construction sites.
- **The keep-alive rule is a heuristic over source structure**, not a proof. It resolves
  same-scope, callback-name, and member-call indirection. A circumvention built from a computed
  name would evade it, and the rule's claim is scoped accordingly.

## Gates, under Node 24.21.0

| | |
| --- | --- |
| `npm run lint` | exit `0` |
| `npm run format:check` | exit `0` |
| `npm run typecheck` | exit `0` |
| `npm test` | exit `0` — **2356 tests** |
| `npm run build` | exit `0` |
| `openspec validate lyrix-style-hidden-player --strict` | valid |
| `openspec validate --specs --strict` | 20 passed, 0 failed |

## Not verified, and not claimed

- **A real browser drive of the parked player.** The tab-stop, navigation, and parked-geometry
  defects were found by a real browser run *before* their fixes; the fixes are covered by jsdom
  tests and by source-level detectors, not by a re-run of that browser check. Whether a 1×1
  `opacity: 0` iframe actually keeps advancing position in a live browser is **not** verified
  here, and the archived M15 evidence suite cannot cover it because the IFrame API does not load
  in this environment. That is the largest open item in this change.
- **The `z-50` stacking against a modal on Now Playing** is reasoned from DOM order, not measured.
- **The constructor-site count** is a static count; it does not see an alias, as above.
