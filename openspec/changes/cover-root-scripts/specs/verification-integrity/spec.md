# Spec Delta

## MODIFIED Requirements

### Requirement: A stated coverage limitation becomes a checked fact or is removed

Where the project records that a guard, a gate step, or a static check does not reach a file, format, or
construct, that limitation SHALL be asserted by an automated check rather than stated only in prose. A
limitation that is described and not checked is a limitation that no longer holds while the description
still claims it does.

A limitation that cannot be asserted — because no tool for it exists — SHALL instead be discharged by
adding a check that reaches the subject, so that the limitation stops being true.

Asserting the existence and wording of a limitation is not by itself discharge. Where a recorded
limitation's subject is itself executable, the limitation SHALL be discharged by executing it, so that
recording the state of a check never becomes a substitute for the state of the thing the check
describes. A limitation that survives on the authority of its own record is the same defect this
requirement exists to prevent, one level up.

#### Scenario: A limitation is recorded in documentation

- **WHEN** the project records that a file type is not reached by any gate step
- **THEN** a check asserts either that the file type is covered, or that its exemption is intentional and
  stated, so the record cannot describe a gap that has since been closed

#### Scenario: A documented gap is closed

- **WHEN** a change adds the check that the recorded limitation said was unavailable
- **THEN** the recorded limitation is removed in the same change, because a limitation claim that no
  longer describes the tree is worse than no claim

#### Scenario: A recorded exemption is asserted rather than executed

- **WHEN** a recorded limitation's subject is itself a program that can be run
- **THEN** running it is what discharges the limitation, and asserting that the record is present and
  correctly worded does not, because a well-formed record of broken evidence is still broken evidence