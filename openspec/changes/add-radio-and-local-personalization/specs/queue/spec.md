# Spec Delta

## MODIFIED Requirements

### Requirement: Dedicated queue state model

Queue state SHALL live in a dedicated queue store, separate from the transport store: the ordered context list, the current index, the traversal (play) order, a bounded played-history stack, the queue source/context label, and the shuffle and repeat settings. The transport store SHALL retain only transport concerns (current track, status, position, duration, volume, mute, error, load requests) and MUST NOT hold queue membership; the queue store MUST NOT depend on the transport store. The queue source SHALL be recorded when playback is started from a surface that supplies a context (for example a search result set) and displayed by the queue surface. The recorded source SHALL include a distinct radio value, so a queue kept playing by a radio is presented as such rather than as ordinary browse or search playback, and the queue surface SHALL keep that label correct while a radio continues.

#### Scenario: Queue edits do not disturb transport state

- **WHEN** a queue membership or order operation runs while a track is playing
- **THEN** the transport state (status, position, current track) is unchanged, and the queue store holds the updated membership without either store duplicating the other's fields

#### Scenario: Starting playback from a surface records the queue source

- **WHEN** playback is activated from a context-providing surface (such as a search result list)
- **THEN** the queue adopts that context as its ordered list with the current index pointing at the activated track, and the queue surface shows the recorded source label for that queue

#### Scenario: A radio queue is labelled as a radio

- **WHEN** a radio fills or refills the queue
- **THEN** the queue records and displays the radio source label, and the label remains that while the radio continues and becomes that of the next ordinary context when a radio ends

## ADDED Requirements

### Requirement: Queue growth by refill and autofill

The queue SHALL support being **grown** while it plays: additional tracks SHALL be appended after the current traversal position without disturbing the current track, the play order, the user's existing entries, or the recorded source. Appending SHALL reject any track already in the queue, SHALL be safe to call repeatedly, and SHALL never be triggered by the queue store itself — growth is requested by the radio or autofill engine. The queue's removal, reordering, and repeat semantics SHALL be unchanged by growth.

#### Scenario: Appending keeps playing and keeps user edits

- **WHEN** tracks are appended to a playing queue
- **THEN** the current track keeps playing, the play order, existing entries, and their order are unchanged, and the new tracks appear in the upcoming sequence

#### Scenario: Appending never duplicates

- **WHEN** an appended track is already present in the queue
- **THEN** it is not added again and the existing entry is untouched

#### Scenario: Growth does not change the queue's own rules

- **WHEN** a queue has been grown by refills or autofill
- **THEN** removal, reordering, shuffle, and repeat behave exactly as they do for a queue that was never grown
