# Design: Home, discovery, trending, languages, and curated surfaces

## Context

See `proposal.md` — Why. Current state that constrains the approach:

- `/` is the M1 placeholder server component; `tests/routes.test.tsx` asserts its exact skeleton/empty copy.
- `Preferences` (`languages`, `onboardingComplete`, …) and `ListeningEventRecord` (`context: "home"` already exists) are fully implemented in `data/` and wired into backup, but **nothing reads or writes them** outside the backup/import code.
- Providers expose exactly one capability — `search(query)` — plus playlist resolution. There is no browse/chart/genre/artist endpoint, and `SearchRequest` carries no language or category parameter. `WEB_REMIX_CONTEXT` hardcodes `hl: "en"`, `gl: "US"`.
- `Track.language?` exists in the domain model but is never populated.
- `QueueSource` already includes `"browse"` and `QueueView` already labels it `From browse`; `ListeningContext` already includes `"home"`.
- DESIGN.md prescribes horizontal card carousels (5-column square tracks, 5-column circular artists, 32–48px section spacing) and a geometry rhythm where two circular or two square sections are never adjacent. There is **no** rail/shelf primitive in the codebase and `AlbumCard`/`ArtistCard` accept no artwork URL.
- `tests/architecture.test.ts` pins exact whitelists (7 IndexedDB stores, 6 backup datasets) and repository-mediated access for the M7 features; new M8 code must satisfy its detectors.

## Goals / Non-Goals

**Goals**

- One additive server capability (discovery feed) reusing the existing tier chain, limiter, dedupe, and cache.
- Deterministic, testable feed composition: seeds, per-seed failure tolerance, language attribution, interleaving.
- Local-only personalization: language choices, likes, history, and derived taste seeds never leave the device beyond request parameters.
- Home/Discover degrade per shelf: loading, empty, error-with-retry, and offline states, never a blank page.
- Additive rollout: no new dependency, no IndexedDB store, no schema migration, no backup dataset.

**Non-Goals (deliberate, with owner milestone)**

- Official charts or any ranking claim (M8 forbids the claim; a real chart source would be a separate approved change).
- Artist/album pages and artist-route navigation — M9. M8 artist entries refine search (existing M5 behavior).
- Track/Artist Radio, queue autofill, deep taste scoring, diversity heuristics beyond language mixing — M10.
- Smart Mix identity/refresh semantics, meaningful-play thresholds, stats, streaks, retention/compaction — M11. M8 ships a gated preview.
- Podcast category-accurate filtering in the shared server filter pipeline — M12.
- Offline app shell / service worker (the M7 evidence already documents that offline `<Link>` navigation fails without one) — M13.
- The DESIGN.md sidebar footer globe/language dropdown: languages are reachable through first-run onboarding and Settings; the footer variant is polish for a later milestone (documented, not silent).

## Decisions

### 1. Query-driven seeds, not a browse/chart provider call

**Decision.** Every non-local shelf is produced by executing curated static seed queries through the existing `runChain`.

**Why.** ROADMAP M8 mandates provider queries instead of claiming a chart, and no tier exposes a browse capability today. Adding one would mean new undocumented Innertube surfaces per tier plus a chart claim the product may not make.

**Alternatives considered.** (a) YT Music `browse`/charts endpoints — undocumented, unstable, and implies an official chart claim. (b) Curated public playlist IDs resolved via the M7 playlist resolver — richer shelf metadata but depends on third-party playlist IDs staying public; graceful failure exists but shelves would silently rot. Rejected as fragile primary mechanism.

### 2. Server composes seeds; the client fetches one shelf at a time

**Decision.** `GET /api/discover?kind=…&languages=…&seeds=…` composes a *single* feed server-side (bounded seeds, per-seed chain execution, merge/dedupe, language stamping, short TTL cache). The Home surface issues one request per shelf with its own `AbortController`.

**Why.** Server-side composition shares the outbound limiter, in-flight dedupe, and cache across every client, and keeps the seed catalog server-owned. Per-shelf client requests give the per-shelf loading/empty/error isolation the acceptance criteria demand; a single aggregated page request would let one slow or failing feed stall or break the page.

**Alternatives considered.** (a) Client firing N `/api/search` calls — N browser→server→provider hops, no shared dedupe/cache, no per-seed language attribution, unbounded fan-out. (b) One server-rendered Home aggregating every feed — best first paint, but violates per-shelf resilience and the client is already a client-rendered app.

### 3. Language attribution comes from the seed, not from track metadata

**Decision.** The server stamps `Track.language` with the language code of the seed that produced each result. Providers expose no reliable per-track language, so inference from artist/title text would be guesswork.

**Why.** Deterministic, testable, and honest: the spec says "the language code of the seed that produced them" rather than claiming ground truth. It also finally populates the declared-but-unused `Track.language` field, which is what makes interleaving possible.

**Alternatives considered.** Provider `hl`/`gl` parameterization per language (would change provider request context globally and is unverifiable per result). Deferring until a provider exposes real language metadata.

### 4. Interleaving is a pure client function over `Track.language`

**Decision.** `interleaveByLanguage(tracks, languages)` (round-robin across language buckets) runs in the client as a pure, unit-tested function.

