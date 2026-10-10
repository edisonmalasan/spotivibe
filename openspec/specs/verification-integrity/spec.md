# verification-integrity Specification

## Purpose
Governs the integrity of the repository's own verification machinery — the release gate, the CI
workflow order, the guards over the source tree, the tests' isolation from each other, and the
recorded claims about all of it. It exists because `release-validation` governs the product's
permanent exclusions and the release contract, and says nothing about whether the machinery performing
that validation can itself be trusted to fail when it should.

## Requirements

### Requirement: A check that cannot fail is fixed or retired, not left in place

A guard over the repository's own sources SHALL either be able to fail on a violating input, or be
removed. A guard that cannot be made to fail SHALL NOT be left in place with a comment asserting
that it can.

Attribution of a guard's coverage SHALL be **computed**, not declared. Where a guard is composed of
multiple clauses, each clause SHALL be shown to be load-bearing: deleting that clause alone SHALL
cause some fixture to stop matching, while a consolidation that preserves coverage SHALL NOT be
treated as a defect.

#### Scenario: A clause that no fixture depends on is found

- **WHEN** each clause of a multi-clause guard is deleted in turn and the guard's own suite re-run
- **THEN** every clause is shown to be required by at least one fixture, and any clause that is not
  is reported by name so it can be given a fixture or removed

#### Scenario: A fixture that passes for an unrelated reason does not count as coverage

- **WHEN** a fixture is filed against a clause but is also matched by a broader clause in the same
  guard
- **THEN** deleting the narrower clause loses no fixture and is therefore reported as redundant,
  because a clause always shadowed by a broader one is not a guard

#### Scenario: Two clauses that are subsets of one another are repaired

- **WHEN** one clause's pattern is a strict superset of another's within the same guard
- **THEN** the pair is disjointed, because a strict superset can never itself be load-bearing and
  makes re-filing a fixture between them undetectable

#### Scenario: A clause matching a documented token rather than an observed one is replaced

- **WHEN** a clause's pattern matches a spelling that no code contains, because it names the term as
  the documentation names it rather than as the source spells it
- **THEN** the clause is replaced with the text the source actually contains, or removed

#### Scenario: Declared attribution is not accepted as evidence

- **WHEN** a fixture names the clause that must catch it, by hand
- **THEN** that declaration is not treated as proof, because a field an author writes about their
  own detector records what the author believed rather than what the detector does

#### Scenario: A check's name does not overstate its scope

- **WHEN** a check covers a named subset of a file's guards
- **THEN** its name says which subset, so that a guard outside the subset is not reported as covered

#### Scenario: A guard cannot be made to fail

- **WHEN** a guard over the repository's own sources is exercised with a violating input
- **THEN** it is shown failing, or the guard is removed

### Requirement: The release gate distinguishes a broken environment from a broken product

The release gate SHALL NOT install dependencies over the working tree it is validating. A failure to
install SHALL be reported as **its own named failure**, distinct from any failure of the thing under
test.

A gate item whose result depends on an artifact produced by an earlier step SHALL NOT be reported as
passing when that artifact does not exist, and the gate SHALL state which items it could not run for
that reason.

#### Scenario: An install fails part way through

- **WHEN** a dependency install fails or leaves the dependency tree incomplete
- **THEN** the gate reports one named failure identifying the install, rather than one failure per
  subsequent item, and does not attribute the cascade to the product

#### Scenario: The dependency tree is complete before the gate runs

- **WHEN** the gate begins
- **THEN** it does not delete and recreate the working tree's dependency directory

#### Scenario: A gate item needs a build artifact and there is none

- **WHEN** a gate item depends on a build report that does not exist
- **THEN** the item is reported as not run for that stated reason, and the gate does not report the
  run as fully green

#### Scenario: A gate reports what it did not run

- **WHEN** the gate completes
- **THEN** every item it could not execute is named, including items requiring credentials, a
  browser, a deployment, or a human

### Requirement: A run that is skipped is never reported as a pass

A check that requires an artifact produced by a separate step SHALL NOT report a green run while
skipping itself for want of that artifact. Where the absence is disclosed, the disclosure SHALL be in
the workflow's own ordering rather than only in a comment inside the file.

#### Scenario: Continuous integration runs the build after the tests

- **WHEN** the workflow's step order leaves a build artifact unavailable to the test suite
- **THEN** the workflow is reordered so the artifact exists, because a documented skip is still a
  check that does not run

#### Scenario: A size budget is checked in continuous integration

- **WHEN** the test suite asserts a bundle size
- **THEN** a build has already run in that workflow, so the assertion executes rather than skipping

### Requirement: A test may not mutate the tree another test reads

A test that writes a file into the application source tree SHALL NOT delete it while another test may
be reading that tree, because test isolation separates process state and not the filesystem. Such a
test SHALL write outside the tree, or take an explicit lock, or the reading test SHALL tolerate the
file's presence.

