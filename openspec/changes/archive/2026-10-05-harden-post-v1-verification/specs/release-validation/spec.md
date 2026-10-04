# Spec Delta

## MODIFIED Requirements

### Requirement: The release gate is runnable and reports what it did not run

The release gate SHALL be executable as a single command, SHALL exit non-zero when any
automated check fails, and SHALL report for every checklist item either its result or the
reason it cannot be automated together with the steps to perform it manually. It SHALL NOT
report a single overall pass in place of per-item results.

The release gate SHALL NOT prepare its environment by deleting and recreating the dependency
directory it is validating. A failure to prepare the environment SHALL be reported as its own
named failure, and the remaining items SHALL be reported as not run rather than as failures of
the thing under test, because a cascade is a property of the environment and attributing it to
the product sends the reader to the wrong code.

#### Scenario: A failing check fails the gate

- **WHEN** an automated release check fails
- **THEN** the gate exits non-zero and names the item and what it found

#### Scenario: An item that cannot be automated is reported as not run

- **WHEN** the gate runs and a checklist item requires a human, a device, or a live
  deployment
- **THEN** the gate reports that item as not run, with the steps to perform it, rather than
  omitting it or reporting it as passed

#### Scenario: Every checklist item appears in the output

- **WHEN** the gate runs to completion
- **THEN** every checklist item is listed with its result or its reason for not running

#### Scenario: The environment cannot be prepared

- **WHEN** the gate's dependency install fails or leaves the dependency tree incomplete
- **THEN** exactly one failure is reported, naming the install, and the remaining items are
  reported as not run rather than as failures of the product

#### Scenario: The dependency tree is not destroyed to run the gate

- **WHEN** the gate begins
- **THEN** it does not delete and recreate the working tree's dependency directory, because a
  gate that can silently break a working tree cannot be the thing that validates one

#### Scenario: An item depends on an artifact that does not exist

- **WHEN** a gate item requires a build report that has not been produced
- **THEN** the item is reported as not run for that stated reason, and the gate's overall
  result states that the run was partial