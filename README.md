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
├── package.json              # root command proxies into frontend/ (no dependencies)
├── frontend/                 # the single Next.js application
│   ├── docs/DESIGN.md        # canonical UI/UX source
│   ├── src/                  # app, components, features, server, data, stores, ...
│   └── tests/                # unit tests
├── openspec/                 # specs + changes
└── .github/workflows/        # CI
```

## Toolchain

- **Runtime:** Node.js 24.x — the version `frontend/package.json` declares, the version CI
  verifies, and the default LTS on the [Vercel deployment target](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
  The three are asserted to agree by `tests/deployment-contract.test.ts`.
- **Package manager:** npm (lockfile: `frontend/package-lock.json`) — npm is the project's selected package manager; do not add pnpm/yarn/bun lockfiles.
- Framework/test/lint versions are recorded in `frontend/README.md`.

## Getting started

From the repository root:

```bash
npm run setup        # install dependencies from frontend/package-lock.json
npm run dev          # development server (http://localhost:3000)
```

There is a `package.json` at the repository root whose scripts proxy into `frontend/`, so the
commands below run without a `cd frontend` first. The Next.js application still lives in
`frontend/` and still owns the only lockfile — the root manifest declares no dependencies, so
`npm install` at the root would create a second lockfile that nothing installs from. **Use
`npm run setup`**, not `npm install`, to install.

## Verified commands

Run from the repository root; each proxies to the application's own script:

```bash
npm run setup        # clean install from the lockfile (npm --prefix frontend ci)
npm run lint         # ESLint over the source
npm run format:check # Prettier formatting check
npm run typecheck    # next typegen && tsc --noEmit (strict TypeScript)
npm test             # Vitest unit tests
npm run build        # Next.js production build
npm run dev          # development server
npm run start        # serve an existing production build
npm run format       # rewrite formatting in place
npm run gate         # lint → format:check → typecheck → test → build, in one command
```

Each of these also works from inside `frontend/` directly, which is where the underlying
scripts and the lockfile live.

These commands establish that the toolchain installs, type-checks, lints, formats, tests the existing unit suite, and produces a production build. They do **not** establish that product behavior is correct — see `AGENTS.md` → Setup & commands for the full evidence scope.

## Continuous integration

`.github/workflows/ci.yml` runs lint → format check → typecheck → unit tests → production build on every push and pull request targeting `main`.
