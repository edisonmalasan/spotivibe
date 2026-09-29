# Spec Delta

## MODIFIED Requirements

### Requirement: Result context actions

Each song result SHALL expose a context menu with: play, like/unlike, add to queue, add to local playlist, go to artist, go to album (where album metadata exists), and start track radio. Like/unlike SHALL persist to the local liked-tracks repository and reflect current state when results render. Add to queue SHALL append the track to the end of the queue per the queue capability's insertion rules (including its duplicate protection) without disturbing current playback. Add to local playlist SHALL let the user pick an existing local playlist or create a new one inline, then append the track — unless the playlist already contains it, in which case the playlist is unchanged and the picker reports that the track is already there, per the library capability's duplicate rule. Go to artist and go to album SHALL open that artist's or release's own surface from the catalog capability, keyed by the provider identity when the result carries one and by the artist/album name otherwise, and SHALL NOT be limited to refining the search query. Start track radio SHALL start a radio seeded by that result's track, replace the queue with it, and close the menu. The menu SHALL be operable by keyboard with a visible focus state and an accessible name per control.

#### Scenario: Like persists locally

- **WHEN** the user likes a result and then reloads the application
- **THEN** the result's like state is still active, and the track is present in the local liked-tracks dataset

#### Scenario: Add to an existing playlist appends the track

- **WHEN** the user adds a result to an existing local playlist
- **THEN** the track is appended to that playlist's ordered track list and persists across reload

#### Scenario: Inline playlist creation adds the track

- **WHEN** the user chooses to add a result to a new playlist and supplies a name
- **THEN** a local playlist with that name is created and the track is added to it

#### Scenario: Going to artist or album refines the search

<!-- Legacy scenario name, retained verbatim. M9 already disclosed that this name
     predates the behavior: OpenSpec requires a MODIFIED block to carry every
     scenario the main spec still has and matches on names, so the name survives
     while the assertion below describes the catalog page the item now opens. A
     scenario-level rename is not expressible as a delta operation. -->
- **WHEN** the user activates "go to artist" or "go to album" on a result
- **THEN** the corresponding artist or album page opens, keyed by the provider identity when the result carries one and by the artist/album name otherwise

#### Scenario: A result can start a track radio

- **WHEN** the user activates "Start track radio" on a result
- **THEN** a track radio for that result's track starts, the queue is replaced by that radio's tracks, and the menu closes

#### Scenario: Add to queue appends without disturbing playback

- **WHEN** the user activates "Add to queue" on a result while a track is playing
- **THEN** the result track is appended to the end of the queue (once — duplicate protection applies), the menu closes, and the current track, status, and position are unchanged

#### Scenario: Adding a track already in the playlist does not duplicate it

- **WHEN** the user adds a result to a local playlist that already contains that track
- **THEN** the playlist's tracks and order are unchanged, and the picker reports that the track is already in the playlist
