# Design

## Context

M0 left `frontend/` as a stock Next.js 16 scaffold (Tailwind v4, ESLint/Prettier/Vitest gates, CI) with the roadmap §7.1 folders. This change builds the first real UI on top of `frontend/docs/DESIGN.md`, which is the canonical UI/UX source (DESIGN.md ships both a CSS custom-property block and a Tailwind v4 `@theme` block ready to adopt). See `proposal.md` for motivation and scope; `specs/app-shell/spec.md` defines the behavior contract.

## Goals / Non-Goals

**Goals:**

- One token source of truth derived from DESIGN.md that all components consume.
- A shell (desktop + compact) with a persistent player region that later milestones extend rather than replace.
- Reusable primitives with complete interaction states, established before feature pages proliferate.

**Non-Goals:**

- Search, library, playback, persistence, or recommendation behavior (M4/M5/M7/M8) — placeholder routes render empty/skeleton states only.
- PWA manifest, service worker, and install icons (M13); language onboarding (M8); dynamic artwork backgrounds (M9).
- Pixel-perfect replication of Spotify's proprietary assets — only the DESIGN.md token/component language is used, with original Spotivibe branding.

## Decisions

1. **Token location: `src/styles/tokens.css` with Tailwind v4 `@theme`, imported by `globals.css`.**
   - Rationale: DESIGN.md provides the `@theme` block verbatim; `src/styles/` is a mandated §7.1 folder; Tailwind v4 generates the CSS custom properties from `@theme`, giving both utility classes and plain CSS variables for non-Tailwind use.
   - Alternative: inline tokens in `globals.css` — rejected, it buries the design contract in app chrome.

2. **Shell variant switching: CSS breakpoints only** (`hidden lg:flex` / `lg:hidden`), breakpoint contract: **desktop ≥1024px** (`lg`), tablet 768–1023px (compact shell with wider grids), mobile <768px.
   - Rationale: `display:none` removes the inactive variant from the visual tree, a11y tree, and tab order — satisfying "not visible or focusable" — with zero hydration flash and no JS.
   - Alternative: `matchMedia`-driven JS rendering — rejected for hydration-mismatch/flash risk with no user-visible gain.
   - DESIGN.md does not specify breakpoints; `lg=1024` matches its fixed-340px-sidebar desktop layout.

3. **Single `AppShell` in the root layout** wraps every route; the player region lives inside the shell, outside page content, so Next.js App Router layout persistence guarantees it never remounts across navigations.
   - Alternative: per-page player slots — rejected, would break the persistence requirement.

4. **Primitives in `src/components/design-system/`, shell parts in `src/components/layout/`** (roadmap §7.1 split). Interactive primitives are client components; the shell structure is server-rendered where possible.

5. **Icons: add `lucide-react`.**
   - Rationale: DESIGN.md requires "minimal, monoline, white on dark" icons; a tree-shaken icon library gives consistent, accessible, maintained glyphs instead of hand-drawn one-offs. This is a concrete reason to add a dependency (AGENTS change-scope rule satisfied).
   - Alternative: hand-rolled SVGs — rejected as duplicated, inconsistent artwork.

6. **Branding: original Spotivibe mark** (inline SVG wordmark/mark + favicon replacement in `public/`), page title/metadata updated. No Spotify assets, wordmark, or copy; the DESIGN.md-derived styling is the only "Spotify-inspired" element.
   - The app manifest and install icon set remain M13 work.

7. **Test approach:** Vitest + jsdom + Testing Library (new dev-deps: `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`).
   - Component tests prove primitive states, accessible names, disabled/error/empty/skeleton rendering, and the variant class contract.
   - jsdom cannot evaluate CSS media queries or layout, so the responsive scenario and DESIGN.md visual audit are verified manually in a browser at 390px/820px/1280px (recorded as visual evidence, distinct from automated tests).

8. **Placeholder routes** (`/`, `/search`, `/library`, `/now-playing`) render only shell chrome plus `EmptyState`/`Skeleton` primitives — this is what makes the navigation and player-slot requirements testable now without leaking M5/M7/M4 scope.

## Risks / Trade-offs

- [jsdom tests cannot prove visual layout] → Responsive/visual scenarios verified by manual browser audit at three viewports; automated tests assert structure, states, and class contracts only — evidence types stay separated.
- [Placeholder pages could grow into premature Search/Library features] → Placeholders are restricted to `EmptyState`/`Skeleton` rendering; any functional query/UI is out of scope and blocks review.
- [CSS-only variant switching leaves the inactive variant in the DOM] → `display:none` removes it from a11y tree and tab order; spec wording is "not visible or focusable", which this satisfies; stricter DOM exclusion was rejected per decision 2.
- [Adopting DESIGN.md's `@theme` verbatim could import mislabeled tokens (e.g. promo gradient named as magenta glow)] → Tokens are copied as given (DESIGN.md is canonical) and used only where DESIGN.md assigns them.
- [New dev-deps slightly expand the lockfile] → Both are test-only, dev-scoped, and required to test DOM behavior at all.

## Migration Plan

1. Tokens + primitives first (each lands with its component tests).
2. Shell layout + placeholder routes on top of primitives.
3. Visual audit against DESIGN.md, then roadmap status update.
4. Rollback: feature branch reverts cleanly; no data or persisted state exists yet to migrate.

## Open Questions

None — DESIGN.md's missing breakpoint values are resolved by decision 2, and all other unknowns are deferred to milestones that own them (manifest → M13, dynamic backgrounds → M9).
