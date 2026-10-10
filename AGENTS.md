# AGENTS.md

## Project overview

<!--
Describe the project explicitly. Do not make the agent guess the product,
architecture, purpose, or current state from repository files alone.

For brownfield, migration, preservation, reconstruction, or replacement
projects, describe what the existing implementation represents and what must
remain preserved during development.
-->

Spotivibe is an accountless, local-first, installable music Progressive Web App (PWA) with a Spotify-inspired interface, YouTube/YouTube Music discovery, and YouTube IFrame playback.

The project starts as a fresh Spotivibe codebase governed by `ROADMAP.md`; `frontend/docs/DESIGN.md` is the canonical UI/UX reference, and Lyrix (`aryanjsx/Lyrix`) is an external technical/reference implementation to study selectively rather than a repository to fork wholesale.

The target is a single Vercel-deployable Next.js application under `frontend/`, with server-only provider mediation through Next.js route handlers, provider-independent normalized domain models, a persistent YouTube player, IndexedDB-backed local user data, versioned JSON import/export, and PWA/offline-shell support; Spotivibe permanently excludes accounts, authentication, cloud sync, centralized user databases, YouTube audio extraction/download, and forced background-play circumvention.

<!--
Example for a migration / reconstruction project:

The existing Lyrix implementation is the reference implementation,
behavioral oracle, protocol specification, data corpus, content source, and
asset archive.

The migration path is:

    Lyrix reference behavior + Spotivibe ROADMAP.md + frontend/docs/DESIGN.md
        →
    Spotivibe-owned normalized adapters, fixtures, and selectively refactored Lyrix concepts
        →
    Spotivibe-owned accountless local-first Next.js PWA with no runtime dependency on Lyrix

Do not treat the legacy repository as disposable code.

Remove or adapt this paragraph when the project is not a migration,
reconstruction, preservation, or brownfield project.
-->

---

## Stack

<!--
List it explicitly. Don't make the agent guess or infer from package.json,
go.mod, Dockerfiles, etc. alone.

Remove fields that do not apply and add project-specific fields when required.
Pin versions when exact versions matter.
-->

- Language(s): TypeScript, TSX, JavaScript where framework/tooling requires it, CSS, Markdown.
- Framework(s): Next.js + React; exact versions are not yet pinned/verified.
- Runtime(s): Browser/PWA client and Vercel-compatible Node.js serverless runtime for Next.js route handlers; exact Node.js version is not yet pinned/verified.
- Frontend / client: Next.js App Router under `frontend/`, React components, Zustand application state, IndexedDB local persistence, service worker/PWA shell, and `frontend/docs/DESIGN.md` as the canonical UI/UX specification.
- Backend / server: Next.js route handlers/serverless functions only by default; no standalone Express server unless `ROADMAP.md` is explicitly amended.
- Database / storage: IndexedDB is canonical for user-owned data; Cache API/service-worker caches for PWA assets/metadata; `localStorage` only for tiny boot-time preferences where appropriate; no cloud user database.
- ORM / data access: No ORM planned; repository abstractions isolate IndexedDB and backup/import persistence details from components.
- Package manager: **npm** (selected and verified during M0; lockfile `frontend/package-lock.json`; no pnpm/yarn/bun lockfiles).
- Build tooling: Next.js/TypeScript build pipeline under `frontend/`; ESLint (`npm run lint`), Prettier (`npm run format:check`), strict TypeScript (`npm run typecheck`), zod-based environment validation, Vitest (`npm test`), and GitHub Actions CI (`.github/workflows/ci.yml`) — all selected and verified during M0.
- Testing: Vitest is the selected unit test runner (verified in M0). Integration, provider/parser, persistence/migration, player/queue, and release-critical browser/E2E coverage are required by the roadmap and are **not yet added**.
- Infra / deploy: Vercel Hobby/free hosting target for the single Next.js application; client-side local storage/personalization is used to minimize server infrastructure.
- External services: YouTube IFrame Player API; YouTube Music Innertube (primary discovery); YouTube Web Innertube, Invidious, and Piped as fallbacks; no baseline YouTube Data API key; optional Sentry is deferred and non-required.
- Specification workflow: OpenSpec
- Optional later infrastructure: Only roadmap-approved non-account infrastructure such as optional error monitoring or additional media/provider adapters; accounts, authentication, cloud sync, Supabase user storage, centralized user profiles, and cross-user collaborative filtering are permanently out of scope.

<!--
For migration / brownfield projects, additional fields may include:

- Legacy server:
- Legacy storage:
- Legacy client:
- Modern client:
- Compatibility layer:
- Target server:
- Target database:
-->

---

## Architecture rules

<!--
Define durable architectural constraints here.

Keep rules explicit. Do not rely on the agent to infer architectural boundaries
from the current implementation alone.

Replace the placeholders below with project-specific architecture rules.
Remove only rules that genuinely do not apply.
-->

