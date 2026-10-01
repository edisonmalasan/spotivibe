# Design: Align the runtime contract with Vercel, and add root-level commands

## Context

Two corrections, one cause and one convenience. The cause is worth more attention than its
three-line diff suggests.

M15's deployment contract required "the runtime the application is verified on SHALL be
declared so that a host builds it with that runtime", and the application verifies on Node
26. Vercel cannot build on Node 26. Both statements were true and the pair is
unsatisfiable — which means the requirement, as written, was not implementable against the
stated deployment target, and nothing noticed because the check it had was about consistency
rather than satisfiability.

## Decisions

### 1. Node 24 becomes the verified runtime, in every current place

**Decision.** `engines.node` becomes `24.x`, CI runs Node 24, `@types/node` moves to the Node
24 line, and every *current* document that names Node 26 is corrected.

**Why 24, and why move everything.** 24.x is Vercel's default LTS, so it needs no project
setting and no per-deployment override. Moving *all* of it is the part that matters: if CI
kept verifying 26 while the host builds 24, the pin would be decorative and the original M15
defect would be back in a new shape — a declared runtime that nothing is verified against.

`24.x` rather than `>=24 <25` because that is the form Vercel's own documentation gives, and
because a major-only expression cannot drift out of its range the way a compound one can.

### 2. The contract checks the host, and is proven able to fail

**Decision.** The deployment contract gains a check that the pinned major is one the stated
Vercel target can build, and a check that CI and the manifest name the same major. Both are
proven against a violating input — the host check against **Node 26, the exact value being
fixed**.

**Why this is the real fix.** The M15 check was "does the pin agree with CI", which is a real
property and was satisfied. It was not the property that mattered. The one that matters is
"can the target host satisfy this", and it is checkable: the supported set is small, public,
and slow-moving. A test that fails on 26 would have caught this before a deploy ever ran.

**The rot risk, stated.** The supported set is a snapshot of somebody else's platform and will
go stale. It is written as a named constant with a source comment and a date, so the failure
mode is a test that needs updating — a deliberate one — rather than a silent divergence.

### 3. Archived evidence is left alone

**Decision.** M14's and M15's archived records continue to say Node 26.

**Why.** They were true when those milestones ran, and they are part of what those runs
established. An archive is a record of a past run, not a changelog of current decisions;
rewriting it makes the history say something that never happened. The current deployment
document — `frontend/docs/DEPLOYMENT.md`, which is a live release artifact rather than an
archive — is corrected, because a person deploying today would be misled by it.

### 4. A root `package.json` that proxies, and no workspace

**Decision.** A root manifest with `"private": true`, no dependencies, and scripts that call
`npm --prefix frontend run …`. `frontend/` remains the application directory and the only
package with a lockfile.

**Why not a workspace.** A workspace changes how `npm ci` resolves, adds a root lockfile, and
moves `node_modules` — all of it to solve a problem (`cd frontend`) that a proxy script
solves without touching resolution at all. The instruction not to convert to a workspace
matches the cost: it is a real change to the install model for a convenience that does not
need it.

**The one footgun, and its mitigation.** A root manifest with no lockfile invites `npm install`
at the root, which would create a root `package-lock.json` and a root `node_modules` that
nothing uses. npm cannot be told to refuse that, so the mitigation is a `setup` script that
does the right thing, documentation that says the lockfile lives in `frontend/`, and a note in
the root manifest itself. Stating a hazard you cannot mechanically prevent is better than
leaving it for someone to discover.

### 5. The install path stays the frontend package

**Decision.** `npm run setup` proxies to `npm --prefix frontend ci`. Dependency installation
remains based on the frontend lockfile.

**Why.** A root `install` that did anything other than proxy would either duplicate the
lockfile or invent a second source of truth. The proxy is the honest version: one lockfile,
in one place, and the root command is a convenience over it rather than a parallel path.

## Risks / Trade-offs

- **The supported-major snapshot will go stale.** Accepted deliberately, with the failure mode
  being a test that must be updated — which is the desired behaviour, because a new Vercel
  runtime should be a decision rather than a silent drift.
- **`npm run format` at the root writes inside `frontend/`.** That is correct — it is the
  application's formatter — but a reader may expect it to reach the whole repository. The
  root manifest says so.
- **Node 24 is older than the Node this machine runs.** The gates are therefore re-run under
  an actual Node 24 here rather than assumed, and the evidence says which interpreter produced
  it.

## Migration Plan

1. Configuration first: the pin, CI, and the types. Then the lockfile.
2. Then the contract tests, so the new checks exist before the numbers they police change.
3. Then the root manifest and the documentation.
4. Re-verify under Node 24 from a clean checkout.
5. No data migration, no format change, no behavioural change — revert any single piece
   without affecting the others.

## Open Questions

None that change the approach. Whether Vercel can be made to build on Node 26 is not a
question for this repository: the platform does not offer it, so the verified runtime moves to
the platform's default rather than the platform moving to the repository's.
