# Spec Delta

## MODIFIED Requirements

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
