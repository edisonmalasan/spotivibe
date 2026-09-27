# M1 visual audit evidence (task 6.2)

## Method

- Captured from a **clean checkout of `feat/m1-design-system-shell` @ `b545a55`**
  (fresh clone → `npm ci` → `npm run build` → `next start` on port 3100), so the
  screenshots show the production render with no dev-only overlays.
- `capture-evidence.mjs` drives headless Edge (`Edg/154.0.4258.37`) over CDP
  using Node built-ins only — no project dependency was added for this.
- Viewports are exact via `Emulation.setDeviceMetricsOverride`
  (`deviceScaleFactor: 2`): **390×844** (mobile, <768), **820×1000** (tablet,
  768–1023), **1280×800** (desktop, ≥1024 — the `lg` breakpoint is 1024).
- Interaction evidence uses **real input events** dispatched over CDP: `Tab`
  key presses for focus, `mouseMoved` for hover.
- Machine-readable results for every check are in `audit-report.json`.
  Regenerate everything with:

  ```bash
  node capture-evidence.mjs http://localhost:3100 .
  ```

## Screenshots (9)

| File | Shows |
|---|---|
| `home-390.png` / `search-390.png` / `library-390.png` / `now-playing-390.png` | Compact shell (TopBar + MiniPlayer + BottomNav) on **every route** at mobile width |
| `home-820.png` | Tablet width still uses the compact shell (below `lg` = 1024) |
| `home-1280.png` | Desktop shell: sidebar + top bar + desktop PlayerBar, no compact shell |
| `focus-visible-1280.png` | Keyboard focus ring on the logo link (2px `#1ed760`, offset 2px) |
| `hover-navarrow-1280.png` | Top-bar nav arrow hover (`#000` → `#292929`) |
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
- **Hover** — nav arrow background `rgb(0,0,0) → rgb(41,41,41)`; sidebar pill CTA
  `scale: none → 1.05` (Tailwind v4 animates the CSS `scale` property);
  bottom-nav link `rgb(115,119,124) → rgb(179,179,179)`. The disabled play
  button shows **no** hover response — expected, it uses
  `disabled:pointer-events-none`.
- **Focus visibility** — first real `Tab` focuses the logo link with
  `outline: solid 2px rgb(30, 215, 96)`, `outline-offset: 2px`.
- **Disabled state** — all five idle transport controls report
  `disabled: true`, `cursor: default`; the play button renders an iron fill
  with a fog icon. (The audit caught a defect here: a base-level
  `disabled:text-iron` overrode the accent tone and rendered the icon
  iron-on-iron — invisible. Fixed in `34a897b` with regression tests.)
- **Empty states** — `empty_390/820/1280` record the rendered copy:
  section headings plus the `Nothing here yet` EmptyState on `/`.
- **Accessible names** — `Accessibility.getFullAXTree`: every interactive
  control has a name (9 controls: logo link, go back, go forward, search box,
  add-to-library, two prompt CTAs, now-playing link, progress bar). The
  `banner` and `main` landmarks are unnamed, which is permitted — they are
  unique landmarks and WCAG/ARIA do not require names for them.
- **Branding** — `document.title` is `Spotivibe`; zero `/spotify/i` text
  matches, zero `spotify.com` links, no third-party image sources.
- **Runtime health** — zero console errors and zero page exceptions during the
  whole capture.

## Evidence classes and limits (stated honestly)

- **Error state**: no placeholder route renders an error surface in M1, so
  there is no runtime screenshot. `ErrorState` is demonstrated by component
  tests (`tests/feedback.test.tsx`: `role="alert"`, retry interaction) — this
  is automated-test evidence, not visual evidence.
- **Card hover surfaces** (`AlbumCard`/`ArtistCard`): these primitives are not
  routed in M1 placeholder routes by design (tasks 5.1/5.2), so their
  hover-class contract is covered by `tests/cards.test.tsx` — again
  automated-test evidence, not a screenshot.
- **Green play affordance**: DESIGN.md defines no player spec; per its rule
  “use `#1ed760` for play buttons, active states, and brand accents”, the
  accent tone renders play buttons `#1ed760` when enabled (M4 introduces
  playback). Idle/disabled transport is intentionally muted (iron fill, fog
  icon), consistent with the `light` tone's disabled treatment.
