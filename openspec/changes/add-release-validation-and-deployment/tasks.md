# Tasks

## 1. Permanent exclusions enforced

- [x] 1.1 Add a release-time exclusion suite that asserts each permanent product constraint from ROADMAP §2 against the shipped sources: no accounts or authentication, **no cloud sync**, no cloud user database, no user-database dependency, no audio extraction or download, no forced background-play circumvention, no ad-blocking behaviour, and no media proxied through the application server (spec: `release-validation` — "The permanent product exclusions are enforced").
      **Eight, not seven.** Cloud sync was missing, and the gate's roadmap-coverage check is what surfaced it: the roadmap's checklist line reads "No account/auth/**cloud-sync** UI or code paths exist", and the first version mapped that line to the account and database exclusions alone. The roadmap makes cloud sync permanent, so it now has its own detector and fixtures. The sweep also reads `public/`, `scripts/`, and `next.config.ts`, not just `src/` — the first version walked `src/` only, so an ad-blocker in the service worker, which is where ad-blocking belongs, was unscanned by construction.
- [x] 1.2 Prove every detector against a violating snippet, one per exclusion, so a detector that cannot fail is never mistaken for one that passes — verify: each proof asserts the detector *does* flag its snippet.
      **Several per exclusion, not one.** A single snippet is a demonstration; several shapes are the evidence that a detector catches the thing it names rather than one phrasing of it. These are the shapes that got past a first draft of the detectors, written down as fixtures so they cannot be forgotten: a session-cookie identity, a bearer-token header, a home-grown session table; `python -m yt_dlp` with the underscore, and a hand-rolled extractor over `streamingData.adaptiveFormats`; `muted = true` plus a `visibilitychange` replay, and a poller that restarts playback; a media proxy with every variable renamed, and a buffer re-wrapped rather than a body streamed; an ad-blocker whose host list is assembled from string parts, and one keyed on a URL path.
- [x] 1.3 Prove every detector against the real sources, and make each one comment-aware, because the only account-pattern occurrence in `frontend/src` is a comment in `playlistRef.ts` reading "no account/OAuth/cookies anywhere" — the file documenting the constraint must not trip its own check (spec: `release-validation` — "A source that documents an exclusion is not reported as breaking it").
      The file is `src/server/music/playlistRef.ts`, and it is a *server* module, so the first version's sweep never reached it and the comment-aware behaviour it was written for was never exercised. A test now asserts the sweep reaches the file, so that behaviour cannot quietly stop being exercised.

## 2. End-to-end suite

- [x] 2.1 Build one maintained CDP harness, in the shape M13 established and M14 extended, with the plumbing written once: server lifecycle, browser launch, target attach, viewport control, and teardown — verify: it starts and stops its own production server, and `node --check` passes after every scripted edit.
      `node --check` after every edit turned out to be a habit rather than a gate, because the evidence scripts live outside `frontend/` and no quality gate reads them. `check-parses.mjs` is now a release-gate item.
- [x] 2.2 Record provider fixtures for search, artist, album, playlist, discovery, and radio responses, shaped like the payloads the normalizer actually produces, so a fixture that stops matching fails a unit test (spec: `end-to-end` — "A run does not depend on a third party being available").
      Two failure shapes rather than one, because a listener meets both: a route that *answers* with `ok: false` — the shape the application's own routes produce when every tier fails — and a route that never answers at all. The first version turned any status of 400 or more into a connection-level failure, so the `ok: false` bodies the fixtures exist to model were dead data.
- [x] 2.3 Implement the eleven named flows as falsifiable assertions on observable outcome: first launch and language onboarding, search and play, navigate while playing, add to queue, like track, create playlist with add/reorder/remove, reload and session restore, offline shell and library, backup export and import, provider failure fallback, mobile navigation (spec: `end-to-end` — "The critical flows are exercised in a real browser").
      **All eleven pass, and five of them did not before the verification pass**, because five asserted something other than the behaviour: `add-to-queue` asserted that a page mounted; `playlist-crud` never reordered and performed its "remove" by writing to IndexedDB itself; `session-restore` asserted that a record existed, which a reload satisfies whether or not the application restores anything; `first-launch` never touched language onboarding; and `provider-failure` only ever delivered one of the two failure shapes.
- [x] 2.4 Fail a flow that reaches a route's error boundary, scoped to the route's own subtree, because a crash that renders something is the failure a naive assertion misses (spec: `end-to-end` — "A crashed page is not a passing flow").
      The render assertion refuses an error boundary, and `prove-can-fail` injects one to show the refusal fires.
