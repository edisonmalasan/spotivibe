# Runtime contract and root-command evidence

What was verified, under which interpreter, and the three things this change could not check.

## The runtime this was verified under

**Node 24.21.0**, obtained as a portable install rather than the Node this machine runs,
precisely so the new target would be tested rather than assumed. The machine's default remains
Node 26, so every number below came from an interpreter that matches `engines.node`.

```
node --version   v24.21.0
npm --version    11.19.0
```

## Quality gates, from the repository root, under Node 24

Every command below was run from `spotivibe/` using the new root proxies — not from
`frontend/`, and not with a `cd` in the command.

| Command | Result |
| --- | --- |
| `npm run setup` (install) | exit `0` — 445 packages, 446 audited, 0 vulnerabilities |
| `npm run lint` | exit `0` |
| `npm run format:check` | exit `0` |
| `npm run typecheck` | exit `0` |
| `npm test` | exit `0` — **2329 tests across 144 files** |
| `npm run build` | exit `0` — compiled successfully |

## The dev server starts from the root

`npm run dev`, run from `spotivibe/` under Node 24:

```
GET /                        -> HTTP 200, 49387 bytes
GET /manifest.webmanifest    -> HTTP 200
listeners on 3000            -> 1
```

Verified with a real `next dev` process, an HTTP request against it, and the process tree
killed afterwards — not by a build succeeding.

## The release gate

**18 passed, 0 failed, 8 not run.** All 13 of the roadmap's release-checklist items are
represented, 1 of them only partly. The eight not-run items are the same manual ones M15
recorded — a live Vercel deployment, the DESIGN.md visual audit, three browsers this tooling
cannot drive, the roadmap's own truthfulness, `ATTRIBUTION.md` provenance, and a second browser
engine — each printed with the reason and the steps.

The suite and the falsifiability proof both ran inside it: **11 of 11 flows**, and **4 of 4
prove-can-fail probes** failing as required.

## The two new checks are proven able to fail

Neither new deployment-contract check is asserted only against a value chosen by its own
author; both were made to fail here, deliberately, and the failure text is the evidence.

**The host-support check, against the value this change replaced.** `engines.node` was
temporarily set to `26.x` and CI to `node-version: 26`, reproducing exactly the state M15
shipped. The suite failed with:

> the pin names Node 26, which the deployment target does not offer; it offers 20, 22, 24

That is the defect this change exists to close, caught by a check rather than by a failed
build on Vercel's schedule.

**The consistency check, against a pin and workflow that disagree.** With the manifest restored
to `24.x` and CI left on a different major:

> CI verifies Node 26 but package.json declares 24; a pin nobody verifies against is
> decorative

Both temporary edits were reverted, and the files confirmed back at `24.x` / `node-version: 24`
before anything was committed.

## What this change changed in archived material, disclosed

Three one-line overrides were added to M15's archived harnesses, each so they still find the
repository now that they live one to three directories deeper than the walk they were written
for:

| File | Change |
| --- | --- |
| `.../evidence/release-gate.mjs` | honour `SPOTIVIBE_REPO` and `SPOTIVIBE_CHANGE` |
| `.../evidence/lib/harness.mjs` | `repoRoot` honours `SPOTIVIBE_REPO` |

The M14 measurement harness had already taken the same override during M15. **No recorded
result was rewritten** — M15's `results.json` and screenshots remain byte-identical to their
committed state, which the gate's own archive-restore check confirms on every run
("restored 1 archived file(s) the harness overwrote").

All three patches exist because the underlying design is wrong, and that is recorded as debt
rather than fixed here: **a harness that locates the repository by counting directories is
portable only until somebody moves it.** A resolver that walked *up* looking for a marker would
be correct wherever the file ended up. Refactoring three archived instruments is a larger
claim against the archive than three disclosed overrides, so the debt is named instead —
including in the code comment at each site, so the next person finds it.

The suite's first symptom without the override is worth recording: `No production build found`,
a message about the build when the fault was the path. It failed in 0.8 seconds having tested
nothing — the same failure mode this repository has now paid for twice, a check reporting
cleanly while checking the wrong thing.

## What was deliberately not changed

- **Archived evidence still says Node 26.** M14's and M15's records describe runs that
  happened before this correction, and they were true when they were made.
- **`frontend/` is still the application**, still holds the only lockfile, and this is not a
  workspace.
- **No application behaviour, dependency, dataset, or API route changed.** The only edits to
  existing files are the `engines` pin, the `@types/node` version, and CI's `node-version`.
- **The root manifest declares no dependencies**, so `npm install` at the root would create a
  second lockfile nothing installs from. npm cannot be told to refuse that, so `setup` exists,
  the root manifest says why, and `tests/root-commands.test.ts` asserts the properties that
  make the proxy correct.

## A pre-existing flake found by running the suite repeatedly

