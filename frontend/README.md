# Spotivibe — `frontend/`

The single Next.js application for Spotivibe (see the repository root `ROADMAP.md` for scope and `frontend/docs/DESIGN.md` for the canonical UI/UX reference).

Bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Package manager

**npm** is the selected package manager for this repository (chosen during milestone M0). Use `npm` commands only; do not introduce pnpm/yarn/bun lockfiles.

## Toolchain (recorded at M0 scaffold time)

| Tool | Version | Verified with |
|---|---|---|
| Node.js | v26.10.0 | `node --version` |
| npm | 12.1.0 | `npm --version` |
| next | 16.3.6 | `npm ls next --depth=0` |
| react / react-dom | 19.2.8 | `npm ls react react-dom --depth=0` |
| typescript | 5.9.3 | `npm ls typescript --depth=0` |
| eslint | 9.39.5 | `npm ls eslint --depth=0` |
| tailwindcss | 4.3.3 | `npm ls tailwindcss --depth=0` |

## Getting Started

```bash
npm ci          # clean install from package-lock.json
npm run dev     # development server
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Quality-gate commands (install, lint, format check, typecheck, test, build) are documented with their evidence scope in the repository root `README.md` and `AGENTS.md`.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
