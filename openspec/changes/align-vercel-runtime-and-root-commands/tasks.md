# Tasks

## 1. The runtime contract

- [ ] 1.1 Move the verified runtime to Node 24: `engines.node` becomes `24.x`, and the CI workflow verifies Node 24 — verify: both name the same major, because a pin and a workflow on different majors is the M15 defect in a new shape (spec: `release-validation` — "A build uses a different runtime than the one verified").
- [ ] 1.2 Move `@types/node` to the Node 24 line and regenerate `frontend/package-lock.json` — verify: `npm ci` installs cleanly from the regenerated lockfile and the type check passes.
- [ ] 1.3 Correct every *current* document that names Node 26 as the target — `frontend/docs/DEPLOYMENT.md` above all, since a person deploying today would be misled by it — verify: a search for "Node 26" outside `openspec/changes/archive/` returns nothing that claims to be current (spec: `release-validation` — "A build uses a different runtime than the one verified").
- [ ] 1.4 Leave archived evidence saying Node 26, because it was true when those runs happened — verify: `git diff` touches nothing under `openspec/changes/archive/`.

## 2. The contract learns to check the host

- [ ] 2.1 Assert that the manifest and the CI workflow name the **same** major, reading the workflow rather than restating its value (spec: `release-validation` — "A build uses a different runtime than the one verified").
- [ ] 2.2 Assert that the major is one the stated Vercel target can build, from a named constant carrying its source, and report the supported set on failure (spec: `release-validation` — "A runtime the deployment target cannot build fails a check").
- [ ] 2.3 Prove that check against **Node 26** — the exact major being replaced — and against every other unsupported major, so a check that cannot reject an unsupported pin is never mistaken for one that can (spec: `release-validation` — "The check rejects a runtime the target cannot build").
- [ ] 2.4 Prove the same-major check by asserting it against a manifest and workflow that disagree.

## 3. Root-level commands

- [ ] 3.1 Add a root `package.json` that is `private`, declares no dependencies, and proxies `dev`, `build`, `start`, `lint`, `format`, `format:check`, `typecheck`, and `test` to the application package with `npm --prefix frontend run …` (spec: `release-validation` — "The application is reachable from the repository root").
- [ ] 3.2 Add `setup`, proxying to `npm --prefix frontend ci`, so the lockfile's location is discoverable from the root — and say in the root manifest why a bare `npm install` at the root is not the path, since npm cannot be prevented from creating a second lockfile there (spec: `release-validation` — "Installation still has one correct path").
- [ ] 3.3 Assert the root manifest's properties: private, no dependencies, every required script present, each proxying to the application package, and the application directory still named `frontend` and still holding the only lockfile (spec: `release-validation` — "The root adds no second source of truth").
- [ ] 3.4 Assert a root command reaches the application's own tooling rather than a similarly-named command — the formatter in particular, since a root `format` that did not reach `frontend/` would be worse than no root command at all (spec: `release-validation` — "A root command reaches the application's own tooling").

## 4. Documentation

- [ ] 4.1 Make the root the documented starting point: `npm run dev` from the repository root, with `frontend/` named as the application directory rather than a step in every command.
- [ ] 4.2 Document installation as the one path that installs from the application lockfile, reachable from the root.
- [ ] 4.3 Record the runtime change, its reason, and the fact that archived evidence still says Node 26 — so a later reader does not "fix" the archives.

## 5. Verification

- [ ] 5.1 Run all six quality gates **under Node 24**, not under the Node this machine happens to use — verify: each command exits `0` and the interpreter's version is reported in the evidence.
- [ ] 5.2 Re-verify from a clean checkout of the branch head, under Node 24.
- [ ] 5.3 Prove `npm run dev` from the repository root actually starts the application and serves a response.
- [ ] 5.4 Re-run the release gate, and confirm the deployment-contract item's count reflects the new checks.
