# network Specification

## Purpose

Connectivity awareness: one shared connection state machine (online / degraded where detectable / offline), a persistent status banner that tells the user without destroying anything, and recovery after reconnect that retries safely and never autoplays.

## Requirements

### Requirement: Shared connection state

The application SHALL maintain a single shared connection state — `online`, `degraded`, or `offline` — derived from `navigator.onLine` and the browser's `online`/`offline` events, plus the Network Information API where available: the state is `offline` when the browser reports offline, `degraded` when Network Information reports data-saver or a slow effective connection type, and `online` otherwise. The monitor SHALL be initialized at most once per page session and consumed by shell-level UI and playback recovery; where the Network Information API is absent, only online/offline SHALL ever be reported (no fabricated degradation).

#### Scenario: Connection loss is reflected immediately

- **WHEN** the browser fires an offline event
- **THEN** the shared state becomes `offline` without navigating or reloading

#### Scenario: Degraded is reported only where detectable

- **WHEN** Network Information reports data-saver or a slow effective connection type
- **THEN** the shared state is `degraded`; when the API is absent the state is only ever `online` or `offline`

### Requirement: Connection status banner

The shell SHALL render a connection banner as a persistent, route-independent status region (`role="status"`, polite announcement) whenever the connection state is not `online`: a prominent banner for `offline` and a subdued one for `degraded`. The banner SHALL appear across all routes without navigating, clear when the connection returns to `online`, and MUST NOT obscure or overlay the player when it is **visible** on any route or viewport. Its offline message SHALL name the capabilities that require a connection — search and playback — and SHALL state what remains available, rather than making a vague promise that something may not load; the application MUST NOT claim anywhere that provider-backed playback or search works offline.

The player is normally parked rather than visible (`lyrix-style-hidden-player`), and the
non-obstruction rule is stated against the **visible** state because that is the only state in
which a covering element could exist. A transparent, non-interactive, 1×1 host is skipped by
hit-testing entirely, so the "topmost element at the player centre is the player" check cannot
be applied to it, and asserting it there would be asserting a tautology rather than a guarantee.

#### Scenario: Going offline shows the banner everywhere

- **WHEN** the connection drops while the user is on any route
- **THEN** the offline banner appears without navigation, announced as a status region, and the current view and its state remain intact

#### Scenario: Reconnecting clears the banner

- **WHEN** connectivity returns
- **THEN** the banner disappears without navigation or reload

#### Scenario: The banner never covers the player surface

- **WHEN** the banner is visible, video mode is on, and the topmost element at the center of the
  visible player viewport is inspected
- **THEN** it is the player itself — the banner renders outside the player's area on desktop and
  compact viewports

#### Scenario: The rule is scoped to the visible state, and says why

- **WHEN** the player is parked
- **THEN** no non-obstruction check is applied to the host, because a transparent,
  non-interactive 1×1 element is skipped by hit-testing, and the requirement records that
  rather than asserting an inspection that cannot discriminate

#### Scenario: The offline message names what is unavailable and what is not

- **WHEN** the offline banner is visible
- **THEN** its message states that search and playback need a connection, and states that the listener's own library and history remain available

#### Scenario: Nothing claims offline playback

- **WHEN** any part of the application is inspected
- **THEN** no text claims search or playback works without a connection

### Requirement: Connection loss preserves playback state

When the connection is lost, the current track, playback status, position, queue membership, and traversal order SHALL all be preserved as they were: connection loss MUST NOT clear, skip, reshuffle, or otherwise destroy queue state, and MUST NOT be treated as a track failure.

#### Scenario: An outage preserves the session and queue

- **WHEN** the connection drops during active playback (or while browsing with a queue loaded)
- **THEN** the queue, current track, and position are byte-for-byte unchanged, the status banner appears, and no queue entry is consumed or skipped

### Requirement: Safe recovery on reconnect

When connectivity returns after an outage that interrupted an active user-initiated track (a track was loading, buffering, or in an error state at the time), the application SHALL retry that same track exactly once, resuming from the last known position. Reconnect recovery MUST NOT start playback that was paused before the outage, MUST NOT start playback from the idle state, and MUST NOT loop: if the single retry fails, the normal error handling path applies and controls remain operable. Any browser autoplay block during recovery SHALL leave playback paused rather than repeatedly re-attempting.

#### Scenario: Interrupted playback is retried at position on reconnect

- **WHEN** an outage interrupts a loading/playing track and connectivity returns
- **THEN** the same track is reloaded once at its last known position, without user re-activation, and playback continues (or rests paused if the browser refuses)

#### Scenario: Paused or idle sessions never resume automatically

- **WHEN** connectivity returns while playback was paused (or no track is active)
- **THEN** no load or play is issued — the session stays exactly as it was

#### Scenario: A failed reconnect retry settles instead of looping

- **WHEN** the single reconnect retry also fails
- **THEN** the track enters the normal visible error state with operable controls — no repeated retry cycle
