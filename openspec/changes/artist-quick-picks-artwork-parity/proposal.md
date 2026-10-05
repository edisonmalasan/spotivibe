# Lyrix-style artist Quick Picks and Home artwork parity

## Why

The user reports that Spotivibe's Home does not behave like Lyrix's in two visible ways: the Quick
Picks rail is filled with the wrong kind of card, and the artwork is missing. Both were investigated
against the live production deployment before anything was written down, and both turned out to be
real defects with measured causes.

This change **intentionally supersedes an earlier approved decision.** M17 and M22 specified — and
M22 shipped, and M22's own roadmap entry recorded as deliberate — that selected languages occupy
Quick Pick slots as `Search` cards. The user has overridden that decision. Selected languages are
**inputs to artist discovery, never Quick Pick content.** Archived M17/M22 artifacts are historical
evidence and are not rewritten; the synced specs and the `ROADMAP.md` M23 row are what supersede
them.

## What is broken, with the measurement

### 1. Languages occupy the artist rail

`quickPicks.ts` derives entries in this order: local artists, local releases, a cold-start stand-in
from provider results, then **one `Search` card per selected language**. The stand-in's limit
reserves room for them:

```ts
const standInLimit = Math.max(0, MAX_QUICK_PICKS - languageCodes.length);
```

Because `MAX_SELECTED_LANGUAGES === MAX_QUICK_PICKS === 8`, the maximum selection fills the rail
with eight `Search` cards and zero artists. Live production, **fresh profile, default language only**:

```
Quick Picks targets: Lumivox, Hazel Aria, Previa, The Weeknd, Ed Sheeran,
                     Swedish House Mafia, Sabrina Carpenter, English
                                                                     ^ Search card
```

Because the reservation always holds one language slot back, the degenerate case is not an edge case
— it is the normal rendering on a brand-new device.

Lyrix uses the language set only as a lookup key for deciding *which artists to offer*
(`PICKS_BY_LANGUAGE[lang]`, iterated over the language `Set`); the languages themselves are never
rendered, and every card is an `ArtistCard`.

### 2. The two artist rails show the same artists

`Popular Artists` derives from `groupArtistsByIdentity(trending.tracks)`. Quick Picks' cold-start
stand-in derives from `groupArtistsByIdentity([...trending.tracks, ...feed.collections.tracks])` —
the same function over a superset of the same input. Measured on production, Quick Picks' artist
targets were a **strict prefix** of Popular Artists': all 7, same order, same image URLs.

`discovery`'s spec permits "at most one circular artist section" and `DESIGN.md` says never to place
two circular sections adjacent, so both rails cannot survive as circular shelves.

### 3. Production blocks its own artwork

`next.config.ts` sets `img-src 'self' https://i.ytimg.com data:` and comments that `i.ytimg.com` is
"track, album, and artist artwork". Real provider artwork is a different host. `pickArtwork()` only
*constructs* the `i.ytimg.com` fallback when a tier supplied none; every provider URL passes through
verbatim. Captured fixtures carry **84 `yt3.googleusercontent.com` matches across 5 files**. Live
production requests only `yt3` URLs, every one `complete: true, naturalWidth: 0` — a *failed* load
(lazy deferral reports `complete: false`).

Cause isolated by controlled experiment, one variable, same browser and same URL:

| injected `img-src` | result |
|---|---|
| none | `ok 120` |
| `'self' https://i.ytimg.com data:` (production's value) | **`ERR`** |
| the same plus `https://yt3.googleusercontent.com` | `ok 120` |

The URLs themselves are valid: the exact production `src` returns HTTP 200 `image/jpeg`, 9,818
bytes, and renders 120x120 when navigated to directly.

### 4. Why the existing guard did not catch it

`tests/security-policy.test.ts` derives permitted origins by scanning `src/**` **source text**.
Provider artwork arrives as opaque data, never as a string in our code, so `yt3` is invisible to it.
**That detector is structurally incapable of failing on this defect and is not evidence of
anything.** It is replaced by one that reads the captured provider fixtures.

## What changes

### Quick Picks becomes an artist rail

Only artists. The `search` and `album` kinds are removed from the rail; no language is ever a card
and no slot is reserved for one. Each card is a circular artist card with real artwork when the
provider supplied it, the artist name, and the `Artist` label, navigating to `/artist/[key]` via the
existing `artistHref` name fallback. Dedupe stays by canonical identity via
`groupArtistsByIdentity`.

### Languages shape candidates instead of becoming cards

Every discovery track is stamped with the language of the seed that produced it
(`discovery.ts`: `language: attempt.seed.language`), so artist candidates carry the language
evidence needed to act on the selection. The selection **orders** candidates: an artist with tracks
in a selected language is a stronger candidate than one whose tracks are all in languages the
listener did not choose. Local evidence still outranks provider results, still issues no request,
and still stores nothing.

This is a preference, not a filter, on purpose: a filter could empty the rail on a device whose
provider results happen to carry no language stamp, which is the dishonest-empty-state outcome
`ROADMAP.md` §21.7 already withdrew once.

### No new provider adapter for artist artwork

The requirement to investigate Lyrix's batched thumbnail endpoint was answered by measurement rather
than assumption: Spotivibe's normalized provider results **already carry artist artwork**, because
`groupArtistsByIdentity` reads `artworkUrl` off the artist's own tracks. Once `img-src` permits
`yt3`, that artwork renders. Lyrix's `/api/artist/thumbnails?names=…` is therefore **not**
reproduced — it is an Express route behind auth, keyed by artist *name*, whose lookup
(`searchArtistThumbnail`) issues an Innertube artists search and returns the first result's
thumbnail **without verifying it is the requested artist**. Spotivibe's approach is
identity-correct by construction because the artwork comes from tracks credited to that artist.

### The two artist rails are reconciled

Quick Picks becomes the single circular artist rail and absorbs `Popular Artists`' content;
`Popular Artists` is consolidated into it, with `homeSections` and the `discovery` spec updated in
the same change. Quick Picks already reads `feed.collections`, which the old rail never did, so no
artist content is lost.

### Artwork parity

`img-src` gains the origins real provider payloads use, derived from the fixtures. Home mix cards
gain honest preview artwork taken from material already on the device — never one provider request
per rendered card, and never a collage presented as a generated mix that does not exist. A generated
mix's cover still comes from that mix's own tracks. Mix generation still happens on activation.

## Impact

- Affected specs: `home-mixes` (Quick Picks requirement rewritten, contradicting scenarios
  removed), `discovery` (artist-rail geometry and the consolidated section), `security` (the policy
  derives its image origins from real payloads).
- Affected code: `quickPicks.ts`, `QuickPicksShelf.tsx`, `HomeView.tsx`, `homeSections.ts`,
  `next.config.ts`, mix card presentation, `tests/security-policy.test.ts`.
- No accounts, authentication, cloud profiles, Supabase, user database, or cross-user filtering.
  No new persisted state. No Lyrix backend.
- **Bundled effect on the client:** the Quick Picks rail loses the language `Search` cards and gains
  language ordering; the CSP change alters one response header and no client bytes. Budget impact
  is measured at the merge commit, not estimated here.