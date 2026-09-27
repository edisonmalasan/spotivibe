# Spotivibe Development Roadmap

> **Status:** Source of truth for product scope, architecture, implementation order, and release criteria  
> **Version:** 1.0  
> **Last updated:** 2026-09-27  
> **Project type:** Accountless, local-first, installable music PWA  
> **Primary deployment target:** Vercel Hobby / free hosting  
> **Primary media source:** YouTube / YouTube Music metadata + YouTube IFrame playback  
> **Reference implementation:** Lyrix (`aryanjsx/Lyrix`) — selectively studied/ported, never wholesale-forked

---

## 1. Project Description

**Spotivibe** is an accountless, local-first Progressive Web App (PWA) that provides a Spotify-inspired music browsing and playback experience while using the YouTube ecosystem for music discovery and playback.

The frontend visual system is defined by **`frontend/docs/DESIGN.md`**. That document is the canonical UI/UX reference for layout, spacing, typography, component proportions, visual hierarchy, responsive behavior, player placement, cards, navigation, surfaces, and interaction styling. Spotivibe must use its own name, icons, branding, copy, and product identity even when the interface is intentionally Spotify-inspired.

Spotivibe will be developed as a **fresh codebase**. We will **not clone Lyrix and refactor the entire repository**. Instead, Lyrix is a technical reference from which we selectively port or rewrite the useful concepts: Innertube discovery, search fallbacks, normalized track handling, persistent YouTube player behavior, queue mechanics, radio/autofill ideas, recommendation heuristics, filtering, resilience, and relevant UI behavior. Code that depends on Lyrix accounts, centralized databases, cloud user profiles, server-side history, collaborative filtering, audio extraction/download, Google OAuth, or other out-of-scope infrastructure must not be ported.

Spotivibe is intentionally designed to remain usable without a Spotivibe account, Supabase, a user database, or paid cloud infrastructure. User-specific data lives on the user's device in IndexedDB and can be backed up or transferred through a versioned JSON export/import format.

---

## 2. Permanent Product Constraints

These constraints are deliberate product decisions, not temporary MVP shortcuts.

1. **No Spotivibe accounts.**
   - No registration.
   - No login.
   - No Google Sign-In.
   - No email/password auth.
   - No guest-vs-authenticated split.

2. **No cloud sync now or later.**
   - Do not architect an "optional sync" path.
   - Do not add Supabase Auth or user-profile sync.
   - Do not store user libraries, playlists, likes, histories, or preferences on a Spotivibe server.

3. **Local-first user data.**
   - IndexedDB is the canonical store for user-owned application data.
   - `localStorage` is reserved for tiny boot-time preferences only when appropriate.
   - Zustand is application state, not the long-term database.

4. **Versioned JSON import/export is the transfer and backup mechanism.**
   - Users own their Spotivibe data.
   - Export/import replaces account-based backup and cross-device sync.

5. **Free-hosting-first architecture.**
   - Avoid infrastructure that requires a permanently running paid server.
   - Prefer one Next.js/Vercel deployment with server-side route handlers/serverless functions where backend mediation is needed.
   - No MySQL/PostgreSQL requirement.
   - No Supabase requirement.
   - No Redis requirement for baseline operation.

6. **No YouTube audio downloading/extraction.**
   - Do not implement YouTube-to-MP3.
   - Do not cache extracted YouTube audio for offline playback.
   - Do not port Lyrix's `downloadService.ts` or `/api/download/:videoId` behavior.

7. **No deliberate circumvention of YouTube playback restrictions.**
   - Do not force hidden/background playback when YouTube or the browser pauses it.
   - Do not build keep-alive loops whose purpose is to defeat background/minimized restrictions.
   - Playback must remain persistent during normal in-app navigation.

8. **Do not block or remove YouTube-delivered advertising.**

9. **Spotify is a design reference, not the product identity.**
   - Spotivibe uses its own logo, name, icons, content copy, and branding.

10. **`frontend/docs/DESIGN.md` is mandatory implementation input.**
    - UI work must be checked against it before being considered complete.

---

## 3. Documentation Precedence

When implementation decisions conflict, use this precedence order:

1. **`ROADMAP.md`** — product scope, architectural constraints, milestone order, accepted/rejected features.
2. **`frontend/docs/DESIGN.md`** — canonical UI/UX and visual design behavior.
3. **Feature-specific technical docs** added later under `frontend/docs/`.
4. **Current implementation/tests.** If implementation differs from this roadmap, the roadmap must be updated intentionally rather than silently allowing scope drift.
5. **Lyrix source code** — reference only. It never overrides Spotivibe requirements.

Any deliberate product-scope change should update `ROADMAP.md` first or in the same change set.

---

## 4. Status Legend

| Status | Meaning |
|---|---|
| `NOT STARTED` | No implementation work accepted yet. |
| `IN PROGRESS` | Actively being implemented. |
| `BLOCKED` | Cannot progress due to a known dependency/problem. |
| `IN REVIEW` | Implemented and awaiting verification against acceptance criteria. |
| `DONE` | Acceptance criteria, tests, and documentation are satisfied. |
| `DEFERRED` | Intentionally postponed; not required for the current release target. |
| `REJECTED` | Explicitly outside Spotivibe scope. |

---

## 5. Milestone Status Table

| ID | Milestone | Status | Depends on |
|---|---|---|---|
| M0 | Repository foundation, documentation, quality gates | `DONE` | — |
| M1 | DESIGN.md-driven design system and application shell | `DONE` | M0 |
| M2 | Local-first data model, IndexedDB, backup/import foundation | `DONE` | M0 |
| M3 | Music provider layer and multi-tier discovery | `IN PROGRESS` | M0 |
| M4 | Persistent YouTube playback engine | `NOT STARTED` | M1, M3 |
| M5 | Search experience and result quality | `NOT STARTED` | M1, M3, M4 |
| M6 | Queue, session persistence, network recovery | `NOT STARTED` | M2, M4 |
| M7 | Library, liked songs, and local playlists | `NOT STARTED` | M1, M2, M4 |
| M8 | Home, discovery, trending, languages, and curated surfaces | `NOT STARTED` | M3, M5, M7 |
| M9 | Artist pages, album pages, Now Playing, related content | `NOT STARTED` | M4, M5, M8 |
| M10 | Radio, queue autofill, and local personalization | `NOT STARTED` | M2, M6, M8, M9 |
| M11 | Listening history, stats, streaks, and Smart Mixes | `NOT STARTED` | M2, M7, M10 |
| M12 | Podcasts | `NOT STARTED` | M3, M4, M5 |
| M13 | PWA installation, offline shell, offline metadata experience | `NOT STARTED` | M1, M2, M6 |
| M14 | Hardening: performance, security, accessibility, resilience | `NOT STARTED` | M3–M13 |
| M15 | Test matrix, release validation, Vercel deployment | `NOT STARTED` | M0–M14 |

---

# 6. Product Scope Matrix

This table is the authoritative translation of Lyrix capabilities plus Spotivibe-specific additions into Spotivibe scope.