- Follow the project's primary architectural sequence: **ROADMAP/OpenSpec requirements + `frontend/docs/DESIGN.md` → explicit domain contracts → local repository/provider abstractions → normalized state/services → feature UI → verification against roadmap acceptance criteria**.
- Keep the existing/reference implementation operational until its required behavior has verified replacements when performing migration or replacement work.
- Do not rewrite multiple major system boundaries simultaneously unless the approved change explicitly requires it.
- `Frontend component/feature` code must depend on `Spotivibe domain/service/repository interfaces`, never directly on `raw Innertube/Invidious/Piped response shapes, Lyrix internals, or IndexedDB implementation details`.
- Build `normalized Spotivibe adapters/fixtures that capture the required reference behavior` before `the final Spotivibe-owned provider/player/feature implementation` when staged replacement is required.
- Preserve externally meaningful IDs; modern storage may add internal IDs but must retain `providerId (including the YouTube video ID for YouTube-sourced tracks)` where compatibility requires it.
- Separate static definitions from runtime/player/entity state where applicable, e.g. `Track/Playlist domain records` vs `PlayerState/QueueState/runtime playback state`.
- Production server actions are authoritative when the architecture is server-authoritative: clients send intent, never trusted resource/XP/HP/result deltas.
- Standard HTTPS/JSON is the default for ordinary request/response APIs. Add WebSockets or another real-time transport only for genuinely real-time behavior.
- Archived/reference assets or runtimes may remain under preservation paths but must never silently become modern runtime dependencies.
- Keep transport, domain logic, persistence, and presentation boundaries explicit.
- Do not bypass an established abstraction merely because direct access is easier.
- Avoid shared mutable global state unless explicitly required and documented.
- Cross-cutting services must stay focused on their defined responsibility.

<!--
Keep or adapt this example for authoritative systems.
Remove it if the project does not use an authoritative server.
-->

```python
# Good: client sends intent.
perform_action(actor_id, action_id, target_id)

# Bad: client dictates authoritative outcome.
apply_client_state(resource=999999, progress=5000)
```

---

## Setup & commands

<!--
Document commands that were actually executed successfully for this repository.

Do not invent commands.

Replace every placeholder below with verified commands as the project develops.
Delete sections that genuinely do not apply.
-->

Current entry point:

```bash
# Development server — run from the repository root
npm run dev
# Serves http://localhost:3000 (falls back to the next free port if 3000 is busy)
# Proxies to `npm --prefix frontend run dev`; see "Root-level commands" below.
```

Current dependency manifest / install command:

```bash
# Clean dependency install from the lockfile — run from the repository root
npm run setup       # proxies to `npm --prefix frontend ci`
# The only lockfile is frontend/package-lock.json. Do not run `npm install` at the
# root: the root manifest declares no dependencies, so that would create a second
# lockfile that nothing installs from.
```

Current baseline syntax / compile check:

```bash
# Static type check and production build — run from the repository root
npm run typecheck   # proxies to: next typegen && tsc --noEmit (strict mode)
npm run build       # proxies to: next build (production build + framework type checking)
```

Project runtime prerequisite (verified 2026-10-01 on Windows, under Node 24):

```bash
node --version      # v24.21.0
npm --version       # 11.19.0
```

CI uses Node 24 on `ubuntu-latest` (`.github/workflows/ci.yml`). Development
environment: Windows/PowerShell locally. Port 3000 may be occupied by another
process; `next dev` then selects the next free port.

Important:

- The supported development/runtime environment is `Node.js 24.x with npm (lockfileVersion 3) and Next.js 16.3.6, targeting current evergreen desktop/mobile browsers and Vercel serverless deployment`.
- **Node 24 is the target because it is what Vercel can build.** Vercel's available build and function runtimes are 24.x (default), 22.x, and 20.x; `engines.node`, the CI workflow, and that set are asserted to agree by `tests/deployment-contract.test.ts`, which proves itself by rejecting Node 26 — the pin this replaced, and one Vercel offers only in Sandboxes. Changing one of the three without the others fails a check.
- Executed dependency/package consistency check: `npm run setup` (re-executed successfully 2026-10-01 under Node 24; installs from `frontend/package-lock.json` with 445 packages audited, 0 vulnerabilities reported). An earlier execution on 2026-09-27 reported 386 packages.
- Run risky, state-mutating, legacy, or preservation checks in an appropriate disposable environment when required.
- No verified automated test, lint, type-check, build, or runtime command exists unless it is explicitly listed in this section.
- Do not invent commands in this file.
- When new tooling is added, update this section only with commands that were actually executed successfully.
- Document what each verification command proves and what it explicitly does **not** prove.
- Do not convert a successful syntax/build command into a claim that behavior or tests passed.

<!--
Add verified project-specific tool commands below.

Repeat the following pattern for each important tool, validator, migration
utility, generator, test suite, asset processor, schema checker, etc.

Do not retain examples that do not apply to the project.
-->

### Root-level commands

A `package.json` at the repository root proxies the application's commands, so they run
without a `cd frontend`. It is `private` and declares **no dependencies**: the application
package in `frontend/` remains the only manifest with a lockfile, and this is not a workspace.

```bash
npm run setup        # npm --prefix frontend ci   (the install path)
npm run dev          # npm --prefix frontend run dev
npm run build        # npm --prefix frontend run build
npm run start        # npm --prefix frontend run start
npm run lint         # npm --prefix frontend run lint
npm run format       # npm --prefix frontend run format
npm run format:check # npm --prefix frontend run format:check
npm run ps:check     # npm --prefix frontend run ps:check
npm run typecheck    # npm --prefix frontend run typecheck
npm test             # npm --prefix frontend test
npm run gate         # lint -> format:check -> ps:check -> typecheck -> build -> test
```

