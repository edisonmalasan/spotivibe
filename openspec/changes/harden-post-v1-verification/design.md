# Design — harden post-v1 verification

## 1. Why this change is mostly about the harness

Five of the seven requirements in `verification-integrity` govern machinery rather than product.
That is the point, and it is worth stating plainly so the change is not mistaken for a
low-priority tidy-up: the machinery is what every future change is checked by. A gate that turns
one broken install into sixteen unrelated failures, a CI order that decides whether a budget runs,
and a probe test that deletes a file while another test walks it, each cost something real in
M16–M20. M16–M20 paid it in re-runs and in warnings that had to be carried forward instead of
fixed.

There is a second reason, and it is the more important one. This repository has produced the same
defect six times now: **a check that reports green without checking what it claims to check.**
Twenty-seven of thirty-five clauses deletable. A CI file never once inside the encoding scan. Two
arms matching a documented spelling rather than an observed one. A hand-written `caughtBy` field
that four reviewers defeated while the suite stayed green. None of these shipped a defect, and that
is exactly what makes them dangerous rather than merely embarrassing — the checks that cannot fail
are the ones the next defect hides behind.

## 2. Decisions

### 2.1 The gate installs to a staged directory, and refuses rather than destroying

**Decision.** `gates-install` no longer runs `npm ci` over the working tree. It stages the install
in a temporary directory outside the tree, and the gate's later steps resolve their tooling through
that staged tree. If staging is impossible in the environment, the gate **refuses before touching
anything** and says why.

**Rejected: `npm ci --dry-run`.** It would not have caught the actual failure. The recorded
incident was an `EPERM` on a native module held by a running dev server — a filesystem contention
that a dry run never hits, because a dry run does not open the handles.

**Rejected: check whether a server is running and skip.** Guesswork about what holds a handle, and
it would still destroy the tree whenever the guess is wrong. A gate whose first step can destroy
the thing it validates cannot be repaired by improving its guess.

**Rejected: leave it, and document it.** ROADMAP already scheduled this into M21 twice. Third
scheduling is not scheduling.

The staging directory is removed on exit, including on failure, so a failed gate leaves no litter
in `node_modules` and no evidence destroyed.

### 2.2 A broken environment is one failure, named

**Decision.** Before each step, the gate verifies the dependency tree is complete. If it is not,
it emits **one** result — `gates-install`, failed, with the reason — and every remaining item is
reported `NOT RUN (environment)`.

This is a diagnostic change, not a cosmetic one. Sixteen unrelated failures cost the reader an
hour of chasing the wrong code; one named failure costs nothing.

The completeness check is concrete, not "did the command exit zero": the packages the later steps
invoke must exist and be loadable. An install that exits `0` while leaving `node_modules/.bin`
empty is exactly the recorded failure, and an exit code alone would call that a success.

### 2.3 The CDP race: set the flag first, and continue when not ready

**Decision.** Two independent changes, because there are two independent bugs:

1. `startRouting()` sets its ready flag **before** `Fetch.enable`, not after. The current order
   opens a window in which requests arrive and are dropped.
2. The request handler **continues the request** when the router is not ready, rather than
   returning without doing so.

Either alone would remove the race. Both are made because a flag-set-before-enable fix leaves the
handler's silent-drop path reachable by any future caller that forgets to set the flag, and a
handler fix leaves a window where requests are routed to a handler that may not be listening.

The dropped-request behaviour is what makes this a flake rather than a failure: the request neither
completes nor errors, so the test waits out its own timeout. A test that failed loudly here would
have been cheaper than one that waits.

### 2.4 CI runs the build first

**Decision.** `npm run build` moves before `npm test` in `.github/workflows/ci.yml`.

**Cost, stated rather than hidden:** the build now runs before any test failure can stop the job, so
a red test suite no longer short-circuits before the build. On a red PR this is minutes of extra
CI time. That is the correct trade — a budget that never runs is not a budget — but it is a real
cost and the change records it rather than pretending otherwise.

