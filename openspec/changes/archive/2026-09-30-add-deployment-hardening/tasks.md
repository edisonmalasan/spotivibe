# Tasks

## 1. Security

- [x] 1.1 Derive the domains the application actually contacts from its own sources (player host and its nocookie variant, artwork hosts, media host) and declare the Content Security Policy in `next.config.ts` from that list, with development-only relaxation and no relaxation in production — verify: a test compares the policy's directives against the domains the sources name, and fails on a domain that is permitted but unused or used but not permitted (spec: `security` — "Response security policy").
- [x] 1.2 Add the standard hardening headers to the same declaration, applying to every route, the manifest, the service worker file, and static assets — verify: a browser evidence step requests a document, a static asset, the manifest, and `sw.js` and asserts each response's headers.
- [x] 1.3 Comment every permissive directive with why it is there and record the debt, so the policy is readable rather than decorative — verify: a test asserts each permissive directive carries a named reason.
- [x] 1.4 Add a bounded, process-local request limiter and apply it to every public route, with a named ceiling, a fixed window, and a bounded map that evicts its own oldest entries — verify: unit tests cover the ceiling, a legitimate burst, the eviction bound, and the window rolling; the module states its per-instance limitation in its own documentation (spec: `security` — "Bounded per-instance request throttling").
- [x] 1.5 Prove the limiter end to end: a loop from one client is refused with a response naming the ceiling, and a human-rate sequence succeeds — verify: a browser evidence step issues both sequences against the running server and asserts the statuses.
- [x] 1.6 Pin the boundary contract in the architecture suite: every public route validates and bounds its parameters, serves only the methods it declares, accepts no listener-owned data, and declares no body-consuming method — verify: each detector is proven against a violating snippet before it is applied to the real routes.

## 2. Resilience

- [x] 2.1 Route every cache read in the worker through one helper that concludes when a stored entry is unusable, discarding it and treating the read as absent, and that treats a throwing read as a miss — verify: unit tests drive the shipped worker bytes with a truncated entry and a throwing cache, asserting a network fall-through rather than the corrupt entry (spec: `pwa` — "Service worker caching strategy").
- [x] 2.2 Prove recovery in a browser: seed a corrupt entry, reload offline, and assert the application still loads and the entry is gone — verify: a browser evidence step writes a truncated response into the worker's cache and asserts the page renders afterwards.
- [x] 2.3 Give storage failure a listener-visible state that names what happened and says the data was not deleted, rather than an empty library that looks like data loss — verify: a component test renders the state with storage refused, and a browser evidence step asserts it appears (spec: `local-data` — "Versioned IndexedDB storage with durable data").
- [x] 2.4 Make "a stored record is untrusted" a rule with a surface sweep behind it: audit every surface that maps over records, skip or default what it cannot render, and record any surface that legitimately cannot — verify: the architecture suite sweeps the surfaces, and each exception names its reason.
- [x] 2.5 Confirm the resilience items ROADMAP M14 lists that are already implemented stay implemented: playback retry caps, provider timeouts and fallbacks, bounded concurrency, and unplayable-track handling — verify: each is asserted by an existing test that is named, and any that is not becomes one here.

## 3. Performance

- [x] 3.1 Build a dependency-free measurement harness in the CDP shape M13 established that reports largest contentful paint, cumulative layout shift, and a responsiveness measure from a real browser, and records the machine, viewport, and cold-or-warm load — verify: the harness runs against a production build and its report names the conditions (spec: `performance` — "Core Web Vitals are measured without user telemetry").
- [x] 3.2 Assert the thresholds so a regression fails the run, with each target naming what it protects — verify: a deliberately degraded page fails the harness, proving the assertion can fire.
- [x] 3.3 Show the measurement collects nothing: no analytics, beacon, or remote-reporting call exists in the client — verify: a scan of the shipped sources for reporting calls, plus the architecture suite.
- [x] 3.4 Prove local lists are bounded with named constants, and that each truncated surface states its bound to the listener — verify: a test with a large synthetic history asserts the rendered entry count and the copy that states the bound (spec: `performance` — "Local lists stay bounded").
- [x] 3.5 Prove nothing repeats while the application is idle: no interval from playback, persistence, or synchronization is scheduled when nothing is happening, and playback-driven work stops with playback — verify: a sweep of every source for a repeating timer, asserting exactly one and that it is the player's, plus the engine's idempotent start and its stop, and a scan of the stores for none (spec: `performance` — "No interval runs while the application is idle"). **Amended after the verification pass:** the task originally promised a test that counts timers across an idle mount and a playback start/stop. That was not built — it needs a full fake YouTube-player harness to reach the engine's poll — so the requirement is unchanged and the check is a static sweep instead, with its limit recorded in the test's own documentation and in `evidence/README.md`. A self-rescheduling `setTimeout`, a `requestAnimationFrame` loop, or an interval reached indirectly would not be seen.

