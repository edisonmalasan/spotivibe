# MEMORY.md — Spotivibe session handoff (untracked working note, NOT part of the product)

> This file is a progress ledger for long sessions. It is intentionally left
> uncommitted and must never be staged into a commit or a PR.

## Objective

Finish the remaining roadmap milestones **autonomously**, following the
`AGENTS.md` OpenSpec lifecycle for each (Propose → Apply → Sync → Archive, one
remote branch + PR per stage, merge commits only) and keeping `ROADMAP.md`
milestone status + §11 checklist items current at every transition.

## Completed milestones (M0–M8) — all `DONE`, all stages merged

| Milestone | Change (archived) | Apply PR / merge |
|---|---|---|
| M0–M6 | `openspec/changes/archive/2026-09-2{7,8}-*` | merged earlier |
| M7 | `2026-09-29-add-local-library` | #30 / `5cf27fd` |
| M8 | `2026-09-29-add-home-discovery-surfaces` | #34 / `4f1ddae` (sync #35, archive #36) |

Baseline after M8: **91 test files / 1107 tests**; all six gates green in a clean
clone; browser evidence harness pattern lives in each archived change's
`evidence/cdp-check.mjs` (dependency-free CDP driver, `results.json` with
`"pass": true`, screenshots, disclosure README).

## Current state — M9 in progress

Change: `add-artist-catalog-pages` (Propose merged: PR #37 / `a51f587`).
Branch: `feat/catalog-pages` (created + pushed). Roadmap M9 = `IN PROGRESS`.

**Wave 1 DONE (uncommitted):**
- Server: `frontend/src/server/music/catalog.ts`, routes `api/artist`,
  `api/album`, `api/similar`; tests `music-catalog.test.ts`, `catalog-route.test.ts`
  (99 tests). Bounds: ≤2 seeds, sequential, `CATALOG_SEED_TIMEOUT_MS=10_000`,
  `CATALOG_FEED_BUDGET_MS=20_000`. `unresolvable` vs `upstream` distinction.
  Risk noted: name-keyed artist requests credit-filter results, so an unusual
  channel name can 404 — loosen `creditsArtist`, not the client, if evidence shows it.
- Client artist surface: `features/artist/{artistKeys,artistApi,ArtistView,likedByArtist}.ts*`,
  `app/artist/[key]/page.tsx`; tests `artist-{keys,api,view}` (72 tests).
  Exports: `isProviderEntityId`, `artistRequestKey`, `artistHref`,
  `albumHrefFor` (TEMPORARY duplicate — see below), `normalizeEntityText`,
  `ArtistApiError`, `fetchArtist`, `likedTracksByArtist`.

**Open integration decision (root):** the album feature will own the canonical
`albumHref` in `features/album/albumKeys.ts`; delete `albumHrefFor` from
`features/artist/artistKeys.ts` and repoint `ArtistView` to import the canonical
one (agent even wrote a test pinning format compatibility).

**Remaining M9 work (waves):**
- Wave 2: (C) album surface — `features/album/*`, `app/album/[key]/page.tsx`;
  (D) related content + Now Playing presentation — generalize
  `useDiscoveryShelf` with a `fetchTracks` override, More Like This shelf via
  `/api/similar`, artwork-derived background, reduced-motion marquee.
- Wave 3: (E) entry points repointed (M5 search artist/album tiles, result menu
  go-to-artist/album, M8 Home artist cards); (F) architecture rules +
  `tests/routes.test.tsx` (tasks 7.1/7.2).
- Wave 4 (root): tick tasks, run six gates, build + run CDP evidence harness
  (write `evidence/cdp-check.mjs` for M9), tick 8.2/8.3, roadmap M9 → DONE +
  §11 ticks, clean-clone re-verify (8.4), push, PR, `gh pr checks --watch`,
  `gh pr merge --merge --delete-branch`.
- Then Sync (specs deltas: ADDED `catalog`, ADDED `music-provider` requirement,
  MODIFIED `app-shell` Now Playing) and Archive.

Then continue M10 → M15 the same way (radio/autofill, history/stats/streaks/
Smart Mixes, podcasts, PWA/offline, hardening, release validation/deploy).

## Hard-won lessons (apply to every milestone)

1. **Encode PowerShell edits with explicit UTF-8.** `Get-Content`/`Set-Content`
   round-trips are lossy for `—`/`§`; `[System.IO.File]::WriteAllText` with a
   UTF8 encoding object is safe. Prefer the edit/write tools for spec files.
2. **Bound provider fan-out.** The M8 verifier found 80 simultaneous chain calls
   against a 4-slot limiter whose 8 s budget started before slot acquisition →
   mass shelf timeouts. Every new endpoint: ≤2–8 seeds, sequential, per-seed +
   feed budget, and a client-side cap on concurrent requests.
3. **Run an independent verification subagent before merging**; fix every
   CRITICAL and acknowledge warnings in the PR body. If the *spec* is wrong
   (e.g. the unsatisfiable DESIGN.md shelf-rhythm rule, or the `limit`
   parameter), amend the artifact and record why — do not bend the code.
4. **Evidence harness assertions must be source-verified**: extract copy/test ids
   from the sources at startup, and remember `IconButton` puts its label in
   `aria-label` only; wait for async embed creation before counting iframes.
5. One milestone per orchestration run unless continuous execution is
   explicitly requested (it is, for this stretch).