## 6.1 Lyrix Capabilities We Will Keep or Adapt

| Capability | Spotivibe decision | Notes |
|---|---|---|
| Spotify-inspired UI | **ADAPT** | Rebuild from `frontend/docs/DESIGN.md`; do not port Lyrix UI wholesale. |
| Search & Play | **KEEP / ADAPT** | Core Spotivibe experience. |
| YouTube Music Innertube search | **KEEP / REFACTOR** | Primary discovery provider. |
| YouTube Web Innertube fallback | **KEEP / REFACTOR** | Secondary provider/fallback. |
| Invidious fallback | **KEEP / REFACTOR** | Best-effort fallback; must tolerate public-instance instability. |
| Piped fallback | **KEEP / REFACTOR** | Best-effort fallback. |
| Local DB search fallback | **ADAPT** | Search the user's IndexedDB/library locally rather than a cloud SQL database. |
| Result normalization | **KEEP / IMPROVE** | All providers return one Spotivibe `Track` shape. |
| Remix/non-music filtering | **KEEP / IMPROVE** | Centralized filter/scoring layer. |
| Queue management | **KEEP** | Current, next, upcoming, history, add/remove/reorder. |
| Auto-advance | **KEEP** | Continue to next playable track. |
| Queue autofill | **KEEP / ADAPT** | Use related/local preference signals. |
| Persistent mini-player | **KEEP / REDESIGN** | DESIGN.md implementation. |
| Persistent shared YouTube player | **KEEP / REFACTOR** | One player instance across routes. |
| Play/pause/seek/volume | **KEEP** | Core playback. |
| Shuffle/repeat | **KEEP** | Repeat off/all/one. |
| Pre-cue next track | **KEEP** | Performance optimization when supported. |
| Playback retry/backoff | **KEEP** | Controlled retry on recoverable failures. |
| Skip unavailable tracks | **KEEP** | Graceful queue continuation. |
| Playlist creation/rename/delete | **KEEP / LOCALIZE** | IndexedDB only. |
| Playlist track add/remove/reorder | **KEEP / LOCALIZE** | IndexedDB only. |
| Playlist hero/cover UI | **KEEP / REDESIGN** | DESIGN.md. |
| Public YouTube playlist import | **KEEP / ADAPT** | Import a public/unlisted-by-link playlist into a local Spotivibe playlist without creating a Spotivibe account; implementation must not require private-account access. |
| YouTube playlist export/private sync | **REJECT** | Requires user-authorized YouTube account operations and conflicts with the permanent accountless/no-OAuth product model. JSON export is Spotivibe's supported backup/transfer path. |
| Saved/Liked tracks | **KEEP / LOCALIZE** | IndexedDB only. |
| Listening history | **KEEP / LOCALIZE** | IndexedDB only. |
| Listening stats | **KEEP / LOCALIZE** | Computed locally. |
| Listening streaks | **KEEP / LOCALIZE** | Computed locally. |
| Personalized Home | **KEEP / REIMPLEMENT** | Derived from local behavior + provider queries. |
| Trending | **KEEP / ADAPT** | Query/provider driven, language aware. |
| Popular artists | **KEEP / ADAPT** | Provider metadata/images as available. |
| Curated playlists/sections | **KEEP / ADAPT** | Static/query-driven, no account required. |
| Genre discovery | **KEEP** | Search/provider-driven. |
| 37-language preference system | **KEEP / ADAPT** | Local preference only; no cloud profile. |
| Language-aware trending | **KEEP / ADAPT** | Local selected languages drive server queries. |
| Language-aware recommendations | **KEEP / REIMPLEMENT** | Local profile and query heuristics. |
| Smart Mixes | **KEEP / REIMPLEMENT** | Generated locally/on demand without cloud user models. |
| Podcasts | **KEEP** | Discovery/search/playback category. |
| Full Now Playing | **KEEP / REDESIGN** | Add compliant visible YouTube surface where needed. |
| Dynamic Now Playing background | **KEEP** | Artwork-derived presentation. |
| Marquee long titles | **KEEP** | UX detail. |
| More Like This | **KEEP / ADAPT** | Provider + local preference based. |
| Mobile-first UI | **KEEP / REDESIGN** | PWA-first responsive implementation. |
| Session persistence | **KEEP / LOCALIZE** | IndexedDB/local persisted state. |
| Network awareness | **KEEP** | Online/slow/offline UI and playback recovery. |
| Input validation | **KEEP** | Server routes and import files. |
| Security headers/CSP | **KEEP / ADAPT** | Fit single Next.js/Vercel deployment. |
| Request concurrency controls | **KEEP** | Protect provider endpoints. |
| Search caching | **KEEP / ADAPT** | Browser/HTTP/serverless opportunistic cache; no Redis dependency. |
| Request deduplication | **KEEP** | Client and server. |
| Cache warming | **ADAPT** | Use bounded client prefetch/HTTP caching where useful; no Redis/cron dependency. |
| Sentry error monitoring | **DEFERRED / OPTIONAL** | Not required for v1; Vercel logs and local diagnostics are sufficient initially. If introduced later, it must not become required infrastructure or capture sensitive local data. |
| PostHog product analytics | **REJECTED BY DEFAULT** | Spotivibe does not require centralized behavioral analytics; local listening behavior is used for user-facing personalization only. |

## 6.2 Spotivibe-Specific Additions

| Capability | Status | Notes |
|---|---|---|
| Installable PWA | **REQUIRED** | Core product requirement. |
| Web App Manifest | **REQUIRED** | Spotivibe branding/icons/standalone mode. |
| Service Worker | **REQUIRED** | App-shell/offline metadata caching. |
| Offline application shell | **REQUIRED** | App opens and library metadata remains usable offline. |
| IndexedDB as canonical user store | **REQUIRED** | Replaces cloud DB. |
| Versioned JSON export | **REQUIRED** | Backup/transfer mechanism. |
| Versioned JSON import | **REQUIRED** | Validated, migratable restore. |
| Import migration system | **REQUIRED** | Old Spotivibe backup versions must remain recoverable where feasible. |
| Import merge/replace choice | **REQUIRED** | User must control how imported data applies. |
| Search history | **REQUIRED** | Local, clearable, exportable. |
| First-class Artist pages | **REQUIRED** | Spotify-style page based on available provider metadata. |
| First-class Album pages | **REQUIRED** | Spotify-style album/release view where metadata permits. |
| Provider abstraction | **REQUIRED** | UI cannot depend directly on Innertube response shapes. |
| Source-aware Track model | **REQUIRED** | Track identifies provider/source and capability flags. |
| Visible compliant YouTube surface | **REQUIRED** | Do not reproduce Lyrix's tiny hidden-ish player approach. |
| DESIGN.md implementation discipline | **REQUIRED** | Every UI milestone validated against `frontend/docs/DESIGN.md`. |
| Local-only recommendation profile | **REQUIRED** | History/likes/preferences never uploaded as a user profile. |
| PWA update handling | **REQUIRED** | Safe service-worker/version upgrades. |
| Local data reset tools | **REQUIRED** | Clear history, clear cache, reset app/library. |

