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

**Every milestone now runs an independent read-only verification pass before its
Apply PR is merged.** The agent gets the specification and the implementation and
nothing else; it reports CRITICAL / WARNING / NIT findings with `file:line`, and it
drives the shipped bytes where that is the only way to check a rule. For M13 it found
nine defects that 2152 tests and a passing evidence run had all missed — including a
service worker that skipped waiting on install (making the entire update flow
unreachable), a search URL cached as a page when requested as a navigation, and an
offline shell that was silently FIFO-evicted after nineteen navigations. Treat this
pass as part of Apply, not as an optional extra: the bugs it finds are the ones no
test in the suite was written to catch.

**For M15 it ran twice, and both passes returned NOT MERGEABLE.** The second pass
re-attacked the first's fixes and found five more criticals, four of them the same failure
modes the first had already named — committed a second time and then reported as fixed.
Expect that: a verification pass that finds nothing the previous one missed is the
suspicious outcome, not the reassuring one.

**Status: the roadmap is complete.** M0 through M15 are all `DONE`, every change is
archived, and all 20 capabilities are in the specs of record. There is no next objective, and
no new milestone should be started without its own proposal PR.

What remains is not development but *verification that needs something this environment does
not have*: a real Vercel deployment, a second browser engine, and Firefox, Android, and iOS.
Each is written down as a manual entry with the steps to perform it — in
`frontend/docs/DEPLOYMENT.md`, and in the release gate's own NOT RUN output. The most useful
thing M15 left behind is the verification record in
`openspec/changes/archive/2026-09-30-add-release-validation-and-deployment/`, including the
thirty-four defects two independent passes found in it and the eight transferable lessons.

## Completed

| Milestone | Change (archived) | PRs / merges |
|---|---|---|
| M0–M8 | `openspec/changes/archive/2026-09-2*-*` | merged earlier |
| **M9** | `2026-09-29-add-artist-catalog-pages` | #37 propose `a51f587`, #38 apply `67c144e`, #39 sync `7d0dd86`, #40 archive `0de10e0` |
| **M10** | `2026-09-30-add-radio-and-local-personalization` | #41 propose `e99435a`, #42 apply `d6ce3d4`, #43 sync `636e642`, #44 archive `723b281` |
| **M11** | `2026-09-30-add-listening-insights-and-smart-mixes` | #45 propose `b735476`, #46 apply `9d9312b`, #47 sync `c7485f0`, #48 archive `802e403` |

| **M12** | `2026-09-30-add-podcasts` | #49 propose `b914875`, #50 apply `ead69e5`, #51 sync `93a2e21`, #52 archive `3cabc58` |
| **M13** | `2026-09-30-add-pwa-install-and-offline-shell` | #53 propose `e8f0576`, #54 apply `6bdc296`, #55 sync `74307b8`, #56 archive `f8e0afb`, #57 record `fbad5cc` |
| **M14** | `2026-09-30-add-deployment-hardening` | #58 propose `0d855f9`, #59 apply `d65abb4`, #60 sync `a6cfb1c`, #61 archive `e2362f9` |
| **M15** | `2026-09-30-add-release-validation-and-deployment` | #63 propose `f83f3f6`, #64 apply `0cbd1dc`, #65 sync `9b8bab7`, #66 archive `78baa67` |

Baseline at the M12 merge (`3cabc58`): **130 test files / 2084 tests**; after M13:
**134 test files / 2152 tests**; after M14: **140 test files / 2231 tests**, all six
after M15: **143 test files / 2316 tests**, all six gates green from a clean clone,
**and zero lint warnings** for the fourth milestone running. Specs of record: 20
capabilities, `release-validation` and `end-to-end` added. Archived changes: 16.

M15 is the last milestone in this roadmap. The release gate reports 18 passed, 0
failed, 8 not run, with 13 of 13 release-checklist items represented and one of them
only partly. Browser evidence: 11 of 11 end-to-end flows in Edge, 4 of 4
prove-can-fail probes, 11 screenshots.

## What M14's verification pass taught

It returned **NOT MERGEABLE** with two CRITICALs, both in the change's own work, and both
found by *executing* things rather than reading them. The transferable lessons:

1. **A byte count is not a character count.** The cache-integrity check compared
   `content-length` against a decoded string's length. Every prerendered page contains
   non-ASCII punctuation, so it deleted *intact* entries — four of nine routes behaved as
   if never visited and the artwork cache could never hit. The unit tests missed it
   because they built responses with **no** `content-length`, so the comparison never
   ran; the evidence missed it because it seeded only a *truncated* entry, so the
   false-positive path was never exercised. **A check that only proves the failure it was
   written for is half a check** — assert both halves of every pair you introduce.
2. **A rule can be green and wrong because its detector never saw the real shape.** The
   M11 guard for "outbound links never suppress the referrer" matched only an inline
   `"Referrer-Policy": "no-referrer"` pair, and the header was declared as a
   `{ key, value }` array entry — so a `no-referrer` header passed a rule written to
   catch one. Its self-test asserted the inline form and passed. **Prove each detector
   against the shape the code actually has**, and make the detector comment-aware, or it
   will flag the file that *explains* the decision.
