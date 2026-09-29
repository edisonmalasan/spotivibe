# Mixes Specification

## Purpose

Smart Mixes: a named, locally generated set of tracks built from the listener's own local taste, reproducible with no server-side identity, and composed from the provider feed the product already has.

## Requirements

### Requirement: Smart Mix generation

The application SHALL generate Smart Mixes from the local taste profile and the provider's existing mix feed, and SHALL NOT require a server-side user identity. A generated mix SHALL contain at least the documented target number of tracks where the provider returns enough distinct material, SHALL contain no duplicate track, SHALL exclude tracks this device has already played within the documented recency window, and SHALL compose its tracks across the languages the listener selected where the feed supports it. Generation SHALL be bounded in the provider work it may spend, and a mix that the provider cannot fill to the target SHALL be shorter rather than padded with unrelated material. A mix SHALL be generated only when the local profile holds actual taste signal; with no signal the application SHALL say so instead of presenting a feed-derived set as the listener's own.

#### Scenario: A mix is generated from the local profile

- **WHEN** the local profile holds taste signal and a mix is generated
- **THEN** the mix's tracks are resolved from the existing mix feed using the profile's own signals, with no request carrying a user identity or a stored profile

#### Scenario: A mix reaches its target size where the feed supports it

- **WHEN** the feed returns enough distinct material across the generation rounds
- **THEN** the mix contains at least the documented target number of tracks

#### Scenario: A mix contains no duplicate and no recently played track

- **WHEN** a mix is generated
- **THEN** no track appears twice in it, and no track played on this device within the documented recency window is included

#### Scenario: A mix follows the selected languages

- **WHEN** the listener has selected several languages
- **THEN** the mix's tracks span those languages as far as the feed provides them, rather than being drawn from one language by accident

#### Scenario: A short mix is not padded

- **WHEN** the feed cannot supply distinct new tracks up to the target
- **THEN** the mix is shorter than the target and claims nothing about its size

#### Scenario: Generation is bounded

- **WHEN** a mix is generated
- **THEN** the number of provider requests it may issue is bounded and documented, and it stops rather than retrying indefinitely

#### Scenario: No signal, no mix

- **WHEN** the local profile holds no taste signal
- **THEN** no mix is generated and the surface explains that mixes appear after some listening

### Requirement: Mix identity and naming

A generated mix SHALL have a stable identity and a name, both persistent across reloads and across the period it was generated in, so the listener can recognize and re-enter it. The name SHALL be derived from the mix's strongest local signal — its top artist where one is present, otherwise its leading genre, otherwise a neutral local label — and SHALL NOT claim a ranking, an editorial selection, or any status beyond what this device derived. The period in which a mix was generated SHALL be recorded with it.

#### Scenario: A mix keeps its identity and name

- **WHEN** a mix is revisited after a reload
- **THEN** it has the same identity, the same name, and the same tracks

#### Scenario: The name comes from the strongest local signal

- **WHEN** a mix is generated
- **THEN** its name names the artist it contains most, or its leading genre when no artist dominates, and carries no chart or editorial claim

#### Scenario: The generation period is recorded

- **WHEN** a mix is generated
- **THEN** the mix records the period it was generated in, and a later regeneration within that period is a refresh rather than a new identity

### Requirement: Mix refresh

A mix SHALL be refreshable: refreshing re-derives its contents from the current local profile and the feed, keeps the mix's identity and name, adds no duplicate, and respects the same played-track exclusion. A refresh SHALL be an explicit user action or the result of the mix's own staleness rule, SHALL NOT silently discard a mix the user can still open, and SHALL be bounded like initial generation.

#### Scenario: Refreshing keeps the identity

- **WHEN** a mix is refreshed
- **THEN** it keeps its identity and name, and its tracks are re-derived with no duplicate and no recently played track

#### Scenario: A refresh is bounded and non-looping

- **WHEN** a refresh cannot obtain new material
- **THEN** it stops, leaves the mix openable, and does not retry indefinitely

#### Scenario: Refreshing is not silent

- **WHEN** a mix is refreshed
- **THEN** the listener either asked for it or can see that the mix was refreshed, and the existing mix is never replaced without trace

### Requirement: Mixes stay local

Mixes, their names, their seeds, and the profile signals they were built from SHALL remain on the device. Requesting mix content SHALL carry only what a feed request needs to fulfill it, SHALL NOT carry a stored profile, liked-track data, or listening history, and SHALL NOT be joined to a persistent identifier. Clearing local history or preferences SHALL change what mixes can be generated and how they are ranked, with no server-side residue.

#### Scenario: No mix data is uploaded

- **WHEN** mix content is requested
- **THEN** the request carries only the documented feed parameters, with no taste weights, liked tracks, history rows, or user identifier

#### Scenario: A mix is reproducible from local data alone

- **WHEN** the same local profile and feed responses are presented again
- **THEN** the same mix is derivable, without consulting any server-held state about the listener

#### Scenario: Clearing local data changes future mixes

- **WHEN** local history or preferences are cleared
- **THEN** subsequently generated mixes are built from what remains, and no previous mix's identity is claimed to come from data that is gone