## 6.3 Explicitly Rejected / Not Planned

| Capability | Decision | Reason |
|---|---|---|
| Spotivibe accounts | **REJECTED** | Permanent local-first decision. |
| Google Sign-In / OAuth for Spotivibe identity | **REJECTED** | No accounts. |
| Cloud playlist/library sync | **REJECTED** | Permanent no-sync decision. |
| Supabase Auth/DB for user data | **REJECTED** | Avoid cloud-user infrastructure and cost. |
| MySQL/TiDB user database | **REJECTED** | No server-stored user data. |
| Centralized play history | **REJECTED** | History is local. |
| Collaborative filtering across Spotivibe users (ALS) | **REJECTED** | Requires centralized cross-user interaction data. |
| Lyrix Python AI service | **REJECTED** | A permanently running centralized AI service is not compatible with the free-hosting/local-first architecture. |
| Recommendation A/B testing across users | **REJECTED** | No centralized user telemetry/profile. |
| YouTube audio download/extraction | **REJECTED** | Policy/legal/compliance constraint. |
| Lyrix `downloadService.ts` | **REJECTED** | Must not be ported. |
| Forced YouTube background/minimized playback | **REJECTED** | Do not circumvent player restrictions. |
| YouTube ad blocking/removal | **REJECTED** | Do not interfere with YouTube-served ads. |
| Private YouTube playlist sync/export requiring user OAuth | **REJECTED** | Conflicts with accountless/no-OAuth product model. Public playlist import into local Spotivibe data remains allowed. |
| Official YouTube API quota/admin dashboard as a baseline dependency | **REJECTED** | Baseline discovery is quota-free/provider based; add only if a future approved feature genuinely requires the official keyed API. |
| Server cron/batch jobs for user profiles/mixes | **REJECTED** | User profiles, stats, and mixes are local/on-demand rather than centrally scheduled. |
| Future Spotivibe account/sync architecture | **REJECTED** | Explicit permanent product decision. |

## 6.4 Deferred / Not Yet Approved

These must not silently enter implementation without updating this roadmap:

- Synced lyrics / karaoke lyrics.
- Lyrics translation/romanization.
- Social/friend activity.
- Collaborative playlists.
- Public user profiles.
- Spotify account/library import.
- Native Android/iOS apps; PWA comes first and is the intended client.
- Equalizer.
- Crossfade.
- Gapless playback guarantees.
- Sleep timer.
- Chromecast/AirPlay integration.
- Keyboard shortcut suite beyond basic accessible controls.
- Download manager for non-YouTube licensed/owned audio. The Track model may remain capability-aware, but no download product work is scheduled without a legitimate media source.

---

# 7. Target Architecture

## 7.1 Deployment Shape

To stay within free-hosting constraints, Spotivibe should begin as a **single Next.js application under `frontend/`** and use Next.js route handlers/serverless functions for provider mediation.

```text
spotivibe/
├── ROADMAP.md
├── README.md
└── frontend/
    ├── docs/
    │   ├── DESIGN.md                 # canonical UI/UX source
    │   └── ...                       # future technical docs
    ├── public/
    │   ├── icons/
    │   └── manifest assets
    ├── src/
    │   ├── app/
    │   │   ├── api/                  # server-only route handlers
    │   │   ├── search/
    │   │   ├── artist/[id]/
    │   │   ├── album/[id]/
    │   │   ├── playlist/[id]/
    │   │   ├── now-playing/
    │   │   ├── library/
    │   │   ├── podcasts/
    │   │   ├── settings/
    │   │   └── layout.tsx
    │   ├── components/
    │   │   ├── design-system/
    │   │   ├── layout/
    │   │   ├── player/
    │   │   ├── track/
    │   │   ├── playlist/
    │   │   ├── artist/
    │   │   ├── album/
    │   │   ├── search/
    │   │   ├── recommendations/
    │   │   └── pwa/
    │   ├── features/
    │   │   ├── library/
    │   │   ├── playlists/
    │   │   ├── history/
    │   │   ├── recommendations/
    │   │   ├── radio/
    │   │   ├── backup/
    │   │   └── preferences/
    │   ├── server/
    │   │   ├── music/
    │   │   │   ├── providers/
    │   │   │   │   ├── youtubeMusic.ts
    │   │   │   │   ├── youtubeWeb.ts
    │   │   │   │   ├── invidious.ts
    │   │   │   │   └── piped.ts
    │   │   │   ├── normalize.ts
    │   │   │   ├── filter.ts
    │   │   │   ├── rank.ts
    │   │   │   └── search.ts
    │   │   └── http/
    │   ├── data/
    │   │   ├── indexeddb/
    │   │   ├── repositories/
    │   │   ├── migrations/
    │   │   └── backup/
    │   ├── stores/
    │   │   ├── playerStore.ts
    │   │   ├── queueStore.ts
    │   │   ├── uiStore.ts
    │   │   └── networkStore.ts
    │   ├── types/
    │   ├── hooks/
    │   ├── lib/
    │   └── styles/
    └── tests/
```

A separate Express server should **not** be created unless a concrete technical limitation makes it unavoidable and this roadmap is amended first. The default is one Vercel-deployable Next.js project.

## 7.2 Runtime Data Flow

```text
User UI
  ↓
Spotivibe feature/service layer
  ├──────────────→ IndexedDB (likes/playlists/history/preferences/backup state)
  │
  └──────────────→ /api/* route handlers
                         ↓
                    MusicProvider layer
                         ↓
          YouTube Music Innertube (primary)
                         ↓ fail
               YouTube Web Innertube
                         ↓ fail
                    Invidious
                         ↓ fail
                      Piped
                         ↓
                 Normalized Track[]
                         ↓
                       UI
                         ↓ click play
                     playerStore
                         ↓
                Persistent YT.Player
```

The app's media bytes are streamed by YouTube's player directly; Spotivibe must not proxy the audio/video stream through Vercel.

---

# 8. Canonical Data Models

The exact TypeScript definitions may evolve, but the following concepts are mandatory.

## 8.1 Track

```ts
interface Track {
  id: string;                    // stable Spotivibe/provider-scoped ID
  source: "youtube";
  providerId: string;            // YouTube video ID for current source
  title: string;
  artists: ArtistSummary[];
  album?: AlbumSummary;
  artwork: Artwork[];
  durationSeconds?: number;
  category: "music" | "podcast";
  explicit?: boolean;
  qualityScore?: number;
  language?: string;
  capabilities: {
    stream: boolean;
    offlineDownload: boolean;    // false for YouTube
  };
}
```

Rules:

- Components use `Track`; they must not consume raw Innertube renderer structures.
- `providerId` is the playback identifier for YouTube tracks.
- Missing album/artist metadata is allowed and must degrade gracefully.
- Duration should be parsed when available and corrected from the player when playback provides a more reliable value.
- `offlineDownload` must remain false for YouTube-sourced tracks.

