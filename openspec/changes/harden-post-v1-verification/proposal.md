# Proposal

## Why

M16–M20 shipped. What none of them proved is that they work **together**, and the machinery meant to
prove it cannot be trusted in its present state: a gate whose first action is a destructive
`npm ci` that turns one broken install into sixteen unrelated failures, a CI job that runs the test
suite before the build and therefore skips the size half of M19's budget, a probe test that writes a
file into `src/` and collides with the test that walks `src/`, and three intermittently failing tests
whose failures are indistinguishable from real regressions.

Underneath those, a category of finding this repository has now produced six times: **a check that
reports green without checking what it claims to check.** Twenty-seven of thirty-five detector
clauses could be deleted with the whole suite green. One CI file had never once been inside the
encoding scan, because `\.git` also matches `.github`. Two arms matched a token as it is
*documented* rather than as it appears in code. None of these was a defect in shipped behaviour, and
that is exactly what makes them worth fixing last: they are the checks standing between the product
and the next change, and each one that cannot fail is a place the next defect hides.

M21 has one further obligation. Two records written by M20 are **wrong** — a claim about scan
coverage that the code contradicts, and a carried-forward warning labelled `W4` that is defined
nowhere in the repository. An archived evidence file that misstates a measurement will be inherited
as fact by whoever reads it next, and this project has already spent five milestones learning that
the prose drifts away from the code.

## What Changes

**The gate stops being able to lie.**

- The release gate's `gates-install` step no longer runs `npm ci` over the working tree. It installs
  into a staged directory, or refuses to run while `node_modules` is in use.
- A broken or partial install is detected and reported as **its own named failure**, not as the
  sixteen unrelated item failures it currently becomes. This is the diagnostic half: even a staged
  install can fail, and the operator has to be told "the install is broken" rather than "sixteen
  things are wrong".
- The CDP fixture-router race is fixed. `startRouting()` enables `Fetch` and then sets the flag the
  request handler tests, and the handler returns without continuing the request when the flag is
  unset — so any request arriving in that window is silently dropped. The flag is set **before**
  `Fetch.enable`, or the handler continues the request when the router is not ready.

**CI runs the checks in an order that makes them mean something.**

- `npm run build` moves before `npm test`, so M19's bundle-size assertions run instead of skipping.
  This is the item ROADMAP already scheduled into M21 and disclosed as "recorded, not fixed" in two
  places.
- The workflow stops reporting green for a budget file whose size half never executed.

**The intermittent failures get diagnosed and fixed, not re-run.**

- `tests/podcast-playback-history.test.ts` — cause established: a fixed 2000 ms polling budget
  standing in for a module-global promise chain, plus recorder instances attached but never
  detached, so they accumulate across tests in the file.
- `tests/discover-view.test.tsx` "shows skeletons" — cause established: a negative assertion against
  a stub whose promise deliberately never resolves, which is a pure race against teardown.
- `tests/settings-ui.test.tsx` — cause **not** established. Three candidates were identified and none
  is confirmed. This change reproduces it before fixing it, and says so if it cannot be reproduced.
- The `motion-scope.test.ts` / `architecture.test.ts` collision: one writes and deletes
  `src/features/sharing/ProbeM19Motion.tsx` while the other walks `src/`. Vitest's isolation
  separates VM state, not the filesystem, so `isolate: true` does not prevent it.

**The checks that cannot fail, stop not being able to.**

- The load-bearing clause check is extended beyond the three M20 detectors, or the remaining
  detectors are renamed to state what they actually cover. `download-non-goals.test.ts` has seven
  detectors whose must-fail fixtures are whole-pattern, which structurally cannot show that any
  individual clause works.
- `download-non-goals.test.ts`'s scanned roots are widened to match `release-exclusions.test.ts` —
  it currently reads `src/` only, so a non-goal committed to `public/`, `frontend/scripts/` or
  `next.config.ts` is invisible to it.
- The coarse §2.7 clause is either narrowed with the origin-of-URL judgement now available, or its
  "detects one spelling, not the property" limitation is asserted by a test rather than stated in a
  comment.
- The M20 carry-overs: W1, W2, W5, W6, and the coarse-clause shape.

**Two M20 records are corrected rather than inherited.**

- `verification.md`'s claim that `applicationSources()` "covers none of M20's new server files" is
  **false as written**. `download-non-goals.test.ts:52` walks all of `src/`, and every M20 server file
  is under `src/`. The real gaps are the missing roots, which is a narrower and different claim.
- `W4` is cited in the carried-forward list and **defined nowhere in the repository**. Either the
  definition is restored or the citation is removed. It is currently a task nobody can execute.

**Documentation describes the product as built.**

- `MEMORY.md` is brought current. It stops at M16, still reads "the roadmap is complete", and never
  mentions M17–M20; the word "downloading" does not appear in it at all.
- `ROADMAP.md` §11's acceptance checklist is extended with the post-v1 features. Coverage collapses
  after M15: Library, Content Pages, Personalization and Local-First/PWA have **zero** post-v1 items.
- `frontend/docs/DEPLOYMENT.md` covers the download route's deployment implications and both
  deliberate non-compliance choices.
- `AGENTS.md` documents `icons:check`, which exists in `frontend/package.json` and is gate item 7
  but appears in `AGENTS.md` nowhere.
- The parked player is re-attempted for live-browser verification, or restated as still unverified.
  **Its recorded status is probably wrong**: `next.config.ts:72` ships
  `frame-src 'self' https://www.youtube.com`, and `public/sw.js` classifies the player as a
  pass-through host, so the shipped configuration permits the 1×1 host while five documents say it is
  CSP-blocked. The correct starting hypothesis is "works", not "blocked".

**Non-goals.** New features. A public deployment. Any change to shipped behaviour — this change
alters tests, CI ordering, the gate, and documentation, and nothing a user can see.

## Capabilities

### New Capabilities

- `verification-integrity`: The repository's own checks are required to be provable — a gate that
  cannot distinguish one broken install from sixteen unrelated failures, a CI job whose ordering
  determines whether a budget runs at all, a probe that mutates the tree another test is reading, and
  an intermittently failing test whose failure is indistinguishable from a real regression. This is
  a new capability because `release-validation` governs the *product's* exclusions and the release
  contract; it does not govern whether the machinery performing that validation is itself sound.

### Modified Capabilities

- `release-validation`: The requirement that a release gate "reports what it did not run" gains
  scenarios for the failure that is not a failure of the thing under test — a broken dependency
  install must be reported as its own named failure, and a gate item that requires a build artifact
  must not be reported as passing when the build has not run.

## Impact

- **No shipped behaviour changes.** `src/` is untouched except where a test-only bug and a real bug
  are indistinguishable and the investigation proves they are the latter.
- **CI ordering changes** in `.github/workflows/ci.yml` — the one edit that affects every future run.
- **The release gate changes**, and becomes safe to run. It is currently invoked only by hand and by
  no manifest, which is why its `npm ci` has gone unnoticed since M15.
- **Two archived evidence files are corrected in place.** Archiving normally means immutability;
  these two are corrections of fact, marked as such, and the alternative — leaving a false
  measurement in the permanent record — is worse.
- **`MEMORY.md`, `ROADMAP.md`, `AGENTS.md` and `frontend/docs/DEPLOYMENT.md`** are brought current.
- **Completion criterion, unchanged from ROADMAP §21.6:** six consecutive green gate runs. A single
  green run is not evidence against an intermittent defect, which is the entire lesson of the three
  flakes in scope.
