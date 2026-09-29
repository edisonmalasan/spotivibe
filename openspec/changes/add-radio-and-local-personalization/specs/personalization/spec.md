# Spec Delta

## Purpose

The local taste profile and the rule-based ranking built on it: the personalization signal that exists only because the accountless product owns its listening data on the device, and the rules that keep it that way.

## ADDED Requirements

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

### Requirement: Ephemeral seed terms

The application SHALL use the local profile to derive a small set of ephemeral seed terms, and SHALL send only those terms with a request needed to fulfill it. Seed terms SHALL be derived per request, SHALL NOT be stored server-side, SHALL NOT be joined to a persistent identifier, and SHALL be discarded after the request. The server SHALL keep no record of what it was asked for beyond its normal short-lived response cache.

#### Scenario: Seeds are derived locally and sent ephemerally

- **WHEN** a refill is requested with a local profile present
- **THEN** the request's seed terms are derived from that profile, and nothing derived from the profile is retained after the response

#### Scenario: No persistent identifier is attached

- **WHEN** any personalization-related request is issued
- **THEN** it carries no user id, device id, account, or session token identifying a person

#### Scenario: A cold device still works

- **WHEN** no local listening signal exists yet
- **THEN** the seed terms fall back to the request's own identity, and the request still succeeds

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