#### Scenario: A probe file exists while another test walks the tree

- **WHEN** two test files run concurrently and one has written a temporary source file
- **THEN** the tree-walking test does not fail because of a file the other test created and will
  delete

#### Scenario: A test asserts on a temporary file it created

- **WHEN** a guard needs a file to exist in order to be tested
- **THEN** the file is created at a path the guard under test walks, because a probe placed where the
  guard cannot see it would make that guard prove nothing
- **AND** every reader of the source tree tolerates a file that vanished between being listed and
  being read, and treats any other read failure as fatal
- **AND** the tolerating reader reports each vanished file, and its caller asserts that no file was
  reported, so a run that does lose a file fails rather than quietly reading fewer files than it
  believes

> **M21 Apply, 2026-10-04 — this scenario was rewritten because it did not describe what was
> implemented.** As first written it required the file to be created outside the application tree, and
> `design.md` §2.5 recorded that as the decision. The code does the opposite: the probe stays at
> `src/features/sharing/ProbeM19Motion.tsx`, because the guard under test asserts on the application
> sources and needs a file at a source path to be exercised at all. Independent verification, CRITICAL
> C7, found the spec and the design both advertising a decision the code had reversed.
>
> The rewrite keeps the requirement the scenario was reaching for — one guard must not break because
> another test wrote a file — and states it as a property of the *reader* rather than as a location
> rule. See `design.md` §2.5 for why tolerating a vanished file needs no excluded-directory constant,
> and therefore has no second spelling that can drift.

### Requirement: An intermittently failing test is diagnosed before it is fixed

A test that fails intermittently SHALL have its cause established and recorded before a change is made
to it. A change that makes an intermittent test pass without an established cause SHALL NOT be
recorded as a fix, and the test's own recorded cause SHALL be updated if the investigation contradicts
it.

Re-running an intermittently failing test until it passes SHALL NOT be counted as evidence.

#### Scenario: A polling budget stands in for an awaited chain

- **WHEN** a test synchronises on an application write path that serialises through a promise chain
  by polling with a fixed timeout
- **THEN** the test waits on the chain rather than on a budget, and a recorder attached by an earlier
  test in the same file does not accumulate

#### Scenario: A negative assertion races teardown

- **WHEN** a test asserts that an element is absent while a stubbed request is deliberately left
  pending
- **THEN** the assertion waits for the condition it means to check rather than racing the test's own
  teardown

#### Scenario: A cause cannot be reproduced

- **WHEN** an intermittent failure cannot be reproduced within the investigation's budget
- **THEN** it is recorded as undiagnosed with the candidate causes listed as candidates, and no fix is
  claimed

### Requirement: The recorded state of a claim matches the code

A recorded measurement, count, or status SHALL match the code it describes at the commit it is
recorded against. Where an archived record is found to misstate the code, it SHALL be corrected and
the correction marked, rather than left to be inherited as fact.

A carried-forward item SHALL be defined at the point it is carried, in enough detail to be executed
without asking its author.

#### Scenario: A record overstates a scan's coverage

- **WHEN** a recorded claim says a check covers less than the code actually scans
- **THEN** the claim is corrected to the real gap and the difference is recorded, because a
  correction that names the wrong defect sends the next reader to fix the wrong thing

#### Scenario: A carried-forward item has no definition

- **WHEN** a list of carried-forward warnings names an item that is defined nowhere in the repository
- **THEN** the definition is restored or the citation is removed, so the item can be executed without
  its author

#### Scenario: A recorded status contradicts shipped configuration

- **WHEN** several documents state that a feature is blocked by a policy, and the shipped policy
  permits it
- **THEN** the status is re-verified and corrected, with the shipped configuration quoted as the
  evidence

### Requirement: A documented limitation of a guard is checked rather than described

Where a guard is known to detect one spelling of a forbidden thing rather than the property itself,
that limitation SHALL be asserted by a test that demonstrates the neighbouring permitted spelling is
not flagged, so that the limitation is a checked fact rather than a comment that can go stale.

#### Scenario: A guard detects a spelling, not the property

- **WHEN** a guard is recorded as unable to see a construct
- **THEN** a test demonstrates that the construct the shipped code uses is not matched, and that a
  different spelling of the same forbidden thing is

#### Scenario: A comment claims a limitation that stops being true

- **WHEN** a change makes a guard narrower or broader than its comment describes
- **THEN** the comment changes with it, because a stale limitation claim is worse than none

### Requirement: A test that renders a control waits for the control's own readiness, not for an earlier signal in the same chain

A test that renders a surface and then asserts on a control's usable state SHALL wait for that
control's state directly. It SHALL NOT wait on a store-level or module-level flag that is set earlier
in the same promise chain, and then rely on a state update and a render commit landing before its
assertion.

