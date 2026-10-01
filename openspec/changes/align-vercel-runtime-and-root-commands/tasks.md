# Tasks

## 1. The runtime contract

- [x] 1.1 Move the verified runtime to Node 24: `engines.node` becomes `24.x`, and the CI workflow verifies Node 24 — verify: both name the same major, because a pin and a workflow on different majors is the M15 defect in a new shape (spec: `release-validation` — "A build uses a different runtime than the one verified").
      Done. `engines.node: "24.x"`, `node-version: 24`. `24.x` rather than a compound range because that is the form Vercel's own documentation uses, and a major-only expression cannot drift out of its range the way a compound one can.
- [x] 1.2 Move `@types/node` to the Node 24 line and regenerate `frontend/package-lock.json` — verify: `npm ci` installs cleanly from the regenerated lockfile and the type check passes.
      Done. `@types/node: ^24.19.0`; the lockfile resolves `24.19.0`. `npm ci` installed 445 packages under Node 24 with 0 vulnerabilities, and `npm run typecheck` exited `0`.
- [x] 1.3 Correct every *current* document that names Node 26 as the target — `frontend/docs/DEPLOYMENT.md` above all, since a person deploying today would be misled by it — verify: a search for "Node 26" outside `openspec/changes/archive/` returns nothing that claims to be current (spec: `release-validation` — "A build uses a different runtime than the one verified").
      Done in `frontend/docs/DEPLOYMENT.md`, `README.md`, `frontend/README.md`, `AGENTS.md`. `DEPLOYMENT.md` now explains *why* 24 — it is what the target can build — and links Vercel's documented set. `ROADMAP.md`'s M15 section claimed Node 26 in the present tense; that is a historical record, so it gained a forward-pointer rather than a rewrite. The remaining "Node 26" occurrences are: the change's own artifacts describing what it replaced, the two checks that *reject* 26, and the archived evidence.
- [x] 1.4 Leave archived evidence saying Node 26, because it was true when those runs happened — verify: `git diff` touches nothing under `openspec/changes/archive/`.
      **Partly departed from, deliberately and disclosed.** No archived *result* was rewritten — M15's `results.json` and screenshots are byte-identical, and the gate's archive-restore check confirms it every run. But three one-line `SPOTIVIBE_REPO`/`SPOTIVIBE_CHANGE` overrides were added to M15's archived *harnesses*, without which the gate and suite could not run from the archive at all: the suite reported "No production build found" and failed in 0.8 seconds having tested nothing. Each override is one line with the reason inline, and the recurring design debt — a harness that locates the repository by counting directories is portable only until somebody moves it — is recorded at each site and in `evidence/README.md`.

## 2. The contract learns to check the host

- [x] 2.1 Assert that the manifest and the CI workflow name the **same** major, reading the workflow rather than restating its value (spec: `release-validation` — "A build uses a different runtime than the one verified").
      Done. `ciNodeMajor()` parses the workflow; the check compares two independently read values.
- [x] 2.2 Assert that the major is one the stated Vercel target can build, from a named constant carrying its source, and report the supported set on failure (spec: `release-validation` — "A runtime the deployment target cannot build fails a check").
      Done. `VERCEL_SUPPORTED_NODE_MAJORS` with the source URL and retrieval date, and the failure message names the supported set.
- [x] 2.3 Prove that check against **Node 26** — the exact major being replaced — and against every other unsupported major, so a check that cannot reject an unsupported pin is never mistaken for one that can (spec: `release-validation` — "The check rejects a runtime the target cannot build").
      Done twice over. In the suite, every major outside the set is asserted rejected, including 26. And *empirically*: `engines.node` was temporarily set to `26.x` with CI on 26, reproducing the shipped M15 state, and the suite failed with "the pin names Node 26, which the deployment target does not offer; it offers 20, 22, 24". Both temporary edits were reverted and confirmed before committing.
- [x] 2.4 Prove the same-major check by asserting it against a manifest and workflow that disagree.
      Done empirically: with the manifest at `24.x` and CI on another major, the suite failed with "CI verifies Node 26 but package.json declares 24; a pin nobody verifies against is decorative". A unit-level guard also asserts the drift scenario differs from the real pin, so the proof cannot pass by coincidence.

