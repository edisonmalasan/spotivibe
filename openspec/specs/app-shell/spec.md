# app-shell Specification

## Purpose

Defines the Spotivibe application shell: the DESIGN.md design-token foundation, reusable UI primitives and their interaction states, the responsive desktop/compact shells with a persistent player region, placeholder navigation surfaces, Spotivibe branding, and accessibility fundamentals.

## Requirements

### Requirement: Design token foundation

The shell SHALL be styled exclusively through design tokens extracted from `frontend/docs/DESIGN.md`, exposed as CSS custom properties and the Tailwind theme: canvas `#000000`, sidebar/card surfaces `#121212`/`#1f1f1f`, card hover `#292929`, primary text `#ffffff`, secondary text `#b3b3b3`, accent `#1ed760`, the 4px-based spacing scale, the typography scale (11/14/16/24px with weights 400/600/700), the radius families (6px content, 9999px actions, 500px inputs), and the documented shadows. Components MUST NOT hard-code colors, spacing, or radii that duplicate token values.

#### Scenario: Rendered surfaces match DESIGN.md token values

- **WHEN** a card primitive and the page canvas are rendered
- **THEN** the canvas computes to `#000000`, the album card surface to `#121212`, the album card hover surface to `#1f1f1f`, and an elevated card's hover surface to `#292929`

#### Scenario: Typography and radius follow the token scale

- **WHEN** a section heading and a pill button are rendered
- **THEN** the heading uses 24px/700 typography and the button uses the 9999px radius family with 14px/700 label text

### Requirement: Desktop shell layout

At viewports of 1024px and wider, the shell SHALL render a 340px-wide left library sidebar (`#121212`), a 64px-tall top navigation bar (`#000000`) containing the branding area, the search input, back/forward navigation arrows, and a settings control (account and upgrade call-to-action controls are permanently out of scope for this accountless product), a vertically scrollable main content region, and the persistent player region at the bottom of the viewport.

#### Scenario: Wide viewport renders the two-column shell

- **WHEN** the app is rendered at a viewport width of 1280px
- **THEN** a 340px sidebar, a 64px top bar, a scrollable main region, and a bottom player region are all present simultaneously

#### Scenario: Main content scrolls while shell regions stay fixed

- **WHEN** main content exceeds the viewport height at 1280px wide
- **THEN** the sidebar, top bar, and player region remain visible without scrolling away

### Requirement: Compact shell layout

Below 1024px the shell SHALL render the compact variant instead: a bottom navigation bar, a compact mini-player slot directly above it, and full-width main content; the desktop sidebar MUST NOT be visible or focusable. The two shell variants MUST NOT be visible at the same time.

#### Scenario: Narrow viewport renders the compact shell

- **WHEN** the app is rendered at a viewport width of 390px
- **THEN** the bottom navigation and mini-player slot are visible and the sidebar is absent

#### Scenario: Shell variants are mutually exclusive

- **WHEN** the viewport crosses the 1024px breakpoint in either direction
- **THEN** exactly one shell variant is rendered after the transition

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

The shell SHALL provide an expanded Now Playing surface as a dedicated route, reachable from the player region, rendered full-screen/expanded on compact viewports and presented as an expanded view on desktop. The surface SHALL present the current track's artwork, title and artists, like state, progress and seek, the full transport and volume controls, and access to the queue, all bound to the same store and player state the player region uses, so that any change made anywhere is reflected in both without a reload. It SHALL render the current artwork as a background behind the content when artwork exists and the plain surface when it does not, SHALL present an over-long title so it stays readable — animating only when the title overflows, and never animating when the user prefers reduced motion — and SHALL offer a More Like This shelf for the current track that never starts playback on its own. It SHALL offer a radio action that starts a track radio from the current track, SHALL omit that action when there is no current track to seed it from, and SHALL label a playing radio as such. The surface SHALL NOT autoplay anything by itself.