## 8.2 Playlist

Local-only object containing ID, name, optional description, optional cover metadata, timestamps, and ordered track references/snapshots.

## 8.3 ListeningEvent

Local-only event containing track identity, timestamp, seconds played/completion state, source context (search/home/playlist/radio/etc.), and optional skip/completion flags.

## 8.4 Preferences

Local-only settings for selected languages, playback preferences, UI state, onboarding completion, and relevant accessibility preferences.

## 8.5 BackupEnvelope

```ts
interface BackupEnvelope {
  format: "spotivibe-backup";
  version: number;
  exportedAt: string;
  appVersion?: string;
  data: {
    preferences: unknown;
    likedTracks: unknown[];
    playlists: unknown[];
    history: unknown[];
    searchHistory: unknown[];
    // other explicitly supported local datasets
  };
}
```

Imports must be schema-validated and migrated before touching live data.

---

# 9. Selective Lyrix Porting Rules

## 9.1 Files/Concepts to Study and Adapt

These are references, not drop-in dependencies.

| Lyrix area | Spotivibe use |
|---|---|
| `backend/src/services/innertubeService.ts` | Adapt Innertube request/parse ideas, concurrency guard, duration parsing, renderer traversal. |
| `backend/src/controllers/searchController.ts` | Adapt fallback orchestration and normalized API response behavior. |
| `backend/src/services/filterService.ts` | Adapt music-quality/remix filtering concepts. |
| `backend/src/services/invidiousService.ts` | Adapt fallback-provider interface. |
| `backend/src/services/pipedService.ts` | Adapt fallback-provider interface. |
| `backend/src/services/trendingService.ts` | Adapt query-driven, language-aware trending generation. |
| `backend/src/services/recommendationService.ts` | Adapt rule-based/query ideas only; no server user profile dependency. |
| `backend/src/services/mixService.ts` | Adapt Smart Mix composition ideas to local profile inputs. |
| `frontend/src/hooks/usePlayer.ts` | Adapt persistent shared player, retry, error handling, progress, queue advance, reconnect ideas. |
| `frontend/src/store/index.ts` | Adapt state concepts; split into smaller Spotivibe stores rather than copying the monolith. |
| Lyrix queue/radio services | Adapt queue lifecycle, dedupe, refill, seed behavior. |
| Lyrix network handling | Adapt offline/slow/reconnect UX. |

## 9.2 Lyrix Areas That Must Not Be Ported

- Google OAuth/auth controllers/providers.
- JWT/cookie user-session system.
- User database/Prisma models that exist to support accounts.
- MySQL/TiDB persistence for user data.
- Server-stored history/saved tracks/playlists.
- User-profile rebuild jobs.
- Collaborative-filtering/ALS model and cross-user training data.
- Lyrix Python AI service as a required dependency.
- Download/audio extraction service.
- Auth-gated download route.
- Private YouTube playlist export/sync that requires user OAuth.
- Quota dashboard that exists only for official keyed API operations not used by baseline Spotivibe.
- Lyrix branding/UI components as final Spotivibe UI.
- Lyrix's undersized `120x68` YouTube player presentation.
- Any behavior intended to suppress YouTube ads.

## 9.3 Attribution

Lyrix is MIT licensed. If substantial Lyrix code is copied or modified rather than independently reimplemented, retain the applicable MIT copyright/permission notice and add a clear attribution file/section as required by the license.

---

# 10. Milestone Details

## M0 — Repository Foundation, Documentation, and Quality Gates

**Goal:** Establish a clean Spotivibe project before any feature work.

### Tasks

- Create fresh repository/project; do not fork Lyrix as the working codebase.
- Create root `ROADMAP.md` (this document).
- Place/retain design source at **`frontend/docs/DESIGN.md`**.
- Scaffold Next.js + TypeScript under `frontend/`.
- Configure linting, formatting, strict TypeScript, path aliases, environment validation, and test runner.
- Define source folders matching the target architecture.
- Add MIT attribution mechanism for any later Lyrix-derived code.
- Add `.env.example` containing only server-side provider/config values that are actually needed.
- Ensure secrets can never be exposed through `NEXT_PUBLIC_*` unless explicitly safe.
- Add CI workflow for lint + typecheck + unit tests + production build.
- Establish commit/checklist convention: no milestone becomes `DONE` without acceptance tests.

### Acceptance Criteria

- `frontend/docs/DESIGN.md` exists and is referenced from README/developer docs.
- Clean install, lint, typecheck, test, and production build pass.
- No auth/database/Supabase dependencies exist.
- No Lyrix source has been blindly copied wholesale.

---

## M1 — DESIGN.md-Driven Design System and Application Shell

**Goal:** Build Spotivibe's own Spotify-inspired shell before feature pages proliferate.

### Tasks

- Extract design tokens from `frontend/docs/DESIGN.md`:
  - surfaces/backgrounds;
  - typography scale/weights;
  - spacing;
  - radii;
  - elevation/hover treatment;
  - accent/active states;
  - responsive breakpoints;
  - card dimensions/aspect ratios.
- Build reusable primitives rather than styling pages independently.
- Implement desktop shell:
  - left library/sidebar;
  - top navigation/search area;
  - scrollable main content;
  - persistent bottom player slot;
  - optional/responsive Now Playing side surface if the design requires it.
- Implement mobile shell:
  - bottom navigation;
  - compact mini-player;
  - full-screen/expanded Now Playing route/sheet.
- Create Spotivibe logo/icon placeholders and branding surfaces.
- Implement skeleton, empty, error, loading, disabled, hover, focus-visible states.
- Ensure keyboard focus and accessible names are part of primitives from the start.

### Acceptance Criteria

- UI visibly follows `frontend/docs/DESIGN.md` across desktop/tablet/mobile.
- Components are reusable and not page-specific duplicates.
- No Spotify logos/assets/brand copy are shipped.
- The persistent player region exists even before playback logic is connected.

---

## M2 — Local-First Persistence, IndexedDB, and Backup Foundation

**Goal:** Make local data ownership a first-class platform capability before building library features.

### Tasks

- Define IndexedDB schema/versioning.
- Implement repository APIs for:
  - liked tracks;
  - playlists;
  - playlist tracks/order;
  - listening history;
  - search history;
  - preferences/languages;
  - persisted queue/session;
  - cached metadata where appropriate.
- Add database migrations.
- Keep components isolated from direct IndexedDB calls.
- Build backup serializer to `BackupEnvelope`.
- Build strict backup validator.
- Build import migration pipeline.
- Implement import modes:
  - **Replace local data**;
  - **Merge local data**, with deterministic dedupe rules.
- Add Settings → Data controls:
  - Export backup;
  - Import backup;
  - Clear listening history;
  - Clear search history;
  - Reset Spotivibe data.
- Add safeguards/confirmation for destructive operations.

### Acceptance Criteria

- Data survives reload/browser restart.
- Export followed by clean reset followed by import restores equivalent supported data.
- Invalid/malicious JSON cannot corrupt the live database.
- Importing the same backup repeatedly does not create uncontrolled duplicates.
- No remote user database exists.