3. **`npm run lint` exiting 0 does not mean no warnings.** Eight accumulated under a
   green build, including a dead import that made a task's description untrue. Check the
   warning count explicitly at the end of a milestone.
4. **A MODIFIED spec block can quietly get weaker.** Rewriting a requirement dropped its
   landmark clause; no scenario was lost, so nothing complained. Diff the normative text,
   not just the scenario names.
5. **Check the identifier a rule is about.** The limiter keys on `x-forwarded-for`, which
   a client sets. The honest fix was to document the assumption where the limitation
   lives, not to imply the loop is unconditionally closed.
6. **Measure both viewports.** The compact shell does not render at 1280×900, so a
   single-viewport audit reported every surface clean while an inactive navigation label
   sat at 4.16:1.
7. **A backtick in a comment inside a template literal ends the string** — hit this
   again in M14, in the evidence harness, *after* writing the rule down. Writing a rule
   down is not the same as obeying it; the check has to be mechanical.
8. **Edit a long generated file by line range, not by text anchor.** Two M14 repairs
   destroyed adjacent blocks that way (a whole evidence phase, a `)` past a `;`) and both
   were caught only by `node --check`. Run it after *every* scripted edit to a `.mjs`
   file, not just at the end.

## M12 state (archived)
- Archived change: `openspec/changes/archive/2026-09-30-add-podcasts` — `design.md`
  holds 9 decisions (2 and 4 amended by the verification pass), `tasks.md` all 10
  sections ticked plus §8b (the 17 findings the verification pass raised and how each
  was resolved) and §10 (the verification record and 10 recorded deviations).
- Evidence: `evidence/{cdp-check.mjs,results.json,README.md}` — `pass: true`, 32 steps,
  0 console errors, 6 screenshots, production build in headless Edge, port 3210.
