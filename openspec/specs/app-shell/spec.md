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

The shell SHALL reserve and render a player region on every route, in both shell variants (bottom player bar on desktop, mini-player slot on compact), including before any playback logic exists. Navigating between routes MUST NOT unmount or re-create the player region.

#### Scenario: Player region persists across route navigation

- **WHEN** the user navigates from Home to Search and back while the app has no active track
- **THEN** the player region remains present and mounted throughout, shown in its idle/empty state

### Requirement: Now Playing surface

The shell SHALL provide an expanded Now Playing surface as a dedicated route, reachable from the player region, rendered full-screen/expanded on compact viewports and presented as an expanded view on desktop. The surface SHALL present the current track's artwork, title and artists, like state, progress and seek, the full transport and volume controls, and access to the queue, all bound to the same store and player state the player region uses, so that any change made anywhere is reflected in both without a reload. It SHALL render the current artwork as a background behind the content when artwork exists and the plain surface when it does not, SHALL present an over-long title so it stays readable — animating only when the title overflows, and never animating when the user prefers reduced motion — and SHALL offer a More Like This shelf for the current track that never starts playback on its own. It SHALL offer a radio action that starts a track radio from the current track, SHALL omit that action when there is no current track to seed it from, and SHALL label a playing radio as such. A visible, compliant YouTube playback surface and its attribution SHALL remain part of the design, and the surface SHALL NOT autoplay anything by itself.

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
