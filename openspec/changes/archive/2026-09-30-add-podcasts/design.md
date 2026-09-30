# Design: Podcasts (search mode, curated categories, long-form playback)

## Context

M12 has almost no new surface area to build and three behaviors to fix. The decisions below are therefore mostly about **not adding things** and about where the category comes from.

Current state, verified in the code:

- `Track.category` is `"music" | "podcast"` (M2) and the backup schema enforces it.
- `resolveCategory(hint, durationSeconds)` in `server/music/normalize.ts` prefers a provider `categoryHint`, else applies `> 1200s → podcast`. **No provider ever sets `categoryHint`** — the type exists and is unused.
- `filterTracks` in `server/music/filter.ts` applies one title-marker set and one duration window per category; the windows already differ (`music 60–14400s`, `podcast 120–14400s`), but the *title* rules do not.
- The chain order is fixed: `ytmusic → ytweb → invidious → piped`. `ytweb` searches `query + " song"`.
- `/api/search` accepts exactly `q` and `limit`.
- The M8 discovery feed already serves `kind: "podcast"` from `PODCAST_SEEDS` per language, and Home already renders a Podcasts shelf.

## Decisions

### 1. Podcast mode is a parameter of the query, not a filter on music results

**Decision.** One bounded `category` parameter (`"music" | "podcast"`, default `"music"`) on the search request, threaded through the route → service → chain → providers → filter stage → cache key, and carried in the browser URL as the search mode.

**Why.** "Search podcasts" is a different *question*, not a filter over a music answer set. A mode expressed as a post-filter would have to fetch a music-shaped result set and then throw most of it away — paying the wrong upstream query, and returning fewer podcasts than the provider could have offered. As a parameter it also reaches the cache key, so a music result is never served for a podcast query (a correctness bug a filter cannot have).

**Alternatives considered.** A separate `/api/podcasts` route (rejected: duplicates validation, caching, diagnostics, and the whole chain for one parameter). Detecting podcasts client-side after fetching (rejected: burns the result budget on content the listener did not ask for, and cannot change the upstream query).

### 2. Podcast mode skips YouTube Music, because that tier is music-only

**Decision.** In podcast mode the chain is `ytweb → invidious → piped`. `ytweb` sends the query unmodified plus YouTube's podcast type hint; `piped` sends **no** `filter=music_songs` parameter (its unfiltered default) because that parameter asks its instance for the *song* index; `invidious` has no category-scoped search parameter, so it sends the same `type=video` in both modes. In music mode nothing changes.

**Why.** The primary tier is YouTube *Music*'s Innertube surface and `ytweb` appends `" song"`. Both are music-biased by construction, so a podcast-mode request through them returns music — the exact failure M12 exists to remove. Skipping a tier that cannot answer the question is cheaper and more honest than fetching results and filtering them. The fallbacks are still there, so the tier-bypass is not a single point of failure.

**Amended by the M12 verification pass.** This decision originally said `invidious` and `piped` "search their own indices unchanged". That was true for `invidious` and wrong for `piped`: its `filter=music_songs` is an explicitly music-scoped upstream parameter, so a podcast request was asking the one tier that answered it to search songs. The `music-provider` spec requires the remaining tiers to be "queried with podcast-appropriate query parameters", and the spec outranks this document — so the **code** moved, not the sentence. The change is a parameter value on the same host and path, which is what keeps it inside "no new provider capability"; the architecture rule that guards that (`providerCapabilityBranchViolations`) is satisfied because no category conditional in a provider module reaches a URL. A scenario now pins it, and `pipedSearchFilter` is the one place the value is decided.

**Alternatives considered.** Keeping the full chain and relying on category pinning (rejected: it would label music results as podcasts — a fabricated claim, worse than a missing tier). Using only `ytweb` (rejected: it makes one tier a single point of failure for the whole mode). Narrowing the spec sentence to "tiers that expose a category parameter receive it" (rejected: it would have legalized a tier asking its upstream a music question on behalf of a podcast listener, which is the failure the spec was written to prevent).

### 3. The category comes from the request in podcast mode, and from the heuristic in music mode

