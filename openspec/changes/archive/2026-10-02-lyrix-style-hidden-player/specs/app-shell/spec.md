# Spec Delta

## MODIFIED Requirements

### Requirement: Persistent player region

The shell SHALL reserve and render a player region on every route, in both shell variants (bottom
player bar on desktop, mini-player slot on compact), including before any playback logic exists.
Navigating between routes MUST NOT unmount or re-create the player region. The region SHALL be
the application's only visible playback interface: the shell SHALL NOT render a floating or
side-mounted video panel, nor a duplicate play control, position readout, or video caption
beside the player region, and the underlying player SHALL remain mounted but visually parked
behind the interface rather than displayed in the region.

#### Scenario: Player region persists across route navigation

- **WHEN** the user navigates from Home to Search and back while the app has no active track
- **THEN** the player region remains present and mounted throughout, shown in its idle/empty state

#### Scenario: The player region is the only visible playback interface

- **WHEN** any route renders while a track is active
- **THEN** no floating or side-mounted video panel appears, and no second play control, position
  readout, or video caption is rendered alongside the player region

#### Scenario: The player stays mounted while parked

- **WHEN** a track is active and the player is parked
- **THEN** the player host element remains in the document, mounted and connected, across route
  navigation, so navigation never interrupts playback

### Requirement: Now Playing surface

The shell SHALL provide an expanded Now Playing surface as a dedicated route, reachable from the
player region, rendered full-screen/expanded on compact viewports and presented as an expanded
view on desktop. The surface SHALL present the current track's artwork, title and artists, like
state, progress and seek, the full transport and volume controls, and access to the queue, all
bound to the same store and player state the player region uses, so that any change made anywhere
is reflected in both without a reload. It SHALL render the current artwork as a background behind
the content when artwork exists and the plain surface when it does not, SHALL present an
over-long title so it stays readable — animating only when the title overflows, and never
animating when the user prefers reduced motion — and SHALL offer a More Like This shelf for the
current track that never starts playback on its own. It SHALL offer a radio action that starts a
track radio from the current track, SHALL omit that action when there is no current track to seed
it from, and SHALL label a playing radio as such. The surface SHALL NOT autoplay anything by
itself.

The surface SHALL offer an explicit video-mode control that reveals the existing playback surface
as a visible video at a usable size, and SHALL omit that control when there is no current track
to show. Video mode SHALL default to off on every visit, SHALL NOT be persisted to session or
preference state, and SHALL be resettable without affecting playback. Revealing the video SHALL
reuse the application's existing single player rather than creating a second one, and the
surface's own controls SHALL remain operable in both video and non-video modes.

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

#### Scenario: Now Playing can start a track radio

- **WHEN** a track is playing and the user activates the radio action
- **THEN** a track radio for that track starts and the surface presents the radio as the active source

#### Scenario: No radio action without a current track

- **WHEN** there is no current track
- **THEN** the radio action is not offered rather than offered without a seed

#### Scenario: Video mode is opt-in and off by default

- **WHEN** the user opens Now Playing with a current track
- **THEN** a video-mode control is offered, video mode is off, and no video is displayed until
  the user activates it

#### Scenario: The video control is absent with nothing to show

- **WHEN** Now Playing is opened with no current track
- **THEN** no video-mode control is offered

#### Scenario: Enabling video mode reuses the one player

- **WHEN** the user enables video mode
- **THEN** the existing playback surface becomes visible at a usable size, no second player
  instance or player host is created, and playback continues uninterrupted

#### Scenario: Disabling video mode returns to the parked player

- **WHEN** the user disables video mode or navigates away from Now Playing
- **THEN** the playback surface returns to its parked state and playback continues uninterrupted

#### Scenario: Video mode does not persist as visible

- **WHEN** the app cold-launches with a persisted session
- **THEN** the session restores cued and paused and video mode is off, so the player never
  starts a visit in a visible state