`tests/root-commands.test.ts` holds the root manifest to these properties: private, no
dependencies, no workspace, no second lockfile, every required script present, each proxying
into `frontend/`, each naming a script the application actually defines, and the same declared
Node major as the application. The `format` check is deliberately strict — a root `format` that
called prettier itself, rather than the application's own script, would look identical to a
correct one and silently format the wrong tree.

**The gate builds before it tests, and that order is load-bearing.**
`tests/motion-budget.test.ts`'s size rules need a build report and skip without one, so
`test`-before-`build` made every local gate run report a file whose headline is a budget
as green while six of its rules never executed. This is the same defect `ci-workflow.test.ts`
asserts against in `.github/workflows/ci.yml`; it was fixed in the archived release gate and in
CI, and then left in place in this script. Measured both ways by moving `.next` aside: **21
passed with a build, 15 passed and 6 skipped without one.**

**Do not run `npm install` at the repository root.** The root manifest has no dependencies, so
npm would create a root `package-lock.json` and a root `node_modules` that nothing installs
from. npm cannot be told to refuse this; use `npm run setup`.

### Verified project tool: `frontend/` quality gates (npm scripts)

Verified on `2026-09-27` (Windows local), and re-verified on `2026-10-01` under **Node 24**
after the runtime correction. Commands run from the repository root, with or without the root
proxies:

```bash
npm run setup        # clean install from frontend/package-lock.json (was `cd frontend && npm ci`)
npm run lint         # eslint (flat config, eslint-config-next)
npm run format:check # prettier --check .
npm run ps:check     # node scripts/powershell-parse-check.mjs
npm run typecheck    # next typegen && tsc --noEmit
npm test             # vitest run
npm run build        # next build
npm run icons:check  # node scripts/generate-icons.mjs --check
npm run dev          # next dev (dev server; verified serving HTTP 200)
```

`ps:check` is a **static-parse** check, not a formatting one, and it exists because of a measured gap.
`scripts/gate-batch/run-gate-batch.ps1` — the script that drives the gate batch — was read by no gate
step: ESLint returned **exit 0** for it carrying `File ignored because no matching configuration was
supplied`, and `prettier --check .` never asked about it at all, because Prettier has no parser for
`.ps1`. `ps:check` parses every tracked `.ps1` with PowerShell's own `[Parser]::ParseFile`, which ships
with every PowerShell and so adds no dependency and no install step to CI. It asserts **syntax only** —
it is a floor, not a substitute for the behavioural cases in `frontend/tests/gate-batch-apparatus.test.ts`,
and it says so on every run rather than leaving the reader to assume more.

**It reports rather than passes when no interpreter is found.** With neither `pwsh` nor `powershell` on
`PATH` the step prints `ps:check NOT RUN` with the reason and exits 0. That is not a silent pass:
`frontend/tests/gate-coverage.test.ts` records `.ps1` as covered *by this step*, so deleting the step
fails the coverage guard instead of leaving the file unchecked. The guard is what converts M29's
documented gap into a checked one — a limitation stated in prose is a limitation nobody re-reads.

`icons:check` is a **build-input** check, not a formatting one: it verifies the checked-in
`public/icons/*.png` match what `scripts/generate-icons.mjs` would produce, so a change to the icon
script cannot ship without the regenerated files. It is item 7 of the release gate. It was absent
from this list until M21, which is the same defect the whole milestone is about: a command that
exists, runs, and gates releases, documented nowhere.

**`icons:check` is documented and verified but is in neither `npm run gate` nor CI**, unlike `ps:check`
which M30 put in both. It therefore has the exact weakness this change exists to close, and closing it
would mean adding it to both — recorded here rather than absorbed, because it is outside M30's approved
scope and touching it would widen the change silently.

**Order matters, and one of the orderings is load-bearing.** In CI the production build runs
**before** `npm test`. `tests/motion-budget.test.ts` has two halves: its manifest and import rules
run unconditionally, and its **size** rules need a build report and skip without one. With the tests
first, those size rules skipped on every CI run and the job reported green for a file whose headline
is a budget. Measured both ways by moving `.next` aside: **21 passed with a build, 15 passed and 6
skipped without one.** `tests/ci-workflow.test.ts` asserts the ordering so it cannot silently
regress.

The cost of that ordering is real and is not hidden: a red pull request now spends a few minutes of
CI on a build whose result nobody reads, because the build runs before a failing test can stop the
job.

