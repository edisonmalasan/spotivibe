# personalization Specification

## Purpose

The local taste profile and the rule-based ranking built on it: the personalization signal that exists only because the accountless product owns its listening data on the device, and the rules that keep it that way.

## Requirements

### Requirement: Local taste profile

The application SHALL derive a taste profile on the device from data it already owns: liked tracks, listening events including completion and skip behavior, selected languages, and recently played tracks. The profile SHALL be a derivation of those sources rather than a second stored copy, SHALL weight liked artists and fully played tracks above merely played ones and played above skipped, and SHALL be recomputed from the sources rather than cached across a data change. The profile SHALL NOT be uploaded, SHALL NOT be sent to the server in any form, and SHALL exist nowhere outside the device.

#### Scenario: The profile reflects local signals

- **WHEN** the user has liked tracks, played others, skipped some, and selected languages
- **THEN** the derived profile reflects those signals, with liked artists ranked above merely played ones and completed tracks counted more than skipped ones

#### Scenario: A derived profile needs no stored copy

- **WHEN** the profile is read
- **THEN** it is computed from the local datasets, and no new dataset exists that duplicates them

#### Scenario: Nothing is uploaded

- **WHEN** a request is issued on behalf of a radio or autofill
- **THEN** it carries only the seed identity, the played-id list for that request, and pagination-shaped parameters, and no request carries the profile, its weights, or the user's liked/history data

### Requirement: Rule-based candidate scoring

The application SHALL rank candidates with deterministic, local rules: artist affinity, genre or category affinity, language affinity from the selected languages, a recency penalty for recently played tracks, a repeat penalty for any track already played, and the provider's own quality as a floor. Scoring SHALL NOT use randomness, SHALL NOT depend on a remote model, and SHALL NOT compare the user with any other user. The same inputs SHALL always produce the same order.

#### Scenario: Scoring is deterministic

- **WHEN** the same candidates are scored twice with the same profile and clock
- **THEN** the resulting order is identical both times

#### Scenario: Affinity raises a matching candidate

- **WHEN** a candidate is credited to an artist the profile weights highly
- **THEN** it is ranked above an otherwise equal candidate credited to an artist the profile does not weight

#### Scenario: A repeated track is ranked last

- **WHEN** a candidate is already in the radio's played set
- **THEN** it is ranked below every eligible candidate

#### Scenario: No cross-user signal exists

- **WHEN** candidates are scored
- **THEN** the ranking depends only on the local profile, the candidate's own metadata, and the provider quality score, with no other user's data involved

### Requirement: Ephemeral personalization, never a profile on the wire

The application SHALL use the local profile **locally** — to rank candidates the provider has already returned — and SHALL NOT transmit it, or anything derived from it, to the provider. A request needed to fulfill a radio or autofill SHALL carry only the seed identity, the rotation index, the result limit, and the exclusion list; it SHALL carry no taste weights, no liked-track or history data, and no persistent identifier of any kind. The rotation index SHALL be a counter the caller keeps, so the server learns nothing about how often anyone asks. The server SHALL keep no per-caller state and SHALL retain nothing beyond its normal short-lived response cache.

> **Amendment (2026-09-29, during apply).** This requirement previously said the profile derives "ephemeral seed terms" that are sent with the request. The implementation does not do that, and the stricter behavior is the better one: a request carries the identity only, and the profile shapes the *ranking* of what comes back. ROADMAP M10 says the API "**may** receive ephemeral search seed terms needed to fulfill a request, but no server-side profile storage" — a permission, not a duty — and sending nothing derived from the listener is strictly stronger than the permission requires. Sending a listener's derived words to a third party would also be a worse privacy posture than not sending them. The unused `seedTermsFor` helper and its tests were removed rather than left as speculative code.

#### Scenario: Nothing derived from the profile reaches the provider

- **WHEN** a radio or autofill request is issued
- **THEN** its parameters are limited to the seed identity, the rotation index, the limit, and the exclusion list, and no taste weight, liked track, history row, or user identifier is present

#### Scenario: The profile decides locally

- **WHEN** candidates return from the provider
- **THEN** the local profile ranks them, and the same profile produces the same order every time for the same candidates

#### Scenario: No persistent identifier is attached

- **WHEN** any personalization-related request is issued
- **THEN** it carries no user id, device id, account, or session token identifying a person

#### Scenario: The server retains nothing about the caller

- **WHEN** the same identity is requested repeatedly with different rotation indices
- **THEN** each request is answered from the provider tier chain with no per-caller record, and the rotation index is the only thing that varies the answer

#### Scenario: A cold device still works

- **WHEN** no local listening signal exists yet
- **THEN** the request carries the identity alone and still succeeds, because the ranking simply falls back to the provider's own quality score

### Requirement: Clearing local data changes personalization

Clearing the local liked tracks, listening history, or preferences SHALL change the personalization used for later requests, because the profile is derived from exactly those datasets. After a clear, the profile SHALL be rebuilt from what remains, SHALL no longer weigh the cleared signals, and SHALL still produce a usable request. No stale copy of the profile SHALL survive the clear.

#### Scenario: Clearing likes changes later personalization

- **WHEN** the user clears their liked tracks and a refill is requested afterward
- **THEN** the derived profile no longer weights the cleared artists, and the request's seed terms reflect only what remains

#### Scenario: Clearing history changes later personalization

- **WHEN** the user clears their listening history and a refill is requested afterward
- **THEN** recency penalties from the cleared events no longer apply and the derived profile reflects the remaining data

#### Scenario: The app still works with everything cleared

- **WHEN** all local personalization sources are empty
- **THEN** a refill is still requested successfully, following the seed alone
