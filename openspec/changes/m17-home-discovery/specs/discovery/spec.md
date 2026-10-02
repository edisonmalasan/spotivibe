# Spec Delta

## MODIFIED Requirements

### Requirement: Home discovery feed

The Home surface SHALL present discovery shelves derived from the listener's own local data and from
curated, query-driven discovery. Home SHALL remain a single section model: a filter selects which of
those sections are presented, and SHALL NOT introduce a section that the one model does not contain.
An unrecognised filter value SHALL present everything rather than nothing.

Home SHALL present named mix cards that start playback, a Quick Picks shelf whose entries navigate to
surfaces that already exist, and a time-aware shelf seeded by the current local time-of-day band. It
SHALL autoplay nothing on render, and one failing shelf SHALL NOT break the feed.

Home SHALL remain readable and operable at a compact viewport, and its sections SHALL remain a
scrolling region with the persistent player region unmoved.

#### Scenario: Fresh user sees non-personalized discovery

- **WHEN** no local listening data exists
- **THEN** Home presents non-personalized discovery shelves

#### Scenario: Returning user sees local-informed sections

- **WHEN** local listening data exists
- **THEN** Home presents sections informed by that local data

#### Scenario: Geometry rhythm keeps circular contrast unclustered

- **WHEN** Home renders its shelves
- **THEN** circular cards are not clustered adjacently against each other

#### Scenario: One failing shelf does not break the feed

- **WHEN** one shelf fails to resolve
- **THEN** the remaining shelves still render

#### Scenario: Loading shelves show skeleton placeholders

- **WHEN** a shelf is still resolving
- **THEN** it is presented as a skeleton placeholder rather than as an empty shelf

#### Scenario: Home never autoplays

- **WHEN** Home renders
- **THEN** nothing begins playing by itself

#### Scenario: The Smart Mixes section lists the listener's own mixes

- **WHEN** Home renders with mixes on the device
- **THEN** the Smart Mixes section lists those mixes

#### Scenario: No mixes means no mixes section

- **WHEN** no mix exists on the device
- **THEN** the mixes section is omitted rather than presented empty

#### Scenario: The filter presents a subset of the one section model

- **WHEN** a filter is applied
- **THEN** the presented shelves are a selection from the single section list, and no shelf appears
  that the list does not contain

#### Scenario: An unrecognised filter presents everything

- **WHEN** the filter value is not one the surface recognises
- **THEN** every shelf is presented, rather than an empty Home

#### Scenario: Mix cards start playback rather than navigating away

- **WHEN** the listener activates a mix card on Home
- **THEN** a mix starts playing, and the listener stays on Home

#### Scenario: Quick Picks navigate to existing surfaces

- **WHEN** the listener activates a Quick Pick
- **THEN** the application navigates to the artist, album, or search surface that entry names

#### Scenario: The time-aware shelf is seeded by the current band

- **WHEN** Home renders at a given local hour
- **THEN** the time-aware shelf offers material appropriate to that hour's band

#### Scenario: Home stays compact-viewport usable

- **WHEN** Home is presented at a compact viewport width
- **THEN** its sections remain reachable by scrolling and the persistent player region is unmoved

### Requirement: Local-only personalization inputs

Discovery SHALL derive its inputs from the listener's own device, and every discovery request it
issues SHALL carry only bounded, non-identifying values: the selected languages and the seed terms
constructed from them. It SHALL NOT create or transmit a server-side profile, and clearing local
data SHALL change what local-informed shelves offer.

The time-of-day band SHALL be treated the same way as any other local signal: it may select seed
terms and the queries built from them, and SHALL NOT be sent to a service or stored.

#### Scenario: Discovery requests carry only languages and seeds

- **WHEN** a discovery request is issued
- **THEN** it carries only the selected languages and the seed terms, and no identifier

#### Scenario: No server-side profile is created

- **WHEN** discovery has been used
- **THEN** no server-side profile of the listener exists

#### Scenario: Clearing history changes local-informed shelves

- **WHEN** local listening data is cleared
- **THEN** local-informed shelves change accordingly

#### Scenario: The time band is not sent and not stored

- **WHEN** a time-aware shelf issues a request or composes a mix
- **THEN** the request carries no time value, and no band is written to any store