Running the suite three times in a row in the clean clone, one run in three failed:

```
tests/podcast-playback-history.test.ts > a played podcast episode is recorded in ...
```

**This change did not cause it and does not fix it.** The test was last touched by M12
(`feb9fd0`), and this branch has zero commits touching it, its stores, or the recorder it
uses. It is recorded here because it was found during this change's verification and a
verification finding that is written down somewhere nobody reads has not been reported.

The cause is legible from the test itself: `waitForEvents(count, timeoutMs = 2000)` polls a
**serialized asynchronous repository chain** on a fixed 2-second wall-clock budget. That is a
timeout standing in for a synchronization signal, so the assertion is really "the write
finished within two seconds", which is a statement about the machine rather than about the
code. It passes when the suite has the machine to itself and fails when it does not.

Why it is not fixed here: it has nothing to do with the runtime target or the root commands,
and `AGENTS.md` is explicit about not broadening a change. It is a release-gate concern
instead — a gate whose input is intermittently red is the "flaky gate gets disabled" failure
this project has already written about twice — so it belongs in its own change, where the fix
can be judged on its own merits rather than smuggled in here.

The gate run recorded in this change's evidence passed 18 of 18, and the full suite passed
2331 of 2331 in two of the three repeat runs.

## An npm collision the clean checkout found

The clean-clone verification failed on the very first command. `npm run setup` reported:

```
npm error code EALLOWSCRIPTS
npm error --allow-scripts is not allowed in project-scoped installs.
```

It is not a defect in the manifest, and it needs **two** conditions at once:

| | user `~/.npmrc` has `allow-scripts` | result |
| --- | --- | --- |
| `npm run setup` (nested `npm ci`) | yes | **fails** |
| `npm run setup` (nested `npm ci`) | bypassed | installs 445 packages |
| `cd frontend && npm ci` (not nested) | yes | installs 445 packages |

npm 11 — the npm that ships with Node 24 — refuses an install nested inside an `npm run`
script when the user's npmrc sets `allow-scripts`. This machine's `~/.npmrc` does.

The repository cannot change a user's global npm configuration, and adding a project-level
`allowScripts` to route around it would grant install-script permissions the project has no
reason to grant. So the resolution is in the other direction: `setup` changes into `frontend/`
rather than using `--prefix`, and the documented fallback for an affected machine is the
non-nested `cd frontend && npm ci`, which is unaffected. `tests/root-commands.test.ts` holds
that fallback, because a documentation-only safety net is exactly what a later edit removes as
redundant.

**Consequence for the evidence below**: the clean-clone gate runs were made with the user
npmrc bypassed (`npm_config_userconfig`), because of the collision above. Every other
condition was the default.

## The runner resolves the repository by walking up, not by counting

This change's own `release-gate.mjs` runner originally used `resolve(HERE, "../../../..")` —
correct while the change is active, wrong the instant it is archived. That is precisely the
defect the section above documents at length: three M15 harnesses each needed a patch for it,
and `harness.mjs` carries a comment saying the real fix belongs in the harness design rather
than in a fourth patch. Writing that fourth instance while explaining why it is a bug would
have been absurd, so the runner walks up looking for `openspec/specs` and fails with a named
marker if it finds none.

Proven at both depths, because depth is the only thing that can break it:

| Where the runner sits | Result |
| --- | --- |
| the active change directory | resolves; gate runs |
| `openspec/changes/archive/<name>/evidence/` — the depth archiving creates | resolves; **gate runs, 15 passed / 0 failed** |
| a copy with no repository above it | **fails loudly**, naming the marker it searched for |

The second row is the real test: the copy was placed at the exact path `openspec archive` will
create, inside the actual repository, and the gate ran from there.

The first probe of this **was wrong and reported a false failure.** It put an archived-layout
copy in a bare sandbox directory, and the resolver reported it could not find the repository —
correctly, because that sandbox genuinely had no `openspec/specs` above it. The probe was
testing for a repository that did not exist. The fix was to run the probe where archiving will
actually put the file, and the lesson is the one this repository keeps relearning: a test that
fails must be understood before it is believed, and "the tool is broken" and "my test is
broken" look identical from the outside.

That probe run refreshed M15's archived screenshots and result files again, since running the
archived instruments writes beside them. They are restored to their committed state; the
restore is visible in the commit that carries this section.

## Not verified, and not claimed

- **A real Vercel deployment.** This change makes the build *satisfiable*; nothing here
  observes a deployed response. Whether Vercel honours `engines.node` when a range is
  satisfiable, and how its CDN treats the security headers and `sw.js`, remain the manual
  verification steps in `frontend/docs/DEPLOYMENT.md`.
- **Node 24 on a non-Windows platform.** CI verifies `ubuntu-latest` at Node 24; the local runs
  here were Windows.
- **The root proxies on a shell other than the one used here.** Each was run under PowerShell.
