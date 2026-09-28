# queue Specification

## Purpose

The queue: a dedicated, locally persisted model of what is playing, what plays next, and what already played — with safe insertion, removal, and reordering that never corrupt playback pointers, plus the surface where users inspect and edit it.

## Requirements

### Requirement: Dedicated queue state model

Queue state SHALL live in a dedicated queue store, separate from the transport store: the ordered context list, the current index, the traversal (play) order, a bounded played-history stack, the queue source/context label, and the shuffle and repeat settings. The transport store SHALL retain only transport concerns (current track, status, position, duration, volume, mute, error, load requests) and MUST NOT hold queue membership; the queue store MUST NOT depend on the transport store. The queue source SHALL be recorded when playback is started from a surface that supplies a context (for example a search result set) and displayed by the queue surface.

#### Scenario: Queue edits do not disturb transport state

- **WHEN** a queue membership or order operation runs while a track is playing
- **THEN** the transport state (status, position, current track) is unchanged, and the queue store holds the updated membership without either store duplicating the other's fields

#### Scenario: Starting playback from a surface records the queue source

- **WHEN** playback is activated from a context-providing surface (such as a search result list)
- **THEN** the queue adopts that context as its ordered list with the current index pointing at the activated track, and the queue surface shows the recorded source label for that queue

### Requirement: Queue insertion with duplicate protection

A queue insertion action SHALL append the track to the end of the context list without changing the current track, status, or position. Insertion SHALL be rejected when a track with the same identity already exists in the current-and-upcoming portion of the queue; identity means the same track id, or the same provider id from the same source. Tracks that are already behind the current position (played earlier in this context) MUST NOT block re-insertion.

#### Scenario: Enqueueing while playing leaves playback untouched

- **WHEN** the user adds a track to the queue while a track is playing
- **THEN** the track is appended to the end of the context, and the current track, playback status, and position are unchanged

#### Scenario: Duplicate insertion is prevented

- **WHEN** the user adds a track that is already queued at or after the current position (including the currently playing track), including a double activation
- **THEN** no second entry is created — the queue length is unchanged and playback continues undisturbed

#### Scenario: An already-played track can be queued again

- **WHEN** the user adds a track whose only existing occurrence lies behind the current position
- **THEN** the track is appended as a new upcoming entry

### Requirement: Queue removal with pointer integrity

Each queue entry SHALL be removable. Removing an entry ahead of the current position SHALL leave the current track, status, and position untouched; removing an entry behind the current position SHALL adjust the current index so it still points at the same track; removing the current entry SHALL continue playback with the next track in traversal order, or, when no track remains, stop cleanly in an idle state without an error and without autoplaying anything else. Removal MUST NOT corrupt the current/next pointers or the traversal order.

#### Scenario: Removing an upcoming item while playing

- **WHEN** the user removes an entry after the current position while a track is playing
- **THEN** that entry disappears, the current track and playback continue unchanged, and the following entry becomes next in traversal order

#### Scenario: Removing the current item continues with the next track

- **WHEN** the user removes the currently playing entry while other entries remain
- **THEN** playback continues with the next entry in traversal order

#### Scenario: Removing the last entry stops cleanly

- **WHEN** the user removes the only remaining entry
- **THEN** the queue is empty, playback stops in a stable idle state with no error shown, and nothing starts playing on its own

### Requirement: Queue reordering

The upcoming sequence SHALL be reorderable through both a drag-and-drop affordance and keyboard-accessible move controls (move up / move down with accessible names), producing the same resulting order. Reordering SHALL operate on the upcoming sequence as displayed (traversal order) and MUST NOT change the current track, status, or position; the current pointer and traversal order SHALL remain mutually consistent after every move, including while shuffle is on.

#### Scenario: Reordering while playing preserves the current track

- **WHEN** the user moves an upcoming entry to a different position while a track is playing
- **THEN** the displayed order reflects the move, the current track/status/position are unchanged, and the new next entry is the one now following the current position

#### Scenario: Keyboard reordering matches pointer reordering

- **WHEN** the user reorders using the move controls instead of dragging
- **THEN** the resulting queue order is identical to the drag result for the same sequence of moves

### Requirement: Traversal bookkeeping on advance

When playback advances (track ended, repeat wrap, manual next, or a failed-track skip), the queue current index SHALL follow the traversal and the finished track SHALL be recorded onto the played-history stack, which is bounded to a fixed maximum with oldest entries dropped. History SHALL be session bookkeeping only — it never alters the context list or blocks insertion.

#### Scenario: Advancing records history

- **WHEN** a track finishes and playback advances to the next track
- **THEN** the current index points at the new track and the finished track is the newest entry in the played history

#### Scenario: History stays bounded

- **WHEN** playback advances far enough for the history to exceed its maximum size
- **THEN** the oldest entries are dropped and the stack never grows beyond the maximum

### Requirement: Queue surface

The application SHALL provide a queue surface on a dedicated route showing three sections: the now-playing track, the upcoming entries in traversal order, and the recently played history. Rows SHALL show canonical track information (title, artist, duration, artwork) using design tokens; upcoming rows SHALL expose remove and reorder affordances; the surface SHALL show the queue source label and an empty state when nothing is queued. The player-region and Now Playing queue controls SHALL be enabled and navigate to this route, with the player-region control's accessible name reflecting the number of upcoming entries. The surface SHALL be operable by keyboard with visible focus and accessible names on every control, and MUST NOT autoplay anything by itself.

#### Scenario: The queue surface lists the queue in traversal order

- **WHEN** the user opens the queue route with an active queue
- **THEN** the now-playing track, the upcoming entries in their actual traversal order, and the recently played history are shown with the queue's source label

#### Scenario: The queue surface shows an empty state

- **WHEN** the user opens the queue route with no queued tracks
- **THEN** an empty state explaining that nothing is queued is shown instead of blank sections

#### Scenario: The player-region queue control reaches the surface

- **WHEN** the user activates the queue control in the player region (or on Now Playing)
- **THEN** the queue route renders, and the player-region control's accessible name includes the current upcoming count

#### Scenario: Queue actions from the surface update it immediately

- **WHEN** the user removes or reorders an entry from the queue surface
- **THEN** the listed order/membership updates immediately and persists across a reload
