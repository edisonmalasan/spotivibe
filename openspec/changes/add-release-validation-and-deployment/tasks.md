# Tasks

## 1. Permanent exclusions enforced

- [ ] 1.1 Add a release-time exclusion suite that asserts each permanent product constraint from ROADMAP §2 against the shipped sources: no accounts or authentication, no cloud user database, no user-database dependency, no audio extraction or download, no forced background-play circumvention, no ad-blocking behaviour, and no media proxied through the application server (spec: `release-validation` — "The permanent product exclusions are enforced").
- [ ] 1.2 Prove every detector against a violating snippet, one per exclusion, so a detector that cannot fail is never mistaken for one that passes — verify: each proof asserts the detector *does* flag its snippet.
- [ ] 1.3 Prove every detector against the real sources, and make each one comment-aware, because the only account-pattern occurrence in `frontend/src` is a comment in `playlistRef.ts` reading "no account/OAuth/cookies anywhere" — the file documenting the constraint must not trip its own check (spec: `release-validation` — "A source that documents an exclusion is not reported as breaking it").

## 2. End-to-end suite

- [ ] 2.1 Build one maintained CDP harness, in the shape M13 established and M14 extended, with the plumbing written once: server lifecycle, browser launch, target attach, viewport control, and teardown — verify: it starts and stops its own production server, and `node --check` passes after every scripted edit.
- [ ] 2.2 Record provider fixtures for search, artist, album, playlist, discovery, and radio responses, shaped like the payloads the normalizer actually produces, so a fixture that stops matching fails a unit test (spec: `end-to-end` — "A run does not depend on a third party being available").
- [ ] 2.3 Implement the eleven named flows as falsifiable assertions on observable outcome: first launch and language onboarding, search and play, navigate while playing, add to queue, like track, create playlist with add/reorder/remove, reload and session restore, offline shell and library, backup export and import, provider failure fallback, mobile navigation (spec: `end-to-end` — "The critical flows are exercised in a real browser").
- [ ] 2.4 Fail a flow that reaches a route's error boundary, scoped to the route's own subtree, because a crash that renders something is the failure a naive assertion misses (spec: `end-to-end` — "A crashed page is not a passing flow").
- [ ] 2.5 Prove the suite can fail: run it against a deliberately broken condition per flow group and show each assertion firing (spec: `end-to-end` — "A detector is proven able to fail").
- [ ] 2.6 Run the suite against a second browser that speaks the same protocol, so coverage is not limited to one engine, and record which engines it covers in the repository (spec: `end-to-end` — "Automated browser coverage extends to what the tooling can drive").

## 3. Release gate

- [ ] 3.1 Build a single-command release gate that runs every automatable checklist item, exits non-zero on any failure, and prints a per-item result or a not-run reason with steps (spec: `release-validation` — "The release gate is runnable and reports what it did not run").
- [ ] 3.2 Cover the checklist items that are already enforced by earlier milestones — the manifest and worker validate, the security policy is declared, the backup round-trips — by invoking those checks rather than restating them.
- [ ] 3.3 Report the items that cannot be automated here — a live Vercel deployment, the DESIGN.md visual audit, Firefox desktop, Android, iOS — as not run, each with the steps to perform it (spec: `release-validation` — "An item that cannot be automated is reported as not run").
- [ ] 3.4 Assert that every checklist item appears exactly once in the output, so a reader can account for the whole list (spec: `release-validation` — "Every checklist item appears in the output").

## 4. Deployment contract

- [ ] 4.1 Assert the deployable shape: one application, no custom server, no middleware or proxy hook, no required environment variable, the security policy declared in `next.config.ts` rather than at the edge, and the service worker and manifest served as static files whose caching does not block updates (spec: `release-validation` — "The deployment contract is asserted").
- [ ] 4.2 Pin the verified runtime in `package.json` `engines`, because without it a Vercel build uses the host's default Node rather than the Node this repository is verified on — and would still build, since the application has no required variables, no custom server, and no native dependencies (spec: `release-validation` — "A build uses a different runtime than the one verified").
- [ ] 4.3 Record the deployment procedure: what a Vercel deploy needs, what it needs nothing of, how to verify the deployment afterwards, and how to roll back — verify: it states that the first deployment is a manual step with these instructions, rather than claiming a check that never deploys.

## 5. Documentation

- [ ] 5.1 Document the backup format for a person: version, top-level fields, what each holds, the compatibility rule, and where the code that writes it lives, citing the tests that hold it honest (spec: `release-validation` — "A person can tell whether a backup can be restored").
- [ ] 5.2 Document the browser support matrix, leading with which targets are automated and which are manual, with instructions and what to look for for each manual entry (spec: `release-validation` — "The matrix does not imply coverage it does not have").
- [ ] 5.3 Update `README.md` and `MEMORY.md` for the release state, and `ROADMAP.md`'s M15 status, in their own `docs:` commit.

## 6. Verification

- [ ] 6.1 Run the release gate, the end-to-end suite against both browsers, and the full quality gates (`npm ci`, `lint`, `format:check`, `typecheck`, `test`, `build`) — verify: every command exits `0` and the gate reports a per-item result for the whole checklist.
- [ ] 6.2 Re-verify from a clean clone of the branch head — verify: all six gates plus the release gate and the end-to-end suite exit `0` in the fresh clone.
- [ ] 6.3 Record the release evidence: the gate's per-item output, the suite's results with the browsers it ran against, screenshots, and a README disclosing every deviation and every item that was not run (spec: `release-validation` — "The roadmap reflects the release").
- [ ] 6.4 Tick the M15 items in `ROADMAP.md`'s release checklist that this change delivers, and record the ones it does not with their reason, so the checklist is a record rather than an aspiration.