---

## M3 — Music Provider Layer and Multi-Tier Discovery

**Goal:** Create a stable Spotivibe music API independent of raw provider formats.

### Tasks

- Define `MusicProvider` interface.
- Implement server-only providers:
  1. YouTube Music Innertube — primary;
  2. YouTube Web Innertube — fallback;
  3. Invidious — fallback;
  4. Piped — fallback.
- Port/refactor only the needed Lyrix Innertube traversal/parsing logic.
- Implement normalized `Track` conversion.
- Implement duration parsing when present.
- Implement artwork normalization.
- Implement artist/channel normalization.
- Implement music vs podcast categorization.
- Implement centralized filtering and quality scoring:
  - reaction/vlog/interview filtering;
  - Shorts filtering;
  - unwanted remix/mashup/slowed/reverb/bass-boost/DJ mix filtering;
  - invalid duration filtering;
  - duplicate and near-duplicate handling.
- Add provider timeouts and abort support.
- Add concurrency limits so one client cannot fan out uncontrolled Innertube calls.
- Add request deduplication for identical in-flight searches.
- Add best-effort short-lived caching through HTTP/serverless-compatible mechanisms; do not require Redis.
- API route response must expose provider/source diagnostics only when safe/useful; UI should not depend on them.
- Local library search remains a client-side fallback and must not require uploading local data.

### Acceptance Criteria

- A search query returns only normalized Spotivibe objects.
- UI code imports no Innertube renderer types.
- Provider failure falls through gracefully.
- One failed fallback provider does not crash the search endpoint.
- Search works without a YouTube Data API key in the baseline path.
- No media stream is proxied through Spotivibe/Vercel.

---

## M4 — Persistent YouTube Playback Engine

**Goal:** Establish one reliable player instance that survives route changes.

### Tasks

- Load YouTube IFrame Player API once.
- Create one persistent player host outside route-specific page content.
- Build `playerStore` with:
  - current track;
  - player state/status;
  - position;
  - duration;
  - volume/mute;
  - repeat mode;
  - shuffle;
  - playback error state.
- Implement actions:
  - play track;
  - play/pause;
  - seek;
  - next;
  - previous;
  - volume/mute;
  - repeat;
  - shuffle.
- Correct track duration using the player when more authoritative.
- Implement controlled retry/backoff.
- Handle unplayable/embedding-restricted/deleted videos by marking error and advancing when appropriate.
- Implement progress polling efficiently; pause unnecessary polling when no track is active.
- Persist relevant session state without auto-playing unexpectedly after a cold launch.
- Ensure the YouTube playback surface meets applicable visibility/size requirements; do not reproduce Lyrix's tiny hidden-style iframe.
- The custom Spotivibe player UI controls the underlying YouTube player but does not remove required YouTube behavior/attribution.

### Acceptance Criteria

- Playing a song then navigating Home → Search → Library does not recreate/restart the player unnecessarily.
- Controls remain synchronized with actual YT player state.
- A failed track does not wedge the application.
- No background-play circumvention loop exists.
- No YouTube audio extraction exists.

---

## M5 — Search Experience and Result Quality

**Goal:** Deliver a polished Spotify-like search workflow on top of the provider engine.

### Tasks

- Build DESIGN.md-compliant Search page.
- Debounce text input.
- Abort stale requests.
- Show progressive loading/skeleton state.
- Render Top Result where appropriate.
- Render song results.
- Render artist results where metadata can be resolved.
- Render album/release-like results where metadata can be resolved.
- Render podcast results/category when selected.
- Add result play affordance.
- Add context actions:
  - play;
  - add to queue;
  - like/unlike;
  - add to local playlist;
  - go to artist;
  - go to album where available;
  - start radio.
- Save search queries locally.
- Provide recent searches with remove-one and clear-all.
- If remote providers fail, allow searching the local library/history without uploading it.
- Dedupe duplicates across providers/results.

### Acceptance Criteria

- Fast typing never allows older responses to overwrite newer queries.
- Search history remains local and survives reload.
- Search has useful empty/error/offline states.
- Clicking a track starts persistent playback.

---

## M6 — Queue, Session Persistence, and Network Recovery

**Goal:** Make playback behave like a real music application rather than a single-video launcher.

### Tasks

- Create a dedicated `queueStore`; do not bury all queue state in one mega-store.
- Model:
  - current;
  - next;
  - upcoming;
  - history;
  - queue context/source;
  - shuffle/repeat interaction.
- Add queue item.
- Remove queue item.
- Reorder via drag/drop where appropriate.
- Prevent accidental duplicate insertion using track/provider identity.
- Auto-advance on track completion.
- Previous-track behavior uses playback time/history sensibly.
- Pre-cue next item where supported without breaking current playback.
- Persist queue/session locally.
- Restore session after reload with position.
- Implement network state:
  - online;
  - slow/degraded where detectable;
  - offline.
- On connection loss:
  - preserve position/state;
  - show banner/state;
  - do not destroy queue.
- On reconnect:
  - retry safely;
  - resume only when appropriate and allowed by browser/user gesture rules.

### Acceptance Criteria

- Queue survives route changes and reload.
- Reordering/removal while playing does not corrupt current/next pointers.
- Connection loss does not erase session state.
- Unplayable tracks are skipped without infinite loops.

---

## M7 — Library, Liked Songs, and Local Playlists

**Goal:** Recreate the core personal-library experience entirely on-device.

### Tasks

- Build Your Library sidebar/surface from DESIGN.md.
- Liked Songs:
  - like/unlike;
  - list/grid view as designed;
  - play all;
  - shuffle;
  - local search/filter where useful.
- Playlists:
  - create;
  - rename;
  - optional description;
  - delete;
  - add/remove tracks;
  - reorder tracks;
  - play all;
  - shuffle;
  - playlist duration calculation;
  - generated/derived cover when feasible.
- Public YouTube playlist import:
  - accept a public/unlisted playlist URL or ID;
  - resolve/import available track metadata into a new local Spotivibe playlist;
  - handle unavailable/private videos gracefully;
  - do not require Google OAuth or a Spotivibe account.
- Build playlist detail hero.
- Use immutable IDs independent of playlist display name.
- Ensure all changes persist immediately/local-first.
- Include library/playlists/likes in JSON backup.

### Acceptance Criteria

- Library functions fully with no internet except when a track is actually played/fetched remotely.
- No account/login prompt exists.
- Playlist order is stable across reload/import/export.
- Public YouTube playlist import creates a normal local playlist and fails gracefully for inaccessible/private playlists.
- Duplicate handling is deterministic.

---

## M8 — Home, Discovery, Trending, Languages, and Curated Surfaces

**Goal:** Make Spotivibe feel alive before centralized personalization exists.

### Tasks

- Build Home page sections using DESIGN.md horizontal shelves/cards.
- Required baseline sections:
  - Continue/Recently Played (when local history exists);
  - Trending Now;
  - Made For You / For You;
  - Smart Mixes preview when available;
  - Popular Artists;
  - genre discovery;
  - podcast discovery preview;
  - curated/query-driven playlists/collections.
