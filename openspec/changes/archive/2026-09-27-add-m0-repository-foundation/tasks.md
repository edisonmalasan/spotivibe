# Tasks

## 1. Next.js scaffold under `frontend/`

- [x] 1.1 Scaffold a fresh Next.js + TypeScript app under `frontend/` with App Router, `src/` directory, ESLint, and Tailwind CSS v4 (no Lyrix code), then verify `npm ci` completes cleanly from the committed lockfile.
- [x] 1.2 Create the `ROADMAP.md` §7.1 source folders (`src/app`, `src/components/*`, `src/features/*`, `src/server/music/providers`, `src/server/http`, `src/data/*`, `src/stores`, `src/types`, `src/hooks`, `src/lib`, `src/styles`, `tests/`) with placeholders, then verify the resulting tree matches the §7.1 layout (folder listing inspected against the roadmap).
- [x] 1.3 Document the chosen package manager (npm) and scaffold/toolchain versions in the scaffold docs (`frontend/README.md` if generated, otherwise root `README.md`), then verify the recorded versions match `node --version`, `npm --version`, and `frontend/package.json`.

## 2. Repository documents at roadmap-mandated paths

- [x] 2.1 Relocate `docs/ROADMAP.md` → `ROADMAP.md` with `git mv`, then verify the file exists at the repository root, `docs/ROADMAP.md` no longer exists, and `git status` records a rename (history preserved).
- [x] 2.2 Relocate `docs/DESIGN.md` → `frontend/docs/DESIGN.md` with `git mv` after the scaffold creates `frontend/`, then verify the file exists at the mandated path, `git log --follow` still reaches the original commit, and the empty `docs/` directory is gone.

## 3. Quality gates: lint, format, typecheck, tests, env validation

- [x] 3.1 Add Prettier configuration and a `format:check` script to `frontend/package.json`, then verify `npm run format:check` exits 0 on the scaffolded source.
- [x] 3.2 Enforce strict TypeScript with the `@/*` path alias in `frontend/tsconfig.json` and add a `typecheck` script, then verify `npm run typecheck` exits 0.
- [x] 3.3 Confirm/extend the ESLint configuration for the project rules, then verify `npm run lint` exits 0.
- [x] 3.4 Configure Vitest with a `test` script, then verify `npm test` runs and exits 0 with the project configuration loaded.
- [x] 3.5 Implement the `zod`-based environment-validation module (near-empty server-side schema, `NEXT_PUBLIC_*` exposure rule documented) plus `.env.example` containing only actually-needed server-side placeholder values, and verify unit tests covering valid/invalid env inputs pass via `npm test`.

## 4. Repository governance, CI, and status ledger

- [x] 4.1 Add a root `README.md` that references `ROADMAP.md` and `frontend/docs/DESIGN.md` and lists the verified commands, then verify each documented command runs exactly as written.
- [x] 4.2 Add root `ATTRIBUTION.md` implementing the Lyrix MIT attribution mechanism (notice + per-file header rule), then verify the file documents the obligation required by `ROADMAP.md` §9.3.
- [x] 4.3 Update `AGENTS.md` → Setup & commands with only the commands actually executed in this change (install, lint, format check, typecheck, test, build) including what each proves and does not prove, then verify by re-running every listed command successfully.
- [x] 4.4 Add `.github/workflows/ci.yml` running lint → typecheck → unit tests → production build on push/PR to `main`, then verify the workflow invokes exactly the locally verified scripts (static inspection of the YAML against `package.json`).
- [x] 4.5 Update `ROADMAP.md` §5 milestone status table: `M0` → `IN PROGRESS`, then verify the table row renders correctly and no other milestone status changed.

## 5. Integration verification (M0 acceptance)

- [x] 5.1 From a clean checkout run the full gate sequence — clean install → lint → format check → typecheck → unit tests → production build — then verify every command exits 0 and record the results in the Apply PR.
- [x] 5.2 Verify M0 acceptance criteria: `frontend/docs/DESIGN.md` exists and is referenced from README; no auth/Supabase/database dependencies exist (`npm ls`/manifest inspection); no Lyrix source was copied wholesale; secrets are not exposed via `NEXT_PUBLIC_*`.
- [x] 5.3 After all acceptance criteria pass, update `ROADMAP.md` §5 `M0` → `DONE`, then verify the status table reflects `DONE` for M0 only and commit the final status update.