- A verification subagent found 4 CRITICAL and 13 WARNING findings; none were waived.
  Two artifacts were indicted in opposite directions (the music-provider delta's
  promo-marker rule was wrong; design.md's "fallbacks search unchanged" was wrong),
  which is the most transferable lesson here: decide per finding *which* artifact the
  finding indicts, rather than reaching for the nearest one.
- Baseline note: the M11 ledger said "129 test files"; the verified count at `fa3e262`
  is 125 (vitest counts what it collects), so M12's delta is +5 files / +97 tests.

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

## M12 highlights worth remembering
- **A mode is a question, so it belongs in the request, not in a filter.** One bounded
  `category` parameter threaded route -> service -> chain -> providers -> filter ->
  cache key. Music mode omits the parameter entirely, so a pre-M12 music request is
  byte-identical (`/api/search?q=…&limit=20`) and its cache key unchanged.
- **Podcast mode skips `ytmusic` and records the skip.** A tier removed for category
  reasons is still reported as `{ tier, outcome: "skipped" }` — omitting it would make
  the diagnostics lie about what was asked. The evidence run reads this from the
  server: `ytmusic → skipped`, then the fallback chain carries the request.
- **Category pinning, not the duration heuristic, in podcast mode.** The `> 1200s`
  heuristic would have labelled a 6-minute spoken-word result as music and then dropped
  it on the music duration floor.
- **The filter split had to keep music byte-identical.** The plan put promo markers
  (`trailer|teaser|preview`) in the category-independent set, which would have *newly
  rejected* music results titled "Preview" — the one thing decision 4 promises not to
  do. They are podcast-only; Shorts is the only any-category rule; the music-only
  lists keep their exact pre-M12 bytes (substring matching, `react` inside "The
  Reactor"). `tests/music-filter.test.ts` carries a 22-row x 2-category table whose
  music column is the pre-M12 verdict, as the guard against the next refactor.
- **A blank id is not an id.** `providerIdFor(artist) ?? artist.name` took `""` as a
  provider id and produced `/artist/` — a keyless link that renders not-found and
  prefetches a 404. The Invidious tier returns podcast shows with a name and an *empty*
  channel id, so the mode made a pre-existing bug common. `ResultMenu` and
  `HistoryView` already used `nonBlank`/`isProviderEntityId`; the tile now agrees.
- **The session write is a 2s debounce fed by position updates**, so nothing is
  persisted while the engine keeps reporting positions. Pre-existing M6 behavior;
  harnesses must pause before reading the record. Documented, not changed.
- **The remote-empty search state is unreachable**: the chain reports "no tier produced
  a usable result" as a 503, which is the *error* state. Exercising an empty state in a
  browser needs one stubbed 200 response (disclosed).
- **The verification pass caught a music-scoped upstream parameter** in `piped`:
  `filter=music_songs` was sent for podcast requests too, so the one tier that answered
  a podcast query was asked to search songs. `pipedSearchFilter(category)` now omits it
  for podcasts. Note *which* artifact was wrong: the spec was right and design.md's
  "the fallbacks search their own indices unchanged" was not - amend the design and keep
  the spec. That is the reverse of the promo-marker case, where the delta's requirement
  text was the thing to fix. Decide per finding which artifact the finding indicts.
- **A local-library fallback in podcast mode renders under an "Episodes" heading**, so a
  liked song matching a podcast query became a mislabelled row. `searchLocalLibrary` now
  takes the mode and keeps podcast records only in podcast mode.

## M13 highlights worth remembering

- **"Offline" must be a genuinely unreachable origin, not an emulation.** A service
  worker is a browser-scoped target, so page-level `Network.emulateNetworkConditions`
  never reaches it: the page went offline while the worker's own `fetch()` kept
  succeeding, and a "served from cache" assertion was measuring the network. The
  harness now connects to the **browser** endpoint, auto-attaches at browser level so
  the worker target is observable, and *stops the production server* for the offline
  phase — asserting `originRefusedConnections` as a step, because everything else
  depends on it.
- **`child.kill()` does not free the port on Windows.** Next's own server process
  survived, so the "offline" phase was quietly online and an API probe reported
  network responses as cache behaviour. Kill the process **tree**
  (`taskkill /T /F`, or a process-group kill elsewhere).
- **A redirect beats serving one route's document under another route's URL.** Doing
  it the obvious way rendered the Home route at `/search`: wrong content, wrong
  address, and a step that passed because the shell-global offline banner matched its
  "the route explained itself" regex. Redirect to the shell so URL and content agree,
  and scope route assertions to the route's own `<main>` subtree.
- **`skipWaiting()` on install silently deletes an update flow.** A worker that skips
  waiting never enters `waiting`, so the page is never told an update exists: the
  notice is unreachable and the swap is silent. The test that "proved" it was
  asserting the very behavior the requirement forbids.
- **A FIFO bound can evict the one entry a guarantee depends on.** The precached shell
  lived in the page cache, so after ~19 document navigations the offline fallback was
  gone and the browser error page was back. A single entry with a bound of one belongs
  in its own cache.
- **Classify by path, not by request mode.** Checking `request.mode === "navigate"`
  before the `/api/` rule wrote a search result set into the *page* cache when a
  listener pressed Back while offline — the exact stale answer the deny rules exist to
  prevent.
- **"Keyless" is not "profile-free."** `/api/discover` was cached on a stated
  justification that was false: the client sends `seeds` derived from liked tracks and
  listening events. Check what the client actually sends, not what the endpoint's name
  suggests.
- **A test that has never been shown to fail is not evidence.** Three M13 steps could
  not fail: one scanned both phases so an all-fail offline phase still found online
  entries; one scanned the whole document so a crash page passed; one exempted cache
  names it did not recognize. Scope the assertion to what the step name claims, and
  prove each detector against a violating snippet.
- **Stored records are untrusted, on the surfaces too.** A liked row whose track could
  not fill `artists` crashed `/library/liked` into the error boundary — the same rule
  the repositories already apply per field at read time. Skip what a surface cannot
  render.
- **A backtick inside a comment inside a template literal ends the string.** Twice, in
  the same harness, a comment that mentioned `main` produced a parse error pointing
  at unrelated code. `node --check` the harness after every scripted edit; the symptom
  is a syntax error several lines away from the cause.

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
11. **`npm ci` fails with EPERM while a `next start` server is running** (it cannot
    unlink the SWC native binary). Stop the production server before the gate sequence.
12. **In-page `headings.find(...)` returns a string, so `.parentElement` is undefined.**
    A harness assertion that read the empty state's description through
    `string.parentElement` silently compared against `""`. Find the *element*, then read
    its text.
13. **A harness must not assert against a different query's data.** Comparing a browser
    search's rows with a probe of a *different* query produced a false failure; probe
    the same query the page searched (the server cache makes both read one result set).
14. **Architecture detectors that must find a guard need depth tracking.** A regex over
    an `if` condition stops at the first `)`, which is the one inside
    `PATTERN.test(lowerTitle)` — exactly the case a guard must be recognized for. The
    reported range must start at the `if`, because a rule used in `a && b` sits before
    the block's brace.
15. **Do not rewrite a large file with PowerShell line splicing.** A failed
    `List[string].AddRange` left the harness truncated to 38 lines with no error
    message; the run only survived because the file was committed. Use the edit tool
    for targeted changes, and `git checkout HEAD -- <file>` is the recovery when a
    scripted rewrite goes wrong mid-file.
16. **Run prettier from the directory that owns `.prettierignore`.** From the repo
    root, `prettier --write frontend/src frontend/tests` reformatted
    `frontend/tests/fixtures/**` — 15 byte-exact captured provider responses the
    repository forbids touching, ~22k diff lines. `.prettierignore` is at
    `frontend/`, so it was never consulted. Restore with
    `git checkout main -- frontend/tests/fixtures` and run prettier from `frontend/`.
17. **Assert the exact property, not a weaker inequality.** The evidence clamp check
    accepted `position >= 0 && position <= duration`, which a silent restart from 0:00
    would also pass. Exact comparisons, with constants read from the source at run
    time, turn a tautology into a check.
18. **A selection probe may retry; an assertion step may not.** A 503 while *choosing*
    a workable query is an upstream hiccup, and reading it as "no results exist"
    fabricates a conclusion. Retry the probe (recording every attempt) and never retry
    the thing being asserted.