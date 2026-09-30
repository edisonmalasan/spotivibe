# Tasks

## 1. Category plumbing through the provider layer

- [x] 1.1 Add `category: "music" | "podcast"` to `SearchRequest` (`src/server/music/types.ts`), defaulting to `"music"` at every boundary that does not set it, and include it in `searchCacheKey` so the two categories can never share a cached result — verify: `tests/music-search.test.ts` asserts the key differs per category and that a request without the field behaves exactly as before.
  - **Done.** `SearchCategory = "music" | "podcast"`; `SearchRequest.category` is optional and every boundary that reads it defaults to music. `searchCacheKey(query, limit, category = "music")` puts the category in the key, and `undefined` produces the pre-M12 key — a warm cache keeps serving what it already had.
  - **Verified** in `tests/music-podcast-mode.test.ts` ("the search mode reaches the cache key") and end to end in `tests/search-route-mode.test.ts` ("never serves a music-mode result for a podcast query, or the reverse"), which pins the property at the route: same mode twice is a cache hit with no second upstream call, the other mode is a miss.
  - **Deviation from the planned test home:** the assertions live in a new `tests/music-podcast-mode.test.ts` rather than `tests/music-search.test.ts`, because the file is named per layer (cache key, chain, upstream body, category resolution) the way `tests/music-chain.test.ts` already is. One layer per file means a regression names the layer it broke in.
- [x] 1.2 Thread the category through the chain (`chain.ts`) into every tier call and into the shared post-parse pipeline (`toResultTracks`), and record a tier skipped for category reasons in the per-tier diagnostics rather than omitting it — verify: `tests/music-chain.test.ts` shows a podcast request never contacting `ytmusic`, and diagnostics naming the skipped tier.
  - **Done.** `tiersForCategory(category, providers)` drops `ytmusic` in podcast mode; the category is passed to every `provider.search` call and to `toResultTracks(candidates, query, limit, category)`. The skipped tier is pushed into `tiersTried` as `{ tier: "ytmusic", outcome: "skipped" }` before the attempt loop, so the diagnostics list every tier the request would have used.
  - **Verified** in `tests/music-podcast-mode.test.ts` ("podcast mode queries only tiers that can answer it", "diagnostics record a tier skipped for category reasons", "a podcast request never touches a music tier, even on failure") — including `expect(ytmusic.calls).toBe(0)`, which is the part a diagnostics assertion alone would not prove.
  - **Also evidenced live:** the evidence run reads the server's own diagnostics for a podcast query and records `ytmusic → skipped` (see `evidence/README.md`, "the tier chain went `ytmusic → skipped` …").
