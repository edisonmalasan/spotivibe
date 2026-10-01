# Design: M16 — Lyrics and Now Playing enrichment

## Context

See `proposal.md` — Why. What shapes the approach:

- Playback position lives in `playerStore.positionSeconds` and is polled roughly once per second
  while playing. Lyrics follow *that*, not a separate clock.
- The current track's `providerId` is the YouTube video id. It is the only stable key available, and
  the search key is metadata (`title`, `artists`, `durationSeconds`) rather than the id.
- `src/server/music/cache.ts` already provides `createTtlCache` and `createInflightDedup`. Lyrics
  needs both and therefore needs no new persistence.
- `globals.css` already collapses every transition and forces `scroll-behavior: auto` under
  `prefers-reduced-motion`. That is a useful safety net and not sufficient on its own: JS-driven
  scrolling and JS-driven animation are not CSS transitions.
- The Now Playing page has a bottom-padding budget that already clears the persistent player
  region, and a long-title treatment. A lyrics panel is a third sibling in that column.

## Goals / Non-Goals

**Goals.**

- Correct LRC parsing and active-line selection, provable by unit test with real fixtures.
- A provider lookup that prefers synced lyrics and the closest duration, and that cannot be
  amplified into an unbounded fan-out.
- Four states that are genuinely distinguishable.
- Following that yields to the listener.
- No new dependency, no database, no new persistent client state.

**Non-Goals.**

- Translation, romanization, word-level timing, editing, or a lyrics database.
- Lyrics for podcasts.
- A server-side record of who asked for what.

## Decisions

### 1. Parse on the client, resolve on the server

**Decision.** The LRC parser and active-line selection are pure client-side modules over the
fetched strings. The server route resolves *which* lyrics, and returns the raw `syncedLyrics` /
`plainLyrics` strings.

**Why.** Parsing is pure text transformation with no I/O, and keeping it client-side means the
panel needs no round trip to move from loading to rendered, and the parser is unit-testable
without a server. The server's job is the part that needs the network and the cache.

**Alternative — parse on the server and return parsed lines.** Rejected: it makes the route's
response shape depend on a parser that the client then cannot re-use or test independently, and
it moves work to the server that the client must do anyway to render.

### 2. Cache with the existing primitives, including negative caching

**Decision.** Use `createTtlCache` for results and for "not found", with different TTLs — Lyrix
uses 7 days for a hit and 1 day for a miss, and that asymmetry is correct: a miss is worth
retrying sooner than a hit is worth distrusting. Add `createInflightDedup` keyed on video id so
concurrent requests for the same track hit the provider once.

**Why no database.** Spotivibe has no server-side store, and adding one to hold lyrics would be
the single most invasive thing this milestone could do. The existing TTL cache is per-instance and
best-effort, which is the right trade for a derived, reproducible value: a cold instance re-fetches
and loses nothing.

**Why negative caching needs stating.** Without it, a track with no lyrics is re-queried on every
single play, forever. That is a self-inflicted rate-limit problem against a free third-party
service, and LRCLIB asks clients to be polite.

### 3. Title cleaning and artist/title split, taken from Lyrix's behaviour

**Decision.** Port the *behaviour* of `cleanTitle` and `splitArtistTitle` — stripping
"(Official Video)", "| Lyrics", "HD", `ft.` normalisation, and splitting on ` - `, ` – `, ` — `,
` ~ `.

**Why.** This is the part of Lyrix's lyrics service that is genuinely load-bearing: YouTube titles
are noisy and LRCLIB's search is metadata-based, so a title that still says "[Official Video]" does
not match. Lyrix's regexes are the accumulated result of that problem.

**Not copied**: the dual concurrent query (`track_name`+`artist_name` and a free-text `q`) run via
`Promise.allSettled`. Two queries per request doubles provider load for a marginal recall gain, and
M3 established a shared outbound limiter and per-attempt timeout that this milestone inherits
rather than bypasses. One query, then the existing chain discipline.

