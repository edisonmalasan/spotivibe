# MEMORY.md — Spotivibe session handoff (untracked working note, NOT part of the product)

> Progress ledger for long sessions. Intentionally uncommitted; never stage it.

## Objective

Finish the remaining roadmap milestones autonomously, following the `AGENTS.md`
OpenSpec lifecycle per milestone (Propose → Apply → Sync → Archive; one remote
branch + PR per stage; merge commits only) and keeping `ROADMAP.md` current.

## Completed

| Milestone | Change (archived) | PRs / merges |
|---|---|---|
| M0–M8 | `openspec/changes/archive/2026-09-2*-*` | merged earlier |
| **M9** | `2026-09-29-add-artist-catalog-pages` | #37 propose `a51f587`, #38 apply `67c144e`, #39 sync `7d0dd86`, #40 archive `0de10e0` |
| **M10** | `add-radio-and-local-personalization` | #41 propose `e99435a` (Apply in progress) |

Baseline after M9: **102 test files / 1436 tests**; all six gates green in a clean
clone. Main specs: `catalog` (new) + `app-shell`/`discovery`/`music-provider`/`search`/
`queue` updated. 10 archived changes.

## M9 highlights worth remembering
- Server `src/server/music/catalog.ts` + `/api/artist|/album|/similar`; ≤2 seeds,
  sequential, `CATALOG_*` budgets; `unresolvable` vs `upstream` split.
- A provider id is **never** rendered as a release title: `AlbumView.title` is
  optional, derived from *confirmed* album metadata; unconfirmed → neutral
  "Unconfirmed release" + `data-metadata-incomplete` attribute.
- `isProviderEntityId` / `normalizeEntityText` live in `src/lib/entityKeys.ts`
  (both catalog routes share them; a release id is `MPREb_…` — underscore rule).
- Evidence harness: `openspec/changes/archive/2026-09-29-add-artist-catalog-pages/evidence/`
  (`cdp-check.mjs`, `results.json` `pass: true`, 32 steps, README with 10 disclosures).

## M10 state
- Branch: create `feat/radio-personalization` from updated `main`; Roadmap M10 = `IN PROGRESS`.
- Deltas: ADDED `radio` + `personalization` (new capabilities), ADDED `music-provider`
  requirement (radio feed), MODIFIED `queue`/`search`/`app-shell`.
- Apply waves used: (1) server radio feed + radio client API ‖ taste profile/scorer/radioStore,
  (2) queue growth + radio source + refill/autofill engine ‖ entry points + autofill setting,
  (3) architecture + route contracts, (4) root: gates, CDP evidence, roadmap, clean clone, PR.
- Evidence harness must be written fresh for M10; the M9 harness is the template, and its
  README's "what the script is" + disclosures structure is the pattern to copy.

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
5. **`openspec validate` requires MODIFIED blocks to retain existing scenario *names*** —
   a scenario-level rename is not expressible; retain the name and disclose inline.
6. **The clean-clone gate (task x.4) earns its keep**: it caught a flaky architecture test
   (repeated full-tree reads tripping vitest's 5s default). Memoize tree reads; give I/O-bound
   sweep proofs an explicit timeout rather than weakening assertions.
