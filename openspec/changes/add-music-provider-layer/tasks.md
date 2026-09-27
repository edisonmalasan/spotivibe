# Tasks

## 1. Foundation: contracts, env config, HTTP helper

- [x] 1.1 Define the provider interface and shared server types (`ProviderCandidate`, tier ids, failure kinds, diagnostics) under `frontend/src/server/music/` with type-only imports of canonical `Track` from `@/data/repositories`; verify `npm run typecheck` passes.
- [x] 1.2 Add optional Invidious/Piped instance-list overrides to `serverEnvSchema` in `frontend/src/server/env.ts`, document them with placeholders in `frontend/.env.example`, and verify `frontend/tests/env.test.ts` covers declared-optional values plus startup-safe absence.
- [x] 1.3 Implement `frontend/src/server/http/` timeout/abort-aware JSON fetch helper and verify unit tests cover timeout abort, non-2xx failure, invalid JSON failure, and caller-signal propagation (mocked `fetch`, no network).

## 2. Provider fixtures and tier parsers

- [x] 2.1 Capture one live response per tier (YouTube Music Innertube, YouTube Web Innertube, Invidious, Piped) into `frontend/tests/fixtures/providers/*.json` with a provenance note (date, request shape) in `frontend/tests/fixtures/providers/README.md`; verify each fixture parses as JSON. If an upstream is unreachable from this environment, record the exact failure and commit a clearly labeled minimal synthetic fixture for that tier instead. (Captured live 2026-09-27: all four tiers reachable — Invidious via `invidious.f5.si`, Piped via `pipedapi.ducks.party`; all four fixtures parse.)
- [x] 2.2 Implement the YouTube Music Innertube provider (request builder: WEB_REMIX context/headers/songs filter param; recursive renderer traversal parser) and verify fixture tests assert extracted candidates (video IDs, titles, artist text, duration/artwork when present, no hard-coded durations).
- [x] 2.3 Implement the YouTube Web Innertube provider (WEB context, recursive `videoRenderer`/`compactVideoRenderer` traversal) and verify its fixture tests pass.
- [x] 2.4 Implement the Invidious provider (built-in/env instance list, ≤2 instance attempts, `/api/v1/search` parse) and verify its fixture tests pass, including instance-rotation behavior on a failing instance (mocked fetch).
- [x] 2.5 Implement the Piped provider (instance list, `/search` parse) and verify its fixture tests pass, including rotation on failure (mocked fetch).

## 3. Shared normalization, filtering, and scoring

- [x] 3.1 Implement candidate→`Track` normalization (duration text parsing `M:SS`/`H:MM:SS`, artwork pick with `i.ytimg.com` fallback, artist-name joining, category marker preference + duration heuristic, `capabilities { stream: true, offlineDownload: false }`) and verify unit tests cover present/absent durations and fallback artwork.
- [x] 3.2 Implement the centralized title/duration filter (reaction/vlog/interview/unboxing, Shorts markers, remix/mashup/slowed+reverb/8D/bass-boosted/nonstop/DJ-mix/megamix; music 60–14400s and podcast 120–14400s only when duration is present; missing duration survives with penalty) and verify unit tests exercise every rejection class plus missing-duration survival.
- [x] 3.3 Implement duplicate collapse (exact by `providerId`, near-duplicate by normalized title + first artist) and the deterministic 0–100 `qualityScore` with stable descending ordering, and verify unit tests cover both dedupe paths, ordering, and score penalties.

## 4. Orchestrator: chain and resilience

- [x] 4.1 Implement the fixed four-tier chain with failure taxonomy (`timeout | network | http | parse | empty`) and first-usable-tier stop, and verify tests cover: primary success stops the chain; primary failure falls through; a failing middle fallback with later success returns results; all tiers failing produces a structured aggregate error.
- [x] 4.2 Implement per-attempt timeout, total request budget, and incoming-request signal propagation into queue waits and upstream fetches, and verify tests show a hung upstream aborts and falls through and that caller abort cancels queued/in-flight work (mocked hanging fetch, short injected timers — native `AbortSignal` clocks are not fakeable).
- [x] 4.3 Implement the bounded outbound-concurrency semaphore (default 4, FIFO) and verify a test observes that concurrent upstream calls never exceed the cap.
- [x] 4.4 Implement identical in-flight request deduplication and verify a test shows two concurrent identical searches produce one upstream call with equal responses for both callers.
- [x] 4.5 Implement the bounded TTL result cache (60s shared constant with the HTTP layer, ~100 entries, insertion-order eviction) and verify tests cover hit, expiry → refetch, and bound enforcement.

## 5. Search API route

- [x] 5.1 Read the Next.js route-handler guide in `frontend/node_modules/next/dist/docs/` and implement `frontend/src/app/api/search/route.ts` (`GET`, zod-validated `q`/`limit`, 200 `{ tracks, diagnostics }`, 400 invalid query with no upstream call, 503 all-tiers-failed, `Cache-Control: public, max-age=60` on success and `no-store` on errors); verify integration tests (mocked fetch) cover all status paths, the diagnostics safe subset, and the header behavior.
- [x] 5.2 Verify the baseline-keyless scenario: search completes with a completely empty server environment (no provider configuration values) in an integration test.

## 6. Architecture invariants

- [x] 6.1 Extend `frontend/tests/architecture.test.ts` with detectors + detector self-tests: UI code (`app/**` except `api/**/route.ts`, `components/**`, `features/**`, `stores/**`) imports neither `src/server` nor Innertube/renderer/provider-response type names; `src/server/**` never imports `src/data/indexeddb`; no `src/app/api/**` route returns media bytes; and verify the suite passes with the real source tree.

## 7. Evidence

- [x] 7.1 Capture M3 evidence against a production build: from a real browser page origin, issue `GET /api/search` (via the dependency-free CDP script approach used for M2) and record response status, normalized shape, and zero console errors; store the script, machine-readable results, and README under `openspec/changes/add-music-provider-layer/evidence/`. If the upstream providers are unreachable from this environment, record the exact network failure and instead record evidence from the fixture-driven suite run against the production build, clearly classified as such. (Captured live 2026-09-27: all 8 steps passed, upstreams reachable — tier ytmusic answered first attempt, no fixture fallback needed.)

## 8. Final verification

- [x] 8.1 Run the full local gate sequence (`npm run lint`, `format:check`, `typecheck`, `npm test`, `npm run build`) and verify every command exits 0, recording test counts. (2026-09-27: all five exited 0; `npm test` = 32 files / 269 tests passed.)
- [x] 8.2 Run `openspec validate add-music-provider-layer --strict` and verify it reports the change valid. (2026-09-27: `Change 'add-music-provider-layer' is valid`.)
- [x] 8.3 Repeat the full gate sequence from a clean checkout of the branch and record the results in the Apply PR description (AGENTS.md verification-evidence rules: distinguish automated/static/browser evidence). (2026-09-27: fresh `git clone --depth 1` of `feat/music-provider-layer` at `2b25225` into a temp directory — `npm ci`, lint, format:check, typecheck, `npm test` (32 files / 269 tests), build all exited 0.)
- [x] 8.4 After verification passes, update `ROADMAP.md` §5 so M3 reads `DONE`, decide which §11 Search/Discovery checkboxes this milestone actually delivers (tick only those), and verify no other milestone row changed. (M3 row → `DONE`; §11 ticks: the four provider tiers, music quality/remix filtering, duplicate handling — server-side pipeline deliveries only; debounce/abort, local-library fallback, history, navigation, and podcasts remain for their own milestones. Diff verified: no other milestone row changed.)
