# Spec Delta

## Purpose

Governs the integrity of the repository's own verification machinery — the release gate, the CI
workflow order, the guards over the source tree, the tests' isolation from each other, and the
recorded claims about all of it. It exists because `release-validation` governs the product's
permanent exclusions and the release contract, and says nothing about whether the machinery performing
that validation can itself be trusted to fail when it should.

## ADDED Requirements

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
- **THEN** the file is created in a location the application tree does not contain, so that no other
  test can observe it by accident

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
