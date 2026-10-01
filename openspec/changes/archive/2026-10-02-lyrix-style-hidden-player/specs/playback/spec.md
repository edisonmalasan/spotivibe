# Spec Delta

## MODIFIED Requirements

### Requirement: Parked playback surface

The YouTube player SHALL exist as exactly one persistent IFrame instance that, during normal
music playback, is visually parked: laid out at approximately 1×1 CSS pixels, fully transparent,
not receiving pointer events, positioned behind the application's own interface, and not
reachable by keyboard or assistive traversal. The player SHALL remain mounted and
playback-capable in that parked state — position, duration, queue advancement, and session
restore all continue to work — and it SHALL NOT be a display-hidden or destroyed node.

The application SHALL NOT render a floating or side video panel during normal playback, and
SHALL NOT render a duplicate play control, position readout, or video caption alongside its own
player controls. A parked player is a presentation state, not a reduced-capability player: the
same transport, queue, and volume operations remain fully available and fully operable.

The application SHALL provide an explicit opt-in video mode on the Now Playing surface. In that
mode the **same existing** player instance becomes visible at a usable size, and no second
player instance, API script tag, or player host node is created to serve it. Leaving video mode
returns the player to the parked state. Video mode is a per-visit view state that defaults to
off and SHALL NOT be restored from persisted session or preference state, so a cold launch never
begins with a visible player.

#### Scenario: The active surface meets the minimum size everywhere

- **WHEN** a track is active at desktop and compact viewports, on any route, with video mode off
- **THEN** the player host measures approximately 1×1 CSS pixels — the minimum footprint that
  keeps an embedded player alive, and never zero, destroyed, or removed from the document while a
  track is active

#### Scenario: Nothing renders in front of the surface

- **WHEN** the topmost element at the centre of the player host is inspected **while the video
  is visible**
- **THEN** it is the player itself — no application overlay, dialog, or control stack ever
  covers the visible video, because obscuring it is prohibited independently of how the player
  is otherwise configured. In the parked state there is nothing to inspect: the host is
  transparent and takes no pointer events, so it is skipped by hit-testing entirely, which is
  the intended behaviour rather than a surface the rule applies to.

#### Scenario: Normal music playback parks the player visually

- **WHEN** a track is playing and the user has not enabled video mode
- **THEN** the player's box measures approximately 1×1 CSS pixels with zero opacity, ignores
  pointer events, sits behind the application's interface, and contains no keyboard-reachable
  element

#### Scenario: A parked player still plays and still advances

- **WHEN** a track is playing in the parked state
- **THEN** reported position advances, duration is known, and the track advances to the next
  queue entry on completion exactly as it would with the player visible

#### Scenario: No floating video panel or duplicate controls are shown

- **WHEN** any route is rendered while a track is active and video mode is off
- **THEN** no floating or side-mounted video panel is present, and the application's own player
  controls are the only visible playback interface — with no second play button, position
  readout, or video caption rendered beside them

#### Scenario: Video mode reveals the existing player

- **WHEN** the user enables video mode on Now Playing
- **THEN** the same player instance becomes visible at a usable size, no additional player
  instance or API script tag is created, and the application's own transport controls remain
  operable over it

#### Scenario: The visible video carries no YouTube controls or keyboard handling

- **WHEN** video mode is enabled
- **THEN** the player's own controls and keyboard shortcuts stay disabled, so the visible
  video is operated only through the application's transport controls and cannot trap or
  diverge from them

#### Scenario: Leaving video mode re-parks the same player

- **WHEN** the user leaves the Now Playing surface or turns video mode off
- **THEN** the same player returns to the parked state and playback continues without
  interruption

#### Scenario: Video mode never survives a reload as visible

- **WHEN** the app cold-launches with a persisted session
- **THEN** the session is restored cued and paused with the player parked, and video mode is off
  unless the user enables it in that visit

### Requirement: YouTube attribution and playback compliance

The player SHALL use only documented, currently-functional player parameters, SHALL NOT suppress
the page referrer, and SHALL NOT include parameters that YouTube has deprecated and that
therefore have no effect. The engine MUST NOT extract, download, capture, or proxy audio/video,
block or alter ads, or force playback that YouTube or the browser has paused (no
background-play circumvention): external pauses are honored as final state until the user acts
again, and media flows only through the embedded player.

**This requirement does not assert compliance with YouTube's documented embedded-player
requirements, and the application MUST NOT be described as meeting them.** Parking the player
and suppressing its branding is an intentional departure from YouTube's published requirement for
a visible player of a given minimum size, taken deliberately for private, personal use. Any
documentation, deployment artifact, or user-facing description of the playback surface SHALL
state this plainly rather than claiming a visible, compliant surface exists. Before any public
deployment or third-party distribution, this configuration SHALL be revisited and the parked
player replaced with a visible one.

#### Scenario: Attribution is present for the active track

- **WHEN** video mode is enabled and the video is visible
- **THEN** the visible player supplies YouTube's own attribution, and the application offers a
  watch-page link on that same surface, so there is exactly one app-owned caption and it appears
  only where there is a video to attribute

#### Scenario: Only functional documented parameters are used

- **WHEN** the player is constructed
- **THEN** every parameter supplied is documented and currently functional, and no
  YouTube-deprecated parameter is supplied, because a deprecated parameter is inert
  configuration that misleadingly reads as effective

#### Scenario: An externally imposed pause is honored

- **WHEN** YouTube or the browser pauses playback outside app control (for example leaving
  autoplay scope)
- **THEN** the store reflects paused state and the engine does not automatically resume

#### Scenario: No extraction or hidden-playback paths exist

- **WHEN** the playback code is statically inspected
- **THEN** all media flows route through the YouTube IFrame player — no audio capture or
  decoding pipelines, no stream download, no media proxy, and no referrer-suppressing
  configuration

#### Scenario: Parked playback is never a background-play workaround

- **WHEN** playback code is inspected for parked-player behaviour
- **THEN** no timer, visibility handler, or media-session call resumes or un-mutes playback in
  order to keep a hidden player playing, and parking is a presentation state only

#### Scenario: The departure is stated rather than implied

- **WHEN** the deployment or release documentation describes the playback surface
- **THEN** it states that the player is parked and that this does not meet YouTube's documented
  visible-player requirement, instead of claiming a visible compliant surface
