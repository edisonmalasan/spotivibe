# Spec Delta

## Purpose

Named mix cards the listener can start, a time-of-day shelf, an artist Quick Picks shelf, and an
`All`/`Music`/`Podcasts` filter over Home's single section model — all derived on the device from the
existing local taste profile.

## ADDED Requirements

### Requirement: The local clock selects a time-of-day band

The system SHALL derive one of four bands — morning, afternoon, evening, late night — from the
current local time, through an injectable clock, and SHALL use that band only to select **seed terms
and query construction**. The band SHALL NOT be persisted, SHALL NOT be transmitted to any service,
and SHALL NOT be combined with any stored listening data to form a profile.

Band selection SHALL be a pure function of the hour, so the same hour always yields the same band.

#### Scenario: Each hour maps to its band

- **WHEN** the local hour is 8, 14, 20, and 2 respectively
- **THEN** the bands are morning, afternoon, evening, and late night

#### Scenario: Band boundaries are half-open and cover every hour

- **WHEN** every hour from 0 to 23 is classified
- **THEN** each yields exactly one band, and no hour yields none

#### Scenario: Band selection is a pure function of the hour

- **WHEN** the same hour is classified twice, at different instants
- **THEN** both classifications agree, with no dependence on elapsed time

#### Scenario: The band influences only seed selection

- **WHEN** a band is selected
- **THEN** the only difference it makes is to the seed terms and the query they construct

#### Scenario: The band is not persisted

- **WHEN** a band has been selected
- **THEN** no band value, and no record of the selection, is written to any store

### Requirement: Mix cards start playback and name honestly

The Home surface SHALL present named mix cards — Top Mix, Discovery Mix, Chill Mix, Night Mix, and
language-aware mixes — each of which starts playback of a mix when activated. Every card SHALL be
composed through the existing single mix generator rather than a card-specific one, and every card
name SHALL satisfy the application's honest-naming rule.

A card SHALL NOT be composed until it is activated, so that rendering Home does not itself start a
mix or issue a provider search per card.

#### Scenario: A card starts playback when activated

- **WHEN** the listener activates a mix card
- **THEN** a mix is composed for that card and begins playing

#### Scenario: Cards use the one generator, not their own

- **WHEN** a card composes its mix
- **THEN** it uses the same mix generator as every other mix surface in the application

#### Scenario: Cards are not composed on render

- **WHEN** Home renders
- **THEN** no mix has been composed and no provider search has been issued for a card

#### Scenario: Every card name is honest

- **WHEN** a card's name is derived
- **THEN** the name passes the application's honest-naming rule, or the neutral fallback name is used

#### Scenario: An empty mix is explained rather than silently inert

- **WHEN** a card cannot compose a mix from the listener's material
- **THEN** activating it explains why, rather than appearing to work

#### Scenario: Language mixes are bounded

- **WHEN** the listener has many selected languages
- **THEN** the number of language mix cards offered is bounded by a documented limit

### Requirement: Quick Picks lead to surfaces that exist

The Home surface SHALL present a Quick Picks shelf derived from the listener's selected languages,
the local listening profile, liked artists and tracks, and existing provider results. Every Quick
Pick SHALL carry a kind and a target that the application can already resolve, and SHALL be rendered
as a control that navigates to that target.

A Quick Pick SHALL NOT be rendered as a non-interactive element, and SHALL NOT carry an empty or
unresolvable target.

#### Scenario: Every Quick Pick navigates somewhere

- **WHEN** a Quick Pick is activated
- **THEN** the application navigates to the surface that target names

#### Scenario: No Quick Pick has an unresolvable target

- **WHEN** the Quick Picks shelf renders
- **THEN** every card carries a non-empty target of a recognised kind

#### Scenario: Quick Picks derive from local material

- **WHEN** Quick Picks are derived
- **THEN** they are derived from the selected languages, the local listening profile, and the
  listener's liked artists and tracks, with no new stored data introduced

### Requirement: A time-aware shelf is offered

The Home surface SHALL offer a shelf appropriate to the current time-of-day band, whose contents are
seeded by that band. The shelf SHALL be labelled with the band so the listener can tell what they are
looking at, and the label SHALL NOT assert a time the clock has not reported.

#### Scenario: The shelf reflects the current band

- **WHEN** Home renders at a given local hour
- **THEN** the time-aware shelf is seeded by the band that hour falls into

#### Scenario: The shelf names its band

- **WHEN** the time-aware shelf is shown
- **THEN** it is labelled with the current band, so the listener can tell why it is showing these
  results
