# Spotivibe

**Spotivibe** is an accountless, local-first, installable music Progressive Web App (PWA): a Spotify-inspired browsing/playback interface backed by YouTube/YouTube Music discovery and YouTube IFrame playback.

There are no Spotivibe accounts, no cloud sync, and no user database — user data lives on-device in IndexedDB and moves via versioned JSON export/import.

## Documentation

| Document | Purpose |
|---|---|
| [`ROADMAP.md`](./ROADMAP.md) | Source of truth for product scope, architecture, milestone order, and release criteria. |
| [`frontend/docs/DESIGN.md`](./frontend/docs/DESIGN.md) | Canonical UI/UX reference: tokens, components, layout, and responsive behavior. |
| [`AGENTS.md`](./AGENTS.md) | Repository engineering rules and the verified command/evidence list. |
| [`ATTRIBUTION.md`](./ATTRIBUTION.md) | Lyrix (MIT) attribution mechanism for derived code. |
| [`openspec/`](./openspec/) | Active specifications and in-flight OpenSpec changes. |

## Structure

```text
spotivibe/
├── ROADMAP.md
├── frontend/                 # the single Next.js application
│   ├── docs/DESIGN.md        # canonical UI/UX source
│   ├── src/                  # app, components, features, server, data, stores, ...
│   └── tests/                # unit tests
├── openspec/                 # specs + changes
└── .github/workflows/        # CI
```

## Toolchain

- **Runtime:** Node.js v26.10.0
- **Package manager:** npm 12.1.0 (lockfile: `frontend/package-lock.json`) — npm is the project's selected package manager; do not add pnpm/yarn/bun lockfiles.
- Framework/test/lint versions are recorded in `frontend/README.md`.

## Verified commands

Run from the repository root:

```bash
cd frontend
npm ci               # clean install from the lockfile
npm run lint         # ESLint over the source
npm run format:check # Prettier formatting check
npm run typecheck    # next typegen && tsc --noEmit (strict TypeScript)
npm test             # Vitest unit tests
npm run build        # Next.js production build
npm run dev          # development server (http://localhost:3000)
```

These commands establish that the toolchain installs, type-checks, lints, formats, tests the existing unit suite, and produces a production build. They do **not** establish that product behavior is correct — see `AGENTS.md` → Setup & commands for the full evidence scope.

## Continuous integration

`.github/workflows/ci.yml` runs lint → format check → typecheck → unit tests → production build on every push and pull request targeting `main`.
