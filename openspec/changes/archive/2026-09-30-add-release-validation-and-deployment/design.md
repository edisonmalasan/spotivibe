# Design: Release validation, end-to-end coverage, and deployment

## Context

This is the last milestone, and it is the one whose failure mode is a false assurance. A
release gate that reports success for checks it did not run is worse than no gate, because
it converts an unknown into a claim. Every decision below is therefore shaped by one
question: *what does this check actually prove, and what does it not?*

Two things are already true and shape the whole design. The repository has **2231 tests
across 140 files** covering M15's unit and integration categories, so this milestone adds
almost no unit testing. And it has **thirteen archived browser harnesses**, each written
from scratch, which is simultaneously the evidence that browser testing works here without
dependencies and the clearest signal that it has never been *maintained*.

## Decisions

### 1. One maintained end-to-end suite, and the archived harnesses stay archived

**Decision.** A single harness covering the eleven named flows, with the CDP plumbing
written once. The thirteen archived harnesses are not consolidated, refactored, or deleted.

**Why.** The duplication is the finding: a harness rebuilt per milestone is a harness
nobody maintains, and M15's acceptance criterion is that a flow regression fails a check
*from one release to the next* — which a suite nobody runs cannot do. But those harnesses
are also the evidence record of thirteen specific verification runs, each with its own
`results.json` and screenshots. Rewriting them would destroy the record to tidy a
duplication, and `AGENTS.md` is explicit that reference and verification material is not
disposable. The new suite learns from them; it does not replace them.

**Alternatives considered.** Extracting a shared library and rewriting the archived
harnesses against it (rejected: it would change the meaning of thirteen archived evidence
records, which are claims about what was true at a point in time). Adopting Playwright
(rejected: see decision 2).

### 2. No Playwright, and no new dependency

**Decision.** The suite speaks the Chrome DevTools Protocol directly, in the shape M13
established and M14 extended.

**Why.** It is the only approach in this repository with thirteen independent
confirmations that it works, it needs no browser download in CI, and it keeps the
dependency list at six runtime packages. Playwright would be more ergonomic and would also
bring a large dependency, a browser-management layer to keep current, and a second
abstraction alongside the harness — for a project whose standing rule is that a dependency
needs a concrete reason, in a milestone that is not about testing ergonomics.

The cost is stated rather than discovered later: **CDP is a Chromium protocol.** Edge and
Chrome both speak it, so two of the five matrix targets are automatable. Firefox does not.
Android and iOS cannot be driven from a developer machine at all. Decision 7 is where that
cost is paid honestly.

### 3. Flow assertions run against mocked providers, and the boundary is drawn explicitly

**Decision.** The end-to-end suite runs against a production build with provider responses
served from recorded fixtures, so a run is deterministic and offline-capable. One scenario
deliberately exercises a *failing* provider to prove the fallback path.

**Why.** An end-to-end suite that calls YouTube is a suite that fails when YouTube rate
limits a CI runner, and a flaky gate gets disabled, and a disabled gate is the false
assurance this milestone exists to avoid. Recorded fixtures make a run reproducible, which
is the property that makes a gate worth having.

The boundary this draws is real and must be written down: the suite proves **the
application's** behaviour — that a search result renders, that a track can be liked, that a
failure falls back — and proves **nothing about the providers**. That is the correct
division of responsibility, because the providers are not this project's to test, but it
means a provider outage is invisible to the suite by construction. One scenario therefore
injects a provider failure on purpose, so the fallback path is exercised rather than
assumed.

### 4. The permanent exclusions are enforced by checks, and each detector is proven twice

**Decision.** Each of ROADMAP §2's exclusions becomes a check over the shipped sources.
Every detector is proven against a **violating snippet** (so it can fail) and against the
**real sources** (so it does not fail for the wrong reason).

**Why.** The second proof is not ceremony. The only occurrence of an account-related
pattern in `frontend/src` is a *comment* in `playlistRef.ts` reading "no account/OAuth/
cookies anywhere" — the file that documents the constraint is the file a naive pattern
would flag. A detector that reported that as a breach would be silenced on its first day,
and a silenced exclusion check is worse than none because it looks like coverage.

M14's verification pass already demonstrated the general failure: a referrer-suppression
guard existed, matched a shape the code never used, and went green over a real violation
while its self-test asserted the wrong shape. Comment-aware matching with a test for it is
the specific answer, and it is the same answer twice.

**Alternatives considered.** Relying on review (rejected: it is the mechanism the
milestone is replacing). Scanning `package.json` only (rejected: an exclusion can be
violated in source without appearing as a dependency).

### 5. The deployment contract is asserted, and the runtime is pinned

**Decision.** The application's deployable shape becomes a set of checks: one Next.js
application, no custom server, no middleware or proxy hook, no required environment
variables, the security policy declared in `next.config.ts` rather than at the edge, and
the service worker and manifest served as static files. `engines.node` is added so a
Vercel build uses the runtime this repository is verified on.

