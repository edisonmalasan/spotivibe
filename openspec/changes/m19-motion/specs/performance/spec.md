# Spec Delta

## ADDED Requirements

### Requirement: A motion budget holds the client bundle

The application SHALL hold a recorded, measured ceiling on the size of its client JavaScript, expressed in
gzipped bytes, and SHALL hold it as an assertion rather than as an intention. Adding a dependency that
grows the client bundle SHALL fail that assertion, so the cost of a dependency is decided rather than
absorbed.

Motion in particular SHALL be expressed in CSS, because a motion system implemented in JavaScript needs a
runtime to read the viewer's motion preference, and that runtime is the thing the budget exists to
question.

#### Scenario: The ceiling is asserted against a measurement

- **WHEN** the budget is checked
- **THEN** the gzipped size of the emitted client chunks is compared against a recorded ceiling

#### Scenario: The recorded ceiling is a measurement, not an estimate

- **WHEN** the recorded ceiling is inspected
- **THEN** it is a figure that was measured from a build, with the route it was measured on

#### Scenario: A dependency that grows the client bundle is visible

- **WHEN** a client-side library is added to the manifest
- **THEN** the budget assertion fails rather than the increase passing unnoticed

#### Scenario: A shared dependency is counted once per visit

- **WHEN** the per-route size is measured
- **THEN** a chunk shared by several routes is counted in each route that loads it, because each visit
  pays for it