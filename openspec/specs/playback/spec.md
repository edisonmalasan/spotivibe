# playback Specification

## Purpose

Client-side playback: one persistent YouTube IFrame player hosted outside route content, store-backed playback state with synchronized custom controls, a visible policy-compliant video surface, resilient error handling with retry/backoff and safe skipping, and local session restore that never autoplays.

## Requirements

### Requirement: Single persistent player instance

The YouTube IFrame Player API SHALL be loaded at most once per page session regardless of how often the player host mounts, and exactly one underlying YouTube player instance SHALL exist, hosted in the application shell outside route-specific page content. Navigating between routes MUST NOT recreate, restart, reload, or otherwise interrupt the player; control surfaces and the video surface persist across navigation.

#### Scenario: The player API loads exactly once

- **WHEN** the player host mounts repeatedly (including development double-mounts) and the user navigates across routes
- **THEN** at most one IFrame API script tag is ever injected and exactly one player instance is created for the page session

#### Scenario: Route navigation does not restart playback

- **WHEN** a track is playing and the user navigates Home → Search → Library (and the Now Playing route)
- **THEN** the same player element remains mounted and connected, and playback continues without restarting or reloading the video

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

### Requirement: Authoritative duration correction

While a track plays, the player's reported duration SHALL be treated as authoritative when it differs from the normalized metadata duration: the store's duration, progress display, and seek range SHALL adopt the player-reported value.

#### Scenario: Player duration overrides metadata duration

- **WHEN** the player reports a duration that differs from the track's stored duration
- **THEN** the progress display and seek range adopt the player-reported duration for that track

### Requirement: Efficient progress polling

Position (and duration until first learned) SHALL be polled from the player only while a track is active and the player is playing or buffering. Polling SHALL stop when no track is active and when playback is paused (position SHALL still be captured at the moment of pausing). Timers MUST NOT accumulate across mounts or track changes.

#### Scenario: No active track means no polling

- **WHEN** the app is idle with no current track, or after a paused track's position has been captured
- **THEN** no position-polling timers are running

#### Scenario: Polling resumes while playing

- **WHEN** playback is active
- **THEN** the progress display advances approximately once per second without duplicating timers across track changes

### Requirement: Controlled retry and backoff

Transient player errors SHALL be retried with exponential backoff up to a bounded attempt count with a capped delay, and SHALL NOT retry indefinitely. On retry exhaustion the track SHALL enter the error state and the engine SHALL advance or settle without wedging the application.

#### Scenario: A transient error is retried with growing delays

- **WHEN** the player reports a transient (non-fatal) error during playback
- **THEN** the track is reloaded after an exponentially increasing delay within the capped maximum, and a successful reload clears the retry budget

#### Scenario: Retry exhaustion settles instead of looping

- **WHEN** transient retries are exhausted
- **THEN** the track enters a visible error state and the engine advances or stops — never an unbounded retry loop

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

### Requirement: Visible compliant playback surface

Whenever a track is active, the YouTube player SHALL be presented as a visible video surface with a viewport of at least 200×200 CSS pixels in both shell variants and on every route, positioned so no overlay, frame, or custom control is rendered in front of or obscures any part of it. The surface MUST NOT be hidden, minimized below the minimum, or detached from the visible layout while playing — a permanently hidden or undersized iframe is non-compliant.

#### Scenario: The active surface meets the minimum size everywhere

- **WHEN** a track is active at desktop and compact viewports, on any route
- **THEN** the player's viewport measures at least 200px × 200px (16:9 layouts sized ≥480×270 where space allows) and is within the visible layout

#### Scenario: Nothing renders in front of the surface

- **WHEN** the topmost element at the center of the active player viewport is inspected
- **THEN** it is the player itself — no Spotivibe overlay or control stacks above it

### Requirement: Volume and mute

Volume (0–100) and mute SHALL be controllable from the persistent player surfaces, applied to the underlying player, and reflected in the controls. The chosen volume/mute values SHALL persist across reloads as a small local boot preference.

#### Scenario: Volume and mute drive the player and survive reload

- **WHEN** the user changes volume or toggles mute, then reloads the app
- **THEN** the player receives the new values, the controls show them, and the restored values are reapplied on boot

### Requirement: Repeat selection and shuffle traversal

The repeat control SHALL cycle through `off` → `context` → `track` and back, displaying the active mode; the repeat mode SHALL persist with the session. The shuffle control SHALL toggle shuffled traversal: while on, next/previous follow a shuffled order of the context list; while off, traversal returns to list order from the current track.

#### Scenario: Repeat control cycles and displays the mode

- **WHEN** the user activates the repeat control repeatedly
- **THEN** the mode cycles off → context → track → off with the active mode visible in the control

#### Scenario: Shuffle changes traversal order

- **WHEN** shuffle is on and the user advances tracks
- **THEN** next/previous traverse a shuffled order of the context rather than strict list order, and switching shuffle off resumes list order at the current track

### Requirement: YouTube attribution and playback compliance

The player SHALL use only documented player parameters and leave YouTube's in-player branding unmodified, SHALL provide visible attribution for the active track (a "Watch on YouTube" link opening the video), and SHALL NOT suppress the page referrer. The engine MUST NOT extract, download, capture, or proxy audio/video, block or alter ads, or force playback that YouTube or the browser has paused (no background-play circumvention): external pauses are honored as final state until the user acts again.

#### Scenario: Attribution is present for the active track

- **WHEN** a track is active
- **THEN** a "Watch on YouTube" link is visible and opens that video's watch page in a new tab

#### Scenario: An externally imposed pause is honored

- **WHEN** YouTube or the browser pauses playback outside app control (for example leaving autoplay scope)
- **THEN** the store reflects paused state and the engine does not automatically resume

#### Scenario: No extraction or hidden-playback paths exist

- **WHEN** the playback code is statically inspected
- **THEN** all media flows route through the YouTube IFrame player — no audio capture/decoding pipelines, no hidden undersized player, and no referrer-suppressing configuration
