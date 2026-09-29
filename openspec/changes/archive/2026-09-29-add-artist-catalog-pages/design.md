# Design: Artist pages, album pages, Now Playing, and related content

## Context

See `proposal.md` — Why. Current state that constrains the approach:

- Providers expose exactly two capabilities: `search(query)` and playlist resolution. There is no browse/channel/album endpoint at any tier, and `ProviderCandidate` carries only an optional `artistId` for the *first* artist of a search result (`normalize.ts` `splitArtists`). YouTube Music channel ids therefore appear inconsistently.
- `ArtistSummary { id?, name }` and `AlbumSummary { id?, title }` are optional-id domain types, so an entity route key can be an id *or* a name.
- M5's artist/album tiles and M8's artist cards all navigate to `/search?q=…`; the M5 result menu's "go to artist"/"go to album" does the same.
- M8 established the query-driven server pattern (`runDiscovery` → `planDiscoverySeeds` → sequential `runChain` calls with per-seed budgets) and the client shelf primitives (`Shelf`, `useDiscoveryShelf`, `ShelfTrackCard`, `groupArtistsByIdentity`).
- The Now Playing route (M4/M7) already renders artwork, title/artist, heart, progress, transport, volume, a queue link, and the watch link. `globals.css` already ships a `prefers-reduced-motion` block.
- The M8 verification pass established the hard rule this milestone must respect: a page must never fan out more concurrent provider work than the shared outbound budget can serve.

## Goals / Non-Goals

**Goals**

- One new server module that turns a *single* resolved result set into artist, album, and similar-track views.
- Artist and album pages that are useful with partial metadata and honest when metadata is missing.
- More Like This on Now Playing, plus the artwork background and marquee.
- Local-only "liked tracks by this artist" with no new store, dataset, or request.
- Bounded outbound work: at most two seeds per entity request, executed sequentially through the existing limiter.

**Non-Goals (deliberate, with owner milestone)**

- Self-refilling radio, played-ID dedupe, queue autofill (M10). M9's "Start artist radio" seeds playback from the artist feed; M10 turns it into a continuous radio with its own queue source.
- Smart Mix identity/stats/streaks (M11), podcast category work (M12), offline shell (M13), image optimization/CDN allowlist (M14 — the existing `no-img-element` disables stay until then).
- A channel/album browse endpoint, rotating-artist IDs, or any "official artist" verification: providers cannot supply it, and inventing it would breach the provider-abstraction rule.

## Decisions

### 1. One chain call per entity; every view is derived from that result set

**Decision.** `/api/artist?name=X` plans at most two seeds (`X`, `X songs`), runs them sequentially through the existing `runChain`, then derives *all* of the artist view from the merged canonical tracks: popular tracks (the tracks themselves, ordered by the existing quality score), related artists (the non-primary artists appearing across those tracks, ranked by frequency then first appearance), releases (tracks grouped by `album.title`), and artist artwork (the best artwork whose track credits that artist).

**Why.** The M8 verification found that per-facet fan-out is what breaks pages under the shared outbound budget. One query per entity keeps every page at one sequential request, and every derived view is internally consistent because it comes from the same resolution.

**Alternatives considered.** (a) Separate facet queries (`X songs`, `X albums`, `similar artists X`) — more precise per facet, but multiplies requests and reintroduces the budget problem. (b) YouTube channel/browse endpoints — undocumented, per-tier, and would imply a browsing capability the product must not depend on.

### 2. Route keys carry an id when the provider gave one, else a slug

**Decision.** `/artist/[key]` and `/album/[key]` accept either a provider entity id (passed as `id=`) or a normalized name/title slug (de-slugged to `name=`/`title=`). A key is treated as an id when it starts with the case-sensitive `UC` channel prefix, when it is an unbroken alphanumeric run of ≥ 20 characters, or when it is a single ≥ 12-character token whose only punctuation is an underscore (the shape of a YouTube release id, `MPREb_…` / `OLAK5uy_…`); everything else is a text key. Unknown or unresolvable keys yield a recoverable not-found state with a way back.