A test asserting on the *ordering* of the workflow is added, so the ordering cannot silently
regress to the shape that produced the skip. M19's budget file disclosed this in a comment, which
is honest and does not make the check run; this change makes the check run.

### 2.5 The probe file stays in the source tree, and the reader tolerates it

> **M21 Apply, 2026-10-04 — this decision was reversed in code and is recorded here rather than left
> to be discovered.** The original decision was that `motion-scope.test.ts` writes its probe outside
> `src/`, to a dedicated directory the tree-walking guard excludes, with both files naming the
> exclusion as a shared constant. **None of that was implemented**, so the delta scenario "A test
> asserts on a temporary file it created" — which requires the file to be created in a location the
> application tree does not contain — was unmet while this file still advertised the decision.
>
> Independent verification, CRITICAL C7, caught it. What is implemented instead:
>
> - The probe **stays** at `src/features/sharing/ProbeM19Motion.tsx`, where the guard under test must
>   be able to see it.
> - `tests/helpers/sourceTree.ts` draws the distinction the *original* rationale cared about, one
>   level lower and without any file to name: a file that vanished between being listed and read is
>   **tolerated and reported**; a read failure for any other reason is **fatal**. `isMissing` is
>   deliberately narrow — `ENOENT` only.
> - `architecture.test.ts` asserts `racedFiles` is empty, so the tolerance cannot become a blind spot:
>   a run that actually loses a file fails rather than quietly reading fewer files than it believes.
>
> **Why this is the better shape, and not merely the one that happened.** The original reasoning — that
> a second literal spelling of the excluded directory would drift, and a drifted exclusion is a probe
> that leaks into the tree anyway — was correct about the failure it was guarding against, and the new
> shape has no equivalent spelling to drift: there is no exclusion list at all. Every reader of a
> source tree in this repository goes through one helper, so there is one place for the distinction to
> be right and one test asserting each half of it. A shared *name* would have been a second thing to
> keep correct; a shared *implementation* is the thing itself.
>
> The cost is stated rather than hidden: the probe still writes into the tree other tests are reading,
> so the race is real and is merely handled rather than prevented. `racedFiles` being asserted empty is
> what makes "handled" a checked claim.

**Rejected: a lock file.** Vitest's workers share a filesystem and do not coordinate, so a lock
means implementing coordination for one test. Overkill — and it would still not make a *reading* test
tolerate a file another test is writing.

**Rejected: make `architecture.test.ts` tolerate the file by name.** It would have to know about
another test's temporary file, which couples two unrelated guards — and it re-couples them the next
time a third probe appears. The helper avoids this by naming nothing: it tolerates a *vanished file*,
which is a property of the filesystem rather than of any particular probe.

**Rejected: `npm ci --dry-run` as a pre-flight for §1.** Noted here because the same instinct
applies — a dry run reports what *would* happen, and the recorded incident was handles that could not
be opened at all, which a dry run never attempts.

### 2.6 Flakes are diagnosed before they are touched

**Decision.** Each of the three gets its cause established and recorded first. `settings-ui.test.tsx`
is explicitly permitted to end **undiagnosed**: three candidates were identified and none confirmed,
and this change records that rather than shipping a plausible-sounding fix. Re-running until green is
not a fix and is not counted.

### 2.7 Attribution stays computed, and the extension is by consolidation not by fixture

**Decision.** Extend the load-bearing clause check to the remaining detectors **only where the
clauses are a disjunction of genuinely distinct spellings**. Where clauses are deliberate synonyms
— fourteen ways to write "no account" — the detector is renamed to say so, and no sole-carrier
fixture is demanded for each.

