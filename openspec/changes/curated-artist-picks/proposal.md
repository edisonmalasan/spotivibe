# Proposal — M35: port Lyrix's curated popular artists into the Quick Picks rail

## Why

**Lyrix's Quick Picks are a curated, per-language list of popular artists. Spotivibe's are derived from
what the listener has played and from whatever the provider returned.** Lyrix's rail is never empty and
never depends on the network; Spotivibe's can be.

That gap is the whole of this change, and it is not hypothetical. `deriveQuickPicks` has exactly three
sources today — explicit first-run picks, local material, and provider results as a cold-start
stand-in — and when all three are empty the rail is empty, the first-run picker has nothing to offer,
and the listener is told *"We couldn't find any artists yet."* M34 spent a milestone working around
that dead end with a time bound and a copy change, and the empty state is still reachable.

Lyrix solved the same problem in the simplest way available: a hardcoded list of well-known artists
per language, chosen so the rail always has something worth tapping.

## What Lyrix actually does

`frontend/src/components/recommendations/QuickPicks.tsx` in `aryanjsx/Lyrix` holds a
`PICKS_BY_LANGUAGE` map — **11 languages, 39 artists** — each entry a `{ label, query }` pair. The
component:

- concatenates the lists for the selected languages, and falls back to `hindi + english` sliced to 10
  when no language is selected;
- renders each as a circular artist card with a **gradient and the artist's initial** when no thumbnail
  is available, and fetches thumbnails in a batch from `/api/artist/thumbnails?names=…`;
- navigates to `/artist/${slugify(label)}` — **by name**, with no provider identity anywhere.

The backend resolves that name at request time: `deslugify(slug)` → `searchInnertube("<name> songs")`.

## What is ported, and what is not

**Ported — the behaviour and the artist names.** A curated per-language list of popular artists, used
as a source of Quick Picks candidates.

**Not ported, with the reason:**

| Lyrix | Why not |
|---|---|
| Its `ArtistCard` (Tailwind + framer-motion) | `ROADMAP.md` §9.2: *"Lyrix branding/UI components as final Spotivibe UI"*. Spotivibe's `ArtistCard` from `DESIGN.md` is used. |
| Its separate **"Popular Artists"** section | The `discovery` spec says *"no separate Popular Artists section SHALL render beside it"* — Quick Picks is the feed's single circular artist section. The artists go **into** that rail. |
| `/api/artist/thumbnails` and `searchArtistThumbnail` | The `home-mixes` spec says the derivation *"SHALL issue no request of its own to obtain"* artwork. The curated entries carry no artwork and render the existing placeholder. |
| Its name-slug artist route | Spotivibe's `/artist/[key]` **already resolves a normalized text key** — `artistRequestKey` returns `{ name }` for anything that is not a provider id, and `artistHref` round-trips it. No route change is needed. |
| `fetchWithAuth`, `API_URL`, the Express backend | §9.1 and §9.2: Spotivibe is one Next.js application with no account client. |
| `ARTIST_GRADIENTS` | The app has its own artist placeholder. |

**The data is copied, so it is attributed.** `ATTRIBUTION.md` rule 2 requires an MIT notice on the file
and a row in the derived-files table; rule 1 prefers independent reimplementation, and the *behaviour*
is independently reimplemented — the artist **names** are Lyrix's data, and pretending otherwise would
be the dishonest option.

## What changes in Spotivibe

**The curated list becomes a source of artist candidates in `deriveQuickPicks`**, and the rail is
completed from it.

**Precedence — the evidence order is preserved and local evidence is never displaced:**

1. **Explicit first-run picks** — the only entries the listener chose by hand. Unchanged, still first.
2. **Local material** — liked tracks and plays. Unchanged, still ahead of everything inferred.
3. **Curated popular artists** — *new*, shaped by the selected languages.
4. **Provider results** — unchanged: still only when the device holds no local material.

**The rail is never empty.** With the curated source in the chain, a device with no picks, no local
material and a failing provider still gets a full rail of popular artists for its language — and the
first-run picker has real artists to offer instead of *"We couldn't find any artists yet."*