**Decision.** In podcast mode a candidate without a provider hint is labelled `podcast` by the request's own category. In music mode the existing `> 1200s → podcast` heuristic still applies, and a provider hint still wins when present.

**Why.** The heuristic is a duration proxy for content type, and it is wrong in both directions: a 6-minute spoken-word item from a podcast search reads as music, while a 25-minute DJ set reads as a podcast. The request knows what the listener asked for; the duration guess does not. Keeping the heuristic for music mode means M12 changes no existing music classification behavior.

**Alternatives considered.** Dropping the heuristic entirely (rejected: music search would stop labelling long DJ sets, changing M3 behavior for no requirement). Asking the provider for a category on every tier (rejected: only `ytweb` can, so most results would fall back to the heuristic anyway — and a hint that exists on one tier and not three is worse than a rule that always applies).

### 4. Title filters split into category-independent and music-only rules

**Decision.** Two rule sets in `filterTracks`:

- **Any category**: `shorts`, `#shorts`, and promo fragments (`trailer`, `teaser`, `preview`) — these are not podcast content in any mode.
- **Music only**: `vlog`, `react`, `unboxing`, `interview`, and the production variants (`remix`, `mashup`, `slowed+reverb`, `8d audio`, `bass boosted`, `nonstop`, `dj mix`, `megamix`).

**Why.** This is the roadmap's two podcast bullets in one place: "filter vlogs/reactions/short irrelevant results" is a *music-mode* job (those markers describe music results that are not songs), and "do not incorrectly reject legitimate podcast content" means the same words must not delete an episode titled "React Native in Production", "Interview with…", or "Remix". One shared list cannot do both jobs; two lists scoped by category can.

**Alternatives considered.** Word-boundary-only matching (rejected: `react` also matches the React framework, `short` inside `shortly` — the current pattern already avoids the worst of this, and a narrower rule would let more junk through). Scoring the markers instead of filtering (rejected: silent junk with a low score is worse than absent, and the existing architecture treats filtering as binary).

### 5. Podcast duration bounds are sized for long-form, not for songs

**Decision.** `podcast: 600–21600s` (10 minutes to 6 hours). Music stays `60–14400s`.

**Why.** The current podcast window (`120–14400s`) is a song window with a lower floor: it admits 2-minute clips and rejects the 4.5-hour episodes the mode exists to serve. A 10-minute floor is the honest line for "an episode rather than a clip", and a 6-hour ceiling stops a compilation or a livestream archive from masquerading as an episode. The floor is the honest cost of the filter: some short-form podcast content becomes unreachable, which the surface discloses rather than silently padding.

**Alternatives considered.** Keeping 120s and adding a separate UI duration filter (rejected: two places to keep honest, and the server still has to decide what to return). No floor at all (rejected: the roadmap asks for duration filtering *suitable for long-form*, and without a floor the mode returns music-adjacent clips).

### 6. Curated podcast categories are query-driven entries, reusing the M8 pattern

**Decision.** A small, explicit, per-language catalog of podcast categories (News, Comedy, True Crime, Technology, …) whose entries are **query seeds** — activating one runs a podcast-mode search for that category's query text. No new feed kind, no new route.

**Why.** M8 already made the genre catalog (`lib/genreCatalog.ts`) a set of navigation tiles that lead to a search or a discover route, and `discoverySeeds.ts` already holds per-language query text. Reusing both keeps podcasts browsable without inventing a second discovery surface, and it means a category is a *starting point* rather than a curated ranking the product cannot compute.

**Alternatives considered.** A new `kind: "podcast-category"` discovery feed (rejected: a second provider-shaped surface for what is a search seed). Only free-text search with no categories (rejected: the roadmap explicitly asks for curated/query-driven categories, and a listener who does not know a show name needs somewhere to start).

### 7. Long-form restore clamps a position beyond the current duration

**Decision.** Session restore keeps storing `positionSeconds` as-is, and the *load* clamps `startSeconds` to the known duration (minus a small tail) when the two disagree. The stored snapshot is untouched, so a later restore with the full duration still resumes correctly.

**Why.** This is the one real hazard a multi-hour timeline introduces: a session restored after an episode was re-cut shorter would otherwise cue a start offset past the end, which the IFrame player treats as either the end or an error. The clamp belongs at the load boundary because that is where the duration is known, and the stored value is what lets the correction be temporary rather than destructive.

