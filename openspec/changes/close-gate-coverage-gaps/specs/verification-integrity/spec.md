# Spec Delta

## ADDED Requirements

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
