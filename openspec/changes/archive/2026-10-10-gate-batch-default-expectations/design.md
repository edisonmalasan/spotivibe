# Design

## Context

See `proposal.md` — Why, for the motivation. What follows is only what an implementer needs in order to
choose between implementations.

The current state, precisely:

`verify-gate-batch.mjs` parses `--expect-files` and `--expect-budget`, defaulting to the literals `"182"`
and `"21"`. It records `options.supplied`, recording whether each figure came from the caller or fell
back to the default, and its failure text already distinguishes the two cases correctly. It then counts
**both** as `problems`, which is the defect: the script can name the cause of its own failure and still
fail because of it.

The two scripts are already coupled by an existing test. `evidence-scripts.test.ts` has a case asserting
the driver's printed checker command carries `--runs $Runs`, and another — added to fix a prior round —
asserting the checker's *documented* defaults equal the defaults it *asserts*, by regexing the header
comment and the `?? "…"` expression out of the source. That second test is the reason the constants look
load-bearing: it will fail when they are removed, and its removal is part of this work rather than an
accident to be worked around.

`run-gate-batch.ps1` measures each run and already prints the file count, test total, and motion-budget
count in its run table. The figures are in hand at print time.

## Goals / Non-Goals

**Goals**

- A reader who follows the printed instruction verbatim gets exit 0 on a correct batch.
- The expectation cannot fall behind the tree, because it is not stored in the tree's history.
- The property the constant guarded — catching a batch from the wrong tree — is still asserted, and by an
  exact mechanism rather than a lower bound.
- A stated expectation that disagrees with the evidence still fails.

**Non-Goals**

- Not changing what the batch *measures*. Six gate runs, six distinct digests, 0 skipped, no NUL or
  U+FFFD, markers present. All of that is untouched.
- Not changing the exit-code contract for real failures.
- Not making the checker assert anything it currently only reports. The executed-test total stays
  reported-and-cross-checked, not asserted; widening it is a separate question.
- Not touching application source.

## Decisions

### D1 — Derive the default from the batch and the live tree, rather than storing it

**Chosen.** When `--expect-files` is absent, the expectation is the figure the logs report, and the
checker's job becomes asserting two things about it: every log agrees, and the live tree agrees.

**Why the live-tree half is exact and not approximate.** The checker already spawns `vitest list` for its
enumeration phase, but `vitest list` alone prints one line per *template* — 3,112 on this tree — which is
not the file count and is explicitly documented as a lower bound by construction. `vitest list
--filesOnly` (vitest 5.0.2, verified today) prints one line per *file* and returns exactly **185**, which
is precisely the figure the batches report. So the cross-tree check is an equality, not a floor, and it
needs no new dependency and no hand-rolled globbing against `vitest.config`.

**Rejected — bump the constants to 185 and 25.** This is the treadmill the change exists to end. It is
correct on the day it is written and wrong again at the next milestone, and the next session discovers it
the same way this one did. It also leaves `run-gate-batch.ps1` printing a command that will break again.

**Rejected — drop the assertion and report the figure only.** The header's existing warning names this
failure mode precisely: a hard-coded expected total "whose failure mode is worse than the staleness it
guards against." A checker that reports a figure and asserts nothing about it is decoration.

**Rejected — require the flags, make omission an error.** Better than a stale default, but it still makes
correct usage require knowledge the reader has to go and find. The driver already knows the figures;
making the reader supply them is manufacturing work.

### D2 — A stated expectation that disagrees stays a failure

**Chosen.** `options.supplied` already exists and the distinction is preserved. Explicit disagreement is
exit 1 and always was.

**Why this must not be relaxed.** D1 changes only where an *unstated* expectation comes from. If the
stated path were allowed to go soft, a caller who asserts `185` against a batch that says `183` would be
told "not asserted, matches the live tree" — which is worse than the current behaviour, because it looks
like agreement.

### D3 — The driver prints the figures it measured

**Chosen.** The printed follow-up command carries `--expect-files <N> --expect-budget <N>`, bound to the
values parsed out of the run table the driver has just printed.

**Why binding to the observed value and not a second lookup.** The driver already extracts these figures
to render the table. Deriving the command from the same variables makes drift between the table and the
instruction structurally impossible, which is the property D1 and this decision are jointly reaching for:
correctness by construction rather than by maintenance.

**Consequence for the existing test.** The `:588` case asserting the printed line contains `--runs $Runs`
still passes and is extended, not replaced. The `:625` case coupling the documented defaults to the
asserted defaults is **removed**, because the constants it pins are gone; a case asserting the printed
command carries the measured figures replaces it.

### D4 — The verdict distinguishes asserted from reported

**Chosen.** With no stated expectation, the verdict names the derived figure, states that the caller
stated none, and states whether it matches the live tree.

**Why this is not cosmetic.** The batch these tools exist to corroborate is a *sample*, and a sample's
value is bounded by what was actually held constant. A green exit that silently means "the six runs agree
with each other and with today's tree" is materially weaker than one that means "the six runs agree with
each other, with today's tree, and with the figure you said you expected" — and the current output does
not tell the reader which they have.

## Risks / Trade-offs

**[The derived expectation cannot detect a batch from a tree that coincidentally has the same file
count]** → Accepted and stated. Equality on a file count is weaker than equality on a commit. The
alternative would be pinning the commit, which requires the checker to know a commit the caller has not
told it. The batch logs already record the commit under test, so the ceiling is documented rather than
papered over: this check asserts *tree-shape* agreement, not *commit* agreement.

**[`vitest list --filesOnly` is invoked on every run and costs time** → Measured: it is the same
invocation the enumeration phase already makes. The checker is run once per batch, not once per gate run,
so the cost is already paid. If a future vitest drops the flag, the checker fails loudly on the flag
rather than silently falling back to a weaker mechanism.

**[Removing the defaults makes the checker's header comment shorter and loses the audit trail** → The
header's round-12 history stays; only the sentence describing the defaults is rewritten. The reason the
constant approach was adopted, and why it was wrong, is preserved in the header and in `AGENTS.md`,
because it is the reason a reader should not reintroduce it.

**[A future milestone adds tests and the derived figure moves again]** → That is the point. The figure is
read from the batch at check time, so a new milestone changes it with no code change and no failure.

## Migration Plan

None required. No product behaviour changes; the change is confined to the verification apparatus, its
tests, and documentation. The exit-code contract for genuine failures is preserved, so any automation
that consumes the checker's verdict continues to work.

Rollback is a revert of a single commit touching four files.

## Open Questions

None. Every choice above would change either the specs or the task breakdown, so each was resolved here
rather than deferred.
