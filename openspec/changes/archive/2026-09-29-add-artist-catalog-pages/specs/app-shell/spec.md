# Spec Delta

## MODIFIED Requirements

### Requirement: Now Playing surface

The shell SHALL provide an expanded Now Playing surface as a dedicated route, reachable from the player region, rendered full-screen/expanded on compact viewports and presented as an expanded view on desktop. The surface SHALL present the current track's artwork, title and artists, like state, progress and seek, the full transport and volume controls, and access to the queue, all bound to the same store and player state the player region uses, so that any change made anywhere is reflected in both without a reload. It SHALL render the current artwork as a background behind the content when artwork exists and the plain surface when it does not, SHALL present an over-long title so it stays readable — animating only when the title overflows, and never animating when the user prefers reduced motion — and SHALL offer a More Like This shelf for the current track that never starts playback on its own. A visible, compliant YouTube playback surface and its attribution SHALL remain part of the design, and the surface SHALL NOT autoplay anything by itself.

#### Scenario: Opening Now Playing from the player region

- **WHEN** the user activates the Now Playing affordance in the player region
- **THEN** the Now Playing route renders an expanded view containing the current track's artwork, title and artists, like state, progress, transport, volume, and queue access, styled with design-system primitives

#### Scenario: The surface reflects the shared player state

- **WHEN** the track, play/pause state, position, or like state changes anywhere in the app
- **THEN** the Now Playing surface and the player region show the same values without a reload

#### Scenario: Artwork drives the background

- **WHEN** the current track has artwork
- **THEN** the surface renders an artwork-derived background behind the content, and a track without artwork leaves the plain surface with no empty image box

#### Scenario: Long titles stay readable

- **WHEN** the current title is wider than the title area
- **THEN** the title is presented so it remains readable rather than clipped, and when the user prefers reduced motion the presentation is static with the full title still available

#### Scenario: More Like This is offered without autoplaying

- **WHEN** the surface renders for a track
- **THEN** a More Like This shelf for that track is available, it never includes the current track, and loading it starts no playback
