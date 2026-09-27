# Design

## Context

M0–M2 delivered the app shell, local persistence, and quality gates. Nothing queries YouTube yet: `src/server/` contains only the validated empty env schema (`src/server/env.ts`, whose header already anticipates M3 provider configuration) and empty `src/server/http/` + `src/server/music/providers/` scaffolds. The canonical `Track` contract already exists in `src/data/repositories/types.ts` (ROADMAP §8.1), and the architecture tests already enforce that the data layer never touches the network and that UI code never imports the IndexedDB implementation.

ROADMAP M3 (see proposal.md — Why) requires the provider layer itself. Reference behavior comes selectively from Lyrix's `innertubeService.ts` (ROADMAP §19): Innertube POST endpoints with WEB/WEB_REMIX contexts, recursive renderer traversal, `H:MM:SS` duration parsing, filter keyword sets, a concurrency queue, and Invidious instance rotation — kept/refactored per §6.1, without Lyrix's Sentry, accounts, hard-coded `duration: 240`, or missing Piped tier.

## Goals / Non-Goals

**Goals:**

- One normalized `Track[]` contract from four keyless tiers with graceful fallback.
- Pure, fixture-testable parsing/normalization/filtering with zero network in CI.
- Per-instance, serverless-compatible resilience controls (timeout, abort, concurrency, dedup, TTL cache) with no external services.
- A thin, validated HTTP boundary whose diagnostics are safe and optional for consumers.

**Non-Goals:**

- Search UI, debounce/abort UX, search-history recording (M5/M7).
- Playback, stream handling of any kind, or YouTube Data API keys (M4/permanently excluded).
- Durable server state, global rate limiting, or cross-instance cache (impossible on serverless without forbidden infrastructure).
- Home/discovery surfaces, artist/album browse endpoints (M8/M9).

## Decisions

1. **Two-stage provider pipeline: provider-specific parse → shared normalize → shared filter/score.**
   Each tier implements one interface — `{ id, search(query, ctx): Promise<ProviderCandidate[]> }` — where `ProviderCandidate` is a small Spotivibe-owned type (videoId, title, artist text and id, album title/id when the tier provides them — the YTMusic album run, which Lyrix never parsed —, artwork candidates, optional duration, optional category hint, tier id). One shared module converts candidates to canonical `Track`s (duration parsing, artwork selection, artist joining, categorization, `qualityScore`), and one shared filter module runs the centralized rules.
   *Why:* filters/scoring cannot drift per tier (spec: identical filtering regardless of tier), and normalization quirks stay isolated in each provider's parser. *Alternative:* providers return final `Track[]` — rejected: duplicates normalization and lets tier-specific filter drift re-enter.

2. **Canonical `Track` via type-only import from `@/data/repositories`.**
   The server layer imports `import type { Track, ... }` from the existing canonical contract; no runtime dependency on `src/data`, no type duplication, no file moves.
   *Why:* one source of truth already exists and search results must be structurally identical to what likes/playlists/session persist. *Alternative:* extract domain types into `src/types/` — rejected: repository reorganization outside M3 scope (AGENTS change-scope rule); revisit only if a real runtime coupling appears.

3. **Placement:** `src/server/http/` (timeout+abort-aware JSON fetch helper), `src/server/music/` (interface, candidate/normalized types, normalize, filter, score, orchestrator chain, limiter/dedup/cache, errors), `src/server/music/providers/` (four tier modules), and the only transport boundary `src/app/api/search/route.ts` (App Router route handler — the Next.js route-handler guide in `node_modules/next/dist/docs/` must be read before writing it).
   *Why:* matches the pre-made scaffold and AGENTS transport/domain separation; `route.ts` stays a thin validation/serialization shell.

4. **Tier order and stop condition:** fixed chain `ytmusic → ytweb → invidious → piped`; a tier "wins" when it parses ≥1 candidate that survives normalization+filtering; first winner ends the chain; failures (`timeout | network | http | parse | empty`) accumulate into diagnostics. Invidious and Piped rotate through a small built-in instance list (configurable via optional `serverEnvSchema` values documented in `.env.example`, per the `env.ts` contract), trying at most 2 instances each within the request budget.
   *Why:* matches ROADMAP §7.2 exactly; "usable results" (not just "HTTP ok") prevents a junk-only primary response from blocking better fallback results.

5. **Timeouts and abort:** one per-upstream-attempt timeout (4s, Lyrix-derived), a total request budget (~8s) so a full four-tier sweep cannot hang the serverless invocation, and explicit propagation of the incoming request's `AbortSignal` into every upstream fetch and into queue waits (queued-but-cancelled requests exit without firing).
   *Why:* bounded latency + no orphaned upstream work (spec scenarios); `AbortSignal.any`-style composition keeps it simple.

6. **In-module resilience primitives:** a FIFO semaphore capping concurrent outbound fetches per runtime instance (default 4), an in-flight `Map<key, Promise>` for identical-query dedup (entries removed on settle), and a bounded TTL result cache (default 60s, ~100 entries, insertion-order eviction). All are module-level, best-effort per instance — explicitly documented as non-durable, per ROADMAP §13 ("a serverless deployment cannot rely on process memory for durable global caching").
   *Why:* satisfies the spec without Redis. *Alternatives:* Redis/edge KV — forbidden baseline infra; Next `unstable_cache` — version-sensitive API, hides the dedup/limiter semantics tests must assert.