**Why.** Presentation ordering is a UI concern; the API stays a stable, cacheable feed. Determinism is trivial to test and the function is reusable by Home, Discover, and future mixes (M10/M11).

**Alternatives considered.** Server-side interleaving (ordering would leak into cache keys and couple presentation to the API). Random shuffling (not deterministic; breaks the acceptance criterion's testability).

### 5. Preferences and listening history get dedicated client stores over existing repositories

**Decision.** Add `preferencesStore` (hydrate/save languages, `onboardingComplete`) and `historyStore` (record/list/clear via the existing repository). Event recording is wired by a small `useListeningRecorder` hook mounted in `AppShell`, subscribing to the player store's track changes — the same pattern as the existing session-persistence attach.

**Why.** No new IndexedDB store or backup dataset, so the `architecture.test.ts` whitelists stay untouched and M2's storage contract is unchanged. A hook avoids any store→store import, which the current architecture rules police for `queueStore`/`libraryStore`.

**Alternatives considered.** Reading preferences directly in components (violates repository-mediated layering in practice and re-hydrates per component). Recording inside `playerStore.playTrack` (creates a store→store dependency and mixes transport with history concerns).

### 6. Recording semantics: one event per track step, `secondsPlayed` at start

**Decision.** A listening event is recorded when playback starts a track that is not already the newest event's track, with `context` from the queue source. `secondsPlayed` starts at 0; completion/skip thresholds are explicitly M11.

**Why.** Recently Played needs identity, recency, and context — nothing more. Threshold semantics (what counts as a real play) is a product decision owned by M11 and would otherwise be invented here.

**Alternatives considered.** Updating a running event on every position tick (churn, and implies the M11 threshold model).

### 7. New shelf primitive; cards gain optional artwork

**Decision.** Add `components/recommendations/Shelf.tsx` (DESIGN.md horizontal rail: 5-column square grid, scrollable, compact section spacing, one `SectionHeader` per shelf) and extend `AlbumCard`/`ArtistCard` with an optional `artworkUrl` that renders a real image when present and keeps the existing placeholder otherwise. Home's section order is a typed list that the geometry-rhythm rule validates.

**Why.** DESIGN.md explicitly prescribes horizontal carousels and the square/circular alternation; a typed ordered list makes the rule testable instead of aspirational. Optional props keep existing usages and tests intact.

**Alternatives considered.** A carousel dependency (no new deps in a free-hosting-first project). A generic grid (contradicts the design reference).

### 8. Podcast preview filters long-form locally, by design

**Decision.** The podcast shelf prefers results whose known `durationSeconds` indicates long-form (≥ 10 min) and is labeled as podcasts. The shared server filter pipeline is untouched.

**Why.** M12 owns "category-appropriate filters"; implementing that here would preempt its acceptance criteria. A local presentation preference is honest, testable, and reversible.

**Alternatives considered.** Adding `category` to `SearchRequest` and switching duration bounds (M12 scope; touches every provider and fixture).

### 9. Smart Mixes ship as a gated preview

**Decision.** A Smart Mixes shelf renders only when local signal exists (at least three distinct locally known artists from likes/recent plays). Each mix is named deterministically from its seed artist and holds a bounded number of tracks.

**Why.** ROADMAP lists it as "when available"; this proves the section and the local taste plumbing without inventing M11's stable-identity/refresh rules.

**Alternatives considered.** Omitting the section in M8 (loses roadmap coverage); full mix generation (M11).

## Risks / Trade-offs

- **Query-driven "trending" can drift from real charts** → copy avoids chart/editorial claims (spec requirement); seeds are curated and can be edited without touching providers.
- **Provider flakiness on some seeds** → per-seed failure tolerance, per-shelf error state, all-seeds-fail structured error; browser evidence discloses any live flakes.
- **Seed attribution is not ground-truth language** → spec wording says "the seed that produced them"; interleaving is presentation-only.
- **N shelves × M seeds = more provider traffic per Home visit** → bounded seeds per kind, per-shelf `limit`, short HTTP cache + existing TTL/dedupe/limiter, client aborts shelves it no longer needs.
- **Home first load does several sequential-ish requests** → skeletons per shelf, independent fetches, no blocking aggregate.
- **Listening-event writes add local storage churn** → one record per track step only; no analytics, no server write.
- **New client stores could drift from repository truth** → stores hydrate from repositories and write through them; architecture tests pin repository-mediated access and forbid `data/indexeddb` imports in UI.
- **Design drift on the rhythm rule** → section order is a typed list validated by a unit test, not a convention.

## Migration Plan

1. Additive only: new server module + route, new client features/components/stores, `app/page.tsx` and `app/settings/page.tsx` extended, two architecture-test rule sets, `routes.test.tsx` updated.
2. No IndexedDB schema version bump, no new store, no new backup dataset → existing backups stay importable, and the M2 migration/import suites are unaffected.
3. Deploy order is a single Vercel app; the new route is inert until the client calls it.
4. Rollback = revert the merge commit. No data to unwind; listening events recorded by the new version are valid `ListeningEventRecord`s the existing Settings "Clear listening history" control already handles.

## Open Questions

None that change specs, approach, or task breakdown. Seed-list composition (which genres/collections ship in v1) is an implementation detail, revisable without touching the specs.
