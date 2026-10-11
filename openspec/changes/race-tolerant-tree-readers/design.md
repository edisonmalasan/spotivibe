# Design

## Context

See `proposal.md` — Why, for motivation. The state that shapes the approach:

- `frontend/tests/helpers/sourceTree.ts` already provides the tolerant read path M25 built: `readTree`
  lists a tree, reads each listed file, skips a file that vanished (`ENOENT` only), rethrows anything
  else, and reports each vanished path through an `onRace` callback. It is proven by
  `source-tree-race.test.ts` using an injected `read` seam, so both branches are tested on every run.
- **Exactly one consumer exists**: `architecture.test.ts`. Thirteen other test files read
  `frontend/src` by listing it and reading each listed file, unguarded.
- **Exactly one writer exists**: `motion-scope.test.ts` writes and deletes
  `src/features/sharing/ProbeM19Motion.tsx` inside `try`/`finally`. A read-only survey found no other
  test-time writer into `frontend/src` or `frontend/public`; every other write targets an `mkdtemp`
  scratch tree.
- `token-contrast.test.ts` already tolerates `ENOENT` — but returns `null` and drops the file with no
  record, so it satisfies half the obligation and fails the reporting half.
- M25's own record (`openspec/specs/verification-integrity`, the M21 note on this requirement) already
  rejected moving the probe and rejected a lock, with reasons that survive re-reading.

The measurements in `proposal.md` came from a read-only survey of `frontend/tests/`. The **exact** set
of files needing conversion is re-measured in Apply task 1 rather than fixed here, because a design that
freezes a count into its own justification is a design that goes stale when the count changes.

## Goals / Non-Goals

**Goals:**

- Every reader of `frontend/src` tolerates a vanished file and surfaces it.
- A reader added later cannot arrive already non-compliant without a check failing.
- `motion-scope.test.ts` is not modified, and the probe stays where it is.
- The guard over the guard is itself proven able to fail.

**Non-Goals:**

- Changing application code, route handlers, providers, or persistence.
- Changing the probe's location or lifetime.
- Any change to gate steps, the client bundle, dependencies, or manifests.
- Claiming the guard makes the race *impossible*. See D3.

## Decisions

### D1 — Readers take the tolerant path; the reporting assertion is made unskippable

**Chosen.** Add a thin asserting wrapper beside `readTree` in `helpers/sourceTree.ts`:

```
readTree(directory, options)        // unchanged — architecture.test.ts depends on it
readTreeStrict(directory, options)  // new — tolerates, reports, and fails on any loss
```

`readTreeStrict` collects raced paths and, if any, throws an error naming every one. A reader calling
it cannot forget the reporting obligation, because the call **is** the assertion.

**Why not "each reader calls `readTree` with `onRace` and then asserts".** That is the pattern
`architecture.test.ts` uses and it is proven. It is also thirteen opportunities to forget half of it,
and the half most likely to be forgotten is the half nobody sees until a file silently goes unread. A
helper that fails on its own removes the opportunity.

**Why not "readers may hand-roll tolerance".** Then the guard has to recognise an arbitrary shape, and
the strength of the guard becomes a matter of how clever the regex is. See D3.

`architecture.test.ts` is **not** migrated to `readTreeStrict`. Its structure is proven and its
`racedFiles` assertion is a separately named test that a reader of the report can find. Converting it
would churn a passing file to gain nothing, and its `readTree` cache is load-bearing for its cost.

### D2 — The guard enumerates readers by shape and is explicitly shape-based

**Chosen.** A new test scans `frontend/tests/**` for files that both enumerate a directory and read
each enumerated file, and requires each such file to reach its read through `readTree` or
`readTreeStrict`. Files that read only fixed, named paths are exempt, and the guard asserts that its
own exemption logic is not vacuous by requiring a known fixed-path reader to be classified as one.

**Alternatives considered:**