- Implement first-run language onboarding.
- Keep Lyrix's broad 37-language catalog unless later intentionally reduced.
- Persist language choices in IndexedDB/preferences.
- Implement round-robin/interleaving so one language does not dominate multi-language feeds.
- Trending generation should use provider queries rather than claim to be an official Spotify/YouTube chart unless an actual chart source is used.
- Build Discover page for genre/language exploration.
- Keep all personalization inputs on-device; API requests may contain a selected language/query when needed but must not create server user profiles.

### Acceptance Criteria

- Fresh users see useful non-personalized discovery.
- Returning users see locally informed sections.
- Multi-language selection produces mixed content instead of grouped monopolization.
- Home remains useful if one provider request fails.

---

## M9 — Artist Pages, Album Pages, Now Playing, and Related Content

**Goal:** Turn search results into a cohesive music-browsing graph.

### Tasks

### Artist pages
- Artist identity/image when available.
- Popular tracks.
- Releases/album-like collections where resolvable.
- Related artists/More Like This where resolvable.
- Start Artist Radio.
- Local "liked tracks by this artist" context where useful.

### Album pages
- Artwork.
- Album/release title.
- Artist.
- available release metadata.
- Ordered track listing where resolvable.
- Play and shuffle.
- Add tracks to local playlist.
- Like individual tracks.

### Now Playing
- Large artwork.
- Title/artist.
- full controls.
- progress/seek.
- like state.
- queue access.
- dynamic artwork-derived background.
- long-title marquee.
- visible YouTube playback surface integrated into the design when using YouTube.
- More Like This / similar track shelf.

### Acceptance Criteria

- Artist/album pages degrade gracefully when YouTube metadata is incomplete.
- Now Playing and mini-player always represent the same store/player state.
- Related content never requires a cloud user profile.

---

## M10 — Radio, Queue Autofill, and Local Personalization

**Goal:** Recreate Lyrix-style continuous listening without cross-user tracking.

### Tasks

- Track Radio seeded by track.
- Artist Radio seeded by artist.
- Maintain played-ID set for session dedupe.
- Refill radio before queue exhaustion.
- Queue autofill for ordinary playback when enabled/appropriate.
- Build a **local taste profile** from IndexedDB data:
  - liked tracks;
  - frequently played artists;
  - frequently played genres/categories where inferable;
  - selected languages;
  - recently played tracks;
  - completion/skip behavior.
- Create rule-based/content-query recommendation scoring.
- Never upload a persistent user taste profile.
- API may receive ephemeral search seed terms needed to fulfill a request, but no server-side profile storage.
- Avoid repeating tracks too frequently.

### Acceptance Criteria

- Radio can continue across multiple refill cycles without obvious short loops.
- Clearing local history/preferences affects future local personalization.
- No collaborative-filtering or cross-user data exists.

---

## M11 — Listening History, Stats, Streaks, and Smart Mixes

**Goal:** Preserve Lyrix's personal insights without a server database.

### Tasks

- Record local listening events.
- Define threshold rules for what counts as a meaningful play vs immediate skip.
- Track seconds played/completion when practical.
- Build History page.
- Build local stats:
  - total listening time;
  - play count;
  - top tracks;
  - top artists;
  - language/genre/category breakdown where metadata supports it;
  - completion/skip summaries where useful;
  - listening streaks.
- Implement Smart Mix generation from local profile + provider search:
  - stable mix identity/name within a period where useful;
  - 20+ track target where provider data supports it;
  - dedupe;
  - language-aware composition;
  - mix refresh behavior.
- All stats and mix preference inputs remain local.
- Include history in export by default unless UX later provides opt-out.

### Acceptance Criteria

- Stats can be recomputed from local history where feasible.
- Deleting history updates stats accordingly.
- Smart Mixes work without any server-side user identity.

---

## M12 — Podcasts

**Goal:** Retain Lyrix's podcast discovery capability without compromising music UX.

### Tasks

- Support `category: "podcast"` in normalized Track/media model.
- Podcast search/discovery mode.
- Curated/query-driven categories.
- Duration filtering suitable for long-form content.
- Filter vlogs/reactions/short irrelevant results.
- Podcast playback uses same persistent player architecture.
- Store podcast listening history locally.
- Ensure music-specific filtering does not incorrectly reject legitimate podcast content.

### Acceptance Criteria

- Music and podcast queries use category-appropriate filters.
- Long durations do not break seek/progress/session restoration.

---

## M13 — PWA Installation and Offline Metadata Experience

**Goal:** Make Spotivibe installable and useful as a local-first app while being honest that YouTube playback requires network access.

### Tasks

- Create Web App Manifest:
  - Spotivibe name/short name;
  - icons;
  - theme/background colors;
  - standalone display;
  - start URL.
- Create service worker strategy.
- Cache application shell/static assets.
- Cache safe artwork/metadata responses where appropriate and bounded.
- Offline experience must permit:
  - opening app shell;
  - viewing local playlists;
  - viewing liked tracks metadata;
  - viewing local history/stats;
  - managing library metadata;
  - export/import where browser file APIs allow.
- Offline experience must clearly indicate that YouTube search/playback is unavailable.
- Implement PWA install affordance only where supported and not annoyingly repetitive.
- Implement service worker update notification/refresh flow.
- Test installed mode on desktop Chrome/Edge, Android, and iOS home-screen constraints where possible.
- Do not market offline YouTube playback.

### Acceptance Criteria

- App launches in standalone installed mode.
- Core local pages render offline after assets have been cached.
- Attempting remote playback/search offline fails gracefully.
- Service-worker updates do not destroy IndexedDB data.

---

## M14 — Hardening: Performance, Security, Accessibility, and Resilience

**Goal:** Prepare a public free-tier deployment that fails safely and remains responsive.

### Performance

- Lazy-load heavy surfaces.
- Virtualize or paginate very long local lists where needed.
- Optimize artwork loading and sizes.
- Abort stale provider requests.
- Deduplicate in-flight identical calls.
- Bound concurrency.
- Avoid unnecessary re-renders in Zustand selectors.
- Avoid polling when player is idle.
- Measure Core Web Vitals locally/in deployment tooling without requiring invasive user telemetry.

### Security

- Strong CSP compatible with required YouTube domains.
- Security headers.
- Input length validation and sanitization.
- Validate all query params.
- Restrict server route methods.
- Never expose internal secrets/client credentials.
- Cap request bodies.
- Validate imported backup schemas before database transactions.
- Ensure exported JSON contains only intended local application data.
- Add best-effort per-instance abuse throttling/concurrency protection without pretending it is globally durable rate limiting.

### Accessibility

- Keyboard-accessible primary controls.
- Visible focus states.
- Semantic buttons/links.
- ARIA labels where visual-only icons are used.
- Minimum contrast checked against design tokens.
- Motion reduced when `prefers-reduced-motion` is enabled.
- Screen-reader announcements for meaningful player state/errors where appropriate.

