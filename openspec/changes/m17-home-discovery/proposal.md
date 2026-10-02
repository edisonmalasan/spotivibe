# Proposal: M17 — Home discovery enrichment

## Why

Home is the surface a listener sees first, and it is currently the thinnest one in the product. It
has shelves — recently played, trending, made for you, popular artists, smart mixes, genres,
podcasts, collections — and every one of them is a *list of tracks*. Nothing on Home is a **card you
can start**: there is no "Top Mix", no "Chill Mix", no way to say "give me something for right now".

The machinery to do all of that already exists. `generateMix` composes a mix from seeds,
`deriveMixName` names one honestly, `deriveSeedTerms` reads the local taste profile, and
`HOME_SECTIONS` is a single declarative list. So this milestone is **presentation and seed strategy
over existing substrate**, not a new recommendation engine — and saying so is the whole point, because
the obvious way to build "Daily Mixes" is to add a second generation path, and two paths that
disagree is a bug waiting for a user to find.

Lyrix's Home is richer, and the honest summary of why is that it has an account. Every one of its mix
cards is a server-side artefact belonging to a profile. Spotivibe has no profile, so the same
*experience* has to be produced by the same *local* machinery — which is a different problem, not a
smaller one.

## What Changes

- **Daily mix cards.** Named mix cards that start playback, built on the existing generator and
  namer: Top Mix, Discovery Mix, Chill Mix, Night Mix, plus language-aware mixes derived from
  `preferences.languages`. Collage covers where a mix has several tracks.
- **Quick Picks.** A compact artist/content shelf from selected languages, the local listening
  profile, liked artists and tracks, and existing provider results. Every card leads to an existing
  artist, album or search surface — no dead ends.
- **A time-aware shelf.** Morning / afternoon / evening / late night, where the listener's clock
  selects a **seed set and query construction** and nothing else. Their history is not uploaded, not
  sent, and not persisted anywhere new.
- **Home filters.** `All` / `Music` / `Podcasts`, choosing which shelves are presented. One data
  model, three presentations — explicitly not three models.

Explicitly **not** in scope: a server-side recommendation, a taste profile upload, a user-profile
page, new provider types, or any third mix-generation path.

## Capabilities

### New Capabilities

- `home-mixes`: named mix cards, collage covers, and the four time-of-day bands, all derived from
  the existing local generator with an injectable clock.

### Modified Capabilities

- `home`: the Home surface gains mix cards, a Quick Picks shelf, a time-aware shelf, and the
  `All`/`Music`/`Podcasts` filter over one section model.
- `discovery`: the local seed strategy gains time-of-day and named-mix seed selection, so
  discovery is reachable by time and by mix identity without any new provider surface.

## Impact

- **New**: `frontend/src/features/home/mixes/` (card, collage, names, bands),
  `frontend/src/features/home/quickPicks.ts`, `frontend/src/features/home/timeBands.ts`,
  `frontend/src/features/home/homeFilter.ts`, and `openspec/specs/home-mixes/`.
- **Changed**: `frontend/src/features/home/HomeView.tsx`, `homeSections.ts`, `localSeeds.ts`, and
  `frontend/src/features/discovery/` where seed construction is shared.
- **Reused, deliberately**: `generateMix`, `deriveMixName`, `isHonestMixName`, `deriveSeedTerms`,
  `createTtlCache`. No new generator, no new cache, no new repository.
- **Dependencies**: **none added.**
- **Tests**: new suites for band bucketing, mix-card composition and naming, collage derivation,
  filter selection, and Quick Picks link resolution; `home*.test.tsx` extended for the filter and the
  cards; new induced-violation cases.
