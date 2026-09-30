# Proposal: Podcasts (search mode, curated categories, long-form playback)

## Why

The data model already knows what a podcast is — `Track.category` is `"music" | "podcast"` since M2, the M8 discovery feed already serves a `podcast` kind with per-language query seeds, and the Home feed already renders a Podcasts shelf. So the vocabulary exists and nothing consumes it.

The actual behavior is wrong in three specific ways, and ROADMAP M12 names all three:

1. **There is no podcast search.** `/api/search` takes a query and nothing else, and every tier searches for music: the `ytweb` tier literally appends `" song"` to the query, and the primary tier is YouTube *Music*. A listener who searches "history of Rome" gets music-biased results, and there is no mode to ask for anything else.
2. **The music-only filters run over everything.** `filterTracks` rejects any title containing `vlog|react|unboxing|shorts|interview` and any `remix|mashup|slowed+reverb|8d audio|bass boosted|nonstop|dj mix|megamix`, for every category. That is right for music and wrong for spoken word: an episode called "React Native in Production" or "Interview with a historian", or an episode titled "Remix", is legitimate podcast content that the current pipeline deletes.
3. **Nothing verifies long-form playback.** Durations up to 4 hours flow through the same code paths as 3-minute songs, but the roadmap's acceptance criterion — "long durations do not break seek/progress/session restoration" — has never been exercised, and the category is currently inferred from a duration heuristic (`> 1200s → podcast`) rather than from the request or the provider.

M12 is a **mode and filtering** milestone: the provider capability already exists, the storage already records the category, and the player already plays whatever it is given. What is missing is the mode, the category-appropriate rules, and the proof.

## What Changes

- Add a **podcast mode** to search, end to end: the mode is part of the query (carried in the URL so it deep-links and survives back/forward), it is part of the `/api/search` request, and it selects a category-appropriate tier order and upstream parameters. A music query keeps today's behavior byte for byte.
- Make the **shared filter stage category-aware**: the title-marker rules split into rules that apply to every category (`shorts`, `#shorts`, promo fragments) and rules that apply to music only (vlog/reaction/unboxing/interview markers and the remix/mashup/slowed/DJ-mix variants). Duration bounds become per-category, with a podcast window sized for long-form rather than for songs.
- **Pin the category in podcast mode** instead of inferring it from a duration heuristic, so a 6-minute spoken-word result from a podcast search is a podcast. The heuristic stays as the fallback for music searches.
- Add **curated podcast categories**: query-driven category entries (the same shape as M8's genre and collection shelves) that start a podcast-mode search, so podcasts are browsable without knowing a query.
- **Prove long-form playback**: an episode plays through the same single persistent player, and its stored position is restored on reload — clamped when the stored position is beyond the current duration, which is the one real hazard a multi-hour timeline introduces.
- **Confirm podcast history**: a played episode is recorded locally with its category, is readable in the M11 History surface, and counts toward the same local statistics, with no new dataset.

## Capabilities

- **New Capabilities**:
  - `podcasts` — podcast search mode, curated categories, long-form playback and session restoration, and local podcast history.
- **Modified Capabilities**:
  - `search` — the mode is part of the query state in the URL, and results present podcast metadata (show/channel and a long-form duration) instead of music-only sections.
  - `music-provider` — the search contract accepts a category, the chain uses a category-appropriate tier order, and the shared filter stage applies category-appropriate rules.
  - `playback` — long-duration episodes restore their position safely, including when the stored position is beyond the current duration.

## Impact

- **New client code**: a podcast-mode control and podcast result presentation in `features/search/`, a curated category list for podcasts (reusing the M8 catalog/query-driven pattern), and a podcast category picker if the surfaces need one.
- **Existing code touched**: `server/music/{types,search,chain,filter,normalize}.ts` + `providers/{ytweb,invidious,piper}.ts` (category plumbing and per-category upstream parameters), `app/api/search/route.ts` (one more bounded query parameter), `features/search/{searchApi,useSearchController,SearchView}.tsx`, the player/session restore guard, and the architecture suite (the route's accepted-parameter list, and category-aware filter tests).
- **No new dependencies, no new API routes, no new storage dataset, no accounts, no provider key.** The `podcast` discovery kind from M8 is reused as-is; only *search* gains a mode.
- **Known limitation, stated rather than hidden**: the podcast search leans on YouTube Web search with a podcast type hint plus the Invidious and Piped fallbacks. YouTube Music is skipped in podcast mode because it is a music-only tier — searching it for spoken word would return exactly the wrong content. If the hint is ignored upstream, results degrade to "unfiltered search results labelled by mode" rather than failing; the filter stage and the category pinning still apply, and the evidence run discloses what the live provider returned.
