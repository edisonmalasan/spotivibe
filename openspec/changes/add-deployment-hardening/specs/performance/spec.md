# Spec Delta

## Purpose

Whether the application stays responsive and stays measurable as a listener's local library grows, and how its Core Web Vitals are observed without collecting anything about the person using it.

## ADDED Requirements

### Requirement: Core Web Vitals are measured without user telemetry

The application SHALL have a measurable definition of its loading performance that can be observed in a real browser without collecting telemetry about a person, and that measurement SHALL be capable of failing a check rather than only reporting a number. The measurement SHALL record the conditions it ran under.

#### Scenario: A measurement exists and is repeatable

- **WHEN** a production build is served and the measurement is run
- **THEN** it reports the largest contentful paint, cumulative layout shift, and a responsiveness measure, together with the machine, the viewport, and whether the load was cold or warm

#### Scenario: A regression fails the check rather than printing a number

- **WHEN** a measured value exceeds the stated target
- **THEN** the run fails, and the failing value and its target are both reported

#### Scenario: No data about the person is collected

- **WHEN** the measurement runs
- **THEN** nothing is transmitted anywhere, and the application contains no analytics, beacon, or remote-reporting call

#### Scenario: The measurement's limits are stated where it is read

- **WHEN** a maintainer reads the measurement
- **THEN** it states that a single-machine run is a regression signal rather than a field lab score, and names the conditions under which its numbers are comparable

### Requirement: Local lists stay bounded

Any list rendered from listener-local data SHALL be bounded, so that the amount of work the interface does grows with what is on screen rather than with everything ever recorded.

#### Scenario: A growing history stays bounded

- **WHEN** a listener has recorded thousands of plays
- **THEN** the history surface renders a bounded number of entries, states the bound to the listener, and the interface remains responsive

#### Scenario: The bound is a named value rather than an incidental slice

- **WHEN** a bound is applied to a local list
- **THEN** it is a named constant with a comment explaining what it protects, and the surface's copy states the bound where the list is truncated

### Requirement: No interval runs while the application is idle

The application SHALL NOT run a repeating timer while nothing is happening. Work that is driven by playback SHALL be driven by playback, and a periodic task SHALL run only while the state it observes is active.

#### Scenario: An idle application schedules nothing

- **WHEN** the application is open with no playback, no search, and no network work
- **THEN** no repeating timer belonging to playback, persistence, or synchronization is scheduled, and no local write occurs as a result of idleness

#### Scenario: Work that playback drives stops with playback

- **WHEN** playback stops
- **THEN** the work it was driving stops, and any final write it owed is completed once rather than continued
