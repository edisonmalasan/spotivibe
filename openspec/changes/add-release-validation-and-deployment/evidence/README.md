# M15 release evidence

The release gate, the end-to-end suite, and — item by item — what they establish and what
they do not.

## Reproducing

```bash
# from the repository root
cd frontend
npm ci
npm run build
cd ..
node openspec/changes/add-release-validation-and-deployment/evidence/release-gate.mjs
```

Exit code `0` means no automated check failed. **A NOT RUN item has not passed either**:
the gate prints one line per checklist item with a result or a reason and the steps to
perform it, and its tally names both numbers. `--skip-browser` omits the browser-driven
checks, and they are then reported as skipped *with* the command that would run them.

Individual suites:

```bash
node openspec/changes/add-release-validation-and-deployment/evidence/end-to-end.mjs
node openspec/changes/add-release-validation-and-deployment/evidence/end-to-end.mjs --flow=offline
node openspec/changes/add-release-validation-and-deployment/evidence/end-to-end.mjs --prove-can-fail
node openspec/changes/add-release-validation-and-deployment/evidence/check-parses.mjs
```

## What the last run produced

| | |
| --- | --- |
| Release gate | 17 passed, 0 failed, 8 not run, all 13 roadmap checklist items represented |
| End-to-end suite | 11 of 11 flows passed in Edge (the one engine installed here) |
| Prove-can-fail | 4 of 4 probes failed as required |
| Unit and integration tests | 2295 across 143 files |
| Screenshots | 11, one per flow, from the run in which every flow passed |

The machine that produced this has **one** browser engine installed. The suite takes a second
(`--browser=<engine>`) and the gate reports a second-engine run as NOT RUN with the reason,
so a one-engine run is never read as a two-engine one.

## The end-to-end suite

Eleven flows, driven by **accessible name, role, and visible text** — which is both what the
flows a listener performs are made of, and a constraint worth keeping: a flow driven by
`aria-label` can only pass if the control is genuinely labelled, so the suite continuously
re-proves the accessibility work rather than testing around it. It adds no test-only markup
to the application, though it does *use* `data-testid` attributes that already existed
(`search-results`, `player-bar`, `compact-shell`); its own render assertions look for each
route's heading rather than a root test id, because the views mostly do not have one and
adding one to five components so a test could find them would be worse than asserting on
what a listener actually reads.

### What it proves, and what it cannot

**Provider responses come from recorded fixtures**, so a run is reproducible and does not
change when a third party rate-limits a CI runner. The boundary is explicit: **this suite
proves the application's behaviour and nothing about the providers.** A provider outage is
invisible to it by construction, which is why one scenario fails every provider deliberately
and asserts the fallback the listener sees — in both shapes a listener meets, an answered
`ok: false` and a dropped connection.

Four further limits, stated rather than discovered later:

- **Firefox, Android, and iOS are not driven.** The automation is a Chromium protocol.
- **The server-side tier chain is not reached.** The router replaces the whole same-origin
  request, so the route handler never runs; what the scenario proves is the *client's*
  handling of each failure shape. The tier chain itself is covered by the provider layer's
  own tests.
- **A file picker cannot be driven from a page**, so the backup flow asserts the import
  surface's own labelled file input and the presence of an export, not a file selection.
- **The YouTube IFrame player's state cannot be observed.** "Playing" is asserted as the
  application putting the track in its player, not as audio moving. A restore that showed an
  empty player would fail; a player that produced silence would not.

### The offline flow takes the origin down for real

It stops the `next start` process, the harness **proves the origin refuses connections**
before anything is asserted, and only then does the flow assert the library renders from the
worker — with a `main` region, no error boundary, real content — and finally brings the
origin back and asserts the same route loads from the network. That pair is what
distinguishes "the shell works offline" from "the page never really navigated".

It deliberately does **not** require the connection banner: the banner reports the browser's
own connectivity, and stopping one origin does not change that. The first version required
it and failed for exactly that reason — asserting the wrong condition, not finding a defect.

### Proving the suite can fail

`--prove-can-fail` runs four probes. Each breaks the application and then runs a **flow's own
assertion machinery** against the broken state, and each must fail. The first version probed
three arbitrary expressions through `evaluate`, none of which was a flow's assertion, so a
harness whose `evaluate` always returned `undefined` would have reported every probe as
failing — a proof that could not distinguish "the assertions are falsifiable" from "the
evaluator is broken". Two of the four probes were themselves wrong before they were right,
one with its polarity inverted, which would have had someone weaken a real assertion to make
the proof look right.

A suite whose assertions have never been observed failing is a report, not a check. M13's
verification pass found three evidence steps in this repository that could not fail.

## The release gate

Covers the roadmap's release checklist. Automated items run the quality gates, the PWA asset
drift check, the release suites, the permanent-exclusion and deployment-contract checks, the
backup round trip, the documentation checks, and a parse check over the evidence scripts.
Eight items are **manual** and carry their steps: the Vercel deployment, the DESIGN.md visual
audit, the three matrix targets that cannot be driven, the roadmap's own truthfulness, and the
provenance judgement behind `ATTRIBUTION.md`.

Two properties it holds about itself:

- **Every checklist item appears exactly once**, checked for duplicates *and* checked against
  the roadmap's own list, which is read from `ROADMAP.md`. The first version only checked its
  own list, which it passes by construction — it could not detect a checklist item with no
  line at all, and "Backup format/version documented" had none.
