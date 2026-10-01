# Spec Delta

## Purpose

Timed lyrics for the currently playing track: an LRC parser, a provider that resolves which lyrics
fit a track, and a Now Playing panel that highlights and follows the active line.

## ADDED Requirements

### Requirement: Timed lyrics are parsed into ordered lines

The system SHALL parse LRC-formatted lyrics into a time-ordered list of non-empty lyric lines,
handling `[mm:ss]`, `[mm:ss.xx]`, and `[mm:ss.xxx]` timestamps, ignoring untimed metadata tags
(`[ar:]`, `[ti:]`, `[al:]`, `[length:]` and similar), and ordering lines by ascending time
regardless of their order in the source. A line with a valid timestamp and no text SHALL be
dropped rather than rendered as an empty highlighted row.

#### Scenario: Timestamps in all three precisions become correct times

- **WHEN** lyrics contain `[00:12]`, `[01:02.50]`, and `[02:03.250]` lines
- **THEN** the parsed times are 12, 62.5, and 123.25 seconds respectively

#### Scenario: Metadata tags and unparsable lines are ignored

- **WHEN** lyrics contain `[ar:Some Artist]`, `[length:03:21]`, and a line with no timestamp
- **THEN** none of them appears in the parsed lines, and the valid lines are unaffected

#### Scenario: Out-of-order lines are sorted by time

- **WHEN** the source lists a line at 00:30 before a line at 00:10
- **THEN** the parsed list has the 00:10 line first

#### Scenario: An empty timed line is dropped

- **WHEN** a line has a valid timestamp and only whitespace after it
- **THEN** it is absent from the parsed lines, so no blank row is ever highlighted

#### Scenario: Lyrics with no usable timestamp yield no timed lines

- **WHEN** the input contains no parseable timestamped line
- **THEN** the parser reports zero timed lines rather than one line at time zero

### Requirement: The active line is selected from playback position

The active line SHALL be a pure function of the timed lines and the current playback position: the
last line whose time is less than or equal to the position, or no active line when the position
precedes the first line. Selection SHALL be independent of line count and SHALL behave correctly at
every boundary, including a position exactly on a timestamp, between timestamps, and beyond the
last line.

#### Scenario: A position exactly on a timestamp activates that line

- **WHEN** lines start at 10s and 20s, and the position is exactly 20
- **THEN** the line at 20s is active

#### Scenario: A position between timestamps keeps the earlier line active

- **WHEN** lines start at 10s and 20s, and the position is 19.9
- **THEN** the line at 10s is active

#### Scenario: A position before the first line has no active line

- **WHEN** the first line starts at 10s and the position is 3
- **THEN** no line is active

#### Scenario: A position beyond the last line keeps the last line active

- **WHEN** the last line starts at 60s and the position is 600
- **THEN** the line at 60s is active

#### Scenario: Selection is a pure function of its inputs

- **WHEN** the same lines and the same position are supplied twice
- **THEN** the same line is active both times, with no dependence on previous calls or on elapsed
  time

### Requirement: Lyrics are resolved for the active track

The system SHALL resolve lyrics for the currently playing track using its cleaned title, artist, and
duration, preferring a timed result over an untimed one and, among equally timed candidates,
preferring the closest duration. The lookup SHALL use one bounded, timed-out request, SHALL be
de-duplicated so concurrent requests for the same track reach the provider once, and SHALL cache
both results and "no lyrics found" — the miss with a shorter lifetime than the hit, so a track
without lyrics is retried sooner than a track with lyrics is distrusted.

A resolved result SHALL be returned to the client as the provider's raw timed and untimed strings,
so that parsing is the client's concern and the two are testable independently.

#### Scenario: Timed lyrics beat untimed lyrics

- **WHEN** the provider returns one candidate with timed lyrics and one without
- **THEN** the timed candidate is the one resolved

#### Scenario: Among timed candidates the closest duration wins

- **WHEN** two candidates both have timed lyrics and their durations differ from the track's
- **THEN** the candidate whose duration is closer to the track's is resolved

#### Scenario: A track with no lyrics is reported as unavailable, not as an error

- **WHEN** the provider returns no usable candidate
- **THEN** the result is "no lyrics for this track", which is distinct from a provider failure

#### Scenario: A miss is retried sooner than a hit is distrusted

- **WHEN** a miss and a hit are both cached
- **THEN** the miss expires sooner than the hit

#### Scenario: Concurrent requests for one track reach the provider once

- **WHEN** several requests for the same track are in flight at once
- **THEN** the provider is queried once and every caller receives the same result

#### Scenario: A provider failure does not become a cached miss

- **WHEN** the provider request fails or times out
- **THEN** the result is an error, and no "no lyrics" entry is cached, so the next attempt retries

#### Scenario: The lookup is bounded

- **WHEN** the provider does not respond
- **THEN** the lookup fails within its timeout rather than holding the request open

### Requirement: The lyrics panel shows the active line and follows playback

The Now Playing surface SHALL present lyrics for the current track when they are available. When
timed lyrics are present, the active line SHALL be marked as current, and the panel SHALL scroll so
the active line stays in view. Automatic scrolling SHALL be suspended when the listener scrolls the
panel themselves, and SHALL resume when they return to the live position, so reading ahead is not
overridden by playback.

The panel SHALL render timed lyrics when the provider supplies them and untimed lyrics when it does
not, and SHALL present four distinguishable states: no track, loading, no lyrics available for this
track, and a failure to reach the provider. Under a reduced-motion preference the panel SHALL NOT
animate the line change and SHALL NOT use smooth scrolling.

#### Scenario: The active line is marked and kept in view

- **WHEN** timed lyrics are shown and playback position advances into a later line
- **THEN** that line is marked as the current one and the panel scrolls it into view

#### Scenario: A manual scroll suspends following

- **WHEN** the listener scrolls the lyrics panel
- **THEN** automatic following stops, and it does not resume until the listener returns to the live
  position

#### Scenario: Untimed lyrics are shown when no timed lyrics exist

- **WHEN** the provider returns untimed lyrics only
- **THEN** the panel shows that text with no active-line marking and no position following

#### Scenario: Unavailable and failure are different messages

- **WHEN** the provider reports no lyrics, and separately when the provider cannot be reached
- **THEN** the panel shows two distinguishable messages, not one

#### Scenario: Reduced motion removes the animation and the smooth scroll

- **WHEN** the user prefers reduced motion
- **THEN** the line change is not animated and the panel does not use smooth scrolling

#### Scenario: A track change resets the panel completely

- **WHEN** the current track changes
- **THEN** the previous track's lyrics, active line, and scroll position are discarded, and nothing
  from the previous track remains visible

#### Scenario: The active line is not announced as a live region

- **WHEN** the active line changes during playback
- **THEN** the change is conveyed by the line's own current state rather than by a live region
  firing on every position update