The surface SHALL offer an explicit video-mode control that reveals the existing playback surface as a visible video at a usable size, and SHALL omit that control when there is no current track to show. Video mode SHALL default to off on every visit, SHALL NOT be persisted to session or preference state, and SHALL be resettable without affecting playback. Revealing the video SHALL reuse the application's existing single player rather than creating a second one, and the surface's own controls SHALL remain operable in both video and non-video modes.

The surface SHALL present a lyrics area for the current track, and every other element of the surface SHALL remain present, operable, and correctly laid out when the lyrics area is loading, populated, unavailable, or failed. The lyrics area SHALL NOT overlay or obscure the player region, and SHALL NOT delay or gate the surface's own controls, artwork, transport, or related content.

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

#### Scenario: Lyrics never displace or delay the rest of the surface

- **WHEN** the lyrics area is loading, populated, unavailable, or failed
- **THEN** the surface's artwork, title, transport, volume, queue access, and related content are
  all still present and operable, and the lyrics area does not overlay the player region

### Requirement: Primitive interaction states

Design-system primitives (buttons, cards, inputs, navigation items) SHALL implement hover, focus-visible, disabled, and loading treatments: card hover shifts surface `#121212` → `#1f1f1f`/`#292929` per placement, interactive controls show a visible focus indicator for keyboard focus, disabled controls are visually muted and non-interactive, and loading content renders as skeleton placeholders matching the layout it replaces.

#### Scenario: Keyboard focus is visible

- **WHEN** a button primitive receives keyboard focus
- **THEN** a visible focus indicator is applied and the control remains operable via keyboard

#### Scenario: Disabled control is inert and muted

- **WHEN** a button primitive is rendered in its disabled state
- **THEN** it cannot be activated, exposes a disabled/`aria-disabled` semantic, and uses muted styling

#### Scenario: Loading state replaces content with skeletons

- **WHEN** a surface renders while its data is loading
- **THEN** skeleton placeholders shaped like the target content are shown instead of the final content

### Requirement: Empty and error states

Shell surfaces SHALL provide reusable empty-state and error-state components; placeholder routes without data MUST render the empty state, and failed renders MUST show the error state with a recover/retry affordance rather than a blank screen.

#### Scenario: Placeholder route with no data

- **WHEN** a placeholder route that has no content is opened
- **THEN** an empty state with explanatory copy is displayed

#### Scenario: Render failure shows a recoverable error state

- **WHEN** a surface enters its error condition
- **THEN** an error message and a retry/recover control are displayed instead of an empty region

### Requirement: Spotivibe branding without Spotify assets

The shell SHALL present Spotivibe's own name, logo mark, and icon surfaces. It MUST NOT ship Spotify logos, icons, screenshots, or Spotify brand copy; any Spotify-inspired styling SHALL be expressed only through the DESIGN.md token/component language.

#### Scenario: Branding surfaces show Spotivibe identity

- **WHEN** the shell renders
- **THEN** the Spotivibe name and logo mark are present in the shell's branding area (top bar), the page title, and the app icon surface

#### Scenario: No Spotify brand assets are shipped

- **WHEN** the shipped bundle, public assets, and rendered UI are inspected
- **THEN** no Spotify logo, icon, or Spotify brand copy is present

### Requirement: Accessibility fundamentals

The shell SHALL provide a keyboard-accessible path to every primary control, a visible focus indicator on keyboard focus, semantic elements for actions and navigation, accessible names for controls that present only an icon, and motion that respects a reduced-motion preference. All interactive shell controls SHALL be keyboard reachable, expose visible focus states, and carry accessible names; icon-only controls MUST have text alternatives (e.g. `aria-label`), and landmarks (banner/navigation/main/complementary) SHALL be expressed with semantic elements — the shell intentionally has no `contentinfo` region (the player areas are application chrome, not document footer content). Text and meaningful non-text indicators SHALL meet a minimum contrast ratio against the backgrounds the design tokens produce, and that ratio SHALL be computable from the shipped tokens rather than asserted by eye. These properties SHALL be verifiable by measurement in a real browser, and the measurement SHALL be able to fail.