## 4. Accessibility

- [x] 4.1 Add four computable audits to the harness: contrast ratio of every rendered text style against its token background, an accessible name for every interactive element, a visible focus indicator on keyboard focus, and Tab reachability of every primary control — verify: each audit is proven against a violating page before it is run against the real one (spec: `app-shell` — "Accessibility fundamentals").
- [x] 4.2 Fix what the audits find, in the same change, recording anything whose fix belongs to another capability's owner with its reason rather than dropping it — verify: the audits pass on the fixed build, and the task record lists every finding and its resolution.
- [x] 4.3 Assert the contrast of the shipped token pairs themselves, so a future token change fails rather than silently lowering contrast — verify: a test computes every declared text-on-surface pair from the token values and checks it against the documented minimums.

## 5. Verification

- [x] 5.1 Extend the architecture suite for this milestone: the security policy is declared once and covers every route; the limiter is the only new server-side capability and stays off the provider layer; the audit harness stays outside the application bundle; no reporting or analytics call exists — verify: each detector is proven against a violating snippet.
- [x] 5.2 Produce browser evidence against a production build: the headers on a document, a static asset, the manifest, and the worker file; the throttling loop refused and a human burst accepted; offline rendering with a corrupt cache entry; the storage-failure state; the performance and accessibility audits; exactly one worker; and zero console errors — verify: `results.json` reports `"pass": true` with screenshots and a reproduce-path README disclosing every deviation, including the machine the measurement ran on.
- [x] 5.3 Run the full quality gates from the repository root (`cd frontend && npm ci`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`) — verify: every command exits `0`. **Run at the merged head and from a clean clone of it; every command exited `0`, and the repository is at zero lint warnings.**
- [x] 5.4 Re-verify the quality gates from a clean clone of the branch head, including the production build under the declared headers — verify: all six commands exit `0` in the fresh clone. **Run from a fresh clone of the merge commit: 140 test files / 2231 tests, the production build succeeding, and the browser evidence reporting `"pass": true` with 62/62 checks and 0 console errors.**
- [x] 5.5 Update `ROADMAP.md`: the M14 status row, the section checklist items this change delivers, and the targets the acceptance criteria refer to, with the reasoning that chose each number — verify: `git diff` shows the status cell, the ticked items, and the targets.

## Verification record

### What each wave produced

| Wave | Tasks | What exists now |
| --- | --- | --- |
| Security | 1.1–1.6 | `next.config.ts` declares one `Content-Security-Policy` plus the hardening headers, derived from the origins the code contacts and pinned by `tests/security-policy.test.ts` (9 tests, each proven against a real disagreement). `src/server/http/` holds a bounded process-local limiter applied to all seven routes through one shared `guardRequest`. |
| Resilience | 2.1–2.5 | Every worker cache read goes through `readUsable`, which concludes whether a stored entry can be served; an unusable entry is deleted and a throwing read is a miss, and a cache that cannot be *written* no longer breaks the response it was returning. `src/features/storage/` names a failed open instead of rendering an empty library. `src/data/repositories/renderable.ts` makes "a stored record is untrusted" a shared predicate, applied at the stores. |
| Performance | 3.1–3.5 | `evidence/audit.mjs` measures Core Web Vitals in a real browser at two viewports, asserts thresholds, and records its conditions. No analytics, beacon or reporting call exists in the client. Local lists are bounded by named constants that the surfaces state. One interval exists in the application and it is the player's, started and stopped with playback. |
| Accessibility | 4.1–4.3 | Four computable audits in the same harness, each proven against a degraded page first. Their findings are fixed in this change (see the evidence README's table). The token suite now tests *usage* rather than a hand-written pair list. |
| Verification | 5.1–5.2 | The architecture suite gained this milestone's rules, each proven against a violating snippet. `evidence/results.json` reports `"pass": true`, 62/62 checks, 0 console errors, four screenshots. |

### Defects the work found in itself

Nine, all fixed in this change. Four are worth naming because they were found by the
*measurement* rather than by reading code, and three of those four were defects in the
measurement:

1. The worker's `store()` let a cache **write** failure reject the whole request, so a
   device with a full store could lose a network response it already had.
2. `freshMetadata` read the cache directly to inspect the freshness stamp and validated
   the same key separately — two reads of one entry, one bypassing the usability check.
3. The first version of the audit injected its `PerformanceObserver`s *after* load and
   read a null LCP, which it reported as `0ms` — a measurement that looked like a result.
4. The audit reported two correctly labelled import-mode radios as unnamed, because it
   hand-rolled a subset of label association instead of using `element.labels`.
5. The audit's primary-control selector never matched role-based controls.
6. The audit measured one viewport, and so could not see the compact shell at all.
7. The compact shell's inactive navigation label was painted at 4.16:1.
8. `text-error` matched no declared token, so two `role="alert"` paragraphs rendered in
   the inherited colour.
9. A `//` comment in JSX children position rendered as page text — the author's own
   mistake, caught by the audit on five surfaces.

### Gates

Run from `frontend/` at the merged head, and again from a **fresh clone of the merge
commit** — so these are measured, not carried over from the branch.

| Command | Result |
| --- | --- |
| `npm ci` | 0 |
| `npm run lint` | 0, and **zero warnings** — the gate does not fail on warnings, which is how eight of them accumulated under a green build |
| `npm run format:check` | 0 |
| `npm run typecheck` | 0 |
| `npm test` | 0 — 140 files, 2231 tests (was 2152 at M13) |
| `npm run build` | 0 |
| `node evidence/audit.mjs` | 0 — 62/62, `"pass": true`, 0 console errors |

**Reconciled at Sync.** The first version of this table said 2225 tests, because it was
written before the verification pass's fixes added their regression tests. An evidence
record that understates what was verified is the same class of error as one that
overstates it, so the number is now the one the run produced, and the table says which
commit it describes. The harness's own `task` field was corrected at the same time: it
named four tasks while the run covered ten.

### What remains unverified, permanently

- **Rate limiting across serverless instances.** The limiter is per-process by design;
  a multi-instance deployment would need a shared store, which this project has no
  server for. Recorded in the spec and the module.
- **The CSP against a real deployment.** Verified against `next start`, which is what
  Vercel's Node runtime serves. A CDN that rewrites or strips headers would not be
  caught by this evidence.
- **Text over third-party artwork.** Not computable from the DOM; excluded and disclosed
  rather than guessed.
- **Focus traps and screen-reader announcement quality.** Reachability is checked from
  semantics, not by driving a screen reader.

### Independent verification pass

Run against this change's own specification and nothing else. Verdict: **NOT MERGEABLE**
— two CRITICAL findings, both in this change's own work, both verified by execution
rather than by reading.

**CRITICAL 1 — the integrity check compared a byte count to a character count.**
`isIntactResponse` compared `content-length` against the length of a *decoded* string,
which counts UTF-16 code units. Every prerendered page in this application contains
non-ASCII punctuation, so the check deleted **intact** cached documents: four of the nine
routes behaved as if never visited, and the artwork cache could never serve a hit. The
reviewer measured the difference directly — `/library` is 26463 bytes and 26461
characters, `/history` 30566 and 30564. Fixed by reading an `ArrayBuffer` and comparing
`byteLength`, with three unit tests that drive non-ASCII bodies and binary artwork
through the check, and with a browser assertion that an intact document is served from
its own route *and survives* the read. It was not caught here because the unit tests
built responses with no `content-length` (so the comparison never ran) and the evidence
seeded only a truncated entry (so the false-positive path was never exercised) — both
gaps are now closed.

**CRITICAL 2 — `Referrer-Policy: no-referrer` contradicted the `playback` spec of
record.** That capability requires the player "SHALL NOT suppress the page referrer", and
this change does not modify it. A response-level `no-referrer` suppresses the referrer
for exactly the attribution navigations the requirement is about, application-wide — and
the proposal cited the M11 rule about those links as the reason the header was missing.
Fixed by using `strict-origin-when-cross-origin`.

It was not caught because the M11 architecture guard — which exists precisely to catch
this — matched only an inline `"Referrer-Policy": "no-referrer"` pair, while the header
was declared as a `{ key, value }` array entry. Its self-test asserted the inline form,
so it passed over a real violation. The detector now matches any declaration shape,
strips comments first (a comment cannot suppress a referrer, and without that the rule
flagged `next.config.ts` for *explaining* why the suppressive value is wrong), and its
self-test exercises the shape the real code uses. This is the "an assertion nobody can
falsify is not evidence" failure M13 documented, reintroduced by the change that cites
that lesson.

**Fourteen WARNINGs**, all fixed: the record guard's `artwork` hole that six surfaces
would have crashed on; `readUsable` not surviving a cache it could not *open*; the
throttle's client-settable identity (documented rather than hidden); three README
disclosures absent from `results.json`; the no-middleware guard checking a filename Next
16 renamed; an eviction test that passed under LIFO as well as FIFO; task 3.5 promising a
runtime timer count that was never built (the task was amended, the requirement
unchanged); two spec scenarios with no test; the `app-shell` delta having dropped the
landmark obligation; the bottom-nav fix overriding the active label's colour; and
`form-action 'none'` resting on "there are no forms", where there are four.

**Nits**, all fixed: a dead export, a dead import, a typo, three unused test locals, a
`DEBT` count that let one note satisfy two directives, two evidence steps whose detail did
not match their assertion, a keyboard step name that read stronger than its check, a stale
`youtube-nocookie` claim in the proposal, and Windows-only browser paths in the harness.

Two findings were **accepted and recorded** rather than fixed:

- The limiter's key uses the first `x-forwarded-for` entry, which a client can set. Behind
  a proxy that *appends* rather than overwrites, rotating the header buys a fresh budget.
  A durable fix needs a trusted-proxy assumption or a shared store, and this project has
  no server; the limitation is now stated in the module, the spec, and the disclosures.
- Task 3.5's check is a static sweep, not a runtime timer count. Reaching the engine's
  poll needs a full fake YouTube-player harness, which is out of proportion to one
  scenario; the task text was amended to say what exists, and the limit is recorded.

The pass also reported what it could not verify: it did not execute the browser harness
(it starts and `taskkill`s a server and a browser), did not run `npm ci` or the
clean-clone gates, could not confirm `main`'s test count by checkout, and did not confirm
Vercel's `x-forwarded-for` behaviour. The orchestrator ran the gates; the numbers in the
table above are the orchestrator's, not the reviewer's.

## Archive record

Archived as `2026-09-30-add-deployment-hardening`, moved with `git mv` so the history
follows the files rather than being rewritten.

| Stage | PR | Merge |
| --- | --- | --- |
| Propose | #58 | `0d855f9` |
| Apply | #59 | `d65abb4` |
| Sync | #60 | `a6cfb1c` |
| Archive | this PR | see `ROADMAP.md` |

**State at archive.** 24 of 24 tasks ticked, all four artifacts `done`, and
`openspec validate --specs --strict` reporting **18 capabilities passed, 0 failed** — 16
before this change, plus the two it added. No active changes remain.

**What the milestone delivered, in one line each.** A response security policy declared
once and derived from the code (`security`, 4 requirements); best-effort per-instance
throttling on the public boundary; cache-corruption recovery that treats an unusable
entry as absent rather than as an answer (`pwa`); a listener-visible storage-failure
state and shared predicates for untrusted stored records (`local-data`); a
dependency-free harness that measures Core Web Vitals and audits contrast, names and
keyboard reachability at both viewports (`performance`, `app-shell`).

**Two design decisions were amended after the verification pass**, and the amendments are
in `design.md` rather than quietly dropped: decision 2 named four origins the shipped
policy does not permit and omitted the referrer decision entirely; decision 4 described
the corruption check without its unit, and the unit was the bug.

**The evidence's own limits, carried forward as the record.** These are not open work;
they are the boundaries of what was verified, and they are reproduced in
`evidence/results.json` and `evidence/README.md` so a reader of the numbers cannot miss
them: a single-machine run against a local production build is a regression signal rather
than a field lab score; INP is not observed, because observing it requires a real
interaction; the browser harness does not run on this repository's own CI runner, because
its browser candidates are Windows paths; the throttling ceiling is reached by
construction, since the run is the only client and the limiter is per-process; and the
address the limiter keys on comes from a header a client can set.

**Permanently out of scope, by design rather than by omission.** Rate limiting across
serverless instances needs a server and an account model this project excludes.
Nonce-based script and style hashing needs a build step and a deployment change, and is
recorded as debt against the two directives that must stay permissive. Durable
cross-instance throttling is the same exclusion as the first.
