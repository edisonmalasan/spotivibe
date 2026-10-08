# Spec Delta

## ADDED Requirements

### Requirement: The contrast guard reads the product's source files once and survives concurrent writes to that tree

The contrast guard SHALL read each component source file at the moment its directory entry is seen,
rather than collecting paths in one pass and reading them in a later pass. It SHALL treat a file that
is listed by the directory walk and then cannot be opened as having ceased to exist, and continue
without it.

A path that the walk returned and the read then cannot open was deleted between the two calls; a
file that is genuinely not part of the product is not returned by the walk in the first place. The
guard's subject is the product's source files, so a file that no longer exists is not one of them,
and asserting a contrast ratio against it is not a stricter check but an impossible one.

The guard SHALL be written into the real source tree by other tests rather than into a temporary
directory, and the contrast walk SHALL NOT exclude any product directory to avoid the collision.

A probe written elsewhere would not exercise the walk over the real tree, so the test that writes it
would pass while proving nothing. Excluding a real directory would stop a genuine contrast
regression in that directory from being caught, which is a worse outcome than a rare retry.

#### Scenario: Another test deletes a component between the walk and the read

- **WHEN** a test file running in parallel writes a probe into the source tree and removes it while
  the contrast guard is walking that directory
- **THEN** the guard completes over the remaining files without aborting, and reports the same
  offences it would report if the probe had never existed

#### Scenario: The probe is dropped into the real source tree

- **WHEN** a test proves that the guard rejects an offending component
- **THEN** the probe is written into the source tree the guard walks, and removed afterwards, so the
  guard's verdict is reached against the real tree

### Requirement: Tolerance in the contrast guard cannot become silence

A guard that tolerates a missing file SHALL still be required to find the product's components and
still be required to find text that uses the type scale. Tolerating a file that vanished MUST NOT
extend to tolerating a file that is present.

The failure mode of making a reader tolerant is a reader that tolerates everything and returns
nothing, which turns every contrast rule into a pass. That is a worse outcome than the flake it
replaces, because it is invisible: the suite is green and the guard is dead.

This SHALL be asserted by a test that establishes both halves at once — that a path which does not
exist is reported absent without throwing, and that a path which does exist still yields its
contents — so that the tolerance cannot generalise into returning nothing.

#### Scenario: A path that does not exist

- **WHEN** the guard is asked for the source of a path that is not present
- **THEN** it reports the path as absent rather than throwing, and the walk over the other files
  continues

#### Scenario: A path that does exist

- **WHEN** the guard is asked for the source of a path that is present
- **THEN** it returns that file's contents, and the walk still reports more than the minimum number
  of component files and of components using the type scale