- [x] 2.5 Prove the suite can fail: run it against a deliberately broken condition per flow group and show each assertion firing (spec: `end-to-end` — "A detector is proven able to fail").
      Each probe breaks the application and then runs a **flow's own assertion** against the broken state. The first version probed three arbitrary expressions through `evaluate`, none of them a flow's assertion, so a harness whose `evaluate` always returned `undefined` would have reported every probe as failing.
- [x] 2.6 Run the suite against a second browser that speaks the same protocol, so coverage is not limited to one engine, and record which engines it covers in the repository (spec: `end-to-end` — "Automated browser coverage extends to what the tooling can drive").
      **Only one engine is installed on this machine, so no second-engine run happened.** The capability exists (`--browser=<engine>`, and the gate resolves the second engine from what is installed) and the absence is recorded rather than claimed: the gate reports a second-engine run as NOT RUN with the reason, and the results file records both `enginesInstalled` and `enginesRun`. The first version's gate command passed the literal `"second"`, which the harness rejects as unknown, so on a two-engine machine — the only machine where this could be satisfied — it would have failed every time.

## 3. Release gate

- [x] 3.1 Build a single-command release gate that runs every automatable checklist item, exits non-zero on any failure, and prints a per-item result or a not-run reason with steps (spec: `release-validation` — "The release gate is runnable and reports what it did not run").
      **17 passed, 0 failed, 8 not run.** The first version could not pass its own documented invocation: it ran `audit.mjs` from this change's evidence directory, where no such file exists, because the measurement is M14's and lives in that change's archive. It also rewrote M14's archived `results.json` — a record of a run that happened during M14 — which it now captures before and restores after, keeping its own copy as `measurement-results.json`.
- [x] 3.2 Cover the checklist items that are already enforced by earlier milestones — the manifest and worker validate, the security policy is declared, the backup round-trips — by invoking those checks rather than restating them.
- [x] 3.3 Report the items that cannot be automated here — a live Vercel deployment, the DESIGN.md visual audit, Firefox desktop, Android, iOS — as not run, each with the steps to perform it (spec: `release-validation` — "An item that cannot be automated is reported as not run").
      A skipped item carries its steps too, rather than being a silent omission.
- [x] 3.4 Assert that every checklist item appears exactly once in the output, so a reader can account for the whole list (spec: `release-validation` — "Every checklist item appears in the output").
      Checked against **`ROADMAP.md`'s own checklist, which is read**, not only against the gate's list. The first version checked its own list for duplicates, which it passes by construction: it could not detect a checklist item with no line at all, and "Backup format/version documented" had none.

## 4. Deployment contract

- [x] 4.1 Assert the deployable shape: one application, no custom server, no middleware or proxy hook, no required environment variable, the security policy declared in `next.config.ts` rather than at the edge, and the service worker and manifest served as static files whose caching does not block updates (spec: `release-validation` — "The deployment contract is asserted").
      The hook check now covers **both roots**, because Next resolves it relative to the project root *or* to a `src/` directory beside it, and this application has one. The first version looked only at the root, where Next would never load a file, so a working `src/proxy.ts` passed every assertion. One assertion was also a tautology — a boolean compared with itself — and now compares the document's central claim against the code that decides it. A further check reads every `process.env` access in the server tree against the schema, so an undeclared required read cannot hide.
- [x] 4.2 Pin the verified runtime in `package.json` `engines`, because without it a Vercel build uses the host's default Node rather than the Node this repository is verified on — and would still build, since the application has no required variables, no custom server, and no native dependencies (spec: `release-validation` — "A build uses a different runtime than the one verified").
      Pinned to `>=26 <27`, a range so a host with a different patch can satisfy it, with a test that the pin and CI's `node-version` cannot drift apart.
- [x] 4.3 Record the deployment procedure: what a Vercel deploy needs, what it needs nothing of, how to verify the deployment afterwards, and how to roll back — verify: it states that the first deployment is a manual step with these instructions, rather than claiming a check that never deploys.

## 5. Documentation

- [x] 5.1 Document the backup format for a person: version, top-level fields, what each holds, the compatibility rule, and where the code that writes it lives, citing the tests that hold it honest (spec: `release-validation` — "A person can tell whether a backup can be restored").
      The document cited a test that **did not exist** — it claimed no server value reaches an export and pointed at a suite with no such check. That claim is now actually tested, with the provider override deliberately *set* so the test cannot pass because the value was absent, and a new suite holds all three documents to the code they describe: fields and datasets read from the schema and the real serializer, every cited path resolved, the browser matrix's automated/manual split asserted to come *before* the table, and each manual entry required to carry steps and say what evidence to produce.