### Resilience

- Provider timeouts.
- Provider fallback.
- corrupted local-record handling.
- IndexedDB migration rollback/failure UX.
- service-worker cache corruption recovery.
- playback retry caps/no infinite loops.
- graceful handling of removed/unembeddable videos.

### Acceptance Criteria

- Lighthouse/accessibility/performance checks meet project targets defined during this milestone.
- No known infinite retry/refill loops.
- No critical UI requires a mouse.
- Provider outage does not crash the whole app.

---

## M15 — Test Matrix, Release Validation, and Vercel Deployment

**Goal:** Validate the entire source-of-truth scope before calling v1 complete.

### Automated Test Coverage

- Unit tests:
  - duration parsing;
  - normalization;
  - filtering/ranking;
  - dedupe;
  - queue transitions;
  - repeat/shuffle logic;
  - local recommendation scoring;
  - backup migrations;
  - import merge/replace;
  - stats/streak calculations.
- Integration tests:
  - search API fallback orchestration with provider mocks;
  - IndexedDB repositories;
  - player-store event flow with mocked YT player;
  - playlist CRUD;
  - export → reset → import.
- End-to-end tests:
  - first launch/language onboarding;
  - search → play;
  - navigate while playing;
  - add to queue;
  - like track;
  - create playlist/add/reorder/remove;
  - reload/session restore;
  - offline app-shell/library flow;
  - backup export/import;
  - provider failure fallback;
  - mobile navigation.

### Manual Browser Matrix

At minimum:

- Chromium desktop.
- Edge desktop.
- Firefox desktop for standard web mode.
- Android Chromium/PWA where available.
- iOS Safari/Home Screen PWA where available.

### Release Checklist

- `ROADMAP.md` reflects actual scope/status.
- `frontend/docs/DESIGN.md` visual audit passed.
- No account/auth/cloud-sync UI or code paths exist.
- No Supabase/user database dependencies exist.
- No YouTube audio downloader/extractor exists.
- No forced background-play circumvention exists.
- No ad-blocking behavior exists.
- No media is proxied through Vercel.
- Backup format/version documented.
- Attribution notices included for substantial Lyrix-derived code.
- Vercel production build passes.
- PWA manifest/service worker validate.
- Critical flows pass automated and manual tests.

---

# 11. Feature-Level Acceptance Checklist

This section prevents roadmap phases from accidentally shipping without important user-facing pieces.

## Navigation / Shell

- [ ] Desktop sidebar/library.
- [ ] Main content region.
- [ ] Global search/navigation.
- [ ] Persistent player bar.
- [ ] Mobile bottom navigation.
- [ ] Responsive Now Playing.
- [ ] Spotivibe branding/icons.

## Search / Discovery

- [ ] YouTube Music Innertube primary.
- [ ] YouTube Web Innertube fallback.
- [ ] Invidious fallback.
- [ ] Piped fallback.
- [ ] Local library fallback/search.
- [ ] Debounce + abort stale requests.
- [ ] Music quality/remix filtering.
- [ ] Duplicate handling.
- [ ] Search history.
- [ ] Artist navigation.
- [ ] Album navigation where metadata supports it.
- [ ] Podcast search/category.

## Player

- [ ] Single persistent YT player instance.
- [ ] Visible/compliant playback surface.
- [ ] Play/pause.
- [ ] Previous/next.
- [ ] Seek/progress.
- [ ] Volume/mute.
- [ ] Shuffle.
- [ ] Repeat off/all/one.
- [ ] Retry/backoff.
- [ ] Skip unavailable tracks.
- [ ] Pre-cue next where safe.
- [ ] Session restoration.
- [ ] YouTube attribution.

## Queue / Radio

- [ ] Add/remove/reorder.
- [ ] Current/next/upcoming/history.
- [ ] Duplicate protection.
- [ ] Auto-advance.
- [ ] Queue autofill.
- [ ] Track Radio.
- [ ] Artist Radio.
- [ ] Radio refill.
- [ ] Played-track dedupe.

## Library

- [ ] Liked Songs.
- [ ] Create playlist.
- [ ] Rename playlist.
- [ ] Delete playlist.
- [ ] Add/remove playlist tracks.
- [ ] Reorder playlist tracks.
- [ ] Play/shuffle playlist.
- [ ] Playlist hero/cover.
- [ ] Public YouTube playlist import into local library.

## Content Pages

- [ ] Home.
- [ ] Search.
- [ ] Discover.
- [ ] Artist.
- [ ] Album/release.
- [ ] Playlist.
- [ ] Library/Liked Songs.
- [ ] Now Playing.
- [ ] History/Stats.
- [ ] Podcasts.
- [ ] Settings/Data.

## Personalization

- [ ] Language onboarding.
- [ ] Local taste profile.
- [ ] For You.
- [ ] Trending.
- [ ] Popular Artists.
- [ ] Genre discovery.
- [ ] More Like This.
- [ ] Smart Mixes.
- [ ] Recently Played.
- [ ] Listening stats.
- [ ] Listening streaks.

## Local-First / PWA

- [ ] IndexedDB repositories.
- [ ] IndexedDB migrations.
- [ ] Versioned JSON export.
- [ ] Validated JSON import.
- [ ] Merge import.
- [ ] Replace import.
- [ ] Clear/reset controls.
- [ ] Web App Manifest.
- [ ] Service Worker.
- [ ] Installable standalone app.
- [ ] Offline app shell.
- [ ] Offline library metadata.
- [ ] PWA update flow.
- [ ] Online/offline indicators.

---

# 12. Local Recommendation Strategy

Because Spotivibe has no accounts or centralized database, Lyrix's cross-user ALS collaborative filtering is intentionally replaced by a local-first strategy.

## Inputs

All maintained on-device:

- likes;
- play counts;
- meaningful completions;
- skips;
- recency;
- artists;
- genres/categories where available;
- selected languages;
- recent searches;
- playlist membership.

## Recommendation Layers

1. **Seed selection:** choose locally relevant artists/tracks/languages/genres.
2. **Provider retrieval:** generate targeted YouTube Music/provider queries or related-content requests.
3. **Filtering:** remove low-quality/remix/unwanted results.
4. **Deduplication:** avoid current queue/recent history/repeated IDs.
5. **Local scoring:** rank candidates against local taste/profile and freshness.
6. **Diversity pass:** prevent one artist/language from taking over the shelf.
7. **Presentation:** build For You, Smart Mixes, More Like This, radio, and queue autofill.

The result preserves the user-facing purpose of Lyrix recommendations without requiring server-side user identity or cross-user behavioral collection.

---

# 13. Data Backup and Import Rules

JSON backup is not a secondary utility; it is Spotivibe's official ownership/transfer mechanism.

## Required Rules

