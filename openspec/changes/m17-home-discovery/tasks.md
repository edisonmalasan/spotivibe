# Tasks

## 1. The time-of-day band, before any UI

- [ ] 1.1 Implement `bandForHour(hour)` as a pure function over the four bands — morning, afternoon, evening, late night — with documented half-open boundaries — verify: a test over all 24 hours asserting each yields exactly one band and none yields none (spec: `home-mixes` — "Each hour maps to its band"; "Band boundaries are half-open and cover every hour").
- [ ] 1.2 Make the band reachable only through an injectable clock, defaulting to `Date.now` — verify: a test that classification depends only on the supplied hour, run twice at different instants with one answer, and a test asserting no module in `features/home/` calls `Date.now` or `new Date(` in its band logic (spec: `home-mixes` — "Band selection is a pure function of the hour").
- [ ] 1.3 Map each band to a **seed-term strategy** over the local taste profile, and assert the band changes nothing but those terms — verify: a test that two bands given the same taste produce different seed terms, and a test that the band's only effect is the terms it selects (spec: `home-mixes` — "The band influences only seed selection").
- [ ] 1.4 Assert the band is neither persisted nor sent — verify: a test that no store write is reached from band selection, and a test that a request built from a band carries no time or band value (spec: `discovery` — "The time band is not sent and not stored").

## 2. Named mix cards

- [ ] 2.1 Define the five named mix identities — Top, Discovery, Chill, Night, and per-language — as **seed strategies** over the local taste profile, and a bounded number of language cards — verify: a test over each identity asserting it resolves to a non-empty bounded seed set, and a test that many selected languages still yield at most the documented number of cards (spec: `home-mixes` — "Language mixes are bounded").
- [ ] 2.2 Route every card's composition through the existing `generateMix`, with no card-specific composer — verify: a test that spies the shared generator and asserts a card activation calls it, and a test asserting the module imports no alternative generator (spec: `home-mixes` — "Cards use the one generator, not their own").
- [ ] 2.3 Pass every card name through `isHonestMixName`, falling back to the neutral name — verify: a test per identity asserting the derived name passes the rule, plus a test that a no-signal case yields the neutral fallback (spec: `mixes` — "A name is never more specific than the evidence"; `home-mixes` — "Every card name is honest").
- [ ] 2.4 Assert rendering Home composes nothing and issues no per-card provider search — verify: a test that renders the mix-card region with the provider stubbed and asserts the transport was not called (spec: `home-mixes` — "Cards are not composed on render").
- [ ] 2.5 Show an explained-empty state when a card cannot compose a mix, rather than an inert card — verify: a test that a no-signal activation renders the explanation and starts nothing (spec: `home-mixes` — "An empty mix is explained rather than silently inert").
- [ ] 2.6 Derive a multi-artwork collage cover from a mix's tracks, with a documented fallback for a single-track or empty mix — verify: tests for a multi-track collage, a single-track fallback, and an empty mix (spec: `home-mixes` — implied by the card presentation).

## 3. Quick Picks

- [ ] 3.1 Derive Quick Picks from selected languages, the local listening profile, and liked artists and tracks — verify: a test that the derivation reads only those inputs, with no new stored data (spec: `home-mixes` — "Quick Picks derive from local material").
- [ ] 3.2 Give every entry a kind and a resolvable target, and render it as a control that navigates — verify: a test per rendered card asserting a non-empty target of a recognised kind and a clickable element, and a test that activation navigates to that target (spec: `home-mixes` — "Every Quick Pick navigates somewhere"; "No Quick Pick has an unresolvable target").
- [ ] 3.3 Assert no entry is rendered non-interactively — verify: a test that every rendered entry has a role that is focusable and activatable, so a decorative card fails it.

## 4. The filter

- [ ] 4.1 Implement `All`/`Music`/`Podcasts` as a **selection** over the single `HOME_SECTIONS` list, with each surface declaring its filters — verify: a test per filter value asserting the presented set equals the list filtered by that value, and a test that the union over filters never exceeds the list (spec: `discovery` — "The filter presents a subset of the one section model").
- [ ] 4.2 Fall back to presenting everything for an unrecognised filter value — verify: a test with an unknown value asserting every shelf is presented rather than none (spec: `discovery` — "An unrecognised filter presents everything").
- [ ] 4.3 Assert the filter cannot introduce a section the list does not contain — verify: a test that a section id absent from the list is never presented, under any filter value.

## 5. The time-aware shelf on the surface

- [ ] 5.1 Render the time-aware shelf seeded by the current band, labelled with that band — verify: a test that renders at two different injected hours and asserts the seeded content and the label both follow the band (spec: `home-mixes` — "The shelf reflects the current band"; "The shelf names its band").
- [ ] 5.2 Assert the label asserts no time the clock has not reported — verify: a test that the rendered label is derived from the band rather than from a formatted clock reading.

## 6. The surface

- [ ] 6.1 Wire the cards, Quick Picks, time-aware shelf and filter into `HomeView` without changing the section list's size or its request count — verify: a test that the request count on render is unchanged from before this change (spec: `discovery` — "Cards are not composed on render").
- [ ] 6.2 Assert Home stays compact-viewport usable and the player region unmoved — verify: layout assertions plus the existing shell suites staying green (spec: `discovery` — "Home stays compact-viewport usable").
- [ ] 6.3 Assert mix cards start playback without navigating away, and that one failing card or shelf leaves the rest of Home intact — verify: a test per case (spec: `discovery` — "Mix cards start playback rather than navigating away"; "One failing shelf does not break the feed").
- [ ] 6.4 Add **no** motion: assert this change introduces no animation or transition classes on the new surfaces — verify: a test that the new components' class names contain no `transition-` or `animate-` utility, so M19 can establish one vocabulary deliberately rather than standardising four.

## 7. The detector

- [ ] 7.1 Add induced-violation cases for the load-bearing behaviour above — the band's effect on seeds only, the shared generator, the honest-name rule, composition deferred to activation, the filter's subset property, the unrecognised-filter fallback, and Quick Pick resolvability — verify: every case caught by its named test, and the harness's anchor guard still resolving for all cases (spec: `home-mixes`, `discovery`, `mixes`).

## 8. Verification

- [ ] 8.1 Run the quality gates from the repository root under Node 24 — verify: each exits `0`, with the interpreter version recorded.
- [ ] 8.2 Run the suite repeatedly and record the run count, distinguishing any pre-existing flake from a regression — verify: the counts recorded, and `tests/podcast-playback-history.test.ts` named explicitly if it appears.
- [ ] 8.3 State plainly what could not be verified here: the parked player's live behaviour is still unobserved, and no visual review of Home has been done at either viewport — verify: the claim is recorded as a limit, not as a pass.
