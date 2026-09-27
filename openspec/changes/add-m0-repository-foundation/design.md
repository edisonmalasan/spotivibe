# Design

## Context

The repository contains documentation and workflow rules only: `docs/ROADMAP.md`, `docs/DESIGN.md`, `AGENTS.md`, and an initialized OpenSpec tree. There is no application code, no dependency manifest, and no CI. Node v26.10.0, npm 12.1.0, `gh` CLI, and the `openspec` CLI (1.13.2) are available on the development machine. See `proposal.md` for motivation and scope.

Two path mismatches must be resolved as part of M0: the roadmap mandates root `ROADMAP.md` and `frontend/docs/DESIGN.md`, while the files currently live at `docs/ROADMAP.md` and `docs/DESIGN.md`, and every later milestone's acceptance criteria reference the mandated paths.

## Goals / Non-Goals

**Goals:**

- A fresh, installable Next.js + TypeScript project under `frontend/` with strict type checking, path aliases, lint, format, unit-test, and production-build commands that all pass locally and in CI.
- Repository layout matching `ROADMAP.md` §7.1 so later milestones extend rather than restructure.
- Verified commands and package-manager choice recorded in `AGENTS.md`.
- CI that runs lint + typecheck + unit tests + production build on every push/PR to `main`.

**Non-Goals:**

- Any UI, design-system, provider, player, or persistence feature work (M1+).
- Lyrix source porting or attribution of specific files (no Lyrix code exists yet; only the mechanism is added).
- Deployment configuration beyond what the default Next.js/Vercel build needs.
- Test coverage targets beyond a real smoke test of the environment-validation module (feature tests arrive with their milestones).

## Decisions

1. **Scaffold with `create-next-app` under `frontend/`, then reshape to §7.1 folders.**
   - Rationale: produces the officially supported Next.js/TypeScript/ESLint baseline quickly; the roadmap requires a *fresh* codebase, not a fork.
   - Alternative considered: hand-written scaffold — rejected as it duplicates framework defaults and risks missing baseline config.
   - The `src/` directory is enabled so the roadmap's `src/app`, `src/components`, `src/features`, `src/server`, `src/data`, `src/stores`, `src/types`, `src/hooks`, `src/lib`, `src/styles` folders map directly.

2. **Package manager: npm (lockfile committed).**
   - Rationale: bundled with the available Node 26 runtime, zero additional tooling; `AGENTS.md` requires the choice to be made and recorded during M0.
   - Alternatives considered: pnpm/yarn (faster/stricter, but require installing another toolchain on this machine with no current benefit).

3. **Test runner: Vitest.**
   - Rationale: TypeScript/ESM-native, fast watch mode, minimal config, works alongside Next.js without a transpile pipeline; the roadmap requires a unit test runner at M0 and broader suites at M15.
   - Alternatives considered: Jest (heavier ESM/TS configuration for no gain here); Playwright (E2E is an M15 concern, added later).

4. **Lint/format: ESLint (with `typescript-eslint` and the Next.js config) + Prettier.**
   - Rationale: ESLint is the framework-recommended linter; Prettier is opinionated and avoids style debate.
   - Alternative considered: Biome (single fast tool, but diverges from the Next.js default ecosystem the roadmap assumes).

5. **Environment validation: a small `zod`-based `env` module in `src/server` (or `src/lib`), validated at server entry points, plus `.env.example`.**
   - Rationale: M0 requires environment validation; no provider secrets exist yet, so the initial schema is intentionally near-empty but structurally in place for M3 provider config. `zod` is reused later for backup/import validation (M2) and query validation (M14), so it is not a throwaway dependency.
   - Secret-exposure rule: server-only values are plain `process.env.X` reads inside the validated module; `NEXT_PUBLIC_*` is reserved for explicitly safe values and documented in `.env.example` comments. No secrets are committed.

6. **Unit-test smoke target: the environment-validation module.**
   - Rationale: gives CI a real assertion against real project code instead of a placeholder test, and proves the test toolchain wires up correctly.
   - Alternative considered: a trivial `expect(true)` test — rejected as it proves nothing.

7. **Docs relocation with `git mv`** (`docs/ROADMAP.md` → `ROADMAP.md`, `docs/DESIGN.md` → `frontend/docs/DESIGN.md`) so history is preserved; the empty `docs/` directory then disappears naturally.
   - Rationale: M0 acceptance criteria and `AGENTS.md` reference those exact paths.

8. **CI: single GitHub Actions workflow** (`.github/workflows/ci.yml`) on push/PR to `main`: checkout → setup Node (pinned major) → `npm ci` → lint → typecheck → unit tests → production build.
   - Alternative considered: separate workflows per check — rejected as unnecessary runner overhead for this size.

9. **Attribution mechanism: root `ATTRIBUTION.md`** describing the Lyrix MIT obligation, plus a rule (documented inside it) that substantially copied/modified Lyrix code must carry an MIT notice header and be listed there.
   - Rationale: satisfies `ROADMAP.md` §9.3 now; concrete entries are added only if/when Lyrix code is actually ported.

10. **Roadmap status ledger**: `M0` moves `NOT STARTED` → `IN PROGRESS` when implementation starts and → `DONE` only after every acceptance criterion is verified. Only the orchestrator edits this table (per `AGENTS.md`).

11. **Styling baseline: Tailwind CSS v4 enabled at scaffold time** (plain CSS default otherwise).
    - Rationale: `frontend/docs/DESIGN.md` ships a ready-made Tailwind v4 `@theme` token block as its Quick Start; enabling Tailwind during the scaffold avoids introducing a CSS framework mid-project when M1 extracts the design tokens.
    - Alternative considered: defer styling tooling to M1 — rejected because retrofitting the framework after components exist is a larger, riskier change than scaffolding it with the app.

## Risks / Trade-offs

- [`create-next-app` / npm registry network failure blocks scaffolding] → Run scaffolding early; if offline, fail the task explicitly rather than hand-faking a lockfile.
- [Newer Next.js may require newer Node or emit breaking defaults] → Use the framework's pinned stable defaults; record the actual versions in `AGENTS.md` after verification instead of guessing.
- [Empty architecture folders with `.gitkeep` can accumulate dead structure] → Folders come directly from the roadmap's mandated layout; they are contract, not speculation.
- [Near-empty env schema could give false confidence] → The module's contract and tests prove the *mechanism*; provider vars are added with M3 where they are actually needed (roadmap M0: `.env.example` contains only values actually needed).
- [CI proves static checks + build only] → Documented explicitly in `AGENTS.md` so no one later claims CI means behavior/tests of product features passed.

## Migration Plan

1. `git mv docs/ROADMAP.md ROADMAP.md` (root file, no interaction with scaffolding).
2. Scaffold `frontend/` with `create-next-app` (it must start from an empty directory, so the design document is moved in afterwards).
3. `mkdir frontend/docs` + `git mv docs/DESIGN.md frontend/docs/DESIGN.md`, then reshape `frontend/src` to the §7.1 folder layout.
4. Configure, then verify all commands locally.
5. Add CI, README, ATTRIBUTION, `.env.example`, roadmap status update.
6. Rollback strategy: each stage is a separate Conventional Commit on the feature branch; a failed verification reverts forward with additional commits — no history rewriting.

## Open Questions

None. (Next.js/Vitest exact versions are resolved by the scaffold and recorded post-install rather than decided here.)
