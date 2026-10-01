# Spec Delta

## MODIFIED Requirements

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