#### Scenario: Icon-only controls have accessible names

- **WHEN** the navigation arrows, play-slot, and bottom navigation icons are inspected
- **THEN** each control exposes a non-empty accessible name

#### Scenario: Keyboard-only traversal of the shell

- **WHEN** the user tabs through the interface
- **THEN** focus moves through top bar, sidebar, main content, and player region controls in a sensible order with visible focus at every stop

#### Scenario: Keyboard focus is visible

- **WHEN** focus moves to a control by keyboard
- **THEN** a visible focus indicator is present, and it is not suppressed by a reset that removes the outline

#### Scenario: Actions are semantic elements

- **WHEN** a control performs an action or navigates
- **THEN** it is a button or a link, not a click handler on a generic container

#### Scenario: Text meets a minimum contrast against its token background

- **WHEN** the contrast of every rendered text style is computed against the background its tokens produce
- **THEN** each pair meets the minimum ratio for its size class, and a pair that does not is reported by name rather than being averaged away

#### Scenario: Motion is reduced when requested

- **WHEN** the platform reports a reduced-motion preference
- **THEN** non-essential animation is reduced or removed

#### Scenario: The measurement can fail

- **WHEN** a contrast pair, a control name, a focus indicator, or a keyboard path is missing
- **THEN** the measurement run fails and names what it found, rather than reporting a score with a footnote

### Requirement: The contrast guard reads the product's source files once and survives concurrent writes to that tree

The contrast guard SHALL read each component source file at the moment its directory entry is seen,
rather than collecting paths in one pass and reading them in a later pass. It SHALL treat a file that
is listed by the directory walk and then cannot be opened as having ceased to exist, and continue
without it.

A path that the walk returned and the read then cannot open was deleted between the two calls; a
file that is genuinely not part of the product is not returned by the walk in the first place. The
guard's subject is the product's source files, so a file that no longer exists is not one of them,
and asserting a contrast ratio against it is not a stricter check but an impossible one.

The guard SHALL be written into the real source tree by other tests rather than into a temporary
directory, and the contrast walk SHALL NOT exclude any product directory to avoid the collision.

A probe written elsewhere would not exercise the walk over the real tree, so the test that writes it
would pass while proving nothing. Excluding a real directory would stop a genuine contrast
regression in that directory from being caught, which is a worse outcome than a rare retry.

#### Scenario: Another test deletes a component between the walk and the read

- **WHEN** a test file running in parallel writes a probe into the source tree and removes it while
  the contrast guard is walking that directory
- **THEN** the guard completes over the remaining files without aborting, and reports the same
  offences it would report if the probe had never existed

#### Scenario: The probe is dropped into the real source tree

- **WHEN** a test proves that the guard rejects an offending component
- **THEN** the probe is written into the source tree the guard walks, and removed afterwards, so the
  guard's verdict is reached against the real tree

### Requirement: Tolerance in the contrast guard cannot become silence

A guard that tolerates a missing file SHALL still be required to find the product's components and
still be required to find text that uses the type scale. Tolerating a file that vanished MUST NOT
extend to tolerating a file that is present.

The failure mode of making a reader tolerant is a reader that tolerates everything and returns
nothing, which turns every contrast rule into a pass. That is a worse outcome than the flake it
replaces, because it is invisible: the suite is green and the guard is dead.

This SHALL be asserted by a test that establishes both halves at once — that a path which does not
exist is reported absent without throwing, and that a path which does exist still yields its
contents — so that the tolerance cannot generalise into returning nothing.

#### Scenario: A path that does not exist

- **WHEN** the guard is asked for the source of a path that is not present
- **THEN** it reports the path as absent rather than throwing, and the walk over the other files
  continues

#### Scenario: A path that does exist

- **WHEN** the guard is asked for the source of a path that is present
- **THEN** it returns that file's contents, and the walk still reports more than the minimum number
  of component files and of components using the type scale