- **Detect by the presence of `readFileSync`.** Rejected: thirteen files read fixed paths with
  `readFileSync` and no listing, including `evidence-scripts.test.ts`. Every one would be a false
  positive, and a guard that cries wolf is the exact defect M31 recorded in its own first version.
- **Execute each reader against an injected vanishing file.** Stronger in principle, and it is what
  `source-tree-race.test.ts` already does for the helper. Rejected as the *guard's* mechanism because
  it means running thirteen suites' read paths out of context, and because the failure it would catch
  — a reader that does not tolerate — is already caught by the static shape. It is kept for the helper
  itself, where it is cheap and precise.
- **A recorded list of compliant files.** Rejected by the spec delta's own wording, and it is the
  failure mode M25 already made once: correct about the file it was shown, silent about the other
  thirteen.

### D3 — The guard's limits are stated, not papered over

The shape-based guard detects a reader that lists a directory and reads each listed file through an
unguarded path. It does **not** detect a reader that obtains paths some other way, or one that hides
its read behind indirection. The spec delta therefore claims only that a check exists and fails for
the shape it inspects — not that the class is closed.

This is deliberate, and it is the M21 CRITICAL 1/2 lesson applied to this design before it is written
rather than after a verifier finds it: a syntactic instrument is worth having, and claiming it proves
more than it proves is what produced twelve rounds of finding the previous round's defect class
reproduced inside the previous round's repair.

### D4 — `token-contrast.test.ts` is migrated for the reporting half only

It already tolerates. Moving it to `readTreeStrict` changes what a lost file does: from *silently
skipped* to *failing the suite that lost it*. That is the point of the reporting clause — a run that
loses a file should fail rather than quietly read fewer files than it believes — but it is a behaviour
change in that suite, so it is called out in tasks rather than folded into the mechanical sweep.

### D5 — Conversion order is by measured exposure, and each conversion is verified alone

Files are converted in the order Apply task 1 measures, most-exposed first, and the suite is run after
each group. A thirteen-file sweep verified only at the end cannot attribute a failure to a conversion,
and this repository has already spent a milestone on a gate that passed repeatedly against a tree
missing its central test file.

## Risks / Trade-offs

**[The guard is evadable]** → D3 states the limit in the spec rather than the design, so the claim
cannot outrun the instrument. The guard is mutation-proven against the shape it inspects, and its own
enumeration is witnessed on synthetic inputs before it is trusted with the real tree.

**[`readTreeStrict` fails a suite that previously passed]** → That is the obligation finally being
discharged, not a regression. It is only reachable when a file genuinely vanished, which task 1
measures against. Mitigated by converting one group at a time (D5) so an unexpected failure is
attributable.

**[`readTreeStrict` performing assertions inside a helper]** → `helpers/sourceTree.ts` is a test-only
module and already takes an injected reader for exactly this reason. The asserting variant is additive;
`readTree` keeps its current behaviour so `architecture.test.ts` and `source-tree-race.test.ts` are
unaffected.

**[Converting thirteen files is a wide mechanical diff]** → Each conversion is one call-site change;
no assertions are rewritten. The guard, not the diff, is the part that must be proven.

**[`encoding-integrity.test.ts` walks roots outside `frontend/`, including the repository root]** →
It reads `openspec/` and `.github/`, which no test writes to at test time. It is converted for
uniformity because the rule says *every* reader; its exposure is lower and its tasks will say so
rather than implying thirteen equally urgent fixes.

## Migration Plan

No deployment and no rollback concerns: the change touches only test files, a test helper, and one new
test. A revert is a revert.

Ordering: measure the true reader set → add `readTreeStrict` and its tests → convert in measured order,
running the suite per group → add the guard → prove the guard fails on the shape it claims to catch.

## Open Questions

None that would change the specs, the approach, or the task breakdown. One deferral is recorded in
`tasks.md` rather than here: whether the guard should also police readers of directories other than
`frontend/src` is a question about scope expansion, and it is answered by not expanding into it.