**Why.** `splitArtists` only attaches ids to the first artist and only when the tier supplied one, so id-only routes would break for most results. Text keys keep every M5/M8 entry point working with no migration. The underscore case was added from the M9 evidence run: a real release key from a live search result (`MPREb_eEpQf8QskKl`) failed the first two rules, was sent as a search phrase, and resolved an *unrelated* release — exactly the substitution the catalog spec forbids. An underscore is what a release id has and a band/artist/release name does not, and requiring length plus "no other punctuation" keeps `AC/DC`, `K-Pop`, and `A_C` on the name side.

**Alternatives considered.** Search-param-only pages (`/artist?name=`) — simple, but unstable for sharing/bookmarking and awkward for artwork routes. Resolving a release id through the existing playlist resolver (a YouTube release *is* a playlist, and `/api/playlist` already returns its ordered tracklist) — attractive, but it changes the approved resolution contract and the id-vs-name contract this change pins, so it is recorded as a follow-up for a later milestone rather than smuggled in here; until then an id-keyed release page asks the chain with the id as its query term, and because that never confirms album metadata the response reports `metadataIncomplete: true` and the page says the tracklist could not be confirmed.

### 3. Album completeness is reported, not faked

**Decision.** The album response carries `metadataIncomplete: true` when the resolved tracks carry no album summary matching the request. The page then shows an explicit notice and still lists the resolved tracks; it never presents a possibly-unrelated list as a definitive tracklist.

**Why.** Search-derived results frequently lack `album` metadata. Silently labelling those tracks "album tracks" would be exactly the kind of fabricated authority the M8 spec forbids for charts.

### 4. "Liked tracks by this artist" is a pure local derivation

**Decision.** A pure helper filters `libraryStore.likedTracks` by artist identity (id when present, else normalized name). No request, no new store, no new dataset.

**Why.** It is a local library question; the M3/M8 rules forbid uploading library content, and the liked dataset already exists.

### 5. "Start artist radio" seeds playback now; M10 makes it a radio

**Decision.** The action plays the resolved artist feed with the full feed as playback context using the existing `browse` queue source (the M8 `playFromShelf` path), labelled "Start artist radio".

**Why.** ROADMAP M9 lists the affordance on artist pages, but radio *behavior* (refill, dedupe, radio queue source) is M10's acceptance criteria. Seeding now and upgrading later keeps both milestones honest and avoids inventing refill semantics here.

### 6. Artwork background is a blurred backdrop, not color extraction

**Decision.** Now Playing renders the current artwork as a blurred, low-opacity, oversized backdrop layer behind the surface. No canvas sampling, no extra request.

**Why.** "Dynamic artwork-derived background" is satisfied by a genuinely artwork-derived visual. Color extraction would need `canvas` image reads (CORS-tainted for provider thumbnails), add test surface, and risk a flash of the wrong color.

**Alternatives considered.** Dominant-color extraction (CORS + canvas + flash-of-wrong-color), and a static gradient (not artwork-derived).

### 7. Marquee is CSS-only, conditional, and reduced-motion aware

**Decision.** The title renders in a fixed-width box; when the text overflows, a duplicated span animates a continuous scroll via CSS keyframes. Under `prefers-reduced-motion` the animation is disabled and the text simply truncates with a title attribute for the full string.

**Why.** No JS measuring loop (no layout thrash), no dependency, and the existing global reduced-motion block already suppresses animations project-wide.

### 8. The M8 shelf hook is generalized, not duplicated

**Decision.** `useDiscoveryShelf` gains an optional `fetchTracks` override (defaulting to the discovery fetcher) so More Like This reuses the same state machine, abort handling, queue bound, and shelf primitives with `/api/similar` behind it.

**Why.** AGENTS.md forbids parallel competing patterns. A second hook would fork the loading/empty/error/retry contract.

## Risks / Trade-offs

