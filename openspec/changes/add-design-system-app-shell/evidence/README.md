# M1 visual audit evidence (task 6.2)

## Method

- Captured from a **clean checkout of `feat/m1-design-system-shell` @ `eaa389b`**
  (fresh clone → `npm ci` → `npm run build` → `next start` on port 3100), so the
  screenshots show the production render with no dev-only overlays.
- `capture-evidence.mjs` drives headless Edge (`Edg/154.0.4258.37`) over CDP
  using Node built-ins only — no project dependency was added for this.
- Viewports are exact via `Emulation.setDeviceMetricsOverride`
  (`deviceScaleFactor: 2`): **390×844** (mobile, <768), **820×1000** (tablet,
  768–1023), **1280×800** (desktop, ≥1024 — the `lg` breakpoint is 1024).
- Interaction evidence uses **real input events** dispatched over CDP: `Tab`
  key presses for focus traversal, `mouseMoved` for hover.
- Machine-readable results for every check are in `audit-report.json`.
  Regenerate everything with:

  ```bash
  node capture-evidence.mjs http://localhost:3100 .
  ```

## Screenshots (11)

| File | Shows |
|---|---|
| `home-390.png` / `search-390.png` / `library-390.png` / `now-playing-390.png` | Compact shell (TopBar + MiniPlayer + BottomNav) on **every route** at mobile width |
| `home-820.png` | Tablet width still uses the compact shell (below `lg` = 1024) |
| `home-1280.png` | Desktop shell: sidebar + top bar + desktop PlayerBar, no compact shell |
| `focus-visible-1280.png` | Keyboard focus, stop 1 (logo link): 2px `#1ed760` outline, offset 2px |
| `focus-traversal-1280.png` | Keyboard focus, final stop (player-region link): same visible outline |
| `hover-navarrow-1280.png` | Top-bar nav arrow hover (`#000` → `#292929`) |
| `hover-card-1280.png` | Elevated sidebar prompt card hover (`#1f1f1f` → `#292929`); the second card shows the resting surface for contrast |
| `hover-bottomnav-390.png` | Bottom-nav link hover (`#73777c` → `#b3b3b3`) |

## Machine checks (`audit-report.json`)

- **Shell mutual exclusion** — computed `display` per viewport/route:
  at 390 and 820: `aside: none`, `player-bar: none`, `compact-shell: flex`
  (bottom nav + mini player visible); at 1280: `aside: flex`, `player-bar: flex`,
  `compact-shell: none`. Holds on all six viewport × route combinations.
- **Persistent player** — `dataset.m1audit` markers were set on both player
  elements, then a **client-side Next.js `Link` navigation** (bottom-nav link at
  390, sidebar link at 1280) navigated `/ → /search`. Both markers survived and
  the variant-correct region stayed visible, proving the player elements were
  never remounted across navigation.
- **Scroll contract (spec R2)** — at 1280 `main.scrollHeight > clientHeight`
  (`canScroll: true`, scrolled to its 61px overflow) and at 390 (scrolled 160px);
  in both cases the header and visible player/nav region `getBoundingClientRect()`
  tops are identical before and after scrolling (`shellFixed: true`).
- **Hover** (5 targets, real mouse input) — nav arrow background
  `rgb(0,0,0) → rgb(41,41,41)`; sidebar pill CTA `scale: none → 1.05` (Tailwind
  v4 animates the CSS `scale` property); **elevated sidebar prompt card
  `rgb(31,31,31) → rgb(41,41,41)`** (`#1f1f1f` → `#292929`, DESIGN.md's
  "Card Hover" surface); bottom-nav link `rgb(115,119,124) → rgb(179,179,179)`.
  The disabled play button shows **no** hover response — expected, it uses
  `disabled:pointer-events-none`.
- **Keyboard traversal** — 9 Tab stops recorded on `/now-playing` in DOM order
  covering all four regions: top bar (logo, go back, go forward, search box) →
  sidebar (add-to-library, Open library pill, Search now pill) → main content
  (Close Now Playing) → player region (Open Now Playing). **Every stop** reports
  `outline: solid 2px rgb(30, 215, 96)` (±3 rgb from live color sampling) with
  `outline-offset: 2px`.
- **Disabled state** — all five idle transport controls report
  `disabled: true`, `cursor: default`; the play button renders an iron fill
  with a fog icon. (The first audit round caught a defect here: a base-level
  `disabled:text-iron` overrode the accent tone and rendered the icon
  iron-on-iron — invisible. Fixed in `34a897b` with regression tests.)
- **Empty states** — `empty_390/820/1280` record the rendered copy:
  section headings plus the `Nothing here yet` EmptyState on `/`.
- **Accessible names** — `Accessibility.getFullAXTree`: every interactive
  control has a name (logo link, go back, go forward, search box,
  add-to-library, two prompt CTAs, now-playing links, progress bar). The
  `banner` and `main` landmarks are unnamed, which is permitted — they are
  unique landmarks and WCAG/ARIA do not require names for them.
- **Branding** — `document.title` is `Spotivibe`; zero `/spotify/i` text
  matches, zero `spotify.com` links, no third-party image sources.
- **Runtime health** — zero console errors and zero page exceptions during the
  whole capture.

## Evidence classes and limits (stated honestly)

- **Error state**: wired through `frontend/src/app/error.tsx` — a render
  failure inside a route surfaces `ErrorState` (`role="alert"`) with a retry
  pill that calls the router's `reset`. Covered by the component test
  (`tests/feedback.test.tsx`, "Route error boundary"). No M1 route fails at
  runtime, so there is no runtime screenshot — this is automated-test evidence.
- **Card hover surfaces**: the elevated sidebar prompt cards are
  runtime-demonstrated (`hover-card-1280.png` + the `sidebar-prompt-card`
  hover check). `AlbumCard`/`ArtistCard` are not routed in M1 placeholder
  routes by design (tasks 5.1/5.2), so their hover-class contract is covered
  by `tests/cards.test.tsx` — automated-test evidence, not a screenshot.
- **Green play affordance**: DESIGN.md defines no player spec; per its rule
  “use `#1ed760` for play buttons, active states, and brand accents”, the
  accent tone renders play buttons `#1ed760` when enabled (M4 introduces
  playback). Idle/disabled transport is intentionally muted (iron fill, fog
  icon), consistent with the `light` tone's disabled treatment.
