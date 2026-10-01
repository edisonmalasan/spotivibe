# Proposal: M16 — Lyrics and Now Playing enrichment

## Why

Now Playing shows a track's artwork, title, progress, transport, and More Like This, and nothing
that reflects *the song*. Lyrics are the largest missing piece of that surface, and they are the
one feature that binds playback position to something the listener reads.

Lyrix has this and it works: an LRC parser, a binary search for the active line, auto-scroll
following, and a duration-aware LRCLIB lookup. The behaviour is worth taking. The implementation is
not — it is 234 lines of inline styles against a Zustand store, with a Prisma cache and a
separate `API_URL`/`fetchWithAuth` client that do not exist in Spotivibe and must not.

## What Changes

- **A lyrics capability**: an LRC parser, a lyrics provider with duration-aware scoring and
  bounded caching, and a Now Playing panel that highlights and follows the active line.
- **Four distinguishable states** — idle, loading, unavailable, error — because "this track has no
  lyrics" and "we could not reach the provider" are different facts and a listener can act on only
  one of them.
- **Follow-with-an-escape-hatch**: auto-scroll follows playback, and a manual scroll suspends
  following until the listener returns to the live position, so reading ahead is not fought by the
  player.
- **Reset on track change**: a new track never inherits the previous track's cursor, scroll
  position, or fetched lyrics.

Explicitly **not** in scope: translation or romanization, lyrics for podcasts, a lyrics database,
editing lyrics, and word-level karaoke timing. The roadmap already records why translation stays
deferred: it needs a translation service and a per-line data model, neither of which exist.

## Capabilities

### New Capabilities

- `lyrics`: LRC parsing, provider resolution with caching and negative caching, active-line
  selection from playback position, follow-with-override, and the four panel states.

### Modified Capabilities

- `app-shell`: the Now Playing surface gains an optional lyrics panel, and the surface's existing
  content must remain operable when lyrics are present, absent, loading, or errored.

## Impact

- **New**: `frontend/src/lyrics/` (parser, active-line selection), `frontend/src/server/lyrics/`
  (provider, cache wiring), `frontend/src/app/api/lyrics/route.ts`,
  `frontend/src/features/lyrics/` (panel + hook), and `openspec/specs/lyrics/`.
- **Changed**: `frontend/src/app/now-playing/page.tsx` to host the panel.
- **Tests**: new suites for the parser, active-line selection, provider scoring, cache behaviour,
  and the panel's four states; `nowplaying*.test.tsx` updated for the new child.
- **Dependencies**: **none added.** LRCLIB is fetched server-side with `fetch`; no client library
  is introduced.
- **Reuse that matters**: `src/server/music/cache.ts` already provides `createTtlCache` and
  `createInflightDedup`, which is exactly the bounded, database-free caching this needs. Lyrix's
  Prisma cache has no equivalent here and is not wanted.
