# Design: M17 — Home discovery enrichment

## Context

What shapes the approach, all verified in the existing code rather than assumed:

- `generateMix(seeds, …)` composes a mix and returns a `MixOutcome`; `MIX_TARGET_TRACKS` is 20.
  It is the **only** mix path in the application.
- `deriveMixName(input)` names a mix and `isHonestMixName(name)` exists precisely so a name cannot
  claim more than the mix knows. That helper is a strong hint about the house's view of naming: a
  derived name must be defensible.
- `deriveSeedTerms(taste: LocalTaste)` already turns the local profile into bounded seed terms.
- `HOME_SECTIONS` is a single readonly array of `HomeSection` with an `id`, a `kind` drawn from
  `DiscoveryKind | "local"`, and signals. There is one section list.
- A `smart-mixes` section already exists, so M17 is about **what a mix card is and how it is
  reached**, not about adding mixes to a list that has none.

## Goals / Non-Goals

**Goals.**

- Mix cards that start playback, named in a way `isHonestMixName` accepts.
- Four time-of-day bands, selected by an **injectable clock**.
- One section model, three filter presentations.
- Quick Picks that never dead-end.
- No new generation path, no new persisted state, no new repository.

**Non-Goals.**

- A server-side recommendation or any profile upload.
- A user-profile page, new provider types, or a third mix path.
- Transcoding, downloading, or anything from M20.
- Motion beyond what M19 will later standardise; M17 adds *no* animation and leaves that vocabulary
  to M19 rather than inventing one here.

## Decisions

### 1. Mix cards compose through `generateMix`; they do not generate

**Decision.** A mix card is a **view over a mix that the existing generator produces**, with an
identity that selects its seeds. The card holds no tracks of its own.

**Why.** Two generation paths that disagree is a user-visible bug with no obvious cause: the
"Smart Mixes" shelf and the "Top Mix" card would compose differently from the same seeds. The
alternative — a card-specific composer — buys nothing, because the hard part (choosing seeds,
bounding the search, excluding what was just played) is already solved and already tested.

**Consequence.** A card's tracks are produced on activation, not eagerly. A Home that renders eight
mix cards must not fire eight provider searches on mount, so cards expose identity and metadata only,
and a card starts a mix the way the existing smart-mix action already does.

### 2. Named mixes are seed strategies, and the name must be honest

**Decision.** Five named mixes — Top, Discovery, Chill, Night, and per-language — each map to a
**seed strategy** over the local taste profile, and each name is passed through `isHonestMixName`.

**Why.** `isHonestMixName` exists to stop a mix claiming something it cannot support. "Top Mix" is
defensible when its seeds are the listener's own most-played material and "Chill Mix" when its seeds
are the ambient end of what they play. A name derived from a *clock* is not a taste claim at all, so
"time-aware" naming would be a lie in a different way — hence bands name a **mood**, not an hour.

**Not copied:** Lyrix's mix names come from a server profile that knows more about the listener than
this device ever will. A name Spotivibe cannot support is worse than a generic one, and the existing
`NEUTRAL_MIX_NAME` is the honest fallback.

### 3. Time-of-day selects seeds, and the clock is injected

**Decision.** Four bands (morning, afternoon, evening, late night) map to **seed sets and query
construction**. The current time is supplied through an injectable clock, defaulting to
`Date.now`, and no test may read the wall clock directly.

**Why.** "Time-of-day should only influence local seed selection/query construction" is the scope
boundary, and an injected clock is the only way to make it testable at all. This repository already
carries a flake (`podcast-playback-history`) caused by a wall-clock budget standing in for
synchronization; a time-of-day feature that reads the clock in its logic would add a second one.

**Boundaries that matter.** The band never leaves the device: it chooses terms, and the terms go to
the same provider layer every other shelf uses. No timestamp, no band, and no listening profile is
sent anywhere.

### 4. One section model, three presentations

**Decision.** The `All`/`Music`/`Podcasts` filter **selects** from the single `HOME_SECTIONS` array
at render. Each section declares which filters it belongs to, and the mix/time/quick-picks surfaces
declare theirs too.

**Why.** Three divergent copies of the section list is the failure this decision exists to prevent:
they would drift, and the drift would be invisible until a shelf appeared under the wrong filter.
A filter that only ever *removes* sections cannot introduce a section that does not exist, which is
the property worth having.

**Consequence.** An unknown or unrecognised filter falls back to showing everything, rather than
showing nothing. A filter that renders an empty Home because of a bad value is a worse failure than
one that ignores the value.

### 5. Quick Picks resolve to existing surfaces, and the test proves it

**Decision.** Every Quick Pick carries a **kind and a target** that already exists — an artist id, an
album id, or a search query — and the component renders a link built from that. The suite asserts
every rendered card's target is a non-empty resolvable value, and that no card renders as a
non-interactive element.

**Why.** A discovery shelf whose cards go nowhere is worse than no shelf: it looks like the app
recommends things and cannot deliver them. Making resolvability a *test* rather than a convention is
the difference, and it is the same lesson the M16 passes taught about assertions that cannot fail.

### 6. No motion in M17

**Decision.** This milestone adds no animation, and does not introduce a motion vocabulary.

**Why.** M19 exists to decide motion once, against surfaces that exist, and `framer-motion` is
currently absent. A feature that adds its own transitions now would be motion M19 then has to
standardise or remove — the same mistake as a second mix generator, one layer down.

## Risks / Trade-offs

- **A Home that fires many provider requests on mount.** → Cards expose identity only; a mix is
  composed on activation, and the existing TTL cache and limiter apply. The section list is unchanged
  in size, so the request count does not grow with the number of cards.
- **Mix cards could duplicate the Smart Mixes shelf.** → Both compose through `generateMix`, and a
  card's identity is a seed strategy over the same taste data, so agreement is structural rather than
  incidental. The Quick Picks and band surfaces are distinct from both.
- **A band with no local material yet produces an empty mix.** → The empty outcome is shown as an
  explained-empty state, not as a card that silently does nothing, and the neutral name is used.
- **Language mixes for a listener with many languages.** → Bounded to a small number of cards; the
  bound is specified rather than left to whatever the preference list happens to contain.
- **The filter could fork the data model.** → It cannot add a section. The spec scenario for it is
  phrased so that "a section not in the single list" is a failure, not an extension point.

## Migration Plan

1. Band bucketing and seed strategies as pure modules with an injected clock, tested before any UI.
2. Named mix identities and card composition, tested through the existing generator.
3. Collage cover derivation, as a pure function over a track list.
4. Filter selection as a pure function over the section list.
5. Quick Picks derivation, with a link-resolution test.
6. Then the Home surface, and the induced-violation cases for each of the above.

No stored data changes, no migration, no new dependency. Every step is independently revertible.

## Open Questions

None that change the specs or the task breakdown.

One implementation choice is left open, as it was in M16: whether the mix cards sit in their own row
above the shelves or inside the existing section flow. Both satisfy the spec, the test must not
distinguish them, and the implementer should choose by what fits the column at 390×844.
