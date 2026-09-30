# Tasks

## 1. Category plumbing through the provider layer

- [ ] 1.1 Add `category: "music" | "podcast"` to `SearchRequest` (`src/server/music/types.ts`), defaulting to `"music"` at every boundary that does not set it, and include it in `searchCacheKey` so the two categories can never share a cached result — verify: `tests/music-search.test.ts` asserts the key differs per category and that a request without the field behaves exactly as before.
- [ ] 1.2 Thread the category through the chain (`chain.ts`) into every tier call and into the shared post-parse pipeline (`toResultTracks`), and record a tier skipped for category reasons in the per-tier diagnostics rather than omitting it — verify: `tests/music-chain.test.ts` shows a podcast request never contacting `ytmusic`, and diagnostics naming the skipped tier.
- [ ] 1.3 Make `ytweb` send a podcast-appropriate query in podcast mode (no `" song"` suffix, plus YouTube's podcast type hint) and leave its music-mode request byte-identical — verify: a provider-level test asserts the outgoing request body per category.

## 2. Category-aware resolution and filtering

- [ ] 2.1 Pin the resolved category from the request in podcast mode, and keep the existing duration heuristic and provider hint precedence in music mode (`normalize.ts`) — verify: `tests/music-normalize.test.ts` asserts a 6-minute spoken-word candidate is a podcast in podcast mode, a 25-minute item is still a podcast in music mode, and an explicit hint still wins in both.
- [ ] 2.2 Split the title-marker rules in `filter.ts` into category-independent ones (Shorts, promo fragments) and music-only ones (vlog/reaction/unboxing/interview, remix/mashup/slowed/8d/bass/nonstop/DJ-mix), and make the duration bounds per-category with podcasts sized for long form — verify: `tests/music-filter.test.ts` covers each rule under both categories, including a podcast titled "React Native in Production" and one titled "Remix" surviving while a music Shorts is still rejected.
- [ ] 2.3 Prove the split is a strict superset of today's behavior for music: every currently rejected music result is still rejected, and no currently accepted music result is newly rejected — verify: a regression test over a table of representative titles, documented as a guard against the refactor silently widening or narrowing music results.

## 3. The search API surface

- [ ] 3.1 Add the bounded `category` query parameter to `/api/search`, validated by the existing input schema so an unknown value is rejected with the same 400-class response and no upstream call — verify: `tests/search-route.test.ts` covers accept, reject, and default.
- [ ] 3.2 Assert the parameter is the only addition to the route's accepted input surface, and that no local-data parameter was added — verify: the architecture suite's accepted-query-key rule fails a widened key, proven on the real handler.

## 4. Podcast mode on the search surface

- [ ] 4.1 Carry the mode in the search URL state (`/search?q=...&mode=podcasts`), defaulting to music when absent or unrecognized, and preserve the query across a mode switch — verify: `tests/search-entry-points.test.ts` and the URL-synchronization cases cover switching, deep link, back/forward, and an unrecognized value.
- [ ] 4.2 Add a mode control to the search surface with an accessible name and an announced state, which does not remount the top-bar input or lose its value — verify: component tests assert the control's state and that the input keeps focus/value.
- [ ] 4.3 Present podcast results with the episode's show/channel, canonical duration, and artwork, and omit the Albums section for a podcast result set while keeping the Top Result and artist derivation rules — verify: `tests/search-presentation.test.ts` asserts both modes' sections against one response fixture.
- [ ] 4.4 Give a podcast search that returns nothing an explanation naming the mode and the query, distinct from the offline and generic failure states — verify: an empty-state test per mode.

## 5. Curated podcast categories

- [ ] 5.1 Add a small explicit per-language podcast-category catalog as query text, resolved per selected language with the documented neutral fallback, reusing the existing language-resolution convention — verify: unit tests cover a language with entries, one without, and the fallback.
- [ ] 5.2 Render the categories as navigation entries on the podcast search surface and on the browse state, each starting a podcast-mode search for its query, with no new feed kind and no new route — verify: component tests assert activation performs the podcast-mode search and that the architecture suite still sees only the documented routes.

## 6. Long-form playback and restore

- [ ] 6.1 Clamp a restore's start offset to the known duration at load time, leaving the persisted snapshot untouched, and keep the music path byte-identical where no disagreement exists — verify: a player test asserts a position beyond the duration is clamped, an inside-the-duration position is untouched, and the stored snapshot is not rewritten.
- [ ] 6.2 Prove a multi-hour episode drives the persistent player and the progress/session surfaces without truncation or overflow — verify: an engine/store test at a 3-hour duration covering position, duration adoption, and the session snapshot's stored position.

## 7. Podcast history proof

- [ ] 7.1 Assert a played episode is recorded in the existing listening-history dataset with its podcast category and canonical metadata, and that no podcast-specific dataset is created — verify: a recorder test on a podcast track plus an architecture rule that the dataset whitelist is unchanged by this change.
- [ ] 7.2 Assert podcast plays appear on the M11 History surface and count toward the local statistics, and that clearing the history clears them the same way — verify: `tests/history-view.test.tsx` / `tests/stats-view.test.tsx` gain podcast cases.

## 8. Architecture and route contracts

- [ ] 8.1 Extend `tests/architecture.test.ts`: the category parameter must be the only new route input, the filter's music-only rules must never be referenced from podcast-mode code paths, no module may branch on a podcast category to fetch from a different provider capability, and the curated catalog must be a language catalog resolved through the one shared language module — verify: each detector is proven against a violating snippet and passes on the clean tree.

## 9. Integration verification and release evidence

- [ ] 9.1 Run the full quality gates from the repository root (`cd frontend && npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`) — verify: every command exits `0`.
- [ ] 9.2 Produce CDP browser evidence against a production server: a podcast-mode search returns podcast-labelled results that music search would not; the category entries start podcast searches; an episode plays in the persistent player and its position survives a reload; a position beyond the duration is clamped rather than cued past the end; a played episode appears on the local History surface with its verdict and is counted by the statistics; music-mode search is unchanged by the same build; exactly one player iframe/API script; zero console errors with disclosed deliberate windows — verify: `results.json` reports `"pass": true` with screenshots and a reproduce-path README (disclosing live-run deviations, including what the live provider actually returned for a podcast query) under the change's `evidence/`.
- [ ] 9.3 Update `ROADMAP.md`: M12 status row → `DONE`; tick the §12 items M12 delivers (Podcast mode, Podcast categories, Podcast playback, Podcast history) — verify: `git diff` shows only those lines plus the status cell.
- [ ] 9.4 Re-verify the quality gates from a clean clone of the branch head — verify: all six commands exit `0` in the fresh clone.