**Language shaping becomes literal.** The rail's own description already says *"Artists from what you
have played, your languages, and what is playing now."* Today "your languages" only *reorders*
candidates that the provider happened to return. With the curated source, the selected languages
determine **which artists are on the rail at all**.

## The three constraints this has to satisfy, and how

**1. The rail must never consist of one card per selected language.** The `home-mixes` spec says the
number of entries *"never equals the number of selected languages by that coincidence"*. Lyrix's
**marathi** list holds exactly **one** artist, so a Marathi-only selection would produce a one-card
rail — precisely the degenerate shape. The curated source therefore offers **at least two** entries,
topped up from a language-agnostic list when a selection would otherwise yield one.

**2. Only 10 of Lyrix's 11 lists are portable.** Lyrix's ids are its own (`hindi`); Spotivibe's are ISO
639-1 (`hi`). Mapping them: `hindi→hi`, `english→en`, `punjabi→pa`, `tamil→ta`, `telugu→te`,
`bengali→bn`, `marathi→mr`, `korean→ko`, `spanish→es`, `japanese→ja`, `urdu→ur`. **Punjabi has no
Spotivibe language code** — the catalog has 38 entries and `pa` is not among them — so that list is
not ported, and the 10 that are carry **33 artists** - Lyrix's `Anime OST` is a category rather
than an artist, and the requirement says every Quick Pick SHALL be a resolvable artist.

**3. 28 of Spotivibe's 38 languages have no Lyrix list.** A language-agnostic list is therefore
required, or the rail would be empty for most of the catalog. Lyrix's own default (no language
selected) is `hindi + english` sliced to 10, which is the same idea: the global list doubles as the
floor for languages that have none of their own.

**4. The same artist must not appear twice.** The existing dedupe is by `kind:target`, and a curated
entry's target is a **name** while a provider entry's is often a **provider id** — so the same artist
could be offered twice. The curated source therefore also dedupes by **normalized name** against
what has already been collected.

## Evidence this change must produce

- The rail is **never empty**, for every language in the catalog, with no provider results and no
  local material — asserted for all 38 codes, not a sample.
- The degenerate marathi case is asserted: a Marathi-only selection yields **at least two** entries,
  never one card per language.
- Local evidence is asserted to **never be displaced, outranked, or reordered** by the curated source.
- A curated entry is asserted to resolve to a real artist route, and to carry no artwork.
- The **same artist** is asserted to be offered once, whether the curated list and the provider
  material name it by the same name or by different identities.
- The ported list is asserted against the **mapping** — 10 languages, 33 artists, and no language
  code outside Spotivibe's catalog — so a typo in a language code is a failing test rather than a
  silent no-op.
- Each new assertion proven **CAUGHT** by mutation, with SHA-256 proving byte-for-byte restoration.

## Out of scope, recorded not absorbed

- **`discovery/spec.md` still says "First run offers language selection"**, which the code contradicts
  (M34 §8.1) — and the same requirement's feed-gating half is still unmet (M34 §8.2). Both need a
  change that owns the first-run requirement as a whole.
- **The Settings host for the artist re-entry** (M34 §8.5): 6,987 gzipped bytes and a 26th chunk
  against a 4,096-byte tolerance. It needs a change that owns the client budget.
- The root lockfile guard gap (M34 §8.6) — **live**, and the stray files are not this change's to
  delete.
- The unidentified intermittent failure (M34 §8.3), and M31–M34's carried-forward items.
- **Lyrix's 25 uncovered languages are not filled in with a hand-written list.** This change ports
  Lyrix's list and adds a language-agnostic floor; inventing per-language lists for the other 28
  languages is a curation task, not a port, and it is recorded as such rather than guessed at.

## Scope

`frontend/src/features/home/` (a new curated-picks module, `quickPicks.ts`, the shelf), the
`home-mixes` spec delta, and `ATTRIBUTION.md`. **No production code outside the Quick Picks
derivation and its shelf, no new route, no provider request, no dependency, no manifest, no gate
step, no CI change.**
