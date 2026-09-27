# Proposal

## Why

Spotivibe has no way to discover music yet: M0–M2 delivered foundations, the shell, and local persistence, but there is no server-side path from a user query to results. ROADMAP M3 requires a stable Spotivibe music API independent of raw provider formats so that search, home/discovery, and playback milestones (M4/M5/M8) can build on one normalized contract without ever leaking Innertube renderer shapes into the UI.

## What Changes

- Define a `MusicProvider` interface and a multi-tier discovery chain: YouTube Music Innertube (primary) → YouTube Web Innertube → Invidious → Piped (fallbacks), all server-only under `src/server/music/`.
- Port/refactor only the needed Innertube traversal/parsing concepts from the Lyrix reference (ROADMAP §19: recursive renderer traversal, duration parsing, browser-context requests), rewritten as Spotivibe-owned code — no Lyrix dependencies, no Sentry, no hard-coded durations.
- Convert every provider response into canonical `Track` objects (ROADMAP §8.1): normalized video-ID `providerId`, artists/channel, artwork, duration when present, music/podcast categorization, `capabilities.stream=true` / `offlineDownload=false`, `qualityScore`.
- Add a centralized filtering and quality-scoring stage shared by all tiers: reaction/vlog/interview and Shorts rejection, unwanted remix/mashup/slowed+reverb/bass-boost/DJ-mix rejection, invalid-duration rejection, duplicate and near-duplicate collapse, score-based ordering.
- Add provider resilience controls: per-attempt timeouts, caller-disconnect abort propagation, a bounded outbound concurrency limiter, identical in-flight request deduplication, and short-lived best-effort caching compatible with serverless (HTTP `Cache-Control` + bounded per-instance TTL store) — no Redis, no API keys.
- Expose a `GET /api/search` route handler that validates input, returns only normalized tracks plus safe provider/source diagnostics, and degrades gracefully when tiers fail; it never proxies media and never accepts local user data.
- Extend the architecture tests to keep the provider layer server-only and the UI free of Innertube types; add fixture-driven unit/integration coverage for parsing, normalization, filtering, fallback, caching, and the API contract.

## Capabilities

### New Capabilities

- `music-provider`: The server-side music discovery layer — provider abstraction and tier order, normalized Track conversion, centralized filtering/quality scoring, resilience (timeouts, abort, concurrency, dedup, short-lived cache), the search API contract and its safety boundaries (no API key, no media proxy, no local data upload, diagnostics not a UI dependency).

### Modified Capabilities

<!-- None: M3 changes no existing spec-level behavior. -->

## Impact

- New code: `frontend/src/server/music/` (interface, four providers, normalization, filtering/scoring, orchestrator, cache/dedup/limiter), `frontend/src/server/http/` (timeout/abort fetch helper), `frontend/src/app/api/search/route.ts`.
- Modified: `frontend/src/server/env.ts` (optional provider-instance overrides in `serverEnvSchema`), `frontend/.env.example` (documented placeholders), `frontend/tests/architecture.test.ts` (server-only/UI-clean invariants).
- New tests and fixtures: `frontend/tests/providers/*.test.ts` + `frontend/tests/fixtures/providers/*.json` (captured provider responses), route-handler integration tests with mocked `fetch` — no network in CI.
- No new runtime dependencies; no API key required; no UI/search-page changes (search UX is M5); no changes to `src/data/`, IndexedDB, or backup behavior.
