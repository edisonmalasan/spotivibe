# Spec Delta

## Purpose

M6 adapts four playback requirements to the dedicated queue store, history-aware previous, network-aware failure handling, and the extended session snapshot. The other playback requirements (single player instance, duration correction, progress polling, retry/backoff, visible surface, volume/mute, repeat/shuffle traversal, attribution) are unchanged.

## MODIFIED Requirements

### Requirement: Store-backed playback state and control synchronization

Playback state SHALL be held in two coordinated client-side stores with a one-way dependency: transport state — current track, status (idle/loading/buffering/playing/paused/error), position, duration, volume, mute, and error — in the player store, and queue state — context list, current index, traversal order, played history, source label, repeat mode, and shuffle — in the dedicated queue store, with the player store depending on the queue store and never the reverse. Player events are the source of truth for status and position: the stores SHALL follow the player, and UI controls SHALL render from the stores so they always reflect actual player state. User activations of store actions SHALL reach the player. State that outlives the page (track, queue, position, repeat) SHALL be derived from the persisted session on boot.

#### Scenario: Player state changes update the visible controls

- **WHEN** the underlying player transitions between playing, paused, buffering, and ended states
- **THEN** the transport controls and status display update to match (for example the play control shows a pause affordance while playing)

#### Scenario: User control activations drive the player

- **WHEN** the user activates play/pause, seek, or volume controls
- **THEN** the corresponding player operation executes and the controls re-render to reflect the resulting state

#### Scenario: Controls stay synchronized after navigation

- **WHEN** the user navigates between routes while a track is playing
- **THEN** the persistent controls continue to show and manipulate the live player state with no stale or reset values

#### Scenario: The stores stay split and one-directional

- **WHEN** the playback stores are inspected
- **THEN** the player store holds no queue membership/order fields, the queue store imports no player store, and queue-only operations (add/remove/reorder) leave transport state untouched

### Requirement: Track playback lifecycle

Playing a track SHALL load it into the player, optionally accepting the surrounding list of tracks as playback context (adopted by the queue store as the queue with its source label). Play, pause, seek, next, and previous SHALL operate on that context. When a track ends, advancement SHALL follow the repeat mode: `track` replays the current track from the start, `context` continues to the next track (wrapping to the beginning at the end of the list), and `off` advances to the next track or, at the end of the list, settles into a stable stopped state; the finished track is recorded to the queue's played history. Previous SHALL restart the current track when more than a few seconds have elapsed, and otherwise return to the most recently played track that still exists in the queue, falling back to context order (and finally to a restart) when no history entry applies.

#### Scenario: Playing a track starts it in the player

- **WHEN** the user activates a track for playback
- **THEN** that track loads into the single player instance and playback begins, with position and duration tracked in the store

#### Scenario: Ending a track advances per repeat mode

- **WHEN** a track ends with a next track available and repeat mode `off` or `context`
- **THEN** playback continues to the next track in the context list

#### Scenario: Repeat track and end-of-list behavior

- **WHEN** a track ends with repeat mode `track`, or with repeat mode `off` and no next track
- **THEN** repeat `track` replays the same track from the start, while repeat `off` at the list end stops at a stable position without error

#### Scenario: Previous restarts the current track near its start

- **WHEN** previous is activated while more than a few seconds into a track
- **THEN** the player seeks to the start of the current track rather than jumping context

#### Scenario: Previous within the opening returns to the last played track

- **WHEN** previous is activated within the opening seconds of a track and the played history contains a track that still exists in the queue
- **THEN** playback returns to that most recently played track at its start

### Requirement: Unplayable track handling

Fatal player errors — invalid parameter (2), deleted/unavailable video (100), and embedding-restricted videos (101, 150) — SHALL mark the current track as failed and, when a next track exists in the context, advance to it after surfacing the error. When no unfailed track remains, playback SHALL settle into a stable error state. Repeated failures MUST NOT produce an infinite skip or reload loop, and a failed track MUST NOT wedge navigation or controls. While the browser is offline, failures MUST NOT be recorded as track failures and MUST NOT advance the queue: the current track stays unfailed and the queue stays intact for reconnect recovery.

#### Scenario: An unplayable track is marked and skipped

- **WHEN** the player reports error 100/101/150/2 for the current track while the context contains an unfailed next track
- **THEN** the failure is surfaced, the track is marked failed, and playback advances to the next unfailed track

#### Scenario: A fully unplayable context settles without looping

- **WHEN** every track in the context has failed
- **THEN** playback stops in a stable, recoverable error state and controls remain operable (no infinite advance/reload cycle)

#### Scenario: Failures while offline do not consume the queue

- **WHEN** playback fails while the browser reports offline
- **THEN** no track is added to the failed set, no advance occurs, and the queue/current/position remain intact for recovery when connectivity returns

### Requirement: Session persistence without autoplay

The playback session (context list, current index, position, repeat mode, shuffle traversal order, played history, and queue source) SHALL be persisted to the local session repository with debounced writes plus a flush when the page is hidden or closed; the added fields are optional in stored/exported snapshots so previously written sessions remain valid. On a cold launch the session SHALL be restored: the current track is cued at the saved position and shown as paused with the position reflected in the controls, and the restored queue, traversal order, history, and source are reapplied when present (falling back to derived defaults for snapshots that predate them). The engine MUST NOT initiate playback without an explicit user action — no sound before a user gesture.

#### Scenario: Cold launch restores the track without starting playback

- **WHEN** the app is reloaded (or reopened) with a persisted session containing a current track
- **THEN** that track appears as current, cued at the saved position, the transport shows a play (not pause) affordance, and no audio plays until the user acts

#### Scenario: Playback progress is persisted during use

- **WHEN** playback proceeds (and when the page is hidden or closed)
- **THEN** the current track, index, position, repeat mode, traversal order, played history, and queue source are written to the local session store so a subsequent launch can restore them

#### Scenario: A snapshot without the newer fields restores cleanly

- **WHEN** a session snapshot written before this change (queue/index/position/repeat only) is restored
- **THEN** the queue and current track restore as before, with history, traversal order, and source derived as empty/defaults, and no error occurs
