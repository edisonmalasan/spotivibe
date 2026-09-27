# Tasks

## 1. Setup

- [x] 1.1 Update `ROADMAP.md` §5 `M1` → `IN PROGRESS`, then verify only the M1 row changed and commit the status update.
- [x] 1.2 Add DOM test infrastructure (dev-deps `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`; Vitest jsdom environment + RTL setup file), then verify `npm test` runs the existing env suite plus a DOM smoke test and exits 0.

## 2. Design tokens from DESIGN.md

- [x] 2.1 Implement `frontend/src/styles/tokens.css` (Tailwind v4 `@theme` + CSS custom properties for DESIGN.md colors, typography scale/weights, 4px spacing scale, radius families, shadows, surfaces) imported by `globals.css`, then verify a token unit test asserting the exact DESIGN.md values passes and `npm run build` exits 0.
- [x] 2.2 Add base-layer styles (canvas `#000000` background, default typography, visible `:focus-visible` outline, reduced-motion respect) and the breakpoint contract (mobile `<768px`, tablet `768–1023px`, desktop `≥1024px`), then verify a raw-content unit test asserts these base rules and breakpoint values exist and `npm run lint` + `npm test` exit 0.

## 3. Design-system primitives

- [x] 3.1 Implement `Button` (filled-white pill + ghost variants, disabled and loading states) and `IconButton` (accessible-name required) in `src/components/design-system/`, then verify component tests cover variants, disabled semantics, loading state, and accessible names passing.
- [x] 3.2 Implement `AlbumCard` (square, 6px radius, surface hover shift), `ArtistCard` (circular), and `SectionHeader` in `src/components/design-system/`, then verify component tests cover rendered structure, DESIGN.md text roles (title/artist), and hover class contract passing.
- [x] 3.3 Implement `SearchInput` (pill 500px radius, icon + placeholder) and `NavArrowButton` (32px circular, accessible name) in `src/components/design-system/`, then verify component tests cover placeholder/label rendering and accessible names passing.
- [x] 3.4 Implement `Skeleton`, `EmptyState`, and `ErrorState` (with retry/recover affordance) in `src/components/design-system/`, then verify component tests cover skeleton rendering, empty copy, and error retry interaction passing.

## 4. Shell layout

- [x] 4.1 Implement `AppShell` in `src/components/layout/` with the desktop variant (340px sidebar "Your Library" panel, 64px top bar with branding/search slots and nav arrows, scrollable main, bottom player region) mounted from the root layout, then verify component tests assert landmarks (banner/navigation/main/complementary), player-region presence, and the desktop variant class contract passing.
- [x] 4.2 Implement the compact variant (bottom navigation with Home/Search/Library items, compact mini-player slot above it) with the mutually-exclusive breakpoint class contract (`hidden lg:flex` / `lg:hidden`), then verify component tests assert the variant class contract, that both variants cannot be simultaneously visible per the contract, and that all nav controls expose accessible names.
- [x] 4.3 Implement the `/now-playing` expanded surface reachable from the player region with placeholder artwork/title/control primitives, then verify a component test renders Now Playing from the player-region link with placeholder content passing.

## 5. Branding and placeholder routes

- [x] 5.1 Create original Spotivibe branding (inline logo mark/wordmark component, favicon, page title/metadata), then verify a test asserts Spotivibe branding renders and a repo/bundle check finds no Spotify logo, icon, or brand copy.
- [x] 5.2 Implement placeholder routes `/`, `/search`, `/library` that render only shell chrome plus `EmptyState`/`Skeleton` states, then verify component tests render each route showing the empty/skeleton state and no functional search/library/playback controls exist.

## 6. Integration verification (M1 acceptance)

- [ ] 6.4 Repair verification findings, then re-run gates and re-capture audit evidence: elevated sidebar prompt cards must hover to `#292929` (code + test + audit target), top-bar/landmark spec prose aligned with the accountless design, route error boundary wiring `ErrorState` (code + test), full keyboard traversal and scroll-contract audit evidence, and stray-file cleanup.
- [x] 6.1 Run the full gate sequence from a clean checkout (install → lint → format check → typecheck → unit tests → production build), then verify every command exits 0 and record the results in the Apply PR.
- [x] 6.2 Perform the DESIGN.md visual audit in a browser at 390px, 820px, and 1280px viewports (rendered screenshots/evidence), then verify: layout follows DESIGN.md, the persistent player region exists on every route/variant, shells are mutually exclusive at the breakpoint, hover/focus/disabled/empty/error states are demonstrable, keyboard focus is visible with accessible names, and no Spotify branding ships.
- [x] 6.3 After all acceptance criteria pass, update `ROADMAP.md` §5 `M1` → `DONE`, then verify the status table reflects `DONE` for M0 and M1 only and commit the final status update.
