# Spec Delta

## Purpose

M6 adds the "Add to queue" context action that M5 explicitly deferred to the queue capability. All other search requirements are unchanged.

## MODIFIED Requirements

### Requirement: Result context actions

Each song result SHALL expose a context menu with: play, like/unlike, add to queue, add to local playlist, go to artist, and go to album (where album metadata exists). Like/unlike SHALL persist to the local liked-tracks repository and reflect current state when results render. Add to queue SHALL append the track to the end of the queue per the queue capability's insertion rules (including its duplicate protection) without disturbing current playback. Add to local playlist SHALL let the user pick an existing local playlist or create a new one inline, then append the track. Go to artist and go to album SHALL refine the search to that artist/album name. The menu SHALL be operable by keyboard with a visible focus state and an accessible name per control.

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

- **WHEN** the user activates "go to artist" or "go to album" on a result
- **THEN** the search query becomes that artist/album name and results update accordingly

#### Scenario: Add to queue appends without disturbing playback

- **WHEN** the user activates "Add to queue" on a result while a track is playing
- **THEN** the result track is appended to the end of the queue (once — duplicate protection applies), the menu closes, and the current track, status, and position are unchanged
