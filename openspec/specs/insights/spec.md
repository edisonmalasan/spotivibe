# Insights Specification

## Purpose

What the listener can learn about their own listening, computed entirely on the device from the events the app already records: a documented rule for what counts as a play, statistics recomputed from history on demand, day-based streaks, and a history surface that links to the artist and album views.

## Requirements

### Requirement: Play classification

The application SHALL classify each recorded listening event as a completed play, a partial play, or an immediate skip using one documented local rule applied to the recorded measurements — seconds played, the track's duration when known, and the recorded completion/skip markers. A play SHALL count as completed when it is marked completed, when at least half of a known duration was played, or when at least the documented minimum number of seconds was played; it SHALL count as a skip when it is marked skipped or when fewer than the documented skip threshold of a track longer than a minute was played; otherwise it SHALL be partial. Classification SHALL be derived on read from the recorded event rather than stored as a verdict, so the thresholds can change without rewriting history and every surface reports the same verdict for the same event.

#### Scenario: A finished track is a completed play

- **WHEN** an event records that a track with a known duration was played past half its length
- **THEN** the event is classified as a completed play

#### Scenario: A brief touch is an immediate skip

- **WHEN** an event records a few seconds of a track longer than a minute, with no completion
- **THEN** the event is classified as a skip and is excluded from play counts

#### Scenario: A partly heard track is a partial play

- **WHEN** an event records more than the skip threshold but less than the completion rule
- **THEN** the event is classified as a partial play, counted once, and distinguishable from both other verdicts

#### Scenario: An unknown duration falls back to seconds

- **WHEN** an event's track has no known duration
- **THEN** classification uses the seconds-based rules alone, and the event still receives exactly one verdict

#### Scenario: Classification is a read-time policy

- **WHEN** the thresholds change
- **THEN** previously recorded events are re-read with the new rule and no stored verdict has to be rewritten

### Requirement: Local listening statistics

The application SHALL derive listening statistics from the local listening history on demand, and SHALL NOT store an aggregate that could disagree with the history it summarizes. Statistics SHALL include total listening time, the number of non-skipped plays, top tracks, top artists, a breakdown by language and by genre or category where the recorded metadata supports it, and completion and skip counts. Each statistic SHALL be explainable from the events it summarizes, and the derivation SHALL be deterministic for a given set of events. Clearing or deleting local history SHALL change what the statistics report, with no separate invalidation step.

#### Scenario: Statistics are recomputed from the events

- **WHEN** statistics are requested
- **THEN** they are computed from the local history events, and the reported totals reconcile with those same events

#### Scenario: Deleting history changes the statistics

- **WHEN** listening history is deleted and the statistics are read again
- **THEN** the reported totals, top tracks, top artists, and breakdown reflect only the remaining events, with no stale figures left behind

#### Scenario: An empty history reports nothing rather than zeroes

- **WHEN** there is no listening history
- **THEN** the statistics report no listening time, no plays, and no top entries, and each surface explains that there is nothing to show yet

#### Scenario: Metadata that is absent is omitted, not invented

- **WHEN** recorded events carry no language or category for a track
- **THEN** that track is left out of the language and category breakdown instead of being assigned a made-up value

#### Scenario: The same history always reports the same numbers

- **WHEN** statistics are computed twice from the same events
- **THEN** both computations agree, including the ordering of the top tracks and top artists

### Requirement: Listening streaks

The application SHALL derive listening streaks from the local history: a day counts as a listening day when it contains at least one non-skipped play, a streak is a run of consecutive listening days, and the statistics SHALL report both the current streak and the longest streak. Day boundaries SHALL use the listener's local time, the current streak SHALL remain intact until a whole day passes without a play, and the derivation SHALL be a pure function of the events and a supplied instant so any boundary can be evaluated.

#### Scenario: Consecutive listening days build a streak

- **WHEN** the listener played on three consecutive days
- **THEN** the current streak is three days

#### Scenario: A streak survives the day not being over

- **WHEN** the listener's last play was yesterday and today is not over
- **THEN** the current streak is still reported as running

#### Scenario: A missed day ends the current streak

- **WHEN** the listener's last play was two or more days ago
- **THEN** the current streak is zero, and the longest streak is still reported

#### Scenario: Skipped plays do not count as a listening day

- **WHEN** a day's only events are skips
- **THEN** that day does not extend a streak

#### Scenario: The rule is evaluable at any boundary

- **WHEN** the derivation is given a supplied instant
- **THEN** the reported streaks depend only on the events and that instant, with no system clock of its own

### Requirement: History surface

The application SHALL provide a History route listing the local listening events most recent first, grouped by the listener's local day, with each entry showing the track, its artists, when it was played, and how it ended. Each entry's artist and album SHALL be activatable and SHALL open that entity's own surface. The surface SHALL render an explanatory empty state when there is no history, SHALL offer a way to clear the history, and SHALL NOT claim that its contents are complete, ranked, or shared with anyone — it is a local record only.

#### Scenario: History lists recent events by day

- **WHEN** the History route is opened with local events present
- **THEN** the events are listed most recent first, grouped by local day, each showing the track, artists, time, and how the play ended

#### Scenario: History entries navigate to the entity

- **WHEN** an entry's artist or album is activated
- **THEN** that artist or album's own surface opens for it

#### Scenario: An empty history explains itself

- **WHEN** the History route is opened with no local events
- **THEN** an explanatory empty state is shown instead of an empty list

#### Scenario: History can be cleared from the surface

- **WHEN** the user clears the history from the History route
- **THEN** the events are removed, the surface returns to its empty state, and the statistics and streaks report the cleared state

#### Scenario: The record is local and unranked

- **WHEN** the History surface is read
- **THEN** it presents the local record only, with no ranking, totals, or sharing claim that implies more than this device knows
