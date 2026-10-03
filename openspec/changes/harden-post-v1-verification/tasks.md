# Tasks

Ordered by dependency. Section 1 is the gate, because a gate that destroys the tree cannot be
used to verify any of the rest.

## 1. The release gate

- [ ] 1.1 Read the real gate (`openspec/changes/archive/2026-09-30-add-release-validation-and-deployment/evidence/release-gate.mjs`) and record its 24 items and their order as the baseline.
- [ ] 1.2 Add a dependency-tree completeness probe: the packages later steps invoke must exist and be loadable. Exit code alone is insufficient — the recorded incident was an install that left `node_modules/.bin` empty.
- [ ] 1.3 Replace `gates-install`'s `npm ci` with a staged install outside the working tree, cleaned up on every exit path including failure.
- [ ] 1.4 Refuse before touching anything when staging is impossible, with the reason named.
- [ ] 1.5 On an incomplete tree, emit exactly one failed result for `gates-install` and mark every remaining item `NOT RUN (environment)`.
- [ ] 1.6 Verify 1.5 by breaking the tree deliberately and counting the failures: it must be one, not sixteen.
- [ ] 1.7 Fix the CDP race: set the router's ready flag before `Fetch.enable`, and continue the request when the router is not ready.
- [ ] 1.8 Run the end-to-end item repeatedly and record the pass count out of the attempts.

## 2. CI ordering

- [ ] 2.1 Move `npm run build` before `npm test` in `.github/workflows/ci.yml`.
- [ ] 2.2 Add a test asserting the workflow's step order, so the ordering cannot silently regress to the shape that made M19's budget skip.
- [ ] 2.3 Confirm the budget file's size assertions execute rather than skip, and record the count that ran against the count that skipped.

## 3. Test isolation

- [ ] 3.1 Move `motion-scope.test.ts`'s probe out of `src/` into a directory the tree-walking guard excludes.
- [ ] 3.2 Share the excluded-directory constant between `motion-scope.test.ts` and `architecture.test.ts`, so a second spelling cannot drift.
- [ ] 3.3 Prove the collision by running both files concurrently against the pre-fix arrangement, and record the failure observed.

## 4. Flakes

- [ ] 4.1 `podcast-playback-history.test.ts` — replace the fixed 2000 ms polling with an await on the module-global chain; detach recorders between tests. Record the measured pass rate before and after.
- [ ] 4.2 `discover-view.test.tsx` "shows skeletons" — replace the negative assertion against a never-resolving stub with a wait on the condition being checked. Record the measured pass rate before and after.
- [ ] 4.3 `settings-ui.test.tsx` — reproduce, then diagnose. **Permitted to end undiagnosed**: record the three candidates as candidates and claim no fix. Re-running until green is not a fix.
- [ ] 4.4 Record each flake's measured pass rate before the fix, so "fixed" is a measurement rather than an impression.

## 5. Guards that cannot fail

- [ ] 5.1 Measure, per detector, how many clauses are deletable with the suite green.
- [ ] 5.2 For the three genuinely distinct detectors in `download-non-goals.test.ts`, consolidate clauses into the smallest set preserving coverage, then extend the load-bearing check to them.
- [ ] 5.3 For synonym detectors, rename to state the scope. Do **not** add a sole-carrier fixture per synonym — see design §2.7 for why, and record the decision where a later reader will find it before adding one.
- [ ] 5.4 Verify the extended check still permits coverage-preserving consolidation and still blocks coverage loss, in both directions.
- [ ] 5.5 Widen `download-non-goals.test.ts`'s scanned roots to `public/`, `frontend/scripts/` and `next.config.ts`.
- [ ] 5.6 Narrow the coarse §2.7 clause using the origin-of-URL judgement, or keep it and assert its limitation by a test showing the neighbouring permitted spelling is not flagged.
- [ ] 5.7 Run the mutation proof in both directions for every check touched: delete a clause → violation test goes red; delete its witness fixture → load-bearing check goes red; fold clauses preserving coverage → stays green.

## 6. The two wrong records

- [ ] 6.1 Correct the `applicationSources()` coverage claim in the archived `verification.md`, as a **marked** correction. The real gap is missing roots, not missing `src/`.
- [ ] 6.2 Investigate `W4`: restore its definition or remove the citation. Do not invent one.
- [ ] 6.3 Search the repository for the other stale counts the exploration surfaced (`exclusions-diff.md` carries a second `77`) and correct each, annotated rather than overwritten.

## 7. Documentation

- [ ] 7.1 Re-attempt live-browser verification of the parked 1×1 player, starting from "works", because `next.config.ts:72` permits the frame.
- [ ] 7.2 If verification is impossible, restate it as unverified, quote the shipped `frame-src`, and keep the policy question distinct from the behavioural one.
- [ ] 7.3 `MEMORY.md` brought current: it stops at M16, still reads "the roadmap is complete", and never mentions M17–M20.
- [ ] 7.4 `ROADMAP.md` §11 extended with the post-v1 features. Coverage currently collapses after M15 — Library, Content Pages, Personalization and Local-First/PWA have zero post-v1 items.
- [ ] 7.5 `frontend/docs/DEPLOYMENT.md` covers the download route's deployment implications and both deliberate non-compliance choices.
- [ ] 7.6 `AGENTS.md` documents `icons:check`, which exists in `frontend/package.json`, is gate item 7, and appears in `AGENTS.md` nowhere.
- [ ] 7.7 Every command claimed as verified in `AGENTS.md` is executed this milestone. A documented command nobody ran is the defect class this change exists to remove.

## 8. Verification

- [ ] 8.1 Independent read-only verification of this change before its Apply PR merges.
- [ ] 8.2 Fix every CRITICAL before merging.
- [ ] 8.3 **Six consecutive green full gate runs.** One green run is not evidence against an intermittent defect.
- [ ] 8.4 Record browser-dependent and deployment-dependent checks as manual/unverified. Never as passes.
- [ ] 8.5 `openspec validate harden-post-v1-verification --strict` and `openspec validate --specs --strict` both valid.