A flag set by an earlier `.then` in a chain becomes observable before the `.then` that schedules a
state update, and a state update becomes observable only after a render commits. A wait on the
earlier flag therefore has a window between the flag and the committed DOM, and whether an assertion
lands inside that window is a scheduling question rather than a property of the code. Under full
suite load the window is missed often enough to fail a batch roughly one run in six.

The condition a test waits on SHALL be the condition it asserts on, so that a genuine defect
surfaces as that defect — a control that never becomes enabled, named as such — rather than as a
timeout on an unrelated signal.

#### Scenario: A control is gated on a local state that follows a store flag

- **WHEN** a surface disables a control while a local status is `"loading"`, and that status is set
  from a promise the same store flag also resolves
- **THEN** a test asserting the control is enabled waits for the control to be enabled, and passes
  once it is, rather than passing or failing according to where a poll lands relative to a render
  commit

#### Scenario: The surface is genuinely broken

- **WHEN** the control never reaches its enabled state
- **THEN** the wait fails naming the control that never became enabled, not a timeout on the store
  flag the surface happened to also set

### Requirement: An unsynchronised wait is a verification defect

A test that can report a defect where none exists SHALL be treated as a defect in the test's
synchronisation and not as a finding about the code under test. Such a test SHALL NOT be recorded as
evidence that the code under test is broken, and its red SHALL NOT be counted toward a milestone
criterion.

A red that does not mean anything is worse than no red: it consumes the signal the gate exists to
provide, and it does so while appearing to be working. The distinction matters most here, where a
mis-synchronised wait in a settings test failed a full gate batch and left a milestone that was
otherwise complete unable to certify its completion criterion.

#### Scenario: A batch fails on a test whose wait condition is not its assertion

- **WHEN** a full gate batch fails on a test that waits on a signal other than the one it asserts
- **THEN** the failure is recorded as a synchronisation defect in that test, the milestone's
  completion criterion is recorded as unmet rather than retried until green, and the code under test
  is not recorded as defective

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

### Requirement: A tool may not report success for input it did not examine

A static analysis tool's exit code SHALL NOT be treated as evidence that it examined a given file. Where
a tool declines a file — because it has no parser for the extension, or no matching configuration — that
file SHALL be recorded as uncovered, and the tool's success over it SHALL NOT be counted as a pass.

Coverage SHALL be established by asking the tool what it would process, not by its exit code. A tool that
reports success while skipping its input is reporting the absence of a contradiction, which is not a
result.

#### Scenario: A linter succeeds over a file it has no configuration for

- **WHEN** a linter is invoked on a file for which no matching configuration exists
- **THEN** the file is recorded as uncovered rather than as passing, because a zero exit code over an
  unexamined file is not evidence about that file

#### Scenario: A formatter has no parser for the extension

- **WHEN** a formatter is pointed at a file whose extension it cannot parse
- **THEN** the file is recorded as uncovered, rather than being omitted from a directory-wide run whose
  success is then read as covering the whole tree

### Requirement: An uncovered file fails at commit time rather than at discovery time

The repository SHALL carry an automated check that enumerates the tracked files a gate is expected to
cover and asserts that each one is either covered by a gate step or recorded as an exemption with a
stated reason. A file that is neither SHALL fail that check.

The check SHALL fail loudly enough to name the offending path and the reason it is uncovered, so that
adding a file in a new format is a deliberate decision rather than an omission nobody notices for four
milestones.

#### Scenario: A new source file appears in a covered format

- **WHEN** a tracked source file is added in a format the gate already covers
- **THEN** the coverage check asserts it is covered and passes without requiring an exemption

#### Scenario: A file is added in a format nothing covers

- **WHEN** a tracked file is added whose format no gate step processes
- **THEN** the coverage check fails, naming the file and the format, rather than leaving the gap to be
  found when that file is next edited

#### Scenario: An existing file loses its coverage

- **WHEN** a change removes a format's coverage — by narrowing a formatter's parser list, or a
  configuration's file patterns — so that a file already in the tree is no longer covered
- **THEN** the coverage check fails, because the gap was created by the change rather than pre-existing

### Requirement: A stated coverage limitation becomes a checked fact or is removed

Where the project records that a guard, a gate step, or a static check does not reach a file, format, or
construct, that limitation SHALL be asserted by an automated check rather than stated only in prose. A
limitation that is described and not checked is a limitation that no longer holds while the description
still claims it does.

A limitation that cannot be asserted — because no tool for it exists — SHALL instead be discharged by
adding a check that reaches the subject, so that the limitation stops being true.

#### Scenario: A limitation is recorded in documentation

- **WHEN** the project records that a file type is not reached by any gate step
- **THEN** a check asserts either that the file type is covered, or that its exemption is intentional and
  stated, so the record cannot describe a gap that has since been closed

#### Scenario: A documented gap is closed

- **WHEN** a change adds the check that the recorded limitation said was unavailable
- **THEN** the recorded limitation is removed in the same change, because a limitation claim that no
  longer describes the tree is worse than no claim