### 4. The active line is a pure function of (lines, position)

**Decision.** `activeLineIndex(lines, positionSeconds)` is a pure binary search returning the index
of the last line whose time is `<= position`, or `-1` before the first line.

**Why.** Lyrix's `findActiveLine` is already this and is correct. The important part is that it is
**pure** — so the reset-on-track-change requirement is satisfied by construction rather than by
remembering to clear something: a new track has new `lines`, and a position before its first
timestamp yields `-1` with no special case.

**Boundary cases that must be tested, not assumed**: exactly on a timestamp (that line is active),
between timestamps (the earlier line stays active), before the first (`-1`), after the last (the
last), and with duplicate timestamps.

### 5. Following yields to a manual scroll

**Decision.** Auto-scroll centres the active line. A user scroll sets a `following = false` flag
and shows a "back to live" affordance; activating it, or the next line change caused by playback
rather than by the user, restores following.

**Why.** Lyrix's panel scrolls unconditionally, so reading ahead fights the player and the reader
loses. This is the single most obviously *felt* difference between a lyrics panel that is pleasant
and one that is not.

**Reduced motion.** Under `prefers-reduced-motion` the scroll is `behavior: "auto"`, not
`"smooth"`, and the line transition is disabled. The global CSS rule is a net; the JS decision is
the guarantee, and it is asserted by test.

### 6. Announce the active line politely, not as a live region per line

**Decision.** The panel is a list; the active line carries `aria-current="true"`. There is no
`aria-live` region, because a per-second position change announced as a live region is noise for a
screen-reader user.

**Why.** Lyrix renders plain divs with no semantics at all. Better is not more announcement — it
is correct semantics and *less* speech.

### 7. Reuse `providerId` as the cache key, metadata as the search key

**Decision.** Cache and dedupe on the video id. Search LRCLIB with cleaned title, artist, and
duration.

**Why.** They answer different questions. The id identifies *which track this is* for caching; the
metadata is what a lyrics service indexes by. LRCLIB has no YouTube-id lookup, so the id cannot be
the search key — a real constraint, not a preference.

## Risks / Trade-offs

- **[A third-party service is now on the critical path of a surface]** → Bounded timeout, one
  query per request, dedupe, negative caching, and an error state that is *honest* rather than
  blank. Lyrics never block or degrade the rest of Now Playing.
- **[LRCLIB metadata quality varies]** → Duration-aware scoring prefers the closest match, and a
  poor match degrades to plain lyrics or to the unavailable state. A wrong-but-synced lyric is
  worse than a right-but-plain one, which is why plain lyrics remain a first-class outcome.
- **[The wall clock]** → Not used anywhere in this milestone's logic. The active line is a function
  of position, and cache TTLs use the injectable clock `createTtlCache` already accepts. This is
  deliberate: the `podcast-playback-history` flake in this repository is a wall-clock budget
  standing in for synchronization, and the same mistake here would be a repeat.
- **[The panel competes with existing Now Playing content for space]** → The panel is a sibling in
  the existing column and respects the existing bottom padding; it never overlays the player
  region, which the `app-shell` spec forbids.
- **The parked player's live behaviour is still unverified** → Lyrics are driven by
  `positionSeconds` from the store, not by the iframe, so this milestone does not depend on that
  open item and does not close it.

## Migration Plan

1. Parser + active-line selection as pure modules, with unit tests, before any UI.
2. Server provider + cache, with its own tests, before any route.
3. Route handler.
4. Panel + hook, then wire into Now Playing.
5. Reduced-motion and follow-override behaviour, then the four states.

No stored data changes, no migration, no new dependency. Each step is independently revertible.

## Open Questions

None that change the specs, the approach, or the task breakdown.

One implementation detail is deliberately left open: whether the panel is a tab or an always-visible
section below the transport. Both satisfy the spec; the test must not distinguish them, and the
choice should follow what fits the existing column at 390×844, which the implementer can measure.
