# Spec Delta

## ADDED Requirements

### Requirement: Every source type in the application home has a gate step or a recorded exemption

Every tracked source file type present in the canonical application home SHALL be processed by at least
one step of the release gate, or SHALL be recorded as frozen evidence with a stated reason. The gate's
report SHALL name which files it did not cover, so that its coverage is a stated result rather than an
inference from a green exit code.

A file type that a gate step covers by parsing SHALL be checked for validity by that step, rather than
being assumed well-formed because nothing has read it since it was written.

#### Scenario: A source type no step parses

- **WHEN** the application home contains a tracked file type that no gate step parses
- **THEN** the gate reports that type among the files it did not cover, naming it, rather than reporting
  a result whose silence is read as coverage

#### Scenario: A parsed file type is malformed

- **WHEN** a source file of a type the gate parses cannot be parsed
- **THEN** the gate fails and names the file and the parse error, rather than leaving the defect to be
  discovered when that file is next executed

#### Scenario: No interpreter is available for a gate step

- **WHEN** the gate runs on an environment where a step's interpreter is absent
- **THEN** that step reports itself as not run, with the reason, and is not counted as a pass — the same
  rule that applies to a checklist item requiring a human

#### Scenario: Frozen evidence is distinguished from live code

- **WHEN** a directory contains one-off evidence tooling that no gate step processes
- **THEN** it is recorded as frozen evidence with its reason, so that new live code added beside it is
  distinguishable from the recorded artifacts rather than inheriting their exemption
