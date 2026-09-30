# Spec Delta

## Purpose

The connection banner's offline message names the capabilities that are actually unavailable while offline, so a listener knows what still works instead of being told that "some things" may not load.

## MODIFIED Requirements

### Requirement: Connection status banner

The shell SHALL render a connection banner as a persistent, route-independent status region (`role="status"`, polite announcement) whenever the connection state is not `online`: a prominent banner for `offline` and a subdued one for `degraded`. The banner SHALL appear across all routes without navigating, clear when the connection returns to `online`, and MUST NOT obscure or overlay the active player surface on any route or viewport. Its offline message SHALL name the capabilities that require a connection — search and playback — and SHALL state what remains available, rather than making a vague promise that something may not load; the application MUST NOT claim anywhere that provider-backed playback or search works offline.

#### Scenario: Going offline shows the banner everywhere

- **WHEN** the connection drops while the user is on any route
- **THEN** the offline banner appears without navigation, announced as a status region, and the current view and its state remain intact

#### Scenario: Reconnecting clears the banner

- **WHEN** connectivity returns
- **THEN** the banner disappears without navigation or reload

#### Scenario: The banner never covers the player surface

- **WHEN** the banner is visible and the topmost element at the center of the active player viewport is inspected
- **THEN** it is the player itself — the banner renders outside the player's area on desktop and compact viewports

#### Scenario: The offline message names what is unavailable and what is not

- **WHEN** the offline banner is visible
- **THEN** its message states that search and playback need a connection, and states that the listener's own library and history remain available

#### Scenario: Nothing claims offline playback

- **WHEN** the shipped application's user-facing copy is inspected
- **THEN** no surface or message claims that playback or search of provider content works without a connection
