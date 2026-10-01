# Proposal: Align the runtime contract with Vercel, and add root-level commands

## Why

The roadmap is complete and the application is ready to deploy — except for one line of
configuration that will very likely stop it.

`frontend/package.json` declares `engines.node: ">=26 <27"`. Vercel documents its available
build and function runtimes as **24.x (default), 22.x, and 20.x**. Node 26 is not among them;
it exists on Vercel only in Sandboxes. An `engines` range that matches no available major is
not a deployment target, so the first build will most likely fail.

The pin is M15's work. M15 found that `package.json` declared *no* `engines` field at all,
which meant a Vercel build would use the host's default Node and then differ at runtime from
anything tested, and it fixed that by pinning the runtime this repository verifies. The check
it added — that the pin and CI's `node-version` agree — verifies *internal consistency*. It
never checked that the pin was *satisfiable by the target host*, and that requirement was not
in the spec. So the fix was correct in form and wrong in substance, and the gap is the same
shape as the bug it closed: a check that could pass while the thing it checked was broken.

## What changes

- **The verified runtime target becomes Node 24**, the default LTS on the stated deployment
  target, and that is what `engines.node`, CI, `@types/node`, and the current deployment
  documentation all say. Consistency matters more than the specific number: if CI keeps
  verifying one major while the host builds another, the pin is decorative.
- **The deployment contract learns to check the host.** Two new requirements: that CI and the
  manifest agree on the major, and that the major is one the stated Vercel target can
  actually build. The second is proven able to fail against Node 26 — the value this change
  is fixing — so a future unsupported pin is a test failure rather than a failed build.
- **Root-level commands.** A `package.json` at the repository root proxying to the frontend
  package, so `npm run dev`, `test`, `lint`, and the rest work from `spotivibe/` without
  `cd frontend`. `frontend/` stays the application directory; this is not a workspace and
  nothing is renamed.

## What does not change

- **Archived evidence stays as written.** M14's and M15's archived records say Node 26, and
  they were true when those milestones ran. Rewriting a historical record to reflect a later
  decision would make the archive say something that never happened.
- **No application behaviour changes.** No dependency is added or removed, no dataset, no API
  route, no runtime code beyond nothing at all — this is configuration, types, tests, and two
  documents.

## Capabilities

- **Modified**: `release-validation` — the deployment contract gains the host-support check it
  was missing, and its runtime requirement stops naming a specific major the host cannot
  build.
- **New**: none. Root-level commands are developer ergonomics rather than product behaviour,
  so they belong in documentation and a manifest, not in a behavioural spec.

## Impact

- **Files changed**: `frontend/package.json` (engines, plus a `dev` convenience if useful),
  `frontend/package-lock.json`, `.github/workflows/ci.yml`, `frontend/tests/deployment-contract.test.ts`,
  `frontend/docs/DEPLOYMENT.md`, `README.md`, a new root `package.json`, and the change's own
  artifacts.
- **The runtime actually changes** for anyone on Node 24 — which is the point, and is why the
  gates are re-run under Node 24 here rather than assumed.
- **No new dependency.** The root manifest has none; it proxies.