- Every export includes `format`, `version`, and `exportedAt`.
- New backup schemas increment `version`.
- Imports never trust types/IDs from JSON without validation.
- Migrations are pure/testable where possible.
- An import is prepared and validated before mutating live IndexedDB.
- Replace mode requires confirmation.
- Merge mode uses deterministic dedupe keys.
- Import failure leaves the pre-import database intact.
- Large backups should show progress where browser APIs permit.
- Backups must not include secrets, browser tokens, caches, or service-worker internals.

---

# 14. Free-Tier Scaling Strategy

Spotivibe deliberately pushes user-state storage and personalization computation to the client.

## Vercel Handles

- Next.js app assets/pages.
- Server route handlers for provider mediation.
- Search/discovery metadata responses.

## User Device Handles

- playlists;
- liked tracks;
- history;
- search history;
- preferences;
- stats;
- local recommendation profile;
- session/queue persistence;
- JSON backups;
- PWA cache.

## YouTube Handles

- actual embedded media delivery/playback.

## Important Limits

- Public Innertube/Invidious/Piped behavior can change or be throttled.
- Vercel Hobby has finite request/data-transfer limits.
- A serverless deployment cannot rely on process memory for durable global caching or global rate limiting.
- If public popularity exceeds free-tier limits, Spotivibe should fail/rate-limit gracefully rather than silently introducing paid infrastructure contrary to project constraints.

---

# 15. UI Implementation Rules from DESIGN.md

The following process is mandatory for each UI-bearing milestone:

1. Read the relevant section of `frontend/docs/DESIGN.md` before implementation.
2. Implement through shared design-system tokens/components where possible.
3. Verify desktop and mobile layouts.
4. Verify hover/focus/pressed/disabled/loading/empty/error states.
5. Compare visual hierarchy and spacing to the design reference.
6. Preserve Spotivibe branding.
7. Do not bypass design-system primitives with one-off page CSS unless justified.
8. Mark the milestone `DONE` only after the DESIGN.md audit is complete.

`DESIGN.md` should remain descriptive of the intended interface. Implementation details that do not belong in the design spec should be documented separately rather than polluting the design document.

---

# 16. Known Technical Risks

| Risk | Mitigation |
|---|---|
| Innertube is undocumented/internal and can change | Provider abstraction, parser tests, multiple fallbacks. |
| Public Invidious/Piped instances are unstable | Treat as fallbacks only; timeouts, instance rotation only if maintained safely. |
| YouTube metadata may be incomplete | Optional fields + graceful UI degradation. |
| YouTube embed restrictions | Never assume every result is playable; detect/skip failures. |
| Browser background behavior differs | Do not promise forced background playback; preserve in-app persistent playback. |
| IndexedDB can be cleared by the user/browser | Strong JSON backup/import UX and clear local-storage messaging. |
| PWA storage eviction | Backup UX; do not claim local data is equivalent to cloud durability. |
| Vercel free-tier exhaustion | Client-side state, caching, request dedupe, provider query discipline, graceful errors. |
| Huge local history | Retention/compaction policy may be introduced locally if needed, without cloud storage. |
| Service-worker stale assets | Explicit version/update flow and cache cleanup. |
| Provider search duplicates/poor results | Quality score, fuzzy normalization, remix filters, dedupe. |

---

# 17. Definition of v1 Complete

Spotivibe v1 is complete only when all of the following are true:

1. The app is installable as a PWA and its shell/local library experience works offline.
2. Search discovers and normalizes music through the provider fallback chain without requiring a Spotivibe account or baseline YouTube Data API key.
3. A user can search, play, pause, seek, queue, shuffle, repeat, and navigate throughout the app without losing the persistent player.
4. A user can like songs and create/manage/reorder local playlists.
5. Home/Discover provide trending, popular artists, genres, language-aware content, and locally informed recommendations.
6. Artist, album/release, playlist, search, library, Now Playing, history/stats, podcasts, settings/data, and core Home pages are implemented according to `frontend/docs/DESIGN.md`.
7. Track Radio, Artist Radio, queue autofill, More Like This, and Smart Mixes operate without centralized user data.
8. Listening history, stats, and streaks are generated locally.
9. Versioned JSON export/import can reliably back up and restore supported user data.
10. No Spotivibe account/auth/cloud-sync path exists.
11. No YouTube audio download/extraction path exists.
12. No forced background-play circumvention exists.
13. No YouTube ad-blocking behavior exists.
14. Automated tests cover critical state/data/provider logic and release-critical end-to-end flows.
15. Vercel production deployment and PWA validation pass.
16. Any substantial Lyrix-derived code retains required MIT attribution.

---

# 18. Post-v1 Changes Require Explicit Roadmap Approval

After v1, new features are not assumed merely because Lyrix or Spotify has them. Additions such as lyrics, cast support, equalizer, crossfade, licensed-download sources, or new provider types require a deliberate update to this roadmap.

The following are **not eligible as post-v1 additions without reversing a permanent project decision** and therefore should be treated as out of scope rather than backlog items:

- Spotivibe accounts;
- cloud sync;
- Supabase user storage;
- centralized listening profiles;
- cross-user collaborative filtering;
- YouTube audio extraction/download;
- forced hidden/background YouTube playback;
- YouTube ad suppression.

---

# 19. Reference Baseline

Lyrix was used only to validate capabilities and implementation patterns. Relevant verified reference points from the current `main` branch at roadmap creation time include:

- Repository/README: `https://github.com/aryanjsx/Lyrix`
- Raw README: `https://raw.githubusercontent.com/aryanjsx/Lyrix/main/README.md`
- Innertube service: `https://raw.githubusercontent.com/aryanjsx/Lyrix/main/backend/src/services/innertubeService.ts`
- Search controller: `https://raw.githubusercontent.com/aryanjsx/Lyrix/main/backend/src/controllers/searchController.ts`
- Player hook: `https://raw.githubusercontent.com/aryanjsx/Lyrix/main/frontend/src/hooks/usePlayer.ts`
- Zustand store: `https://raw.githubusercontent.com/aryanjsx/Lyrix/main/frontend/src/store/index.ts`

Lyrix's README describes its multi-tier discovery, queue, playlists, history/stats, hybrid AI recommendations, language-aware personalization, podcasts, Now Playing, mini-player, mobile UI, session persistence, and network resilience. Spotivibe keeps the relevant user-facing goals while replacing Lyrix's account/database/AI/download infrastructure with the local-first architecture defined here.

YouTube developer-policy references should be rechecked before shipping because platform requirements can change:

- `https://developers.google.com/youtube/terms/developer-policies`
- `https://developers.google.com/youtube/terms/required-minimum-functionality`

---

# 20. Roadmap Maintenance Rule

This file is the project source of truth. During development:

- Update milestone status as work changes.
- Add newly approved scope before implementing it.
- Mark intentionally removed scope as `REJECTED` rather than deleting history without explanation.
- Keep technical implementation detail in dedicated docs when it becomes too granular for this roadmap.
- Never silently introduce accounts, cloud sync, a user database, YouTube downloading, or background-play circumvention.
- When Lyrix changes upstream, Spotivibe does **not** automatically inherit those changes. Port only changes that match this roadmap.