7. **HTTP caching:** successful `GET /api/search` responses send `Cache-Control: public, max-age=60` (CDN/edge-reusable, serverless-compatible); error responses send `no-store`. The in-module TTL cache and the HTTP header share the same constant so behavior stays coherent.
   *Why:* durable-ish caching across instances without infrastructure; testable headers.

8. **Route contract:** `GET /api/search?q=<string>&limit=<1..50, default 20>`; zod-validated; 200 `{ tracks: Track[], diagnostics: { tier, tiersTried: [{ tier, outcome }], cached, resultCount } }`; 400 `{ error: { code: "invalid_query", message } }` with no upstream call; 503 `{ error: { code: "upstream_unavailable", message } }` when all tiers fail. Diagnostics contain only tier ids/outcomes/cache status — never headers, keys, instance credentials, or raw upstream bodies. Consumers treat `diagnostics` as optional (UI must not depend on it).
   *Why:* small stable core contract; safe diagnostics per ROADMAP M3 ("expose diagnostics only when safe/useful").

9. **Filtering/scoring rules (centralized, pure, constant-driven):**
   - *Rejected titles:* reaction/vlog/interview/unboxing content; Shorts markers (`#shorts`, `shorts`); remix/mashup/slowed+reverb/8D/bass-boosted/nonstop/DJ-mix/megamix variants (Lyrix-derived regex sets, owned as Spotivibe constants).
   - *Duration bounds* (applies only when a duration is present): music must be 60–14400s, podcast 120–14400s (Lyrix-verified bounds); present-but-unparsable/zero/negative → reject. **Missing duration is allowed** (`Track.durationSeconds` is optional per §8.1) but incurs a quality-score penalty. *Why not reject missing:* the primary YTMusic parser often has no duration column; dropping those would gut the primary tier — Lyrix hard-coded `240` instead, which we deliberately do not.
   - *Categorization:* explicit provider marker wins; otherwise Lyrix's `duration > 1200s → podcast` heuristic (documented trade-off: long music may classify as podcast).
   - *Dedup:* exact by `providerId`; near-duplicate by normalized (lowercased, punctuation-stripped) title + first artist.
   - *Quality score (0–100):* deterministic sum of query-token overlap, metadata completeness (duration/artwork/artist present), and plausibility (duration within a typical-song window); penalties for missing duration; stable sort descending (ties keep provider order).

10. **Architecture-test extensions:** UI (`app/**` except `api/**/route.ts`, `components/**`, `features/**`, `stores/**`) must contain no `src/server` imports and no Innertube/renderer/provider-response type names; `src/server/**` must never import `src/data/indexeddb` or `@/server` secrets… (types-only import from `@/data/repositories` allowed); no route under `src/app/api/**` may return media bytes (no stream/proxy/extract paths). Detector self-tests follow the existing pattern in `tests/architecture.test.ts`.

11. **Fixtures over live network:** capture one real response per tier once (live request from the development machine) into `tests/fixtures/providers/*.json` and commit it as the behavioral evidence for the reference parsers; unit/integration tests parse fixtures and mock `fetch` for orchestrator/route tests — CI never hits the network. An optional browser evidence run (CDP against production `/api/search`) is attempted only if the upstream is reachable from this environment; if blocked, the blockage is recorded explicitly rather than faked.
    *Why:* AGENTS fixture/parity discipline + reproducible CI.

## Risks / Trade-offs

- [Innertube is undocumented and can change] → fixture-pinned parsers; parse failure = tier failure → graceful fallback chain; four tiers keep search alive when one shape drifts.
- [Public Invidious/Piped instances are flaky or dead] → treated as fallbacks only; instance rotation capped at 2 attempts within budget; built-in lists overridable via server env without code changes.
- [Serverless per-instance memory limits] → all in-module stores bounded (cache ~100 entries, dedup entries removed on settle, semaphore fixed); documented as best-effort, never as global rate limiting.
- [Filter false positives (legit tracks titled "remix"/"mix")] → conservative Lyrix-verified keyword sets; ordering by score keeps survivors on top; keyword refinement is an M5 tuning concern, not a contract change.
- [Category heuristic misclassifies long music as podcast] → explicit markers preferred; heuristic documented; harmless for playback (category affects presentation/discovery, not streamability).
- [Fixture staleness vs live drift] → drift surfaces as `parse`/`empty` tier failures (covered by fallback), not crashes; live evidence run (when reachable) cross-checks.
- [CDN caching of search could serve slightly stale results] → 60s TTL only on success; acceptable for discovery; error responses `no-store`.

## Migration Plan

Purely additive: new endpoint + new server modules; no existing route, data, or UI behavior changes. Deploy = standard `next build`/Vercel; rollback = revert the commit (no data or schema migration involved).

## Open Questions

- Long-term maintenance source for the built-in Invidious/Piped instance lists (env override already covers immediate needs; refreshing defaults can happen later without spec or architecture changes).