- **It never rewrites an archived record.** The accessibility and performance measurement
  belongs to M14 and writes its results next to itself, inside that change's archive; the
  archived file is captured before the run, restored after, and this change keeps a copy as
  `measurement-results.json`. The first run overwrote a claim about a run that happened
  during M14.

The evidence scripts live outside `frontend/`, so `npm run lint`, `format:check`, and
`typecheck` never read them. `check-parses.mjs` is the substitute, and it is a gate item: a
backtick inside a comment inside an interpolated template literal ended a string three times
while this change was written, and nothing failed until a flow was run.

## The permanent exclusions

Eight exclusions, each asserted against the shipped sources and each proven against **several
violating snippets** — the shapes that got past a first draft of the detectors, written down
so they cannot be forgotten. A detector proved only against a snippet its own author wrote
catches that phrasing and little else, which is what the first version of this suite had: the
verification pass probed the patterns with eighteen realistic snippets and seventeen passed
undetected.

The sweep reads `src/`, `public/`, `scripts/`, and `next.config.ts` together. The first
version walked `src/` only, so an ad-blocker in the service worker — which is where
ad-blocking belongs — was unscanned by construction.

Three detectors also fired on the application's **correct** code while being strengthened,
which is how a check gets switched off: a bare `googlevideo.com` rule matched the worker's
deny-list, a bare `new Response(x.body)` rule matched the worker's own cache copy and a fetch
helper's request body, and `volume = 0` matched a legitimate fade to 5%.

## The release documentation is held by the code

All three documents are asserted against what they describe: the backup document's envelope
fields and datasets are read from the schema and the real serializer, every path it cites must
resolve, and the claim that no server value reaches an export is now actually tested — with
the provider override deliberately *set*, so the test cannot pass because the value was
absent. That claim previously cited a test that did not exist, and the citation check is what
catches that class of error now.

## Defects found in this work

Twenty-two, all fixed. Several were in the harnesses, which is the point: a suite that cannot
report its own failures is not a suite.

**Detectors, three of them wrong on first contact with the real code**

1. The audio-download pattern flagged the **backup export** for using `createObjectURL` — a
   feature the roadmap requires. Forbidding the mechanism would have meant deleting it.
2. The media-proxy pattern matched only named hosts, so its own violating snippet — a
   generic forwarder — correctly did not match.
3. The exclusion sweep excluded the server tree, which is where the file documenting the
   no-account rule lives, so the comment-aware behaviour was never exercised.

**Detectors, then probed and found to miss the ordinary shapes**

4. An account system as a `cookies()` session jar, as a bearer-token header, or as a
   home-grown session table: all undetected.
5. A downloader invoked as `python -m yt_dlp` — underscore, which the pattern's list did not
   contain — and a hand-rolled extractor over `streamingData.adaptiveFormats` with no named
   tool anywhere: both undetected.
6. Background-play circumvention as `muted = true` plus a `visibilitychange` replay, and as a
   poller that restarts playback: both undetected.
7. Media proxying whose every variable was renamed, and a buffer re-wrapped rather than a
   body streamed: both undetected.
8. An ad-blocker whose host list was assembled from string parts, or keyed on a URL path:
   both undetected.
9. **Cloud sync had no detector at all**, and the roadmap makes it a permanent decision. The
   coverage check is what surfaced it.

**Harness, five of them capable of reporting success without testing anything**

10. The browser's version endpoint was read *before* the browser was launched.
11. The browser candidate list double-escaped its backslashes and found no browser.
12. The run loop broke at the offline flow, so **the three flows after it never ran** while
    the summary reported 8 of 11 without saying so.
13. The offline flow returned a flag and never stopped the origin.
14. A `RegExp.source` was interpolated without its delimiters.

**Flows, six of which could pass while the feature behind them was broken**

15. A one-flow run was recorded as the release result, with `"pass": true`.
16. `add-to-queue` asserted that a page mounted; `QueueView` renders its heading whatever it
    contains.
17. `playlist-crud` never reordered, and its "remove" wrote to IndexedDB itself and asserted
    its own return value.
18. `session-restore` asserted that a record existed — IndexedDB survives a reload whether or
    not the application restores anything.
19. `first-launch` never touched language onboarding, and checked instead that the browser
    supports service workers.
20. Two assertions were wrong about the *condition* rather than the code: the backup flow
    demanded a feedback region that only exists after an operation, and the offline flow
    demanded a connection banner that stopping an origin does not produce.

**Gate and evidence**

21. The gate could not pass its own documented invocation — it ran a file that does not exist —
    and three documents repeated the same false reference.
22. The gate rewrote an archived record; a `--browser=second` command that could never
    succeed; a "every checklist item appears" check that could not detect a missing item; a
    tautological deployment assertion; a proxy check in the one directory Next never reads; a
    backup document citing a test that did not exist; a `prove-can-fail` that proved nothing
    about the flows' assertions.

## Recorded conditions and limits

- **One browser engine is installed on the machine that ran this.** The second-engine path is
  implemented and reported honestly rather than claimed.
- **The deployment contract is asserted against the application's shape, not against a live
  Vercel account.** The first deployment remains a manual step;
  `frontend/docs/DEPLOYMENT.md` is the procedure and names the five things to verify.
- **The DESIGN.md visual audit is manual.** Contrast, accessible names, and keyboard
  reachability are computed and asserted; proportion, hierarchy, and visual rhythm are human
  judgements no check in this repository makes.
- **Whether Vercel honours `engines.node` is host behaviour**, verified by a person after the
  first deploy, not by anything in this repository.
- **The archived harnesses are untouched.** They are the record of thirteen specific runs, and
  the maintained suite learns from them rather than replacing them.