**Why not all of them.** ~~`download-non-goals.test.ts` has seven detectors and 47 of 52 clauses
deletable.~~ **That count was never measured.** It was an estimate written in the grammar of a
measurement — "47 of 52" reads as two integers someone counted, and nobody did. The exploration had
counted *clauses* by eye and *deletable* clauses by reasoning about what each detector would find; it
never deleted 47 clauses and watched the suite stay green. Presenting the product of two estimates as
a measurement is the defect this change exists to remove, committed in the document that argues for
the repair.

**What is actually known**, because the difference matters for the decision below: clauses were
*counted* (five of seven detectors were single regex literals whose alternatives the check could not
see, and two had a fixture per arm), and the *effect* was demonstrated on the two that did — deleting
an arm there left the file green. So the gap is real and the direction is right; only the number was
invented. Adding one fixture per synonym means one near-identical snippet per synonym, which costs
maintenance and teaches nothing: a synonym does not need its own witness to be honest. What a synonym
needs is a **name that admits it**, which is free — and, since C6, a `notSeen` snippet proving the
stated boundary is still the boundary.

**And the estimate was too pessimistic in the direction that mattered.** It assumed seven detectors
would stay as they were. Splitting the five literals into clause lists and witnessing each arm
(`tasks.md` 5.2) turned "7 detectors, mostly unwitnessed" into "7 detectors, every arm witnessed",
which is a stronger position than the estimate claimed to justify.

**Why not leave it.** The defect this change exists to fix is a check that overstates its scope.
Naming the scope is the whole repair for a synonym detector; enumerating it would be theatre.

For the three genuinely distinct detectors in `download-non-goals.test.ts`, clauses are consolidated
into the smallest set that preserves coverage, and the load-bearing check is extended to them. The
check must permit coverage-preserving consolidation and block coverage loss **only** — a check that
fails on every edit gets disabled, and a disabled check is the state this change is trying to leave.

### 2.8 The two wrong records are corrected in place, and marked

**Decision.** Edit the archived `verification.md`, adding a marked correction block rather than
silently rewriting the sentence. `verification.md` is archived, so a bare edit would leave a reader
unable to tell a correction from an original claim — and the whole reason to correct it is that
prose drifts from code.

The `applicationSources()` claim is corrected to the **real** gap: `download-non-goals.test.ts:52`
walks all of `src/`, so M20's server files *are* covered; what is missing is `public/`,
`frontend/scripts/` and `next.config.ts`. Correcting a false claim to a different false claim would
send the next reader to fix the wrong thing.

**`W4`** is cited in a carried-forward list and defined nowhere in the repository. It is a task
nobody can execute. Either the definition is restored or the citation is removed; the change
investigates which, and does not invent a definition.

### 2.9 The parked player: re-verify, starting from "works"

**Decision.** Attempt live-browser verification. The recorded status is **probably wrong**:
`next.config.ts:72` ships `frame-src 'self' https://www.youtube.com`, and `public/sw.js` classifies
the player host as pass-through, while five documents say it is CSP-blocked. Five documents
disagreeing with shipped configuration is a documentation defect, not evidence about the feature.

If browser verification is impossible — and it has been impossible since M4, with only Edge
installed and both production and Preview origins behind Vercel Deployment Protection — the status
is restated as unverified, the shipped configuration is quoted as evidence about the *policy*, and
the two are kept distinct. A policy that permits a thing is not proof the thing works; it is only
proof that "blocked" is the wrong word.

### 2.10 Six consecutive green runs is the completion criterion

**Decision.** The gate's full run must be green six times consecutively.

One green run is not evidence against an intermittent defect. That is the entire lesson of the three
flakes in scope, and it would be incoherent to accept one green run as this change's proof while
fixing three tests precisely because one green run meant nothing.

### 2.11 The install suite is a pin on shape, and the milestone does not claim more

**Decision, taken in round 12 after the alternative was rejected.** `tests/release-gate-install.test.ts`
asserts everything it can about the gate's install cascade from its **syntax**. It is the strongest
instrument of its kind this repository has, and it is not a proof that the cascade runs. Two escapes
are measured, named, and accepted as open:

```text
const SKIP_INSTALL = true;
if (!SKIP_INSTALL) { /* or a condition nothing can satisfy */
  if (item.how === "install") { ... }
}
// prepareDependencies, cascadeReason and environmentBroken are all never touched.  71 passed (71)

const prepared = prepareDependencies({ frontendDir: FRONTEND });
prepared.ok = true;   // the value is discarded; the else arm never runs.       71 passed (71)
```

**Why this is a decision and not a deferral.** The instrument that closes the class is executing the
gate and observing whether `environmentBroken` is set, or a taint/flow analysis — the same thing with
more machinery. Executing the gate is forbidden for this work, because its first step is a dependency
install and `npm ci` is never run here. So the closing instrument is unavailable, and the alternative
was a thirteenth syntactic predicate.

That alternative was rejected on evidence rather than taste. Twelve rounds of independent verification
each found the previous round's defect class reproduced inside the previous round's own repair, and the
ladder is legible: **name → span → declaration → dispatch → complement**. Each rung is real, and none is
the rung that would have covered the next finding, because the ladder was extended along the axis the
last defect was on rather than the axis the next one would be on. The same pattern appears one level
up: three of round 12's eight CRITICAL/WARNING rows were defects in the *verification apparatus* rather
than in the code it verifies. A suite that acquires a meta-layer per round acquires a meta-layer that
must itself be verified, and this milestone's verification budget was being spent there instead of on
the product.

**What this change therefore claims.** That the gate's install cascade is pinned against a named list
of specific regressions, each mutation-proven, and that two further ways to make it dead code are known,
measured and documented. It does **not** claim that a false green in this area is impossible.

### 2.12 Scope extension — one defect, authorised because M21's own criterion found it

> **The premise was falsified, and it is recorded here rather than in a heading.** When this section was
> written the defect was believed to be in **shipped code**, and the extension was granted on that basis.
> Measurement then placed the cause in the **test's measurement window**, and **no `src/` change was
> made**. Round 14's NIT 1 is right that a heading-only reader — a table of contents, a grep for
> `shipped code`, a diff summary — would have extracted the falsified premise from the old heading, so
> the phrase is gone from the heading and the correction lives here, where it cannot be summarised away.
> The section is retained because what was authorised, and what the authorisation turned out to be
> worth, is part of the evidence.

**Decision, 2026-10-05.** M21 §2.10 requires six consecutive green full gate runs. Batch 15, run at the
final documentation commit `0e65dc8`, was **five of six**. The failing run was

```text
tests/lyrics/lyricsPanel.test.tsx > LyricsPanel — following yields to the listener
  > scrolls the active line into view while following
AssertionError: expected [ …(2) ] to deeply equal [ { top: 150, behavior: 'smooth' } ]
```

— an exact-count assertion over a shared call counter, receiving the *same* call twice. Reproduced at
**0 failures in 40 isolated runs** and **2 in 10 concurrent instances** with an identical signature, so
the condition is contention rather than isolation. At the commit where batch 15 ran, `0e65dc8`, neither
`tests/lyrics/lyricsPanel.test.tsx` nor `src/features/lyrics/LyricsPanel.tsx` was touched by this branch —
`git diff --stat origin/main...HEAD` on both was empty — so **this was a pre-existing nondeterministic
defect that M21's own verification criterion exposed.** A criterion that finds a real defect before it
finds nothing is the criterion working. *Both statements are timestamped because this branch has since
touched the test file; see the supersession below.*

**Why this extends scope.** §3 promises no shipped behaviour changes, and the premise at the time of
writing was that the defect *is* shipped code. **That premise was falsified by measurement, and the
supersession is here rather than only in `tasks.md` 8.29 because this section is the authority.**

The measured cause is in the **test's measurement window**, not the panel:

```
MARKER read: scrollCalls.length = 0     (8 of 8 isolated runs)
exactly ONE scroll recorded per passing run
```

`layout()` mutates the global `getBoundingClientRect` stub, and `scrollActiveLineIntoView` reads it at
the moment the effect **flushes**, not when it is scheduled. Flushing before `layout()` gives delta `0`
and an early return — one recorded call, passes. Flushing after gives delta `150` and a second recorded
call inside the window — fails. Which branch runs is a scheduler decision. **All four of the effect's
dependencies are inert**: the effect's trace is byte-identical whether the run passes or fails, so
`following`, `state.kind`, `activeIndex` and the callback identity never move.

So the extension was needed to *investigate* shipped code, and it turned out no shipped change was
warranted. What survives of the original scope:

- **Done:** determine which dependency moves — measured, and the answer is **none of them**; capture
  evidence establishing the cause; make the smallest change that removes the nondeterminism without
  weakening lyrics-following or weakening the assertion; add a regression test that reproduces the
  established mechanism and fails without the fix.
- **The repair is in the test file only.** `git diff --stat -- src/` is empty. A production fix would have
  meant suppressing the panel's legitimate first centring, which is intended behaviour.
- **Explicitly out of scope, unchanged:** any other change to `LyricsPanel`, any change to the
  lyrics-following *behaviour*, and any weakening of the assertion to make the failure disappear. The
  assertion's exact count is the thing that caught this; relaxing it would convert a caught bug into a
  silent one.
- **All temporary instrumentation was removed before verification.** Instrumentation that survives into
  the tree is a debug artefact that later readers must reverse-engineer, and this change has spent twelve
  rounds on exactly that failure mode.
- **The six-run count restarts at the final fix.** Runs recorded before it are not evidence about the
  tree the fix produces.

**The record this section now corrects is the reason it is here at all.** §2.12 and §3 were written
*before* the investigation, on the belief that the defect was in shipped code, and both went on asserting
that in the present tense. When the measurement reversed it, only `tasks.md` was updated, and this change's
scope authority kept claiming a `src/` edit that does not exist. Round 13 found it by checking the claim
against `git diff`. A falsified premise left standing in the document that defines scope is the same
defect class as the one this milestone exists to remove — something believed because it was written down,
rather than because anything about it could fail — and it was introduced by the very commit that measured
it.

## 3. What this change does not do

- No shipped behaviour changes. `src/` is touched only if a test-only defect and a product defect
  prove indistinguishable, and that is recorded as a finding rather than slipped in. **No `src/` change
  was made under §2.12**: the defect was investigated in `src/features/lyrics/LyricsPanel.tsx` and the
  measurement placed the cause in the test's measurement window, so the repair is in
  `tests/lyrics/lyricsPanel.test.tsx` alone — `git diff --stat -- src/` is empty. §2.12 authorised a
  shipped-code change and none turned out to be warranted.
  **One export was added and it is on the record:** `flushListeningRecorder()` in
  `src/features/history/useListeningRecorder.ts`. Task 4.1 replaced a fixed 2000 ms poll with an
  await on the recorder's serialized write chain, and that chain was module-global and unexported, so
  the test had no way to await it without one. It is a flush over state the module already owns, it
  adds no capability, and the only caller in the repository is the test. A "no shipped behaviour
  changes" promise that omits a `src/` export is not checkable by the reader it is written for.
- No new product features, no public deployment.
- The coarse §2.7 clause is **kept**, narrowed if the origin judgement supports it. It is a false
  positive on the approved M20 shape *and* the only clause catching the caller-path-segment
  violation; deleting it trades one undetected hole for another. Its limitation becomes a tested
  fact rather than a comment.
- `MEMORY.md`, `ROADMAP.md`, `AGENTS.md` and `frontend/docs/DEPLOYMENT.md` are brought current,
  but no documentation is written to agree with a measurement that was not taken.