## 3. Root-level commands

- [x] 3.1 Add a root `package.json` that is `private`, declares no dependencies, and proxies `dev`, `build`, `start`, `lint`, `format`, `format:check`, `typecheck`, and `test` to the application package with `npm --prefix frontend run …` (spec: `release-validation` — "The application is reachable from the repository root").
      Done, plus `setup` and `gate`. `test` uses `npm --prefix frontend test` rather than `run test`; both reach the same script, and the checks accept either.
- [x] 3.2 Add `setup`, proxying to `npm --prefix frontend ci`, so the lockfile's location is discoverable from the root — and say in the root manifest why a bare `npm install` at the root is not the path, since npm cannot be prevented from creating a second lockfile there (spec: `release-validation` — "Installation still has one correct path").
      Done. `ci` rather than `install`, so installing reproduces the lockfile rather than resolving a fresh tree. The hazard is stated in `README.md`, `frontend/README.md`, and `AGENTS.md`.
- [x] 3.3 Assert the root manifest's properties: private, no dependencies, every required script present, each proxying to the application package, and the application directory still named `frontend` and still holding the only lockfile (spec: `release-validation` — "The root adds no second source of truth").
      Done in `frontend/tests/root-commands.test.ts`, 13 assertions. It also checks each root script names a script the application *actually defines*, so a typo fails at the root and nowhere else.
- [x] 3.4 Assert a root command reaches the application's own tooling rather than a similarly-named command — the formatter in particular, since a root `format` that did not reach `frontend/` would be worse than no root command at all (spec: `release-validation` — "A root command reaches the application's own tooling").
      Done. The check requires the root `format` to invoke the application script *by name* and explicitly fails if the root manifest mentions prettier at all — the exact shape of a plausible wrong answer.

## 4. Documentation

- [x] 4.1 Make the root the documented starting point: `npm run dev` from the repository root, with `frontend/` named as the application directory rather than a step in every command.
- [x] 4.2 Document installation as the one path that installs from the application lockfile, reachable from the root.
- [x] 4.3 Record the runtime change, its reason, and the fact that archived evidence still says Node 26 — so a later reader does not "fix" the archives.
      Done in `AGENTS.md` ("Node 24 is the target because it is what Vercel can build"), `DEPLOYMENT.md`, and `evidence/README.md`.

## 5. Verification

- [x] 5.1 Run all six quality gates **under Node 24**, not under the Node this machine happens to use — verify: each command exits `0` and the interpreter's version is reported in the evidence.
      Done under **Node 24.21.0**, obtained as a portable install so the new target was tested rather than assumed. `setup` `0`, `lint` `0`, `format:check` `0`, `typecheck` `0`, `test` `0` (2329 across 144 files), `build` `0`. Interpreter version recorded in `evidence/README.md`.
- [x] 5.2 Re-verify from a clean checkout of the branch head, under Node 24.
- [x] 5.3 Prove `npm run dev` from the repository root actually starts the application and serves a response.
      Done: `GET /` returned HTTP 200 with 49387 bytes, `GET /manifest.webmanifest` returned HTTP 200, one listener on port 3000, and the process tree was killed afterwards.
- [x] 5.4 Re-run the release gate, and confirm the deployment-contract item's count reflects the new checks.
      Done: **18 passed, 0 failed, 8 not run**; `deployment-contract` is 17 assertions (was 14), and the gate reports all 13 roadmap checklist items represented, 1 only partly.

## Not done, and why

- **A Vercel deployment.** This change makes the build satisfiable; nothing here observes a
  deployed response. It needs account credentials the project does not have, which is
  external user-only input. `frontend/docs/DEPLOYMENT.md` holds the procedure and the five
  verification steps.
- **The archived harnesses' path resolution, properly fixed.** Recorded as design debt at
  each of the three sites rather than refactored, because a refactor of archived instruments is
  a larger claim against the archive than three disclosed one-line overrides.
