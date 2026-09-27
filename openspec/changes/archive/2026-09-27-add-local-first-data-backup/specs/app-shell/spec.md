# Spec Delta

## MODIFIED Requirements

### Requirement: Desktop shell layout

At viewports of 1024px and wider, the shell SHALL render a 340px-wide left library sidebar (`#121212`), a 64px-tall top navigation bar (`#000000`) containing the branding area, the search input, back/forward navigation arrows, and a settings control (account and upgrade call-to-action controls are permanently out of scope for this accountless product), a vertically scrollable main content region, and the persistent player region at the bottom of the viewport.

#### Scenario: Wide viewport renders the two-column shell

- **WHEN** the app is rendered at a viewport width of 1280px
- **THEN** a 340px sidebar, a 64px top bar, a scrollable main region, and a bottom player region are all present simultaneously

#### Scenario: Main content scrolls while shell regions stay fixed

- **WHEN** main content exceeds the viewport height at 1280px wide
- **THEN** the sidebar, top bar, and player region remain visible without scrolling away
