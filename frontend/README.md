# Spotivibe — `frontend/`

The single Next.js application for Spotivibe (see the repository root `ROADMAP.md` for scope and `frontend/docs/DESIGN.md` for the canonical UI/UX reference).

Bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Package manager

**npm** is the selected package manager for this repository (chosen during milestone M0). Use `npm` commands only; do not introduce pnpm/yarn/bun lockfiles.

## Toolchain

| Tool | Version | Verified with |
|---|---|---|
| Node.js | 24.x | `node --version`, and CI |
| npm | lockfileVersion 3 | `npm --version` |
| next | 16.3.6 | `npm ls next --depth=0` |
| react / react-dom | 19.2.8 | `npm ls react react-dom --depth=0` |
| typescript | 5.9.3 | `npm ls typescript --depth=0` |
| eslint | 9.39.5 | `npm ls eslint --depth=0` |
| tailwindcss | 4.3.3 | `npm ls tailwindcss --depth=0` |

**Node 24** is the runtime this project targets because it is the default LTS on Vercel, the
stated deployment target, and a pin the host can actually build. `tests/deployment-contract.test.ts`
asserts that `engines.node`, the CI workflow, and Vercel's documented set all agree, so
changing one of them without the others fails a check rather than a build.

## Getting Started

Most people will run these from the repository root, where a `package.json` proxies into this
directory:

```bash
cd ..              # repository root
npm run setup      # install from this package's lockfile
npm run dev        # development server
```

The same commands work here directly if you prefer to stay in this directory:

```bash
npm ci             # clean install from package-lock.json
npm run dev        # development server
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

This directory is the only one with a `package-lock.json`, and the root manifest declares no
dependencies — so the lockfile here is the only install manifest in the repository. Do not run
`npm install` at the root; it would create a second lockfile nothing installs from. Use
`npm run setup` from the root, or `npm ci` here.

Quality-gate commands (install, lint, format check, typecheck, test, build) are documented with their evidence scope in the repository root `README.md` and `AGENTS.md`.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