- **Search-derived album tracklists can be approximate** → the response reports `metadataIncomplete` and the UI says so; the unit tests pin both branches.
- **Artist imagery is derived from member-track artwork** (channel avatars are rarely present in search results) → the hero falls back to a circular placeholder, which the empty/placeholder states already cover.
- **Related artists are only as good as one query's cast** → they are the other artists credited on the tracks of the artist's own resolution, because no tier offers a related-artists, similar-artists, or channel-browse capability. Measured against the live provider on 2026-09-29: Daft Punk 5 related (Pharrell Williams, Nile Rodgers, Julian Casablancas), Kendrick Lamar 1 (SZA), Radiohead 0 — a solo artist's result set is homogeneous. The section therefore reports an explanatory empty state when nothing is co-credited (the same rule the M8 Popular Artists shelf uses) rather than presenting unrelated artists; surfacing genuinely related artists needs a related-content capability that no current tier has, and is left to a later milestone rather than faked here.
- **Two seeds per entity doubles provider work versus one** → seeds are sequential and bounded, and identical requests are served from the existing TTL cache + in-flight dedupe.
- **Name-keyed artist resolution credit-filters, and a real artist can miss.** `creditsArtist` requires normalized equality or a `requested + " "` prefix, so an artist whose provider credit differs from the typed key (`AuroraVEVO` typed as `Aurora`, `Sigur Rós` reached unaccented, `X Ambassadors` for `X`) resolves to zero credited tracks and reports **unresolvable** → a 404 for an artist that exists. The specs *require* refusing substitution and no tier exposes a channel lookup to verify a name against, so the alternative would be showing a *different* artist under this one's name — strictly worse. The 5-minute resolution cache also makes such a miss sticky for the listener. Accepted as a disclosed limitation with product impact, not as a spec violation; a name-keyed miss must stay a 404 rather than a substitution, and widening the credit match is a follow-up that has to keep the anti-substitution guarantee.
- **An id-keyed artist request is not credit-filtered.** The id half adopts the merged result set and reads the display name from the credits, because there is no name to filter *against* — so a stale or hand-typed `UC…` id renders a successful page for whatever the chain returned, labelled with that id. Partially mitigated by the fact that ids are never hand-typed by a user (they are minted by this app's own entry points and are shareable links); a genuine verification would need a channel lookup no tier provides.
- **One artist/album activation still refines search.** The M5 **Top Result** card keeps `onRefine(name)` for artist and album results (`TopResultCard.tsx` → `SearchResults.tsx`). It is a *result* affordance, not an artist/album tile, and the `search` main spec's Top Result requirement only governs its presentation — so it is out of this change's scope, disclosed here so the proposal's "every artist or album reference" is not read as a complete inventory. The search specification delta covers the tiles, the result menu, and the Home shelf, which are the entry points the requirements actually govern.
- **The `app-shell` main spec was already stale before this change.** `openspec/specs/app-shell/spec.md` still carries the M1 wording ("MAY render placeholder content") because M4/M6/M7's Now Playing work was never synced. The MODIFIED delta therefore also folds in that shipped behavior, so the sync diff for this capability will be larger than M9's own additions — expected, and noted here so it is not mistaken for scope creep in the sync stage.
- **Live upstream flakiness** → identical tolerance to M8: per-seed failure, structured error only when every seed fails, disclosed in browser evidence.
- **Route-key heuristics can misclassify a name that looks like an id** → the rule is narrow (`UC…` prefix or a long alphanumeric token), documented, and unit-tested in both directions.
- **Two main-spec requirements said artist/album navigation "refines search"** (`search` → "Result context actions", `discovery` → "Popular artists shelf") once the routes existed that was false, so this change carries MODIFIED deltas for both capabilities instead of letting the implementation drift. OpenSpec requires a MODIFIED block to retain every scenario name the main spec still has, so the two scenario *names* are kept verbatim with an inline comment marking that the asserted behavior changed; renaming them is not expressible as a scenario-level operation.

## Migration Plan

1. Additive: one server module + three routes, two feature folders, two routes, presentation components, generalized shelf hook, and test/architecture updates.
2. No IndexedDB change, no backup-schema change, no new dependency; existing M5/M8 entry points are repointed at the new routes and keep their old behavior as a fallback.
3. Single Vercel app; the new routes are inert until called.
4. Rollback = revert the merge commit; no data to unwind.

## Open Questions

None that change the specs, approach, or task breakdown.
