# Proposal

## Why

M0 delivered the repository foundation (Next.js scaffold, quality gates, CI), but the app still ships the untouched `create-next-app` landing page. `ROADMAP.md` milestone **M1 — DESIGN.md-driven design system and application shell** is the next incomplete milestone and a declared dependency of M4 (player), M5 (search), and M7 (library); every feature page must be built on shared design-system primitives rather than page-specific CSS, so the shell must exist first.

## What Changes

- Extract the design tokens defined in `frontend/docs/DESIGN.md` into the Tailwind v4 `@theme` layer and CSS custom properties: surfaces/canvas colors, accent colors, typography scale/weights/families, 4px-based spacing scale, border-radius families (6px content / 9999px actions / 500px inputs), elevation/shadows, and hover/active states.
- Build reusable UI primitives (not page-specific duplicates): pill/ghost buttons, icon buttons, square album card, circular artist card, section header, search input, navigation arrow, skeleton, empty state, error state, and disabled/loading treatments — each with hover, focus-visible, disabled, and loading behavior.
- Implement the **desktop shell**: 340px left library/sidebar panel, 64px top navigation bar (branding + search + nav arrows), scrollable main content area, and a persistent bottom player bar slot.
- Implement the **mobile shell** (bottom navigation, compact mini-player slot, expanded Now Playing route) with responsive breakpoints switching between shells.
- Add Spotivibe branding surfaces (name, wordmark/logo placeholder, icon mark) — **no Spotify logos, assets, or brand copy**.
- Add placeholder routes for the shell's navigation targets (Home, Search, Library, Now Playing) that render design-system empty/skeleton states only — no search, library, or playback functionality (those belong to M5/M7/M4).
- Ensure keyboard focus visibility and accessible names are part of the primitives from the start.

## Capabilities

### New Capabilities

- `app-shell`: The Spotivibe application shell — design tokens, reusable UI primitives and their interaction states, desktop/mobile responsive shell layout, persistent player region, navigation placeholders, branding, and accessibility fundamentals.

### Modified Capabilities

None — `openspec/specs/` is empty; `app-shell` is the first capability.

## Impact

- **Code:** `frontend/src/app/` (layout + placeholder routes), `frontend/src/components/design-system/`, `frontend/src/components/layout/`, `frontend/src/styles/`, `frontend/src/app/globals.css`, `frontend/public/` (Spotivibe icon assets).
- **Dependencies:** none new (Tailwind v4 already scaffolded); test tooling may gain a DOM environment (e.g. jsdom + Testing Library) for primitive behavior tests.
- **Verification:** `DESIGN.md` visual audit required by `ROADMAP.md` §15 (desktop/tablet/mobile), unit/component tests for primitives and responsive shell switching, CI gates unchanged.
- **Roadmap:** `ROADMAP.md` §5 `M1` status moves `NOT STARTED` → `IN PROGRESS` → `DONE`.
- **No changes to:** provider/player/persistence code (not yet built), PWA/service worker, Lyrix-derived material.
