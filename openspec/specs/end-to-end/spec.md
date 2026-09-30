# end-to-end Specification

## Purpose

Whether the flows a listener actually performs keep working from one release to the next,
and whether the suite that proves it is maintained rather than rebuilt.

## Requirements

### Requirement: The critical flows are exercised in a real browser

Each critical user flow SHALL be exercised end to end in a real browser against a
production build, driving the shipped application rather than a component in isolation, and
SHALL assert on what the interface actually did rather than on that a request was made. The
flows SHALL cover first launch and language onboarding, search and play, navigation while
playing, adding to the queue, liking a track, playlist creation with add, reorder, and
remove, reload and session restore, the offline application shell and library flow, backup
export and import, provider failure fallback, and mobile navigation.

#### Scenario: A flow regression fails the suite

- **WHEN** a change breaks one of the critical flows
- **THEN** the suite fails, naming the flow and the step that no longer holds, rather than
  passing on a page that merely rendered

#### Scenario: A flow is asserted on observable outcome

- **WHEN** a flow's assertion is evaluated
- **THEN** it checks what the interface shows or what is stored, and not merely that a
  request was issued or that a component mounted

#### Scenario: The suite runs against a production build

- **WHEN** the end-to-end suite runs
- **THEN** the application it drives is a production build served as it would be
  deployed, because a suite that proves behaviour only in development proves something
  different from what ships

#### Scenario: A run does not depend on a third party being available

- **WHEN** the suite runs
- **THEN** provider responses come from recorded fixtures, so the result is reproducible
  and does not change when a third party is rate-limiting, and the suite states that it
  therefore proves the application's behaviour rather than the providers'

#### Scenario: The provider failure path is exercised rather than assumed

- **WHEN** the suite runs
- **THEN** one scenario fails a provider deliberately and asserts the fallback the listener
  sees, because a fallback that is never exercised is a fallback nobody knows works

### Requirement: The suite is maintained, and its assertions can fail

The end-to-end suite SHALL be one maintained entry point rather than a harness rebuilt per
milestone, and SHALL ship with the repository so that a release runs it. Each flow's
assertion SHALL be proven capable of failing before it is trusted, and a verification run
that reached a page through an error boundary SHALL fail rather than pass as a rendered
page.

#### Scenario: One suite, not one per milestone

- **WHEN** the repository's browser-driving code is counted
- **THEN** there is one maintained end-to-end entry point, and the harnesses kept as
  verification records are not treated as runnable suites

#### Scenario: A detector is proven able to fail

- **WHEN** a flow's assertions are proven
- **THEN** the suite is shown failing against a deliberately broken condition, so a flow
  that cannot fail is not mistaken for a flow that passes

#### Scenario: A crashed page is not a passing flow

- **WHEN** a flow reaches a route that renders an error boundary
- **THEN** the flow fails, because a crash that renders *something* is the failure mode a
  naive assertion misses

#### Scenario: Verification records are not code to maintain

- **WHEN** a milestone's archived browser evidence is encountered
- **THEN** it is preserved as the record of that run, and is not consolidated into or
  rewritten by the maintained suite

### Requirement: Automated browser coverage extends to what the tooling can drive

The end-to-end suite SHALL be run against every browser the available tooling can drive,
and the set of browsers it covers SHALL be discoverable from the repository rather than
only from a document. Targets the tooling cannot drive SHALL be named as such, with the
reason.

#### Scenario: A second browser is covered

- **WHEN** a browser that speaks the same automation protocol is available
- **THEN** the suite runs against it as well, so coverage is not limited to one engine
      because only one engine was tried

#### Scenario: An uncoverable target is named with its reason

- **WHEN** a browser or platform cannot be driven by the available tooling
- **THEN** the repository says so and gives the reason, so its absence is a recorded fact
      rather than an omission
