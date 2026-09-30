# Spec Delta

## Purpose

What a multi-hour episode requires of the persistent player: the same playback architecture, and a restore that cannot cue a start past the end of an episode.

## MODIFIED Requirements

### Requirement: Session persistence without autoplay

The playback session (context list, current index, position, repeat mode, shuffle traversal order, played history, and queue source) SHALL be persisted to the local session repository with debounced writes plus a flush when the page is hidden or closed; the added fields are optional in stored/exported snapshots so previously written sessions remain valid. On a cold launch the session SHALL be restored: the current track is cued at the saved position and shown as paused with the position reflected in the controls, and the restored queue, traversal order, history, and source are reapplied when present (falling back to derived defaults for snapshots that predate them). The engine MUST NOT initiate playback without an explicit user action — no sound before a user gesture. A restore whose stored position exceeds the track's currently known duration SHALL cue the track at or inside that duration rather than at a start offset past the end, and the persisted snapshot SHALL NOT be rewritten to hide that correction, so a later restore against a known duration resumes where the listener left off.

#### Scenario: Cold launch restores the track without starting playback

- **WHEN** the app is reloaded (or reopened) with a persisted session containing a current track
- **THEN** that track appears as current, cued at the saved position, the transport shows a play (not pause) affordance, and no audio plays until the user acts

#### Scenario: Playback progress is persisted during use

- **WHEN** playback proceeds (and when the page is hidden or closed)
- **THEN** the current track, index, position, repeat mode, traversal order, played history, and queue source are written to the local session store so a subsequent launch can restore them

#### Scenario: A snapshot without the newer fields restores cleanly

- **WHEN** a session snapshot written before this change (queue/index/position/repeat only) is restored
- **THEN** the queue and current track restore as before, with history, traversal order, and source derived as empty/defaults, and no error occurs

#### Scenario: A multi-hour episode restores at its stored position

- **WHEN** a session is restored for a podcast episode whose duration is hours long and whose stored position is inside that duration
- **THEN** the episode is cued at the stored position, the progress display reflects the full duration, and the transport shows a play affordance rather than starting playback

#### Scenario: A stored position beyond the duration is clamped at load time

- **WHEN** a stored position is greater than the track's currently known duration
- **THEN** the track is cued inside its duration rather than past its end, and the stored snapshot keeps the original position so a later restore against a known duration is unaffected