**Alternatives considered.** Clamping when writing the snapshot (rejected: the write does not know the duration and would bake in a guess). Ignoring the mismatch (rejected: it is the acceptance criterion).

### 8. Podcast history needs no new storage — only proof

**Decision.** No new dataset and no new event field. The M11 recorder already stores the whole `Track` (so the category travels with the event), and the M11 statistics already count podcasts as plays and as a `podcast` breakdown key. M12 adds tests proving that and nothing else.

**Why.** Adding a `podcastHistory` dataset would duplicate the history store and create two sources of truth for "what was played". The roadmap's "store podcast listening history locally" is satisfied by the existing dataset; the risk is a regression, not a missing feature.

**Alternatives considered.** A separate podcast history list (rejected: duplicate state, and the History surface would need a second clear action). Tagging events with a `podcast` boolean (rejected: redundant with `track.category`, and redundant stored state can disagree with the track it points at).

### 9. A blank channel id is no id (pre-existing bug the mode exposed)

**Decision.** In `features/search/ArtistTile`, a derived artist's provider id is used only when it is non-blank; a blank id falls back to the artist's name. `features/search/ResultMenu` and `features/history/HistoryView` already did this (`nonBlank`, `isProviderEntityId`); the tile did not.

**Why.** `providerIdFor(artist) ?? artist.name` treats `""` as an id, so `artistHref("")` produced `/artist/` — a link to the artist route with *no key*. That renders the not-found state and prefetches an RSC request that 404s, which the evidence run recorded as a console error. Nothing about it is podcast-specific, but the mode makes it common: the Invidious tier routinely returns a podcast show whose `ownerText` yields a name and **an empty channel id**, so the id is present-and-blank rather than absent. The M9 contract is explicit that an id-less entry stays activatable by name (`catalog` — "Catalog entity keys and resolution requests", covered by `tests/search-entry-points.test.tsx`); a blank id is the same situation wearing a costume. Fixing it here rather than suppressing the 404 in the harness keeps the evidence honest: the run reports zero console errors because the product does not produce that 404.

**Alternatives considered.** Suppressing the error in the harness (rejected: it hides a real dead link and would leave the M9 contract broken for blank ids). Making `artistHref` reject an empty key (rejected: it returns `string`, so "reject" would mean a second magic string at every call site — the decision belongs to the caller that knows whether it has an entity).

## Risks / Trade-offs

- **Podcast results depend on an upstream type hint the app does not control.** If YouTube ignores the hint, podcast mode degrades to "unfiltered results labelled by the mode". The filter stage and the category pinning still apply, so the failure is wrong-content-rather-than-missing-content. The evidence run records what the live provider actually returned for a podcast query, and the README discloses it.
- **Skipping YouTube Music costs recall for podcasts.** Music-mode search is unaffected; podcast mode has one fewer tier. If a podcast query returns too few results, the fallback tiers are the only backfill — disclosed rather than papered over with an unbounded retry.
- **The 10-minute floor hides short-form podcast content.** Deliberate (decision 5) and stated in the empty state so it does not read as "no podcasts exist".
- **Category pinning can label a music video found by a podcast query as a podcast.** It is a *search-mode* label, not a content-type guarantee, and the surface shows the show/channel name so the listener can see what they got. The alternative — dropping everything that is not provably spoken word — would return nothing at all, because no tier exposes that signal.
- **A `category` parameter changes the search cache key shape.** The key becomes `query|category|limit`; a stale cached entry from a previous build simply misses (it cannot be read with the new key), so there is no cross-mode contamination and no migration.

## Migration Plan

1. Additive: one bounded request parameter, per-category constants in the filter/normalizer, a podcast search mode in the client surface, a curated category catalog, and a restore clamp.
2. No storage migration: the history dataset is unchanged, and the category is already part of every stored `Track`.
3. No data transform: existing music results keep the same filters and the same category inference.
4. Rollback = revert the merge commit. No dataset or snapshot is left in a shape the previous code cannot read.

## Open Questions

None that change the specs, the approach, or the task breakdown.
