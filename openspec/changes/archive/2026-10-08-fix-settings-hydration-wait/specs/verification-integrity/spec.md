# Spec Delta

## ADDED Requirements

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