- [x] 5.2 Document the browser support matrix, leading with which targets are automated and which are manual, with instructions and what to look for for each manual entry (spec: `release-validation` — "The matrix does not imply coverage it does not have").
- [ ] 5.3 Update `README.md` and `MEMORY.md` for the release state, and `ROADMAP.md`'s M15 status, in their own `docs:` commit.
      **Deliberately left for the Sync and Archive stages.** These files describe the repository as it will be after the change is merged, and the root orchestrator owns them; writing them now would record a release state that does not exist yet on `main`. Carried forward deliberately, not missed.

## 6. Verification

- [x] 6.1 Run the release gate, the end-to-end suite against both browsers, and the full quality gates (`npm ci`, `lint`, `format:check`, `typecheck`, `test`, `build`) — verify: every command exits `0` and the gate reports a per-item result for the whole checklist.
      Gate: 17 passed, 0 failed, 8 not run, all 13 roadmap checklist items represented. Suite: **11 of 11** flows in Edge, with 4 of 4 prove-can-fail probes failing as required. Tests: **2295 across 143 files**. **A second-browser run did not happen** — one engine is installed — and the gate reports that as NOT RUN with the reason rather than as a pass.
- [x] 6.2 Re-verify from a clean clone of the branch head — verify: all six gates plus the release gate and the end-to-end suite exit `0` in the fresh clone.
      Done from a fresh `git clone` of the branch head: `npm ci` (445 packages), `lint` **0**, `format:check` **0**, `typecheck` **0**, `test` **2295 across 143 files**, `build` **0**, end-to-end **11 of 11**, release gate **17 passed / 0 failed / 8 not run** with all 13 roadmap checklist items represented. The run left M14's archived measurement record untouched, which is the point of restoring it — only this change's own evidence was regenerated.
- [x] 6.3 Record the release evidence: the gate's per-item output, the suite's results with the browsers it ran against, screenshots, and a README disclosing every deviation and every item that was not run (spec: `release-validation` — "The roadmap reflects the release").
      `evidence/README.md` discloses 22 defects found in this work, every limit, and the fact that one browser engine is installed. Screenshots: **11 PNGs**, one per flow, from the single run in which every flow passed — the first set mixed passing and failing states, including a stale `first-launch-fail.png` from before that flow was corrected, and a screenshot set that contradicts its own results file is worse than none.
- [ ] 6.4 Tick the M15 items in `ROADMAP.md`'s release checklist that this change delivers, and record the ones it does not with their reason, so the checklist is a record rather than an aspiration.
      The gate now reads that checklist and fails if an item has no line above it, which is the mechanical half. Marking each row in `ROADMAP.md` is the Archive stage's bookkeeping.

## Verification pass record

An independent read-only verification pass ran against the branch and returned **NOT
MERGEABLE**, with 10 critical findings, 10 warnings, and 6 nits. Ten of the criticals and the
warnings listed in the evidence README are fixed. The transferable lessons, because they are
the point rather than the fixes:

1. **A rule can be green and wrong because its detector never matched the code's real shape.**
   The first version of the referrer guard, and again of the request-hook check, and again of
   the media-proxy detector: each existed, each passed, and each would have missed the thing
   it names. The check on a detector is not that it passes — it is that it has been *seen to
   fail*.
2. **Proving a detector against a snippet its own author wrote proves much less than it
   appears to.** Eighteen realistic probes; seventeen undetected. The fixtures are now the
   shapes that got past the first draft.
3. **A detector can be wrong in both directions, and the permissive one's opposite is just as
   damaging.** Three patterns fired on the application's correct code. A check that cries wolf
   gets switched off, and a switched-off check is worse than none because it looks like
   coverage.
4. **A record that understates its coverage is the same class of error as one that
   overstates it.** A one-flow diagnostic run had overwritten the release record with
   `"pass": true`.
5. **A check that confirms its own assumption is worse than no check.** The playlist flow's
   "remove" wrote to IndexedDB and asserted its own return value.
6. **An assertion can be wrong about the *condition* rather than the code.** Two flows demanded
   things a correct application does not do, and each would have had someone change the
   application to satisfy the test.
7. **A scope that misses where the thing lives makes the check theatre.** `src/` only, when an
   ad-blocker belongs in the service worker.
8. **The archived record is a claim about a past run, and a later milestone must not be able
   to rewrite it.** Running M14's harness from here replaced its `results.json`.
