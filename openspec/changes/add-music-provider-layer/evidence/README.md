# M3 browser evidence — GET /api/search against a production build (task 7.1)

**Evidence class: browser/runtime evidence.** This directory captures what
unit tests cannot: the M3 search API responding inside a real Chromium
browser session against a **production build** (`next build` → `next start`),
issued from the real app page origin over the Chrome DevTools Protocol by a
dependency-free script (Node built-ins + the global `WebSocket` only — no
Playwright/Puppeteer packages).

Generated: 2026-09-27 (see `generatedAt` in `results.json`).

## What is proven

| Requirement | Result |
| --- | --- |
| `GET /api/search` succeeds from a page origin | `200`, `content-type: application/json`, `cache-control: public, max-age=60`, 1172 ms live (fresh profile) |
| Response contains only canonical `Track` fields | 10 tracks (limit honored), first `youtube:4D7u5KF7SP8` — "Get Lucky (feat. Pharrell Williams and Nile Rodgers)", Daft Punk et al., 370 s, `qualityScore: 100`; every key within the §8.1 canonical set |
| Diagnostics are the safe subset | `{ tier, tiersTried, cached, resultCount }` only; `tier: "ytmusic"`, `tiersTried: [{ tier: "ytmusic", outcome: "ok" }]`, `cached: false` |
| No raw provider structures cross the boundary | serialized body scanned for 8 renderer/response key names (`flexColumns`, `videoRenderer`, `musicResponsiveListItem`, …) — zero matches |
| Invalid request → structured 400, no upstream | `400`, `cache-control: no-store`, `{ error: { code: "invalid_query", message: "Invalid input: expected string, received undefined" } }`, 7 ms |
| Repeat within the TTL → server-side cache hit | second identical query: `200`, `diagnostics.cached: true`, byte-identical `tracks`, 25 ms (queried with `cache: "no-store"` so the hit is the **server** cache, not the browser's) |
| Zero console errors for the whole session | `consoleErrors: []`; the intentional 400 probe's browser network log is classified separately in `expectedNetworkLogs` |

All **8 steps passed** (`results.json` → `"pass": true`, script exit code 0).

Upstreams were reachable from this environment (live run — no fixture
fallback was needed): the primary YouTube Music tier answered on the first
attempt, so ytweb/invidious/piped fallbacks were not exercised in *this*
capture; they are covered by the fixture-driven suite
(`frontend/tests/music-chain.test.ts`, `frontend/tests/providers/*.test.ts`).

## Files

- `cdp-search-check.mjs` — the self-contained driver (launches headless Edge
  with a throwaway profile, loads `http://localhost:3210/`, performs the
  three page-origin fetches, writes `results.json`). If the route reports
  503 it additionally probes the primary upstream directly from Node and
  records the exact network failure for classification.
- `results.json` — machine-readable run report: steps with details, the full
  request/response payloads (live, invalid, repeat), summary of the first
  track, console errors, expected network logs, pass flag.

## How the capture works

1. Wait for the production server on `SPOTIVIBE_ORIGIN` (default
   `http://localhost:3210`), launch headless Edge with a fresh profile over
   CDP, and open the real app page origin (`/`).
2. **Live search** — from the page, `fetch("/api/search?q=daft%20punk%20get%20lucky&limit=10")`
   → assert status/header/canonical shape/safe diagnostics/no raw keys.
3. **Validation probe** — `fetch("/api/search?limit=10")` (no `q`) → assert
   structured 400 + `no-store`.
4. **Cache probe** — repeat the live query with `cache: "no-store"` → assert
   `diagnostics.cached === true` and identical tracks.
5. Assert zero console errors (`console.error`, runtime exceptions, and
   `Log` error entries are all captured); write `results.json`; exit
   non-zero on any failure.

## Reproduce

```bash
cd frontend
npm run build
$env:PORT=3210; npm run start    # separate shell
cd ..
node openspec/changes/add-music-provider-layer/evidence/cdp-search-check.mjs
```

Environment overrides: `SPOTIVIBE_ORIGIN` (default `http://localhost:3210`),
`SPOTIVIBE_BROWSER_PATH` (Edge/Chrome executable), `SPOTIVIBE_CDP_PORT`
(default `9444`). Exit code 0 means every assertion passed.

## What this does NOT prove

- Fallback-tier behavior against live upstreams (only tier 1 was needed) —
  covered by fixture-driven unit tests for all four tiers.
- The 503 all-tiers-failed path against live upstreams — covered by
  `frontend/tests/search-route.test.ts` (mocked failing fetch) since a live
  total outage cannot be reproduced on demand.
- UI search surfaces, playback, or queue integration — not in M3 scope
  (server provider layer only); the route is not yet consumed by UI code.
- Behavior beyond the single Chromium build used here.
