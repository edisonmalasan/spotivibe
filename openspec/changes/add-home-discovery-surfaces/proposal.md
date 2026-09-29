# Proposal: Home, discovery, trending, languages, and curated surfaces

## Why

Spotivibe has no discovery surface: `/` is still the M1 placeholder ("Trending songs" skeletons plus "Made for you" → "Nothing here yet"), and two already-shipped local datasets have zero consumers — `Preferences` (including `languages` and `onboardingComplete`) and `listeningHistory` (no writer exists). M8 is the next eligible roadmap objective, and without it a fresh user lands on an empty page while a returning user's likes, playlists, and language choices influence nothing. Trending and curated content must also be produced *without* accounts, cloud profiles, or any official chart claim, per the permanent product constraints.

## What Changes

- Replace the Home placeholder with a DESIGN.md-driven feed of horizontal card shelves: Continue/Recently Played (only when local history exists), Trending Now, Made For You, Smart Mixes preview, Popular Artists, genre discovery, podcast preview, and curated collections.
- Enforce DESIGN.md's geometry rhythm: square shelves and circular shelves never sit adjacent, and Home keeps the 5-column horizontal carousel layout.
- Add a **discovery feed API** (`GET /api/discover`) that composes curated seed queries through the existing provider tier chain, tolerates partial tier failure, and stamps each returned track with the language of the seed that produced it — no new provider capability, no credentials, no server-side user profile.
- Add a curated static seed catalog (37-language catalog, genre seeds, podcast seeds, collection seeds) plus round-robin interleaving so multi-language feeds stay mixed instead of one language dominating.
- Add first-run **language onboarding** and a Settings control to change languages later, both persisting through the existing `Preferences` repository.
- Record listening events (track identity, timestamp, source context) when playback starts, so Recently Played has a local data source; meaningful-play thresholds, stats, and streaks remain M11.
- Group returned tracks into artist shelves and present language/genre exploration on a new `/discover` route; artist tiles refine search (artist pages are M9).
- Make every shelf independently resilient: one failed provider request degrades that shelf, never the page.

## Capabilities

- **New Capabilities**:
  - `discovery` — the discovery feed contract, curated seed catalog, language onboarding/persistence, interleaving, Home shelves, Discover surface, recently played, and per-shelf failure/offline behavior.
- **Modified Capabilities**:
  - `music-provider` — adds the discovery-feed resolution contract (query-driven seeds through the same fixed tier chain, language attribution, per-seed failure tolerance, metadata-only) alongside the existing search and playlist contracts.

## Impact

- **New server code**: `frontend/src/server/music/discovery.ts` (seed composition, per-seed chain execution, merge/dedupe) reusing `runChain`, `outboundLimiter`, `InflightDedup`, and the TTL cache; new route `frontend/src/app/api/discover/route.ts`.
- **New client code**: `features/home/` (Home feed, shelf composition), `features/discover/` (genre/language surface), `features/preferences/` (preferences store, onboarding, language picker), `features/history/` (listening-event recorder), `features/recommendations/` (local taste seeds, interleave helper), `components/recommendations/` (shelf rail, artwork-capable cards).
- **Existing code touched**: `app/page.tsx` (replaced), `app/settings/page.tsx` (language control), `stores/` (new `preferencesStore`, `historyStore`; player start path gains event recording), `components/design-system/AlbumCard.tsx` + `ArtistCard.tsx` (optional artwork), `tests/routes.test.tsx` (Home placeholder assertions), `tests/architecture.test.ts` (new layering rules).
- **No new dependencies, no new IndexedDB store, no new backup dataset, no schema migration** — the history and preferences stores already exist, so the `architecture.test.ts` store/backup whitelists stay unchanged.
- **Out of scope (later milestones)**: official chart sources, artist/album pages (M9), radio/autofill and deep taste scoring (M10), Smart Mix identity/refresh semantics and stats (M11), podcast category filtering (M12), offline shell/service worker (M13), and the DESIGN.md sidebar footer language selector (deferred: languages are reachable via onboarding and Settings).
