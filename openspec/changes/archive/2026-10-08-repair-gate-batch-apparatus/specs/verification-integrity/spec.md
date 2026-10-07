# Spec Delta

## ADDED Requirements

### Requirement: A verification tool's ability to run does not depend on the directory it is stored in

A verification tool SHALL NOT determine the location it operates on by counting the directory levels
between itself and that location. It SHALL locate a known marker by walking upward from its own
position until the marker is found, so that relocating the tool does not change whether it runs.

The number of levels is a property of one storage layout, and archiving a change relocates it. A tool
whose runnability is conditional on a depth that no test observes satisfies the letter of a
documented interface while being unrunnable in practice.

This SHALL be asserted by a test that resolves the location from more than one nesting depth and
requires the same result from each. A comment naming a depth is not a check that the depth still
holds, and a tool that has already been relocated once by a mechanism outside its control will be
relocated again.

#### Scenario: The change that supplied the tool is archived

- **WHEN** the tool is stored under an archived change directory, one level deeper than the layout it
  was written against
- **THEN** it resolves the same location it resolves from the shallower layout, and does not exit
  reporting a failed root computation

#### Scenario: The tool is stored beside the code it exercises

- **WHEN** the tool is stored at a depth unrelated to any change directory
- **THEN** it resolves the same location, without requiring the caller to place it at any particular
  depth

#### Scenario: No marker is found anywhere above the tool

- **WHEN** no known marker exists at or above the tool's own directory
- **THEN** the tool exits non-zero and names the directory it searched from, rather than proceeding
  with a location it did not verify

### Requirement: An interface a tool prints names an invocation that executes

Where a tool prints the command, interpreter, or argument form that completes its workflow, that
printed form SHALL execute in the environments the repository documents as supported.

A usage block contradicted by the tool's own implementation is a defect rather than a documentation
preference: the printed form is the interface, and an interface that no reader can run is not an
interface. This is distinct from a tool that merely omits an example, which loses convenience rather
than correctness.

This SHALL be asserted by a test that runs the tool through the invocation exactly as printed, rather
than by a test that compares the usage text against a second copy of the same claim.

#### Scenario: The printed usage names an interpreter the repository does not provide

- **WHEN** a tool's usage block names an interpreter that is not installed, while its implementation
  is written to accommodate a different interpreter that is
- **THEN** a reader following the printed usage cannot run the tool, and the tool is defective at its
  interface

#### Scenario: The printed completion command is run as printed

- **WHEN** the command a tool prints to complete its workflow is executed verbatim, from a clean
  state
- **THEN** it runs to completion rather than failing on a missing interpreter or an argument the
  caller was not told about

### Requirement: A default figure a checker asserts cannot fail indistinguishably from a regression

Where a checker asserts an observed figure against a built-in default, a mismatch SHALL report the
figure observed, the figure expected, and that the default belongs to an earlier tree.

A default that has fallen behind the tree is a stale constant, not a regression, but a mismatch that
does not say so forces the reader to re-derive the entire measurement to discover which of the two it
is. Asserting a default is correct and is not the defect; making the failure undiagnosable is.

This SHALL be asserted by a test that provokes the mismatch and requires the diagnostic to name both
figures, so that the diagnostic cannot be deleted or weakened without failing.

#### Scenario: A measurement runs against a tree whose figures differ from the default

- **WHEN** the figure observed differs from the default the checker asserts
- **THEN** the failure names both figures and identifies the default as belonging to an earlier tree,
  so a stale constant is distinguishable from a regression without re-running the measurement

#### Scenario: The caller states the expected figure explicitly

- **WHEN** a caller supplies the figure the checker should assert
- **THEN** the checker asserts that figure, and does not fall back to the built-in default