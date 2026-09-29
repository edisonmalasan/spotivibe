# MEMORY.md — Spotivibe session handoff (session ledger, NOT part of the product)

> Progress ledger for long sessions. It is **tracked** in this repository (an earlier
> `git add -A` committed it, so it could no longer stay untracked) but it is not part of
> the shipped application: nothing under `frontend/` imports it and no build step reads
> it. Keep it accurate, and do not let a milestone commit carry incidental edits to it —
> put ledger updates in their own `docs:` commit.

## Objective

Finish the remaining roadmap milestones autonomously, following the `AGENTS.md`
OpenSpec lifecycle per milestone (Propose → Apply → Sync → Archive; one remote
branch + PR per stage; merge commits only) and keeping `ROADMAP.md` current.

## Completed

| Milestone | Change (archived) | PRs / merges |
|---|---|---|
| M0–M8 | `openspec/changes/archive/2026-09-2*-*` | merged earlier |
| **M9** | `2026-09-29-add-artist-catalog-pages` | #37 propose `a51f587`, #38 apply `67c144e`, #39 sync `7d0dd86`, #40 archive `0de10e0` |
| **M10** | `2026-09-30-add-radio-and-local-personalization` | #41 propose `e99435a`, #42 apply `d6ce3d4`, #43 sync `636e642`, #44 archive `723b281` |
| **M11** | `2026-09-30-add-listening-insights-and-smart-mixes` | #45 propose `b735476`, #46 apply `9d9312b`, #47 sync `c7485f0`, #48 archive `802e403` |

Baseline after M11: **129 test files / 1987 tests**; all six gates green in a clean clone.
Main specs: `insights` and `mixes` (new), `discovery`/`local-data` updated. 12 archived
changes. `openspec validate --specs --strict`: 14 passed, 0 failed. Next objective:
**M12 (podcasts)** — see ROADMAP rows 121-124; M13 PWA, M14 hardening, M15 release.

## M11 state
- Archived change: `openspec/changes/archive/2026-09-30-add-listening-insights-and-smart-mixes`
  (`tasks.md` §8 records the ten corrections the verification pass forced; `design.md`
  decisions 7-8 record the two amendments).
- Evidence: `evidence/{cdp-check.mjs,results.json,README.md}` — `pass: true`, 36 steps,
  0 console errors, 4 screenshots, run against a production build in headless Edge.
- No active OpenSpec changes remain (`openspec/changes/` holds only `archive/`).

## M11 highlights worth remembering
- **The recorder had to start measuring.** M8 wrote `secondsPlayed: 0` and deferred
  thresholds to M11, which made *every* real play classify as a skip — so play counts,
  streaks, and "no signal, no mix" were all unsatisfiable. The recorder now patches
  `secondsPlayed` (clamped to duration) and `completed` when a step ends: on the next
  load request, on detach, and on `pagehide`. Raw measurements only, never a verdict.
  Captured *per step* from the store's position ticks, because by the time the next load
  request arrives the store has already switched tracks.
- **`composeMix` is separate from persistence.** `generateMix` composes then creates;
  `refreshMix` composes then patches. Without the split a refresh briefly replaced the
  very name it must preserve, and resurrected a mix deleted in the meantime.
- **Mix identity** is `mix:<local day>:<first four seed terms>`, so a second build in
  the same period takes the refresh path (name preserved) instead of renaming silently.
- **The mixes dataset is derived but persisted** (IndexedDB schema v2, optional in the
  backup envelope, merges by id with newest `updatedAt`).
- The mix *surface* is on `/history`; the Home Smart Mixes shelf is list-only, so opening
  the feed never spends a provider request (design decision 8).
- `HISTORY_LIMIT`-style honesty: the History surface says "the most recent plays … up to
  50 at a time" because it renders `historyStore`'s 50-event window, and a negative test
  forbids any total/ranking/completeness claim on that surface.

## Hard-won lessons
1. **PowerShell edits**: `Get-Content`/`Set-Content` round-trips are fine, but
   `[System.IO.File]::WriteAllText` must use an explicit `New-Object System.Text.UTF8Encoding($false)`;
   prefer the edit/write tools. Inside double-quoted PowerShell strings, `` `r `` is a
   carriage return — a backtick-quoted word like `` `rows= `` silently corrupts text.
2. **Bound provider fan-out.** ≤2 seeds per request, sequential, per-seed + request budgets,
   a client-side cap. Background refill must be latched (one in flight).
3. **Run an independent verification subagent before merging**; fix every CRITICAL, and
   amend the *spec* (not the code) when the spec is wrong — record the rationale in design.md.
4. **Evidence harness assertions must be source-verified**: extract copy from the sources,
   `IconButton` puts its label in `aria-label` only, skeleton rows look like real rows (count
   controls, not rows), and a backtick inside a comment inside a template literal breaks the file.
   Copy labels differ from their confirm labels (`Reset Spotivibe data` vs `Reset everything`).
5. **`openspec validate` requires MODIFIED blocks to retain existing scenario *names*** —
   a scenario-level rename is not expressible; retain the name and disclose inline.
6. **The clean-clone gate (task x.4) earns its keep**: it caught a flaky architecture test
   (repeated full-tree reads tripping vitest's 5s default). Memoize tree reads; give I/O-bound
   sweep proofs an explicit timeout rather than weakening assertions.
7. **Trusted CDP clicks can silently miss.** An element scrolled under a sticky header
   receives the mouse event without activating. Try the trusted click, fall back to
   `element.click()`, and record which path ran in `results.json`.
8. **Steps that write data need the step to *end*.** Any harness step asserting recorded
   playback data must close each step (or assert on the last one being open); buffer a
   loaded-but-never-started track and its event honestly records zero seconds.
9. **Read the assertion's own error message.** `element.click()` on an untrusted
   expression or a selector interpolated without `JSON.stringify` fails as
   "Invalid left-hand side in assignment", not as "element not found".
10. **New tests can expose old bugs, and the old bug may be in shipped code.** The mixes
    round trip exposed `applyImport` opening stores the transaction did not span — a
    pre-existing failure for any import writing only *some* datasets. Reproduce the live
    shape in a unit test before assuming the new code is at fault.