- [x] 1.3 Make `ytweb` send a podcast-appropriate query in podcast mode (no `" song"` suffix, plus YouTube's podcast type hint) and leave its music-mode request byte-identical — verify: a provider-level test asserts the outgoing request body per category.
  - **Done.** `ytwebSearchBody(query, category)` returns the pre-M12 body for music (same context, same `query: "<q> song"`, no `params` key at all) and, in podcast mode, the unmodified query plus `params: PODCAST_TYPE_PARAMS`.
  - **Verified** in `tests/music-podcast-mode.test.ts` ("the podcast question changes the upstream request") and again at the wire in `tests/search-route-mode.test.ts` ("sends the podcast question upstream, not the music one"), which parses the outgoing request bodies.

## 2. Category-aware resolution and filtering

- [x] 2.1 Pin the resolved category from the request in podcast mode, and keep the existing duration heuristic and provider hint precedence in music mode (`normalize.ts`) — verify: `tests/music-normalize.test.ts` asserts a 6-minute spoken-word candidate is a podcast in podcast mode, a 25-minute item is still a podcast in music mode, and an explicit hint still wins in both.
  - **Done.** `resolveCategoryForRequest(requestCategory, candidate)` reuses `resolveCategory(hint, duration)` and only overrides the result in podcast mode; `candidateToTrack(candidate, requestCategory = "music")` threads it. Provider hint still wins in both modes, and the `> 1200 s` heuristic is untouched in music mode.
  - **Verified** in `tests/music-podcast-mode.test.ts` ("category resolution prefers the question asked") including the no-duration case, and at the route in `tests/search-route-mode.test.ts`, where a 6-minute and a 48-minute spoken-word result both come back labelled `podcast`.
- [x] 2.2 Split the title-marker rules in `filter.ts` into category-independent ones (Shorts, promo fragments) and music-only ones (vlog/reaction/unboxing/interview, remix/mashup/slowed/8d/bass/nonstop/DJ-mix), and make the duration bounds per-category with podcasts sized for long form — verify: `tests/music-filter.test.ts` covers each rule under both categories, including a podcast titled "React Native in Production" and one titled "Remix" surviving while a music Shorts is still rejected.
  - **Done, with one correction to the plan's split.** Shorts are the only category-independent rule; the promo markers (`trailer|teaser|preview`) are **podcast-only**, and the music-only lists keep their exact pre-M12 bytes. The plan put the promo markers in the any-category set, which would have *newly rejected* music results titled "Preview" — a change decision 4 explicitly promises not to make. A 30-second trailer is a promo, and a music result's metadata is not this change's to reinterpret.
  - **Verified** in `tests/music-filter.test.ts` (per-category duration bounds, including an episode longer than any song) and `tests/music-podcast-mode.test.ts` ("the shared pipeline applies the mode's rules", "still drops Shorts and podcast promo fragments in podcast mode"): an "Interview:" and a "Remix" candidate survive podcast mode and are dropped in music mode, a Shorts is dropped in both, and a promo fragment is dropped only for a podcast.
- [x] 2.3 Prove the split is a strict superset of today's behavior for music: every currently rejected music result is still rejected, and no currently accepted music result is newly rejected — verify: a regression test over a table of representative titles, documented as a guard against the refactor silently widening or narrowing music results.
  - **Done.** `tests/music-filter.test.ts` carries a 22-row × 2-category table whose `music` column is the pre-M12 verdict, reproduced by hand from the shipped single-pattern rules — including the two substring cases (`The Reactor`, `React Native in Production`) that a word-boundary "cleanup" would have silently accepted. A future edit that changes a music verdict fails this table.
  - **Also** pinned by the architecture suite: a category-scoped rule is reachable only from inside its own category's guard, and only from `filter.ts`.

## 3. The search API surface

- [x] 3.1 Add the bounded `category` query parameter to `/api/search`, validated by the existing input schema so an unknown value is rejected with the same 400-class response and no upstream call — verify: `tests/search-route.test.ts` covers accept, reject, and default.
  - **Done.** `category: z.enum(["music", "podcast"]).default("music")` in the existing schema, so an unknown value takes the same 400 `invalid_query` path as an empty query. Enumerated rather than free text: a permissive string would let a caller label results arbitrarily.
  - **Verified** in `tests/search-route-mode.test.ts` (accept / default / reject-without-contacting-a-provider, and the podcast response labelled end to end). The pre-existing `tests/search-route.test.ts` still passes unchanged, which is itself evidence that music requests are unaffected.
- [x] 3.2 Assert the parameter is the only addition to the route's accepted input surface, and that no local-data parameter was added — verify: the architecture suite's accepted-query-key rule fails a widened key, proven on the real handler.
  - **Done.** The M12 section of `tests/architecture.test.ts` reads the real handler's accepted keys and compares them to exactly `["q", "limit", "category"]`, and asserts the local-data key list (`liked`, `likedIds`, `playlist`, `history`, `listeningHistory`, plus `deviceId`/`profile`/`trackIds`/`playlistId`) is absent. The same set is asserted in `tests/search-route-mode.test.ts` so a widened key fails both the static and the behavioral suite.

## 4. Podcast mode on the search surface

- [x] 4.1 Carry the mode in the search URL state (`/search?q=...&mode=podcasts`), defaulting to music when absent or unrecognized, and preserve the query across a mode switch — verify: `tests/search-entry-points.test.ts` and the URL-synchronization cases cover switching, deep link, back/forward, and an unrecognized value.
  - **Done, with one naming correction:** the parameter is `mode=podcast` (singular), matching the `category` value it carries; the plan's `mode=podcasts` was a typo that would have made the two names disagree. `buildSearchUrl(query, mode = "music")` writes the parameter **only** in podcast mode, so a music URL stays byte-identical to the pre-M12 shape. `searchModeFromParam` maps absent *and* unrecognized values to music: a shared or hand-edited URL must still produce a working search.
  - **Verified** in `tests/search-mode-route.test.tsx` (URL-read, default, unrecognized value, switch preserving the query, no `category` sent in music mode) and `tests/podcast-search-surface.test.tsx` (the URL helpers, including the round trip through the param they write). The pre-existing `tests/search-page-url.test.tsx` and `tests/search-entry-points.test.tsx` pass unchanged.
  - **Correction to the verification plan:** the "the input keeps focus/value" half of task 4.2 is asserted as *the switch never writes the search store* — the top-bar input's value mirrors that store, and a mode switch is a `router.replace` only. The `/search` route does not render the shell's input, so a "same element" assertion is not available at that level; the store-level assertion is the property that actually guarantees it, and it is what `tests/search-mode-route.test.tsx` checks.
- [x] 4.2 Add a mode control to the search surface with an accessible name and an announced state, which does not remount the top-bar input or lose its value — verify: component tests assert the control's state and that the input keeps focus/value.
  - **Done.** `SearchModeSwitch` is a `role="radiogroup"` with `aria-label="Search mode"` and two `role="radio"` buttons carrying `aria-checked` — a radio group rather than a toggle, because the two modes are two questions and the selected one is always announced. Labels name the question ("Music", "Podcasts") and promise no results.
  - **Verified** in `tests/search-mode-route.test.tsx` (default state, both options, state after a switch, the store untouched) and `tests/podcast-search-surface.test.tsx` (`SEARCH_MODE_OPTIONS` is exactly the two modes, each labelled).
- [x] 4.3 Present podcast results with the episode's show/channel, canonical duration, and artwork, and omit the Albums section for a podcast result set while keeping the Top Result and artist derivation rules — verify: `tests/search-presentation.test.ts` asserts both modes' sections against one response fixture.
  - **Done.** `SearchResults` takes `mode` and, for a podcast set, titles the sections **Episodes** and **Shows** and omits Albums entirely. Artwork, duration, and the show/channel all come from the canonical `Track` (the first artist *is* the show), so nothing is rendered from provider shapes. The Top Result card and the derived artist tiles are untouched.
  - **Verified** in `tests/podcast-search-surface.test.tsx` (both modes' sections, the episode's show/channel and duration from the canonical track, the music presentation unchanged with Albums present, and the default with no `mode` prop) and live in the evidence run's `search-podcast-mode-1280.png`.
  - **Deviation:** the planned `tests/search-presentation.test.ts` does not exist in this repository (presentation is covered per surface); the assertions live in the M12 surface suite instead, which renders the same `SearchResults` component.
- [x] 4.4 Give a podcast search that returns nothing an explanation naming the mode and the query, distinct from the offline and generic failure states — verify: an empty-state test per mode.
  - **Done.** The `empty` surface renders a podcast-specific `EmptyState`: `No podcasts found for "<query>"` plus "Podcast search looks for episodes of at least 10 minutes…". The offline and error states are separate branches and were not touched.
  - **Verified** live in the evidence run (with one disclosed stubbed response, because the chain reports "nothing usable" as a 503 and the remote-empty state is otherwise unreachable), which reads both modes' empty states from the DOM in one window and asserts the podcast one is not the music wording.

## 5. Curated podcast categories

- [x] 5.1 Add a small explicit per-language podcast-category catalog as query text, resolved per selected language with the documented neutral fallback, reusing the existing language-resolution convention — verify: unit tests cover a language with entries, one without, and the fallback.
  - **Done.** `features/search/podcastCategories.ts` holds eight categories (`news`, `true-crime`, `comedy`, `technology`, `history`, `business`, `science`, `health`) with per-language query text and a `neutral` entry each. `podcastCategoryQueries(category, languages)` resolves in the selected languages' order, then the neutral entry — the same convention as the M8 discovery seed lists, with the same `"neutral"` key literal.
  - **Verified** in `tests/podcast-search-surface.test.tsx` (a language with entries, a language without, a multi-language selection order, an empty selection, and "every category has a non-empty neutral entry" over the whole catalog) and statically in `tests/architecture.test.ts` (no second language catalog, and no query text keyed by a language the shared catalog does not define).
- [x] 5.2 Render the categories as navigation entries on the podcast search surface and on the browse state, each starting a podcast-mode search for its query, with no new feed kind and no new route — verify: component tests assert activation performs the podcast-mode search and that the architecture suite still sees only the documented routes.
  - **Done.** `PodcastCategoryList` renders `Link`s to `/search?q=<query>&mode=podcast`, shown on the podcast-mode browse state (alongside recent searches). Links rather than buttons: the URL is the shareable state, and a category can never become a stale shelf of results fetched once. The resolved query is visible on the tile, so the listener knows what they are about to search for.
  - **Verified** in `tests/podcast-search-surface.test.tsx` (one link per category, the exact href, the visible query, language switching, and "claims no ranking" — no best/top/#1/chart/editor wording) and live in the evidence run (a category link is activated with a real click, the route changes to `?q=news%20podcasts&mode=podcast`, and a podcast-mode request goes out on the existing `/api/search` route).

## 6. Long-form playback and restore

- [x] 6.1 Clamp a restore's start offset to the known duration at load time, leaving the persisted snapshot untouched, and keep the music path byte-identical where no disagreement exists — verify: a player test asserts a position beyond the duration is clamped, an inside-the-duration position is untouched, and the stored snapshot is not rewritten.
  - **Done.** `clampCuePosition(position, duration)` clamps into `[0, duration − END_CUE_TAIL_SECONDS]` and is applied by both `restoreSession` and `requestTrack` to the *cue*, never to the caller's snapshot. An unknown duration (`0`) is never clamped, and a cue exactly at the end still lands 2 s short of it, because the player reads the end as "ended".
  - **Verified** in `tests/podcast-playback-history.test.ts` (a 3-hour episode restores at 2 h untouched and the caller's snapshot still reads 2 h; a re-cut episode cued at `duration − 2`; a music track with no disagreement unchanged; the helper's edges including NaN, negatives, and a 1-second track) and live in the evidence run, where the stored position is forced to `duration + 900 s` and the player cues at `duration − 2 s`.
- [x] 6.2 Prove a multi-hour episode drives the persistent player and the progress/session surfaces without truncation or overflow — verify: an engine/store test at a 3-hour duration covering position, duration adoption, and the session snapshot's stored position.
  - **Done.** A 3-hour episode round-trips through the player store and the session snapshot; the position and duration are adopted as-is, the cue is in `loadRequest`, and playback is cued rather than started.
  - **Verified** in `tests/podcast-playback-history.test.ts` and live: the evidence run plays a 57-minute episode, reads the position and duration from the progress surface, persists the session, reloads, and restores the same position — with the position/duration pair rendered by `formatClock` (no truncation) and a second, 1 h 17 m episode advancing in the same run.

## 7. Podcast history proof

- [x] 7.1 Assert a played episode is recorded in the existing listening-history dataset with its podcast category and canonical metadata, and that no podcast-specific dataset is created — verify: a recorder test on a podcast track plus an architecture rule that the dataset whitelist is unchanged by this change.
  - **Done, as planned — the change adds no storage at all.** The recorder writes the whole `Track`, so `category: "podcast"` and the canonical metadata travel with the event; `Repositories`, the IndexedDB `STORE` map, and the backup envelope are untouched.
  - **Verified** in `tests/podcast-playback-history.test.ts` (one event carrying the podcast category, the show/channel, the 3-hour duration, and the `search` context; the step's measured seconds landing when the step ends; and "no podcast-specific store was added") and statically in `tests/architecture.test.ts`, which compares the `Repositories` keys and the store definitions against the existing whitelist and asserts no key matches `/podcast|episode/i`.
- [x] 7.2 Assert podcast plays appear on the M11 History surface and count toward the local statistics, and that clearing the history clears them the same way — verify: `tests/history-view.test.tsx` / `tests/stats-view.test.tsx` gain podcast cases.
  - **Done.** `tests/history-view.test.tsx` gained a podcast case: the episode is listed beside a music play, its verdict is shown, its show links to that show's surface, `StatsView` counts it (`1` play, `20 min`, the episode as the top track, the show as the top artist, `podcast` in the category breakdown), and clearing the History clears the statistics with no second action. `tests/podcast-playback-history.test.ts` covers the same counting and clearing at the derivation layer.
  - **Also evidenced live:** the evidence run reads the dataset out of IndexedDB, reads the History rows and the statistics from the DOM, and records `plays=1` for three events — the two zero-second steps being the honest consequence of the reloads the run performs.

## 8. Architecture and route contracts

- [x] 8.1 Extend `tests/architecture.test.ts`: the category parameter must be the only new route input, the filter's music-only rules must never be referenced from podcast-mode code paths, no module may branch on a podcast category to fetch from a different provider capability, and the curated catalog must be a language catalog resolved through the one shared language module — verify: each detector is proven against a violating snippet and passes on the clean tree.
  - **Done, with a fifth rule the plan implied rather than named:** the repository surface must still equal the dataset whitelist (task 7.1's static half). Four detectors, each exercised against a violating snippet first:
    - `categoryRuleViolations` — a music-only marker applied to every category, a podcast rule behind a music guard, and a rule duplicated into another module are all violations; a declaration is not a use, and a correctly guarded use passes. Finding the guard needs parenthesis-depth tracking, because a rule used in `a && b` sits *before* the block's brace.
    - `providerCapabilityBranchViolations` — a category conditional that reaches a URL, a `fetch`, or a request builder, and a ternary that picks between two hosts, are violations; passing the question in a request *body* is the mode's contract, not a new capability.
    - `curatedCatalogViolations` — a second language catalog, a language key the shared catalog does not define, and a catalog with no neutral fallback are violations.
    - The route's accepted keys are exactly `["q", "limit", "category"]` with no local-data parameter, and no category conditional outside `chain.ts` may name a tier.
  - **Verified:** `tests/architecture.test.ts` is 104 tests and passes; the M12 section is 11 of them.

## 9. Integration verification and release evidence

- [x] 9.1 Run the full quality gates from the repository root (`cd frontend && npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`) — verify: every command exits `0`.
  - **Done** — see §10 for the recorded results of the final pass.
- [x] 9.2 Produce CDP browser evidence against a production server: a podcast-mode search returns podcast-labelled results that music search would not; the category entries start podcast searches; an episode plays in the persistent player and its position survives a reload; a position beyond the duration is clamped rather than cued past the end; a played episode appears on the local History surface with its verdict and is counted by the statistics; music-mode search is unchanged by the same build; exactly one player iframe/API script; zero console errors with disclosed deliberate windows — verify: `results.json` reports `"pass": true` with screenshots and a reproduce-path README (disclosing live-run deviations, including what the live provider actually returned for a podcast query) under the change's `evidence/`.
  - **Done.** `evidence/cdp-check.mjs` (Node built-ins only) drives a production build in headless Edge: **30 steps, all passing, `"pass": true`, exit 0**, 6 screenshots at 1280×900, and an empty `consoleErrors` array with the deliberate stub window disclosed. `evidence/README.md` gives the reproduce path and discloses, among others, what the live provider actually returned: for `true crime podcast` in podcast mode the recorded run went `ytmusic → skipped`, `ytweb → empty`, `invidious → timeout`, `piped → ok` — the fallback chain carried the request — while an earlier run of the same harness got `invidious → ok`. The README also discloses the one stubbed response (the remote-empty state is unreachable because the chain reports "nothing usable" as a 503), the wall-clock playback pacing, the pre-M12-style session debounce that requires a pause before the record settles, and the two zero-second events the run's own reloads create.
- [x] 9.3 Update `ROADMAP.md`: M12 status row → `DONE`; tick the §12 items M12 delivers (Podcast mode, Podcast categories, Podcast playback, Podcast history) — verify: `git diff` shows only those lines plus the status cell.
  - **Done.**
- [x] 9.4 Re-verify the quality gates from a clean clone of the branch head — verify: all six commands exit `0` in the fresh clone.
  - **Done** — see §10.

## 10. Verification record

Every command below was executed on Windows with Node v26.10.0 / npm 12.1.0, and every
exit code was read from the run, not assumed.

| Command | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run lint` | exit 0, no errors and no warnings |
| `npm run format:check` | exit 0, "All matched files use Prettier code style!" |
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0 — **2077 tests, 130 files**, 0 failed |
| `npm run build` | exit 0 — compiled successfully, 19 routes in the output |
| Six gates again, from a clean clone of the branch head | exit 0, same test count |
| `node openspec/changes/add-podcasts/evidence/cdp-check.mjs` | exit 0, `"pass": true`, 30 steps |

Baseline at the M11 merge (`fa3e262`): 125 test files / 1987 tests. M12 adds
**5 test files and 90 tests**, all of them about the mode, plus one regression test
for the pre-existing blank-id link (design decision 9) inside an existing file.

### Deviations from this plan, collected

1. **Test homes.** Five new suites rather than the files named per task
   (`music-podcast-mode`, `search-route-mode`, `search-mode-route`,
   `podcast-search-surface`, `podcast-playback-history`). Layer-per-file naming
   matches the existing `tests/music-*.test.ts` convention, and the per-task
   verification is satisfied by the assertions listed under each task above.
2. **Promo markers are podcast-only, not category-independent** (task 2.2), because
   the plan's split would have newly rejected music results titled "Preview" — the
   one thing decision 4 promises not to do.
3. **The URL parameter is `mode=podcast`**, not `mode=podcasts`, so the URL and the
   `category` value it carries cannot disagree.
4. **Task 4.2's input assertion is store-level** (the mode switch never writes the
   search store), because the `/search` route does not render the shell's input.
5. **Task 4.3's presentation assertions live in the M12 surface suite**; the
   repository has no `tests/search-presentation.test.ts`.
6. **One pre-existing bug fixed** (design decision 9): a blank channel id produced a
   dead `/artist/` link and a 404 prefetch. The evidence run surfaced it; the fix is
   pinned by a regression test in `tests/search-entry-points.test.tsx` rather than
   suppressed in the harness.
7. **One pre-existing characteristic documented, not changed** (evidence README): the
   session write is a 2 s debounce fed by position updates, so nothing is persisted
   while playback keeps reporting positions. The harness pauses before reading. This
   is M6 behavior, unchanged by M12, and fixing it belongs to whichever change owns
   session persistence rather than to this one.
