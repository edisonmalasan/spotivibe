# Proposal

## Why

Spotivibe currently contains only documentation (`docs/ROADMAP.md`, `docs/DESIGN.md`), an initialized OpenSpec workflow, and repository rules (`AGENTS.md`) — there is no runnable project, no toolchain, and no CI. `ROADMAP.md` milestone **M0 — Repository foundation, documentation, quality gates** is the first incomplete milestone and a hard dependency for every later milestone (M1–M15), so the smallest appropriate next change is the M0 foundation itself.

## What Changes

- Relocate preserved documents to their roadmap-mandated paths with `git mv`:
  - `docs/ROADMAP.md` → `ROADMAP.md` (root, per M0 task "Create root `ROADMAP.md`").
  - `docs/DESIGN.md` → `frontend/docs/DESIGN.md` (per M0 task "Place/retain design source at `frontend/docs/DESIGN.md`"; acceptance criteria reference this exact path).
- Scaffold a fresh Next.js + TypeScript application under `frontend/` (App Router, `src/` layout) matching the target architecture folders in `ROADMAP.md` §7.1 — no Lyrix code is copied.
- Select and record the package manager (npm) and add the verified install/lint/typecheck/test/build commands to `AGENTS.md` → Setup & commands after they are actually executed.
- Configure quality gates: ESLint, Prettier, strict TypeScript with path aliases, environment-variable validation, and a unit test runner with an initial smoke test so CI has something real to run.
- Add `.env.example` containing only server-side provider/config placeholders that are actually needed at this stage, plus a guard/rule that secrets are never exposed via `NEXT_PUBLIC_*`.
- Add an MIT attribution mechanism (`ATTRIBUTION.md`) for any later Lyrix-derived code, per `ROADMAP.md` §9.3.
- Add a root `README.md` that references `ROADMAP.md` and `frontend/docs/DESIGN.md`.
- Add a GitHub Actions CI workflow running lint + typecheck + unit tests + production build.
- Update `ROADMAP.md` milestone status: `M0` → `IN PROGRESS` during implementation, `DONE` only after acceptance criteria are verified.

Out of scope for this change: M1 design-system/shell UI work, provider/player/persistence features, PWA manifests, and any Lyrix source porting.

## Capabilities

### New Capabilities

None — this change declares `skip_specs: true`.

### Modified Capabilities

None — `openspec/specs/` is empty and no spec-level product behavior changes.

Rationale: M0 is repository tooling, documentation placement, and CI scaffolding. Per OpenSpec rules, `skip_specs` is reserved for changes where no spec-level behavior changes (tooling/docs) — product behavior specifications begin with the first UI/data/provider milestone (M1+). No requirement is invented just to satisfy validation.

## Impact

- Repository layout: new `frontend/` project tree; `docs/` documents relocated (history preserved via `git mv`); new `.env.example`, `README.md`, `ATTRIBUTION.md`, `.github/workflows/`.
- Dependencies: `next`, `react`, `react-dom`, TypeScript, ESLint/Prettier toolchain, Vitest, and an env-validation library — explicitly **no** auth, Supabase, database, or account-related dependencies.
- Verified commands: new install/lint/typecheck/test/build commands will be documented in `AGENTS.md` only after successful execution.
- Roadmap status ledger: `M0` status changes in `ROADMAP.md` §5.
- No runtime/user-facing behavior exists yet to change; nothing is deployed.
