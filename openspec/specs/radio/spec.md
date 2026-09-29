# radio Specification

## Purpose

Continuous listening without a profile server: radio modes that keep playing across refill cycles, dedupe that remembers what this session already played, queue autofill for ordinary playback, and the local taste profile that steers all of it — computed on the device, uploaded nowhere.

## Requirements

### Requirement: Radio modes

The application SHALL offer two radio modes, `track` and `artist`, each started from a user action and each playable through the same persistent player, mini-player, Now Playing surface, and queue view as any other playback. A radio SHALL be reflected as a distinct playback source, SHALL record its listening context, and SHALL stop cleanly when the user leaves it, so a radio is a mode of the one queue rather than a second player. Starting a radio SHALL replace the current queue with that radio's tracks, SHALL NOT autoplay a second stream, and SHALL be cancelable.

#### Scenario: Starting a track radio replaces the queue and plays

- **WHEN** the user starts a track radio from a track
- **THEN** the queue is filled with that radio's tracks, playback begins from its first track, the source is presented as a radio, and the listening context is the radio context

#### Scenario: Starting an artist radio seeds from that artist

- **WHEN** the user starts an artist radio from an artist
- **THEN** the queue is filled with tracks resolved for that artist, playback begins, and the source is presented as a radio

#### Scenario: A radio uses the one player state

- **WHEN** track, play/pause, position, or like state changes anywhere while a radio is playing
- **THEN** the Now Playing surface, the player region, and the queue view all reflect the same values without a reload

#### Scenario: Leaving a radio restores ordinary playback

- **WHEN** the user starts ordinary playback, opens a playlist, or navigates away from the radio
- **THEN** the radio ends, is no longer refilled, and the ordinary source is presented

### Requirement: Radio refill

A radio SHALL continue across multiple refill cycles: when the number of unplayed upcoming tracks falls to a defined low-water mark and no refill is in flight, the application SHALL request more tracks for that radio and append them without interrupting current playback. Each refill SHALL ask for material that differs from earlier cycles, SHALL exclude the tracks this radio has already played, and SHALL never append a duplicate of a track already in the queue. A refill that fails SHALL surface a non-blocking retry affordance on the queue, SHALL NOT discard or reorder the existing queue, and SHALL NOT start a retry loop. A radio whose provider returns nothing usable SHALL end gracefully.

#### Scenario: A radio refills before the queue runs out

- **WHEN** a radio's unplayed upcoming tracks fall to the low-water mark
- **THEN** more tracks are requested and appended while the current track keeps playing, and the radio continues afterward

#### Scenario: A radio survives multiple refill cycles

- **WHEN** a radio is played through more than one refill cycle
- **THEN** playback continues across the cycles with distinct tracks, and the queue never empties unexpectedly while the provider keeps answering

#### Scenario: A played track is never served again

- **WHEN** a refill is requested after tracks from the radio have played
- **THEN** the response excludes the radio's played tracks, and the client additionally refuses to append any played id even if it were returned

#### Scenario: A refill never duplicates a queued track

- **WHEN** a refill's candidates include a track already in the queue
- **THEN** that track is not appended a second time, and the existing queue entry is left untouched

#### Scenario: A failed refill is survivable

- **WHEN** a refill request fails or the provider returns nothing usable
- **THEN** the existing queue keeps playing, a non-blocking retry affordance is offered, no retry loop starts, and a radio with no material left ends gracefully

### Requirement: Played-track dedupe

The application SHALL maintain the set of tracks a radio has played for the duration of that radio and SHALL use it to exclude those tracks from later refills. It SHALL additionally apply a recency penalty so a track is not repeated soon after it was played, and the penalty SHALL be weaker for tracks the user completed than for tracks the user skipped. Dedupe SHALL apply to radio refills; ordinary playback SHALL remain governed by the queue capability's own duplicate protection.

#### Scenario: The played set is remembered for the radio's life

- **WHEN** a radio plays several tracks and later refills
- **THEN** every track already played in that radio is excluded from the refill

#### Scenario: A recently played track is ranked down

- **WHEN** candidates for a refill include a track played within the recency window
- **THEN** that track is ranked below an otherwise equal candidate that was not played recently

#### Scenario: A completed track is penalized less than a skipped one

- **WHEN** two candidates were both played recently, one completed and one skipped
- **THEN** the completed one is ranked at least as high as the skipped one

### Requirement: Queue autofill

When the autofill setting is enabled and a queue playing under ordinary playback runs low, the application SHALL append further tracks derived from the current track and the local taste profile, keeping the queue playing past its original end. Autofill SHALL be latched so that at most one request is in flight and a failure does not start a loop, SHALL respect the same played/queued duplicate rules as a refill, and SHALL stop when the setting is disabled, when the radio takes over, or when the user leaves the surface. Autofill SHALL never reorder or remove the user's existing queue entries.

#### Scenario: Autofill keeps an ordinary queue playing

- **WHEN** an ordinary queue runs low and autofill is enabled
- **THEN** additional tracks are appended before the queue ends, and playback continues without the user acting

#### Scenario: Autofill is off when disabled

- **WHEN** the autofill setting is disabled and a queue runs low
- **THEN** nothing is appended and the queue plays to its end

#### Scenario: One autofill request at a time

- **WHEN** autofill triggers while a previous request is still in flight
- **THEN** no second request is issued, and the queue is appended at most once per low-water mark

#### Scenario: Autofill never disturbs the user's queue

- **WHEN** autofill appends tracks
- **THEN** the existing entries, their order, and the current track are unchanged

#### Scenario: A radio takes over from autofill

- **WHEN** a radio starts while autofill is enabled
- **THEN** autofill stops and only the radio's own refills continue

### Requirement: Radio entry points

Track radio SHALL be startable from a search result and from the Now Playing surface, and artist radio SHALL be startable from an artist page. Every entry point SHALL be operable by keyboard with an accessible name, SHALL start exactly one radio, and SHALL NOT be presented on a surface where the required identity is unknown.

#### Scenario: A search result can start a track radio

- **WHEN** the user activates "Start track radio" on a search result
- **THEN** a track radio for that track starts and the result menu closes

#### Scenario: Now Playing can start a radio

- **WHEN** the user activates the radio action on Now Playing
- **THEN** a track radio for the current track starts

#### Scenario: An artist page starts an artist radio

- **WHEN** the user activates "Start artist radio" on an artist page
- **THEN** an artist radio for that artist starts in radio mode

#### Scenario: No entry point without an identity

- **WHEN** a surface has no current track to seed a radio from
- **THEN** the radio action is not offered rather than offered without a seed