**Why.** Every one of those is a property that can silently stop holding, and each has a
concrete failure: a custom server breaks the single-deployable shape the free tier depends
on; a required environment variable makes a fork undeployable and is invisible until
someone tries; an edge-injected header is dropped by a CDN and the policy is silently gone;
a service worker served with a long-lived cache header never updates, which is the failure
mode M13 spent a milestone designing against.

The `engines` pin is the concrete find. Without it Vercel builds with its own default Node
rather than the Node 26 this repository is verified on — and because the application has no
required environment variables, no custom server, and no native dependencies, **it would
build successfully and then differ at runtime from anything tested.** A build that passes
is not a build that was tested, and this is what that costs.

**Alternatives considered.** A `vercel.json` (rejected below). Asserting the deployment
against a live Vercel account in CI (rejected: it needs credentials this project does not
have and does not want, and a free-tier account is a resource the project should not spend
on a check).

### 6. No `vercel.json`, because nothing needs one yet

**Decision.** No Vercel configuration file is added.

**Why.** The application is a single Next.js application with a conventional layout, so
Vercel's framework preset detects it and supplies the build command, the output directory,
and the runtime. A `vercel.json` would be a file whose contents nobody can justify from a
requirement — and a configuration file that exists without a reason is a thing future
maintainers must keep in sync for no benefit. The one setting that genuinely needed pinning
belongs in `package.json`, where it is read by every host rather than one.

If a later milestone needs edge configuration, the decision reverses, and the release gate
is where that need would be detected: the deployment-contract checks name what the shape
must be, so a change that breaks one says which check failed.

### 7. The browser matrix is split honestly, and the manual half is written down

**Decision.** Chromium desktop and Edge desktop are automated, by running the end-to-end
suite against each browser binary. Firefox desktop, Android, and iOS are **manual entries
with instructions**: what to open, what to do, and what to look for. The document states
which is which, at the top, so nobody reads a five-row table and assumes five rows were
verified.

**Why.** Decision 2's cost lands here. A matrix that ticks five boxes because five boxes
exist is worse than a matrix of two automated and three pending, because the first invites
trust the second does not. The manual entries are written precisely so that a person doing
them knows what evidence to produce.

### 8. The release gate runs, and reports what it did not run

**Decision.** One command executes every automatable checklist item and prints, for each,
either its result or the reason it is manual plus the steps. It exits non-zero if any
automated check fails.

**Why.** The output is the deliverable. A gate that prints "11 automated, 2 manual" teaches
a reader the state of the release; a gate that prints a single word teaches them nothing
and, worse, invites the assumption that the unrun items were run. A gate that cannot say
what it skipped is not a gate.

### 9. The backup format is documented as a contract

**Decision.** A document stating the envelope's version, its top-level fields, what each
one holds, the compatibility rule, and where the code that writes it lives.

**Why.** A backup is a promise to a person about data they cannot get back if the promise
is wrong. The code pins the version and the tests pin the keys, so a maintainer can find
the truth — but the checklist asks for the format to be *documented*, and a person deciding
whether to restore a file has no way to read a test. The document cites the tests that hold
it honest, so it cannot silently drift from the code.

## Risks / Trade-offs

- **A release gate that is wrong in the permissive direction is the worst outcome.** Every
  check is therefore written to fail on a known-bad input before it is trusted, and the
  gate's own output distinguishes pass, fail, and not-run.
- **Recorded fixtures can go stale** relative to the real provider response shapes. The
  normalisation tests already pin those shapes, so a fixture that stops matching the shape
  the normalizer produces fails a unit test — the coupling is deliberate.
- **Automating two of five matrix targets could be read as coverage.** The matrix document
  leads with the split for exactly this reason.
- **The deployment contract asserts the application's shape, not a live deployment.** The
  first real deploy stays manual, with written steps. Saying so is better than a check
  named "deployment" that never deploys.
- **Thirteen more assertions in an already-large architecture suite.** The exclusions go in
  their own file rather than appended to `architecture.test.ts`, so the release-time
  concerns stay separable from the layering ones.

## Migration Plan

1. Additive throughout: two new test suites, one release-gate script, one `engines` field,
   two documents. No existing behaviour, dataset, or spec changes.
2. No data migration and no format change: the backup document describes what the code
   already writes.
3. Rollback: each piece is independent. The `engines` pin is the only change to an existing
   file, and reverting it cannot break the build on any host that ignores it.
4. The archived harnesses are untouched, so a rollback of the new suite costs nothing that
   was there before.

## Open Questions

None that change the specs, the approach, or the task breakdown.

One item is deliberately left to the milestone that follows a real deployment rather than
settled here: whether the first Vercel deployment needs any edge configuration at all. The
deployment-contract checks will say which property stopped holding if it does, which is the
mechanism for finding out.