Exit codes: `npm run setup` (install), `npm run lint`, `npm run format:check`, `npm run ps:check`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run icons:check` ("icons match the generator") each exited `0`; `npm run dev` started successfully and served HTTP 200 before being stopped manually. `.github/workflows/ci.yml` runs the install, `lint`, `format:check`, `ps:check`, `typecheck`, `build`, and `test` steps in `frontend/` on push/PR to `main`, on Node 24. The build precedes the tests deliberately; see above for why, and for what it costs.

These commands establish `that dependencies install from the lockfile, ESLint reports no errors, formatting is consistent, strict TypeScript compiles, the current unit tests pass, a production Next.js build succeeds, and the dev server starts and serves the app`.

They do **not** establish `that product features behave correctly, that provider/player/persistence flows work (not yet implemented), that end-to-end or browser tests pass (test suites not yet added), that the CI workflow itself has run green on GitHub (first run happens when this branch's PR is opened), or that a Vercel deployment succeeds`.

<!--
Duplicate the "Verified project tool" section as required.

Examples of things that may deserve separate entries:

- unit tests
- integration tests
- E2E/browser checks
- schema generation
- schema validation
- API contract validation
- migration checks
- asset registry tools
- asset conversion tools
- replay tools
- state-diff tools
- data normalization tools
- content validation
- protocol catalog validation
- code generation
- static analysis
- package integrity checks
- deployment validation

---

### Verified project tool: the gate-batch corroborator

`frontend/scripts/gate-batch/` holds two scripts that `npm run gate` does not cover, and that this file
documented nowhere until M29:

- `run-gate-batch.ps1` runs `npm run gate` N times, writes `run1.log`…`runN.log`, and prints a run table.
- `verify-gate-batch.mjs` reads those logs and asserts the batch really is N consecutive green runs of one
  unchanged tree — distinct logs, markers present, 0 NUL bytes, 0 U+FFFD, one commit, agreed figures.

Verified 2026-10-10 (Windows local). The checker runs **once per batch**, after the driver has produced
the logs — never once per gate run.

**Run the command the driver prints, verbatim.** It now carries `--expect-files <N> --expect-budget <N>`
bound to the figures the driver had just measured, so it cannot drift from the batch it describes:

```bash
powershell -File run-gate-batch.ps1 -LogDir <directory> -Runs 6
# ... then the command the driver prints as its last line ...
```

Omitting `--expect-*` is **no longer wrong**, but it is weaker, and a green verdict says so. With no figure
stated, the checker derives the expectation from the batch and additionally checks the file count against
the live tree via `vitest list --filesOnly`. That cross-check is an **equality, not a lower bound**:
`--filesOnly` prints one line per *file*, whereas plain `vitest list` prints one line per *template* and is
a lower bound by construction, because `.each(` call sites expand only at run time.

**There is no live-tree equivalent for the motion-budget count**, so with nothing stated it is asserted for
*stability only* — the logs agreeing with each other — and the verdict reports that honestly.

Reading a green verdict:

- `what was asserted: …` names which of those paths ran. Read it; do not assume it covered everything.
- The executed-test total is **reported and never asserted**, because it moves whenever the suite gains a
  test and has no exact live-tree equivalent.

**The accepted limitation:** equality on a file count is weaker than equality on a commit, so a batch from
a different commit with the same number of test files would pass. The logs record their commit and the
commit-agreement check refuses a batch spanning two, so this asserts tree-*shape* agreement, not commit
agreement.

**Do not reintroduce a literal default.** The checker used to fall back to `182` / `21` — the M21 tree.
That default was stale by construction and cost four sessions a manual override, because no documented
source recorded the required flags. A figure stored in the script is a snapshot of whatever tree it was
written on; read it at check time instead. `gate-batch-apparatus.test.ts` asserts this negatively.

**The `.ps1` driver now has a static gate.** This paragraph previously read *"These scripts have no static
gate"*, and that was correct — but `verification-integrity` requires a stated coverage limitation to be a
**checked** fact rather than a comment that can go stale, and a paragraph in a documentation file is the
comment. M29 wrote it; M30 discharged it.

`run-gate-batch.ps1` is now parsed by `npm run ps:check`, which is in `npm run gate` and in CI, and
`tests/gate-coverage.test.ts` asserts that it is covered *by that step* — so deleting the step fails the
guard rather than quietly leaving the file unread. What is still true, and is now checked rather than
asserted: `tsconfig.json` includes only `.ts`/`.tsx`/`.mts`, and neither ESLint nor Prettier handles `.ps1`
— ESLint returns exit 0 for it carrying `no matching configuration`, which is the false green the guard
exists to catch. Behaviour remains covered by the cases in `gate-batch-apparatus.test.ts`, which **skip
with a stated reason** where no interpreter is present. A skip is reported as a skip, never as a pass.

These commands establish `that the logs form a batch of N distinct green runs of one commit, and that the
figures in them agree with each other and with the expectation in force`.

They do **not** establish `that npm run gate itself passes` (the batch is evidence of that, not a
substitute for reading it), `that the batch measured the merge commit` (compare trees yourself —
`run-gate-batch.ps1` labels HEAD but runs in the **working tree**, so commit first), or `that a skipped
PowerShell case passed`.
-->

---

## Code style

<!--
Keep durable repository-wide style rules here.
Add language/framework-specific rules when needed.
-->

- Prefer small domain modules over giant dispatchers or god objects.
- Use explicit names and domain types; avoid untyped dictionaries/objects crossing modern domain boundaries.
- Keep transport, domain logic, persistence, and presentation separate.
- Prefer pure functions for reusable calculations where practical.
- Handle failures explicitly; never silently swallow exceptions.
- Do not leave dead compatibility code after its replacement is verified and the related migration explicitly retires it.
- Use consistent import conventions in new application packages.
- Keep scenes/components/modules focused; do not create giant global managers.
- Limit global/autoload/singleton services to genuine cross-cutting concerns such as `the persistent YouTube player bridge`, `the YouTube IFrame API loader`, `network-state monitoring`, `service-worker/PWA update coordination`, `bounded provider request deduplication/caching`, and `application diagnostics/logging`.
- Match the existing formatter/linter conventions when they are already established.
- Prefer existing project abstractions over introducing parallel competing patterns.
- Avoid speculative abstractions that are not needed by the active task.
- Keep public interfaces small and explicit.
- Prefer composition over deep inheritance unless the framework or domain clearly benefits from inheritance.
- Keep framework-specific code at system boundaries where practical rather than spreading it through domain logic.

---

## Testing

- Every migrated or replaced legacy behavior must have a captured fixture or equivalent behavioral evidence before replacement when parity matters.
- Prefer golden fixtures containing `request`, `before`, `response`, and `after` state when applicable.
- Bug fixes require a regression test when the affected system has test infrastructure.
- Server-authoritative actions must test invalid ownership, insufficient resources, duplicate requests, stale revisions, and invalid state where applicable.
- Runtime/asset changes must not reintroduce retired or prohibited runtime dependencies.
- Run every relevant available check before finishing.
- Do not claim tests passed unless they were actually run.
- If a required check cannot be run, report exactly why.
- Never convert “code compiles” into “tests pass.”
- Test behavior at the narrowest useful layer first, then add integration/E2E coverage where system boundaries matter.
- Do not weaken existing tests simply to make a change pass.
- Do not delete failing tests without determining whether the implementation or the test is wrong.
- When a test is intentionally changed because behavior changed, ensure the approved requirement/specification supports that change.
- Verification evidence must distinguish automated tests, static checks, manual inspection, runtime checks, and inferred conclusions.

---

## Boundaries — do not touch

<!--
Keep universal safety boundaries and add project-specific protected areas.

For preservation projects, explicitly list source material that must never be
destroyed merely because replacements exist.
-->

- Never delete original/reference/source material merely because a replacement exists unless its retirement is explicitly approved.
- Never overwrite raw source assets during conversion; write generated/converted/runtime assets separately.
- Never silently drop unknown legacy/data fields during migration; preserve them for migration analysis when applicable.
- Never manually edit generated files under `.agents/skills/`.
- Never commit `.env`, `.env.*`, credentials, tokens, private keys, or production secrets.
- Never hardcode production secrets.
- Never package prohibited/retired runtimes or dependencies into the final application.
- Do not modify reference/legacy behavior merely to make modern implementation easier; document and reproduce it first when parity is required.
- Never modify generated artifacts by hand when a canonical generator owns them.
- Never bypass security boundaries for convenience.
- Never weaken authentication, authorization, validation, sandboxing, permission checks, or trust boundaries without explicit requirements.
- Never delete user data, migration data, production data, or preservation material as part of ordinary feature work.
- Do not modify CI/CD, deployment, infrastructure, security, or repository governance unless the active task requires it.
- Do not touch `ROADMAP.md, frontend/docs/DESIGN.md, Lyrix reference/attribution material, openspec/specs/, or openspec/changes/` unless the active task explicitly requires it.

---

## Change scope

- Make the smallest coherent change that satisfies the active task/OpenSpec change.
- Do not perform unrelated refactors or cleanup.
- Do not modify unrelated files.
- Do not upgrade dependencies without a concrete reason.
- Do not reorganize existing files during feature work unless the active change requires it.
- Use `git mv` when relocating preserved repository files where practical.
- Preserve existing behavior unless the task or approved spec explicitly changes it.
- Do not alter unrelated product behavior during parity, migration, or focused feature work.
- Prefer one domain/vertical slice at a time.
- Avoid “while I am here” changes.
- Separate required cleanup from optional cleanup.
- When additional work is discovered outside scope, record/report it rather than silently expanding the current change.
- Do not broaden an OpenSpec change simply because related opportunities are discovered during implementation.

---

## Migration order

<!--
Keep this section only when the project has an intentional migration,
reconstruction, modernization, or phased replacement sequence.

Replace the placeholders with the actual project migration order.
Delete this section only when the project genuinely has no phased sequence.
-->

Unless an approved OpenSpec change intentionally requires otherwise:

    M0 — repository foundation, documentation, and quality gates
        ↓
    M1 — DESIGN.md-driven design system and application shell
        ↓
    M2 — local-first IndexedDB persistence and versioned JSON backup/import
        ↓
    M3 — provider abstraction and multi-tier music discovery
        ↓
    M4 — persistent YouTube playback engine
        ↓
    M5 — search experience and result quality
        ↓
    M6 — queue, session persistence, and network recovery
        ↓
    M7 — local library, liked songs, and playlists
        ↓
    M8 — Home/Discover, trending, languages, and curated surfaces
        ↓
    M9 — Artist/Album/Now Playing pages and related content
        ↓
    M10–M12 — radio/autofill, local personalization, history/stats/Smart Mixes, and podcasts
        ↓
    M13–M15 — PWA/offline metadata, hardening, full release validation, and Vercel deployment

The first major target is `M1 — a DESIGN.md-driven Spotivibe design system and application shell after M0 foundations`, not `deferred analytics, centralized AI infrastructure, paid cloud services, accounts, authentication, or cloud sync`.

---

## Git / PR workflow

`main` is the integration branch. Never perform planned work directly on `main`.

Every repository-mutating OpenSpec stage must use a remote branch and PR. Local-only working branches are not allowed.

### Branch naming

Branch names describe the technical work, not the raw OpenSpec change name.

- Proposal/docs: `docs/<technical-scope>-proposal`
- Feature: `feat/<technical-scope>`
- Fix: `fix/<technical-scope>`
- Refactor: `refactor/<technical-scope>`
- Tests/validation: `test/<technical-scope>`
- Technical spike: `spike/<technical-scope>`
- Spec sync: `docs/<technical-scope>-spec-sync`
- Archive: `chore/archive-<technical-scope>`

Examples:

- `docs/<technical-scope>-proposal`
- `feat/<technical-scope>`
- `fix/<technical-scope>`
- `docs/<technical-scope>-spec-sync`
- `chore/archive-<technical-scope>`

Do not use the OpenSpec change ID as the branch name unless it is also the clearest technical description.

### Branch lifecycle

Before starting any repository-mutating stage:

1. Check `git status`.
2. Switch to `main`.
3. Pull the latest `origin/main`.
4. Create a new branch from the updated `main`.
5. Immediately push the new branch to `origin` and set upstream tracking.
6. Only then begin modifying files.

Never leave active repository work only on a local branch.

Recommended pattern:

    git switch main
    git pull --ff-only origin main
    git switch -c <branch-name>
    git push -u origin <branch-name>

### OpenSpec Git lifecycle

#### Explore

`/openspec-explore` is normally read-only.

If no repository files change, no branch or PR is required.

If exploration intentionally modifies tracked documentation, treat it as a normal repository-mutating stage and use a branch + PR.

#### Propose

For `/openspec-propose`:

1. Start from updated `main`.
2. Create a technical proposal branch such as `docs/<scope>-proposal`.
3. Immediately push the branch to `origin`.
4. Create/update the OpenSpec proposal, design, specs, tasks, and roadmap status.
5. Review the diff.
6. Commit using Conventional Commits.
7. Push all proposal commits to the remote branch.
8. Open a PR into `main`.
9. After required checks pass, merge the PR using a **merge commit**.
10. Delete the merged local and remote branch.
11. Return to `main` and pull the merged result before starting Apply.

Proposal artifacts should be committed and pushed so the exact remote PR diff can be reviewed.

Do not reuse the proposal branch for Apply.

#### Apply

For `/openspec-apply-change`:

1. Ensure the proposal PR has already been merged.
2. Return to `main`.
3. Pull the latest `origin/main`.
4. Create a new implementation branch from `main`.
5. Immediately push the new branch to `origin`.
6. Apply only the approved OpenSpec tasks.
7. Commit coherent implementation steps using Conventional Commits.
8. Push commits regularly to the remote branch.
9. Run all required verification.
10. Review the final diff and test results.
11. Open or update the PR into `main`.
12. Merge after required checks pass.
13. Merge using a **merge commit**.
14. Delete the merged local and remote branch.
15. Return to updated `main`.

Do not reuse the proposal branch for Apply.

Do not begin Sync or Archive from an unmerged Apply branch.

#### Sync

If `/openspec-sync` modifies repository files:

1. Ensure the Apply PR has already been merged.
2. Return to `main` and pull latest `origin/main`.
3. Create `docs/<scope>-spec-sync`.
4. Immediately push it to `origin`.
5. Run the approved OpenSpec sync.
6. Review the diff.
7. Commit using Conventional Commits.
8. Push the commit(s).
9. Open a PR into `main`.
10. Merge using a **merge commit** after required checks pass.
11. Delete the local and remote branch.
12. Return to updated `main`.

Skip this stage when no spec synchronization is required.

#### Archive

For `/openspec-archive`:

1. Archive only after Apply and any required Sync are merged.
2. Return to `main`.
3. Pull latest `origin/main`.
4. Create `chore/archive-<technical-scope>`.
5. Immediately push the branch to `origin`.
6. Run the OpenSpec archive workflow.
7. Update Project Status, roadmap references, and archive links where required.
8. Review the diff.
9. Commit using Conventional Commits.
10. Push the archive commit(s).
11. Open a PR into `main`.
12. Merge after required checks pass.
13. Merge using a **merge commit**.
14. Delete the local and remote branch.
15. Return to `main` and pull latest `origin/main` before beginning the next roadmap phase.

### Commit conventions

Use Conventional Commits:

- `feat:` new product capability
- `fix:` bug fix
- `refactor:` behavior-preserving restructuring
- `test:` tests or technical validation
- `docs:` documentation/specification
- `chore:` repository/tooling/archive maintenance

Examples:

- `docs: propose <technical scope>`
- `test: add <technical validation>`
- `feat: add <product capability>`
- `fix: prevent <bug>`
- `docs: sync <technical scope> requirements`
- `chore: archive <technical scope>`

Keep commits coherent and scoped.

Do not bundle unrelated changes into one commit.

### PR / merge conventions

- Every Propose, Apply, Sync, and Archive stage that changes repository files must go through a PR into `main`.
- Never silently commit completed stage work directly to `main`.
- Keep one coherent OpenSpec stage per branch.
- Open the PR from the remote branch, not from local-only work.
- Use **merge commits only** for OpenSpec and development PRs.
- Do **not** squash merge.
- Do **not** rebase merge.
- Preserve branch topology and individual branch commits in Git history.
- When using GitHub CLI, merge with:

      gh pr merge <PR_NUMBER> --merge --delete-branch

- Do not use:

      gh pr merge <PR_NUMBER> --squash

  or:

      gh pr merge <PR_NUMBER> --rebase

- Do not replace the default GitHub merge-commit title unless there is a specific reason.
- Prefer preserving the normal GitHub merge message, for example:

      Merge pull request #123 from owner/feat/<technical-scope>

- Delete local and remote branches only after the PR has successfully merged.
- The PR and merge commit are the permanent historical record after branch deletion.
- Never begin the next OpenSpec stage from an unmerged branch.
- After every merge, switch back to `main` and update it from `origin/main` before creating the next branch.

### Expected OpenSpec branch flow

For one OpenSpec change, the normal flow is:

    main
      │
      ├── docs/<scope>-proposal
      │      ↓ push remote immediately
      │      ↓ /openspec-propose
      │      ↓ commit + push
      │      ↓ PR
      │      ↓ merge commit
      │
      ├── feat|spike|test/<scope>
      │      ↓ push remote immediately
      │      ↓ /openspec-apply-change
      │      ↓ implementation
      │      ↓ verification
      │      ↓ commit + push
      │      ↓ PR
      │      ↓ merge commit
      │
      ├── docs/<scope>-spec-sync
      │      ↓ only if sync is required
      │      ↓ /openspec-sync
      │      ↓ PR
      │      ↓ merge commit
      │
      └── chore/archive-<scope>
             ↓ /openspec-archive
             ↓ update roadmap/status
             ↓ PR
             ↓ merge commit
             ↓ delete branch
             ↓ return to updated main

### Git safety

- Check `git status` before significant work.
- Inspect `git diff` before every commit.
- Inspect the final diff before opening a PR.
- Never discard existing user changes.
- Never force-push unless explicitly authorized.
- Never use destructive Git operations unless explicitly authorized.
- Never rewrite history unless explicitly authorized.
- Never merge a PR with failing required checks unless explicitly authorized.
- Never claim a branch was pushed, a PR was opened, or a merge occurred unless it actually happened.

---

## Source of truth

When deciding what the project should do, use this order:

1. Explicit user/task requirements
2. `ROADMAP.md` for product scope, architectural constraints, milestone order, and accepted/rejected features
3. `frontend/docs/DESIGN.md` for canonical UI/UX and visual behavior
4. Approved active OpenSpec change
5. `openspec/specs/`
6. Existing implementation and tests
7. Lyrix/reference behavior and other repository documentation
8. Agent assumptions

When sources conflict, investigate the conflict. Do not silently invent a resolution.

For preservation/parity work, observed reference behavior is evidence; an accidental implementation difference is not automatically an improvement.

<!--
If the project is greenfield and has no legacy/reference behavior, adapt item 4
to the appropriate project authority, for example:

4. Approved product/design/API contracts

Do not silently alter the precedence without documenting it here.
-->

---

## Existing / brownfield project rules

<!--
Keep this section for any existing project.

Replace project-specific file/path examples with the repositories' important
implementation surfaces.
-->

Before modifying an existing capability:

- Inspect its implementation.
- Search `ROADMAP.md, frontend/docs/DESIGN.md, frontend/src/app/, frontend/src/components/, frontend/src/features/, frontend/src/server/music/, frontend/src/data/, frontend/src/stores/, frontend/src/types/, frontend/tests/, openspec/specs/, and openspec/changes/` as applicable.
- Read the relevant OpenSpec spec/change.
- Check `openspec/changes/` for active work.
- Identify the current request → state mutation → response/output behavior.
- Capture or locate behavioral fixtures before replacing existing behavior when parity matters.
- Do not assume undocumented means unused.
- Do not rewrite working systems merely because they are unfamiliar.
- Classify obscure systems explicitly as implemented, parity-verified, retired, deprecated, experimental, or out-of-scope.
- Identify consumers before changing public interfaces.
- Search for tests, documentation, migrations, fixtures, generated code, and external contracts connected to the capability.
- Preserve backwards compatibility when required by the active specification.
- Distinguish accidental implementation details from externally observable behavior before reproducing them.

---

## Spec-driven development — OpenSpec

This project uses OpenSpec for nontrivial behavioral and architectural changes.

Expected structure:

    openspec/
    ├── config.yaml
    ├── specs/
    └── changes/

Rules:

- Check `openspec/changes/` before starting nontrivial implementation.
- Continue an existing relevant change instead of creating a duplicate.
- Read the relevant `openspec/specs/` capability before modifying it.
- Create/propose a change before implementing new nontrivial behavior when no appropriate change exists.
- Keep implementation aligned with the active change's requirements, design, and tasks.
- If implementation reveals a missing or incorrect requirement, update the change instead of silently diverging.
- Do not expand an active change with unrelated work.
- Sync approved behavior back into main specs and archive completed changes using the installed OpenSpec workflow.
- Do not manually edit generated `.agents/skills/`; use `openspec update` when regeneration is required.

Typical workflow:

    Explore → Propose → Apply → Verify → Sync → Archive

Use exploration for investigation only; it is not permission to implement.

OpenSpec owns feature requirements and change artifacts. This file owns durable repository-wide engineering rules.

---

## Reconstruction workflow

<!--
Keep this section for migrations, reconstructions, compatibility projects,
rewrites, preservation projects, or staged replacement work.

For ordinary greenfield projects, rename this section to "Implementation
workflow" and adapt the steps without removing verification discipline.
-->

For each migrated/reconstructed/replaced feature:

    1. Inspect the existing/reference implementation and related resources.
    2. Identify interfaces/endpoints/state/dependencies involved.
    3. Capture or locate reference fixtures/evidence when applicable.
    4. Read/create the OpenSpec change.
    5. Implement the smallest complete behavior.
    6. Add/update tests.
    7. Replay/compare against reference behavior when parity matters.
    8. Perform visual/runtime verification when relevant.
    9. Update migration/project status and documentation.
    10. Inspect diff and report checks actually run.

Do not mark an existing/reference feature replaced until parity has been verified or an approved spec explicitly changes its behavior.

---

## Orchestration mode

For nontrivial OpenSpec changes, the root Codex agent acts as the orchestrator.

- Use real Codex subagents when work can be divided into concrete, independent tasks without overlapping file ownership.
- The root orchestrator owns the active OpenSpec artifacts and task status.
- Implementation subagents must not independently edit `proposal.md`, `design.md`, specs, or `tasks.md` unless explicitly assigned that responsibility.
- Assign each worker a bounded task, owned files/directories, requirements, dependencies, and required verification.
- Do not parallelize tasks that depend on unfinished interfaces or behavior.
- Do not have multiple agents edit the same files unless intentionally coordinated.
- Worker agents must report files changed, checks run, results, and unresolved concerns.
- The root orchestrator must review worker diffs/results before accepting them.
- After implementation, use a separate verification pass or verifier subagent to compare the actual implementation against the active OpenSpec artifacts.
- Do not trust checked task boxes as evidence; inspect the implementation.
- Run OpenSpec strict validation and the installed OpenSpec verification workflow before considering the change complete.
- Any unresolved CRITICAL verification issue blocks completion.
- Any unresolved WARNING blocks completion unless explicitly accepted by the user or active specification.
- If verification fails, create bounded repair tasks, delegate when useful, then rerun verification.
- Only the root orchestrator may declare the OpenSpec change complete.
- Worker subagents should not spawn additional subagents unless the root explicitly authorizes nested delegation.

### Subagent

- Default to at most two active subagents per root session.
- Preferred roles are:
  1. implementation agent
  2. verification agent
- The root agent remains the orchestrator and owns OpenSpec artifacts, architectural decisions, integration, and final acceptance.
- Do not spawn additional agents merely because work can technically be parallelized.
- Prefer sequential delegation when the verifier depends on implementation output.
- Spawn additional agents beyond this default only when the task has clearly independent workstreams and the expected benefit outweighs duplicated context/token cost.
- Give subagents only the context necessary for their assigned task; do not require every subagent to rediscover the entire repository.

### OpenSpec bootstrap and resume

The root orchestrator must support both bootstrap and resume workflows.

Before creating a new OpenSpec change:

- Inspect `openspec/changes/` and the project status recorded in the development roadmap.
- If a relevant active change already exists, resume it instead of creating a duplicate.
- If a completed but unverified or unarchived change exists, finish its verification/lifecycle before creating another dependent change.
- If no active change exists, use the development roadmap and current repository state to determine the smallest coherent next change.
- Use OpenSpec exploration before proposing a new change when repository investigation, existing/reference behavior, architecture, dependencies, or scope need confirmation.
- Exploration must not implement code.
- After exploration is sufficiently resolved, create the change with the installed OpenSpec propose workflow.
- Validate the generated change before implementation.
- Do not create an OpenSpec change for the entire development roadmap. The roadmap is the program-level plan; OpenSpec changes are bounded implementation units.
- Do not skip ahead to a later roadmap milestone while required exit criteria or dependencies of the current milestone remain incomplete.
- Default to completing one OpenSpec change per orchestration run unless the user explicitly requests continuous milestone execution.

### Development roadmap ownership

The development roadmap contains a root-orchestrator-owned milestone status table.

- Only the root orchestrator may update the roadmap's milestone status table.
- Implementation and verification subagents must not modify the roadmap unless explicitly assigned.
- Treat the status block as a progress ledger, not as the behavioral source of truth.
- OpenSpec specs and active change artifacts remain the source of truth for specified behavior.
- Repository implementation and tests provide implementation evidence.
- Reconcile the roadmap status against Git, OpenSpec, and the repository before trusting stale status from a previous session.
- Update project status whenever the active change enters a meaningful lifecycle transition: proposed, implementing, verifying, blocked, verified, archived, or completed.
- Record blockers and unresolved verification findings rather than hiding them.
- After archiving a verified change, update the roadmap cursor to the next eligible objective but do not automatically begin that change unless the current orchestration request allows it.
