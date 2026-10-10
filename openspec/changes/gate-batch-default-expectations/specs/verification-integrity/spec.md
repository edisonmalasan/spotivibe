# Spec Delta

## ADDED Requirements

### Requirement: A verification tool's own printed instruction must succeed on the evidence it just produced

A verification tool that prints a follow-up command SHALL print one that succeeds against the evidence
that same tool just produced. Where the tool already measured a figure, the printed command SHALL carry
that measured figure rather than requiring the reader to rediscover it.

A tool that prints an instruction which fails on a correct result is worse than one that prints nothing:
the reader follows the documentation, the apparatus reports failure, and the only available conclusion
is that the evidence is bad or the reader is wrong. Both are wrong.

The printed command SHALL be correct by construction rather than by coincidence. It SHALL be bound to the
figures the tool observed in the run it is describing, so that it cannot drift from that run as the tree
changes underneath it.

#### Scenario: The printed instruction is followed on a correct batch

- **WHEN** a batch runs and the reader follows the follow-up command the tool printed, verbatim
- **THEN** the checker exits 0 on that batch, and the command required no figure the reader had to
  discover separately

#### Scenario: The tree gains a test file after the tool was written

- **WHEN** a test file is added to the repository and the tool is used again without modification
- **THEN** the printed command still exits 0, because it carries the figure this run measured rather than
  a figure compiled into the tool when it was written

### Requirement: A default expectation may not be a constant that falls behind the tree

A verification tool SHALL NOT assert correctness against a default figure describing a different version
of the tree than the one under test. A figure that changes whenever the repository legitimately gains a
file is not an expectation; it is a snapshot, and it invalidates correct evidence on every ordinary
change.

Where the tool can obtain the correct figure from an independent source — from the evidence it is
checking, or from the live tree — it SHALL use that source instead of a constant, and the expectation
SHALL hold without the caller having to supply anything.

Deriving the expectation SHALL NOT weaken the check. The properties a constant was standing in for SHALL
still be asserted:

- the logs in a batch SHALL **agree** with one another on every asserted figure, and
- the batch's figure SHALL be **consistent with the live tree**, so that a batch taken against a
  different tree is detected rather than quietly accepted.

Where a caller states a figure explicitly, a disagreement between that figure and the evidence SHALL
remain a failure. A stated figure is a claim about the batch, and a false claim is worth reporting.

#### Scenario: A correct batch on a newer tree

- **WHEN** the tree has legitimately gained test files since the tool was written, and a batch taken on
  that tree is checked without stated expectations
- **THEN** the check passes, because the expectation is derived from the batch and confirmed against the
  live tree rather than compared against a stale snapshot

#### Scenario: A batch taken on a different tree

- **WHEN** a batch's file count does not match the number of test files the live tree actually contains
- **THEN** the check fails and reports the cross-tree batch by name, without the caller having supplied
  any expectation at all

#### Scenario: The logs disagree with each other

- **WHEN** one log in a batch reports a different figure from the others
- **THEN** the check fails, and the disagreement is reported rather than resolved by picking a majority

#### Scenario: A caller states a figure that the evidence contradicts

- **WHEN** a caller passes an explicit expectation that does not match the batch
- **THEN** the check fails, and removing the default has not silently removed the assertion

### Requirement: A verification run states what it did and did not assert

A verification run SHALL report, in its own output, which checks were asserted and which were merely
reported. Where a check was not asserted, the run SHALL say so in words rather than leaving the absence
to be inferred from the absence of a complaint.

A run that is green SHALL NOT be read as covering every property the tool is capable of checking. The
distinction between "checked and passed" and "not checked" is the difference between evidence and the
absence of a contradiction, and a verdict that does not draw it is not a verdict.

#### Scenario: No expectation was stated by the caller

- **WHEN** the checker is run without any stated expectation
- **THEN** its verdict names the figure it derived, states that the caller stated no expectation, and
  states whether the derived figure matches the live tree

#### Scenario: A run asserts everything it can

- **WHEN** the checker is run with stated expectations on a batch that satisfies them
- **THEN** the verdict distinguishes the figures that were asserted from those that were only reported,
  and a green exit reflects only the asserted ones
