# Proposal: Artist pages, album pages, Now Playing, and related content

## Why

Spotivibe has no browsing graph. Every artist or album reference in the product still resolves to a text search — the M8 Home artists shelf links to `/search?q=…`, and the M5 search tiles refine the query — so a listener cannot browse an artist's catalogue, see their releases, or continue from the track they are hearing. M9 is the next eligible roadmap objective and the two REQUIRED additions in the scope matrix ("First-class Artist pages", "First-class Album pages") depend on it. It must also be built on the same accountless, keyless, query-driven foundation as M3/M8: no browse endpoints exist at any tier, and inventing undocumented ones would violate the provider-abstraction rule.

## What Changes

- Add a **catalog resolution API** built entirely on the existing tier chain: `GET /api/artist` (artist identity, popular tracks, related artists, releases) and `GET /api/album` (release metadata, ordered tracks), plus `GET /api/similar` for More Like This. Each composes curated query seeds through the same `runChain`/normalize/filter/score/dedupe pipeline and derives the structured entity views from one resolved result set — no new provider capability, no credentials, no stored profile.
- Add **artist pages** at `/artist/[key]`: identity and artwork when available, popular tracks with per-row play and like, releases, related artists, a local "liked tracks by this artist" section computed on-device, and a "Start artist radio" action that begins playback seeded by that artist.
- Add **album pages** at `/album/[key]`: artwork, title, artist, available release metadata, ordered track list, play/shuffle, per-track like, and add-to-local-playlist through the existing picker.
- Route keys tolerate incomplete provider metadata: a provider entity id when the tier supplied one, otherwise a normalized name/title slug; unknown keys yield a recoverable not-found state.
- Upgrade the **Now Playing surface** with an artwork-derived background, a long-title marquee that respects `prefers-reduced-motion`, and a More Like This shelf — while keeping it and the mini-player bound to the same store/player state.
- Every catalog surface degrades gracefully when YouTube metadata is incomplete and never requires a cloud user profile.

## Capabilities

- **New Capabilities**:
  - `catalog` — artist pages, album pages, and related content (More Like This), including their local-only signals, playback entry points, degraded-metadata behavior, and recovery.
- **Modified Capabilities**:
  - `music-provider` — adds the entity-resolution contract (artist, album, similar) alongside the existing search, playlist, and discovery-feed contracts.
  - `app-shell` — extends the Now Playing surface requirement with the artwork-derived background, marquee, and More Like This shelf.

## Impact

- **New server code**: `frontend/src/server/music/catalog.ts` (seed composition + entity derivation) and routes `frontend/src/app/api/artist/route.ts`, `api/album/route.ts`, `api/similar/route.ts`.
- **New client code**: `features/artist/` (ArtistView, artist API, artist key helpers), `features/album/` (AlbumView, album API), `features/related/` (More Like This shelf), `components/artist/` and `components/album/` presentation pieces, plus new routes `app/artist/[key]/page.tsx` and `app/album/[key]/page.tsx`.
- **Existing code touched**: `app/now-playing/page.tsx` (background, marquee, shelf), the M5 search artist/album tiles and M8 Home artist cards (link to the real pages), `features/search/ResultMenu.tsx` (go-to-artist/go-to-album target real routes), and the architecture test suite (new layering rules).
- **No new dependencies, no new IndexedDB store, no schema migration, no new backup dataset** — "liked tracks by this artist" is derived from the existing liked dataset.
- **Out of scope (later milestones)**: continuous radio refill, played-ID dedupe, and queue autofill (M10); Smart Mix identity, stats, and streaks (M11); podcast category work (M12); offline shell (M13); artist/autoplay asset optimization beyond what M14 schedules. M9's "Start artist radio" seeds playback from the artist feed; M10 upgrades it into a self-refilling radio.
