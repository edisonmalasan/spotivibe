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
| M3 | Music provider layer and multi-tier discovery | `DONE` | M0 |
| M4 | Persistent YouTube playback engine | `DONE` | M1, M3 |
| M5 | Search experience and result quality | `DONE` | M1, M3, M4 |
| M6 | Queue, session persistence, network recovery | `DONE` | M2, M4 |
| M7 | Library, liked songs, and local playlists | `DONE` | M1, M2, M4 |
| M8 | Home, discovery, trending, languages, and curated surfaces | `DONE` | M3, M5, M7 |
| M9 | Artist pages, album pages, Now Playing, related content | `DONE` | M4, M5, M8 |
| M10 | Radio, queue autofill, and local personalization | `DONE` | M2, M6, M8, M9 |
| M11 | Listening history, stats, streaks, and Smart Mixes | `DONE` | M2, M7, M10 |
| M12 | Podcasts | `DONE` | M3, M4, M5 |
| M13 | PWA installation, offline shell, offline metadata experience | `DONE` | M1, M2, M6 |
| M14 | Hardening: performance, security, accessibility, resilience | `DONE` | M3–M13 |
| M15 | Test matrix, release validation, Vercel deployment | `DONE` | M0–M14 |

**v1 is complete: M0–M15 are `DONE` and their records are historical, not to be rewritten.**

### Post-v1 (approved 2026-10-03)

Six new milestones, specified in §12. They are approved scope, not deferred ideas, and each runs
the full `AGENTS.md` lifecycle: Propose → Apply → independent verification → Sync → Archive.

| Milestone | Objective | Status | Depends on |
|---|---|---|---|
| **M16** | Lyrics and Now Playing enrichment | `DONE` | M9, M12 |
| **M17** | Home discovery enrichment | `DONE` | M11, M8 |
| **M18** | Keyboard shortcuts, search suggestions, sharing | `DONE` | M5, M7, M9 |
| **M19** | Motion and interaction polish | `DONE` | M18 |
| **M20** | Personal-use media downloading | `APPROVED` | M3, M4 |
| **M21** | Post-v1 integration, regression validation, documentation | `APPROVED` | M16–M20 |

**Sequencing rationale.** M16 first because lyrics is the deepest new *data* path (an external
provider, a parser, a playback-position binding) and it proves the Now Playing surface can grow.
M17 depends on M11's local Smart Mix system and **introduces no motion of its own** — the M16 motion
vocabulary it originally reused was later found not to exist (M16 shipped none), and M17's decision was
to add none, so that M19 can establish one vocabulary deliberately rather than standardising several.
M18 is three
independent interaction features grouped because they share the "global input handling" problem
and are individually small. M19 is last among features because it must be judged against surfaces
that exist, and adding motion to a surface that is about to change is wasted work. M20 is
independent of M16–M19 and is placed after them because it is the only milestone carrying a
deployment risk, and it should not be able to block the rest. M21 exists because the release gate
is currently intermittently red and post-v1 work must not ship on a gate that lies.

**M16 is `DONE` as of 2026-10-02** (proposal #78, apply #79, sync #80, archive this branch). Timed
lyrics with active-line highlighting, auto-scroll that yields to a manual scroll, four
distinguishable panel states, and a duration-aware LRCLIB lookup cached without a database.

Three things M16 established that the rest of the post-v1 work inherits:

- **The induced-violation harness** (`frontend/scripts/lyrics-induced-violations.mjs`) and its guard
  are now the repository's way of showing a check can fail. **70 cases, all caught** — 22 from M16,
  14 from M17, 24 from M18, 6 from M19, and 4 more added after independent review found M18's shift rule had
  no coverage at all. M20 should add cases for their own load-bearing behaviour rather than
  trusting a green suite.
- **Five independent verification passes** on one change found ten CRITICALs, every one a claim that
  outran its evidence and none a behavioural defect — and four of them introduced by an earlier pass's
  own fix. A ticked task clause is a contract about what a test does, and reviewing those clauses is
  cheap relative to the alternative.
- **The sync script** (`scripts/sync-m16-lyrics.mjs`) states the invariant a name-matched spec merge
  must preserve, so no future sync can delete a scenario silently.

**M16's two open items carry forward.** The active line's following is verified in jsdom but **not
observed in a real browser** — the YouTube IFrame API is blocked by CSP in this environment — and the
M16 release gate could not be used as a comparison, which is how the destructive-install finding below
was found. Both are in M21's scope.

The work that followed M15 was not a milestone. It was the one defect M15's own release
process was built to find, found before the first deploy rather than during it:

- **The runtime target was unbuildable.** M15 pinned `engines.node: ">=26 <27"`, and Vercel
  offers 24.x, 22.x, and 20.x for builds and functions — Node 26 is a Sandbox runtime. M15's
  check asked whether the pin and CI agreed. They agreed, and both were unbuildable. The
  correction, in `2026-10-01-align-vercel-runtime-and-root-commands`, moved the target to
  Node 24 everywhere and added the check that was missing: not that the declaration is
  internally consistent, but that the target host can satisfy it.
- **Root-level commands.** `npm run dev`, `test`, `lint`, and the rest now run from the
  repository root. `frontend/` remains the application and keeps the only lockfile.

The work after that was a **deliberate reversal of M4's visible-player decision**, in
`2026-10-02-lyrix-style-hidden-player`:

- **The floating YouTube video panel is gone and the single persistent player is parked** at
  1×1 with zero opacity, non-interactive, and behind the app UI. PlayerBar/MiniPlayer is the only
  visible playback interface, and Now Playing has an opt-in video mode that reveals *that same*
  player. The branding could not be suppressed — `modestbranding` is deprecated and inert, and a
  cross-origin iframe cannot be reached by CSS or DOM — so it was made invisible rather than
  absent, which is Lyrix's approach.
- **This does not meet YouTube's documented visible-player requirement, and is intended for
  private, personal use.** The `playback` capability now carries that as a requirement rather
  than a caveat, and `frontend/docs/DEPLOYMENT.md` instructs a public deployer to revert it
  first. No extraction, `yt-dlp`, stream download, media proxy, or ad blocking was introduced, and
  a detector holds that.
- An independent verification pass returned **NOT MERGEABLE** with six criticals, **four of them
  detectors that could not fail**. All were fixed and each is now shown failing by inducing the
  violation in the real file.

### What remains, and it is not a milestone

| Item | Why it is not a milestone | Where it is recorded |
|---|---|---|
| ~~The Vercel deployment itself~~ — **CLOSED 2026-10-02** | Deployed to `https://spotivibe-web.vercel.app` and verified: 8 automated checks green against the live origin (headers present through the CDN, `sw.js` updateable, manifest and its four icons valid, `/api/search` returning real provider results, rate limiting answering `429` with `Retry-After`, all eleven routes answering). The browser-only list — offline reload, live playback, the parked player, console errors, layout — is **still open** and was never claimed as passing. | `openspec/changes/archive/2026-10-02-first-production-deployment.md`; `frontend/docs/DEPLOYMENT.md` |
| Whether a parked 1×1 iframe keeps advancing in a live browser | The IFrame API is blocked by CSP in this environment, so no browser run can confirm it. The largest open item in the parked-player change. | `2026-10-02-lyrix-style-hidden-player` evidence README, "Not verified" |
| Reverting the parked player before any public deployment | The parked configuration is right for a personal instance and wrong for a public one. | `frontend/docs/DEPLOYMENT.md`; the `playback` spec's departure requirement |
| Real multi-instance rate limiting | The limiter is per-instance in memory, so its effective ceiling multiplies by instance count on serverless. Never observed under load. | M15's archived `tasks.md`, "permanently unverified" |
| Firefox / Android / iOS | Only Edge is installed here, and the automation protocol is Chrome DevTools-based. | M15's archived `tasks.md` |
| The DESIGN.md visual audit | A proportion and hierarchy judgement, not a number. | M15's archived `tasks.md` |
| `tests/podcast-playback-history.test.ts` flake | A pre-existing 2-second wall-clock budget standing in for synchronization; roughly 1 run in 3 under load. Found during the runtime correction, deliberately not fixed there. | `2026-10-01-align-vercel-runtime-and-root-commands` evidence README |
| A flaky release gate | M15's end-to-end suite fails intermittently on a CDP race in its own fixture router, reproduced on the commit before the runtime correction. The gate's credibility rests on green meaning something. | Found during the runtime correction; not yet fixed |
| **The release gate destroys `node_modules` when its install step fails** | Discovered by running it during M16. `gates-install` runs `npm ci`, which deletes `node_modules` *before* installing; when it aborts — e.g. `EPERM` on a native `.node` file held by a running production server — it leaves **19 top-level packages, no `node_modules/.bin`, and `next` without its `package.json`**. Every later gate item then fails in under a second for a reason that is not the code. This is a hazard to any developer's working tree, not only a red gate. | M16's evidence README, "The release gate could not be used as a comparison"; `node_modules` restored there with `npm ci` (445 packages, 0 vulnerabilities) |
| **Repository-root `scripts/` is outside every quality gate** | Found during M17. CI runs with `working-directory: frontend`, so `scripts/sync-m16-lyrics.mjs` and `scripts/sync-m17-home.mjs` — the two guards that protect the *specs of record* from a silently lossy merge — are never linted, formatted, type-checked, or tested. The M16 script does not currently pass Prettier's check. Closing this means changing CI, which is repository governance and therefore out of scope for a feature milestone; until then each sync script must be run and its output recorded by hand. | M17's evidence README; `scripts/sync-m17-home.prove.mjs` exists precisely because the M16 guard was never shown failing |
| `tests/settings-ui.test.tsx` flake | A pre-existing load-sensitivity flake, roughly 1 run in 7: the file's `waitFor` for the local-data connection to open exceeds its 5s `asyncUtilTimeout` when the suite is loaded. The file already sets that timeout, so raising it further would mask a genuine hang rather than fix anything. Observed independently during M17; whether M17's added tests made it more likely is **unproven**. | M17's evidence README, "Suite"; `2026-10-02-m17-home-discovery` archived `tasks.md` 8.2 |
| **No browser verification of M17's Home** | Home was never opened at 1280×900 or 390×844, the filter was never switched by hand, and no card was ever pressed in a real browser. The time shelf's layout is reasoned from the existing `mb-8`/`gap-8` rhythm, not seen, and the hydration fix rests on `renderToStaticMarkup` plus `useSyncExternalStore` rather than on a console free of mismatch warnings. | M17's evidence README, "Not verified" |
| **The size half of M19's budget skips in CI** | `.github/workflows/ci.yml` runs `npm test` **before** `npm run build`, so six assertions that need a build report skipped and the run reports green for a file whose headline is a budget. Disclosed in the test file's header, which is honest but does not make the check run. The manifest and import rules — the "no animation library" half — are unconditional and do run; verified by hiding the chunk directory and observing `11 passed | 6 skipped`. Moving the build earlier in CI is a CI change and therefore its own decision, **scheduled into M21** alongside the flaky release gate. | M19's evidence README, "Recorded, not fixed" |
| **An animation library outside the 17-name list is invisible in CI** | The budget has two backstops: a named-list rule that runs unconditionally, and a size rule that skips without a build. A renamed or forked animation package is caught only by the second, so in CI it would pass. Narrow, and stated in the test's own comment; **scheduled into M21** with the skip above. | M19's evidence README, "Recorded, not fixed" |
| **No motion has been seen** | M19's motion is **reviewed, not seen**. No browser is available, and both the production and Preview Vercel origins sit behind Deployment Protection — every path on either answers `302` to `vercel.com/sso-api`. So no transition was seen, no frame or responsiveness measurement was taken (the roadmap's before/after frame behaviour is *unmeasured*), `prefers-reduced-motion` was asserted structurally and never observed resolving, and no layout was reviewed at either viewport. What could be made structural instead of visual was: only `opacity`/`transform` ever transition, a leaving dialog is `inert` and `pointer-events: none` from its first frame, and nothing waits on `transitionend`. | M19's evidence README, "Not verified" |
| **The 407-byte attribution is prose, not a measurement** | M19 measured a total client bundle of 384,831 B before and 385,238 B after, and attributes the +407 B to the `Dialog` leave lifecycle. The spike branch is deleted and no pre-M19 build is retained, so the total is reproducible but the per-component split is not. Recorded as prose rather than asserted. | M19's evidence README, "What motion actually cost" |
| **Two pre-existing `text-body` uses remain on Now Playing** | `text-body` is a dead utility — `styles/tokens.css` declares only `caption | body-lg | link | heading | label`, so the class compiles to nothing. One occurrence sits on a line M19 touched and one is untouched; **both predate M19**, confirmed against HEAD. Provably a no-op on the rendered result, left as a separate fix rather than widening M19's change. | M19's verification report; `frontend/src/app/now-playing/page.tsx` |
| **One suite run during M19's archive exited 1 and could not be attributed** | The run's output was not captured, so the failing test is unknown. Five subsequent full runs were green at 167 files / 2829 tests. It is consistent with the two known pre-existing flakes, but "consistent with" is not an identification, and it is recorded as an observation rather than as a clean bill of health. | M19's archive; see the two named flakes in this table |
| **M17's "no motion" is about vocabulary, not the rendered DOM** | The time shelf's action reuses the design system's Ghost Text Button, which DESIGN.md defines *with* a `transition`, so the rendered control fades on hover — and `HomeFilterBar` in the same milestone already used `variant="ghost"`. This is reuse of a documented primitive, not a new vocabulary, but a reader who takes "M17 adds no motion" as a claim about the DOM will be wrong. The guard's documentation states the distinction explicitly. | M17's evidence README, "Scoped claims"; `frontend/tests/motion-scope.test.ts` (renamed from `home-m17-no-motion.test.ts` by M19, which generalised its coverage) |

| **The no-motion guard covers only M17's surface** | Found during M18's verification. `frontend/tests/home-m17-no-motion.test.ts` scopes itself to `features/home` plus `Shelf.tsx`, so a motion utility added to `features/shortcuts`, `features/sharing`, `features/search`, or `components/design-system/Dialog.tsx` is caught by nothing. M18 was checked by hand — no added line in `frontend/src` contains `transition-`, `animate-`, `duration-` or `ease-`, and the three `transition-` hits in M18-touched files are all pre-existing — but a by-hand check does not survive the next milestone. Generalising the guard is the natural companion to M19, which is the milestone that adds motion deliberately. | M18's evidence README, "Scoped claims"; scheduled into **M19** |
| **No shortcut, dialog, or share has been exercised in a browser** | Only Edge is installed here and there is no browser-automation dependency, so M18's evidence is jsdom plus static architecture rules. Unverified: real `KeyboardEvent.key` values (so the `"Space"` legacy branch is untested against any engine); real `Tab` movement, so `Dialog`'s focus trap has never been driven by the browser's own tabbing — the tests assert the cycle the code performs, because jsdom does not move focus; the `isContentEditable === true` branch, which jsdom does not implement at all; screen-reader announcement of `aria-activedescendant`, `role="listbox"`, and the dynamically-mounted `role="status"`; `navigator.share` cancel semantics and `navigator.clipboard`, both needing a user gesture; that `preventDefault` actually cancels scrolling; and the help trigger's placement at `fixed bottom-32 right-4`. One unresolved detail: the combobox popup and the `Dialog` backdrop are both `z-40`, so the stacking winner is DOM order. | M18's evidence README, "Not verified" |
| **One harness run reported 59/60 and could not be attributed** | During M18's Apply, one induced-violation run reported 59/60 and the next four reported 60/60. It could not be pinned to a case because the output was filtered too aggressively to distinguish the harness's own `FAIL` line from vitest's output inside it. Independent verification then ran the suggestion suite 22 consecutive times with no failure and showed its timing is deterministic by construction, so the most likely explanation is environmental rather than a flaky detector — but that is a hypothesis, not a measurement, and it is recorded as such rather than dismissed. | M18's evidence README, "Gates" |

**Three of the above are prerequisites for post-v1 work and are scheduled inside it**: the flaky
release gate is fixed in **M21** (post-v1 work must be gated by a gate that means something), the
gate's destructive install step is fixed in **M21** (a gate that can silently break a working tree
cannot be run to validate anything), and the parked player's browser re-verification is revisited in
**M21** once the motion and interaction changes have altered the surfaces being measured.

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
| Full Now Playing | **KEEP / REDESIGN** | Add the YouTube playback surface where needed. *The "visible compliant" part was reversed* by `lyrix-style-hidden-player` (2026-10-02): the player is parked during normal playback and revealed by an opt-in video mode on this route. See the §6.2 note on the reversed visible-surface row. |
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
| ~~Visible compliant YouTube surface~~ | **REVERSED** | **Deliberately reversed by `lyrix-style-hidden-player` (2026-10-02), for private/personal use.** Spotivibe now parks the single persistent YouTube IFrame at 1×1 with zero opacity and takes Spotivibe's PlayerBar/MiniPlayer as its only visible playback interface, with an opt-in video mode on Now Playing. This is Lyrix's hidden-player architecture, and it does **not** meet YouTube's documented visible-player requirement. Nothing else in this table changes, and no extraction, stream download, media proxy, or ad blocking was introduced. **Before any public deployment this must be reverted to a visible surface.** |
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

**Updated 2026-10-03.** The items marked **[NOW APPROVED — M16]** … **[NOW APPROVED — M20]** below
were approved as post-v1 scope on 2026-10-03 and are specified in §12. They are no longer
"merely deferred" and must not be described as such. Their v1 deferral is recorded rather than
erased, because the reason for it was sound and the reversal is a decision someone will re-read.

| Item | v1 decision | Post-v1 status |
|---|---|---|
| Synced lyrics / karaoke lyrics | Deferred | **[NOW APPROVED — M16]** |
| Lyrics translation/romanization | Deferred | Still deferred. Not in post-v1 scope; it needs a translation service and a per-line data model neither of which exist. |
| Keyboard shortcut suite beyond basic accessible controls | Deferred | **[NOW APPROVED — M18]** |
| "Download manager for non-YouTube licensed/owned audio" | Deferred — *no download product work without a legitimate media source* | **[NOW APPROVED — M20] with the "legitimate media source" condition explicitly reversed.** See §12.6. |
| Social/friend activity | Deferred | Still deferred. Requires accounts, which are a permanent exclusion. |
| Collaborative playlists | Deferred | Still deferred. Same reason. |
| Public user profiles | Deferred | Still deferred. Same reason. |
| Spotify account/library import | Deferred | Still deferred. Same reason. |
| Native Android/iOS apps | Deferred | Still deferred. PWA is the intended client. |
| Equalizer | Deferred | Still deferred. No audio-graph surface exists, and the player is a YouTube IFrame. |
| Crossfade | Deferred | Still deferred. Requires controlling playback across two media sources, which an IFrame does not expose. |
| Gapless playback guarantees | Deferred | Still deferred. Same reason, and "guarantee" is a claim an IFrame cannot support. |
| Sleep timer | Deferred | Still deferred. Not in the approved post-v1 set. |
| Chromecast/AirPlay integration | Deferred | Still deferred. |
| Richer Home (daily mix cards, quick picks, time-aware shelf, All/Music/Podcasts filters) | Not previously listed | **[NOW APPROVED — M17]** |
| Search suggestions | Not previously listed | **[NOW APPROVED — M18]** |
| Track/catalog sharing (Web Share + copy link) | Not previously listed | **[NOW APPROVED — M18]** |
| Motion and interaction polish | Not previously listed | **[NOW APPROVED — M19]**, including a *decision* on whether `framer-motion` is justified |

---

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

**Added 2026-10-03, for the post-v1 milestones** — again, references and not drop-in
dependencies. Each row records the specific behaviour to take and, where it matters, the specific
thing in the Lyrix original that must *not* be copied.

| Lyrix area | Spotivibe use | Do not copy |
|---|---|---|
| `frontend/src/components/player/SyncedLyrics.tsx`, `services/lyricsApi.ts`, `backend/src/services/lyricsService.ts` | M16: LRC parsing, duration-aware LRCLIB scoring, active-line selection, auto-scroll following. | The inline-style component, the Zustand coupling, and the Prisma lyrics cache. |
| `frontend/src/services/suggestionsService.ts` | M18: query refinements, recent searches, no-results recovery. | The hardcoded `FALLBACK_SUGGESTIONS` genre list as a fixed answer, and the separate `API_URL`/`fetchWithAuth` client. |
| `frontend/src/hooks/useKeyboardShortcuts.ts` | M18: the binding set and help surface. | Its mute implementation — it sets volume to `0` and restores a hardcoded `70`, destroying the listener's volume. Spotivibe has a real `muted` state. Its `isContentEditable`-only focus check, which is not enough to protect a focused slider or dialog. |
| `frontend/src/services/shareService.ts` | M18: Web Share with a copy-link fallback. | Any account-gated or server-side share path. |
| `frontend/src/hooks/useDownload.ts`, `services/downloadService.ts` | M20: the four download states, the Blob→object-URL→`<a download>` flow. | The `isLoggedIn` gate and the `login()` call — Spotivibe has no accounts and adds none for this. |
| `backend/src/routes/download.ts`, `controllers/downloadController.ts`, `services/downloadService.ts` | M20: ytdl-core primary with an Invidious fallback, ID validation, streaming. | The Express router/controller layer, `requireAuth`, and `stream.pipe(res)` — Spotivibe is one Next.js application with a route handler. |
| `backend/src/middleware/rateLimiter.ts` | M20: the shape of a bounded per-instance download limit. | `express-rate-limit` itself, and the other five limiters, which exist for Lyrix's account-backed API. |

## 9.2 Lyrix Areas That Must Not Be Ported

- Google OAuth/auth controllers/providers.
- JWT/cookie user-session system.
- User database/Prisma models that exist to support accounts.
- MySQL/TiDB persistence for user data.
- Server-stored history/saved tracks/playlists.
- User-profile rebuild jobs.
- Collaborative-filtering/ALS model and cross-user training data.
- Lyrix Python AI service as a required dependency.
- Private YouTube playlist export/sync that requires user OAuth.
- Quota dashboard that exists only for official keyed API operations not used by baseline Spotivibe.
- Lyrix branding/UI components as final Spotivibe UI.
- Any behavior intended to suppress YouTube ads.

**Revised 2026-10-03.** Two entries were removed from this list by §18's recorded reversal, not
by oversight, and the reasoning is preserved here rather than left to be re-derived:

- *"Download/audio extraction service"* and *"Auth-gated download route"* are no longer absolute
  prohibitions. M20 approves a download route with **no auth**, because a personal instance has
  no accounts to gate against. What remains prohibited is unchanged in substance: the **auth
  gate** is still never ported, and any central server-side store of downloaded media is still
  refused — download is to the device, not to a server library.
- *"Lyrix's undersized `120x68` YouTube player presentation"* was removed by the parked-player
  change (§12.5 in the earlier draft numbering; the parked-player archived change), which
  deliberately adopted the hidden-player approach and documented the departure.

Still absolutely prohibited, unchanged: ad suppression, audio capture/decoding, hidden
background playback circumvention, and any account or cloud infrastructure.

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

- [x] Music and podcast queries use category-appropriate filters.
- [x] Long durations do not break seek/progress/session restoration.

**Delivered by M12** (spec: `podcasts`, change `add-podcasts`):

- Podcast search mode: a bounded `category` parameter threaded route -> service ->
  chain -> providers -> filter -> cache key, with the mode in the URL
  (`/search?q=...&mode=podcast`) and a mode control on the search surface.
- Curated podcast categories: eight per-language query-seed entries that open a
  podcast-mode search, with the M8 neutral-fallback language convention and no new
  feed kind or route.
- Podcast playback: the same persistent player, with a restore clamp for a stored
  position beyond the current duration and podcast-sized duration bounds.
- Podcast history: the existing listening-history dataset, unmodified, with a
  podcast play listed on History and counted by the local statistics.

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

### How M13 was verified

Every milestone from M13 runs an independent read-only verification pass before its
Apply PR is merged: it is given the change's specification and the implementation and
nothing else, and it reports findings against the requirements with file and line
references. For M13 it found nine defects that the test suite and a passing browser
evidence run had all missed. The pattern that worked - and that M14 and M15 should
reuse - is:

- drive the **shipped bytes** where a rule can only be checked by execution, rather
  than testing a copy of the logic;
- make every evidence assertion **falsifiable**, by scoping it to exactly what its
  name claims and by proving each detector against a violating snippet;
- treat "the spec says X and the code does Y" as a finding in either direction: amend
  the requirement when the code is right, move the code when the requirement is.

### Delivered by M13

- A typed Web App Manifest route (`src/app/manifest.ts`) with a stable `id`, root
  `start_url`/`scope`, `display: standalone` and DESIGN.md's own colors; PNG icons
  at 192/512 plus a maskable 512, generated from `icon.svg`'s geometry by a
  committed Node script (no image dependency, `--check` for drift).
- A hand-written `public/sw.js` (no `serw`/`workbox`: both need a custom Node
  server, which breaks the Vercel free-tier shape in section 7.1) whose strategy is
  a per-request-class decision table: cache-first hashed assets, bounded artwork
  with background revalidation, bounded keyless metadata with a 7-day freshness
  bound, and an explicit deny list that keeps the YouTube player API, media,
  non-GET, `Range`, search, radio, and playlist requests on the network. Every
  cache has a named bound and FIFO eviction.
- One ordered fallback chain for every same-origin navigation - network, then the
  route's own cached document, then a *redirect* to the cached shell - so an offline
  visit to an uncached route lands the listener in the application, at a URL that
  matches what is shown, instead of on the browser's "no internet" page. It cannot
  render the route they asked for, because a single offline shell has never been sent
  that route; the connection banner says what needs a connection. Found and fixed by
  the browser evidence run.
- The worker precaches exactly one entry (the shell document) at install into a cache
  of its own - so the page cache's FIFO bound cannot evict the one entry the offline
  fallback depends on - never touches IndexedDB, and on activation deletes only caches
  matching its own names and previous versions.
- An install row in Settings that appears only where the platform offers
  installation, withdraws once asked, remembers a dismissal in a namespaced
  `localStorage` boot flag (not a dataset, not a backup field), and explains *Add
  to Home Screen* where iOS exposes no programmatic prompt.
- An update notice in the shell on every route: a new worker installs into `waiting`
  (install never calls `skipWaiting`, so a version swap is never silent), the notice
  announces it with Later/Reload, `SKIP_WAITING` activates it over a live message
  port, and the page reloads into the new build.
- Honest offline copy: the connection banner names search and playback as needing a
  connection and states that the library, playlists, and history still work, with a
  negative test that scans every shipped source for offline-playback claims.
- Verification: 2152 unit tests (new suites for the worker's shipped bytes, the
  manifest and decoded PNGs, the client modules, and the offline-claim scan; an M13
  architecture section for the worker, which no existing rule covered), plus a
  browser evidence run (`evidence/results.json`, `pass: true`, 34/34 steps, 5
  screenshots, 0 console errors) whose offline phase stops the production server so
  "offline" means a genuinely unreachable origin. An independent verification pass then
  compared the implementation against the change's own specification and found nine
  further defects, all fixed - including a silent update swap, a stale search result
  cached through a navigation, listener-derived seeds written to the metadata cache,
  and an offline shell that was silently evicted after nineteen navigations.

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

### Delivered by M14

Most of this milestone's items were already implemented and are now *pinned* rather
than re-implemented: provider timeouts and fallback, bounded outbound concurrency,
in-flight deduplication, playback retry caps, graceful unplayable-track handling, zod
query validation with length caps on every route, validated backup import before any
transaction, and bounded local lists. Re-implementing working code to "harden" it is a
change that can only lose. What was genuinely missing:

**Security**

- A response security policy declared once in `next.config.ts` (spec `security`): a
  Content Security Policy written from the origins the browser actually contacts — the
  YouTube IFrame API and its embed frame, and the artwork host whose URLs the *server*
  builds — plus `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Permissions-Policy` and the cross-origin isolation pair, applied to every response
  including the manifest, the worker file, and static assets. The provider origins are
  deliberately absent: they are contacted in Node, so permitting them would grant the
  page access it does not use. `tests/security-policy.test.ts` reads the origins out of
  the sources and fails in **both** directions — an origin the browser needs that the
  policy omits, and an origin the policy permits that nothing in the browser needs.
  Inline script and style stay permitted with a recorded `DEBT` note, because the App
  Router bootstraps hydration inline; `unsafe-eval` is development-only and the suite
  asserts both halves.
- Best-effort per-instance throttling on the public boundary (spec `security`): a
  fixed-window limiter, 60 requests per minute per address and route class, a bounded
  map of 5000 keys that evicts its own oldest, and `Retry-After` on a refusal. All seven
  routes cross one shared `guardRequest`. It is per-process, per-instance and lost on
  restart — not a quota, and not coordinated across instances — which the module, the
  spec, and a test that reads the module's own text all say.
- Boundary input validation as a rule for every route, enforced by the architecture
  suite: every route validates and bounds its parameters, serves only `GET`, and reads
  no request body.

**Resilience**

- Cache-corruption recovery (spec `pwa`): every worker cache read goes through one
  helper that concludes whether a stored entry can be served — a body whose length
  contradicts `content-length`, an empty document, a read that throws — and an unusable
  entry is deleted and treated as absent, so a device with a corrupted store falls
  through to the network exactly as a device with an empty one does. A cache that cannot
  be *written* no longer breaks the response it was returning.
- A listener-visible storage failure (spec `local-data`): a database that cannot be
  opened or upgraded is reported as a named state that says what happened, that nothing
  was deleted, and that the data is still on the device — never as an empty library,
  which looks identical from inside and means something entirely different to the person
  looking at it.
- "A stored record is untrusted" as a shared rule (spec `local-data`):
  `data/repositories/renderable.ts` judges a record against the fields a surface reads,
  as type-narrowing predicates applied where repository reads land. It skips rather than
  repairs, because a fabricated title in someone's library cannot be told apart from
  real data.

**Performance and accessibility measurement** (specs `performance`, `app-shell`)

- One dependency-free CDP harness (`evidence/audit.mjs`) that measures Core Web Vitals in
  a real browser and audits contrast, accessible names, focus visibility, and Tab
  reachability — each audit proven against a deliberately degraded page before it is
  trusted on the real one, and every surface measured at **both** a desktop and a compact
  viewport, because a check that only runs where a defect is invisible is not a check of
  the application.
- No telemetry: the measurement reports to a file, and the suite scans the shipped
  sources for analytics, beacon, and reporting calls.
- Local lists bounded by named constants that the surfaces state, and no interval in the
  application except the player's, which starts and stops with playback.

### Project targets defined during M14

The acceptance criteria above refer to "project targets defined during this milestone".
They are these numbers, and each names what it protects — a threshold with no reason is a
number someone relaxes the first time it is inconvenient.

| Target | Value | What it protects |
| --- | --- | --- |
| Largest contentful paint | ≤ 2500 ms | when the interface's main content is actually on screen |
| Cumulative layout shift | ≤ 0.1 | nothing moves after it has been painted |
| Total blocking time | ≤ 400 ms | responsiveness on a load, standing in for INP, which cannot be observed without interaction |
| Longest single task | ≤ 500 ms | past half a second a person waits rather than watches |
| Text contrast | ≥ 4.5:1, ≥ 3:1 at 24px or 18.66px bold | WCAG AA, computed from the shipped tokens |
| Request ceiling | 60/minute per address and route class | the shared provider instances the application depends on |
| Tracked limiter keys | ≤ 5000 | the limiter's own memory, under an address spray |

Each is a **regression bound measured on one machine against a local production build**,
not a field lab score. `evidence/results.json` records the machine, the viewports, and the
cold-or-warm load beside every number, and `evidence/README.md` states the limits.

### How M14 was verified

`evidence/results.json` reports `"pass": true`: **62 checks** across 5 surfaces at 2
viewports plus the security, throttling, storage-failure, worker-uniqueness, and
offline-recovery phases, with **0 console errors** and 4 screenshots. The offline phase
**stops the server process** rather than emulating an offline mode, because M13 recorded
that as the only definition worth trusting.

Nine defects were found by the work itself, and three of the four the measurement found
were defects in the *measurement*: a cache-write failure that rejected the whole request,
two reads of one cache entry where one bypassed the usability check, a `PerformanceObserver`
installed after load that reported a null LCP as `0ms`, an accessible-name check that
hand-rolled a subset of label association and reported two correctly labelled radios as
unnamed, a primary-control selector that never matched role-based controls, an audit that
measured one viewport and so could not see the compact shell at all, that shell's
inactive navigation label painted at 4.16:1, a `text-error` class matching no declared
token so two `role="alert"` paragraphs rendered in the inherited colour, and a `//`
comment in JSX children position that rendered as page text.

Every milestone from M13 runs an independent read-only verification pass before its Apply
PR is merged. For M14 it checked the implementation against the change's own five spec
files, its eight design decisions, the evidence's falsifiability, and the correctness of
the throttle, the worker, and the record predicates. It returned **NOT MERGEABLE**, with
two CRITICAL findings that were both in this change's own work and both verified by
executing rather than reading: an integrity check that compared a **byte** count to a
**character** count and so deleted *intact* cached entries, and a `Referrer-Policy:
no-referrer` that contradicted the `playback` spec's own "SHALL NOT suppress the page
referrer" — which slipped past the M11 guard written to catch it, because that guard
matched an inline JSON-style pair while the header was declared as a `{ key, value }`
array entry. Fourteen warnings and the nits followed. All are recorded in the archived
change's `tasks.md` and `evidence/README.md`.

**Lifecycle.** Propose #58 `0d855f9`, Apply #59 `d65abb4`, Sync #60 `a6cfb1c`, Archive
#61 `e2362f9`; archived as
`openspec/changes/archive/2026-09-30-add-deployment-hardening/`. The change added two
capabilities (`security`, `performance`) and amended three (`pwa`, `local-data`,
`app-shell`), taking the specs of record from **16 to 18 capabilities**, all validating.
`openspec validate --specs --strict` reports **18 passed, 0 failed**; 15 changes are
archived and none is active.

**Reconciled at Sync.** Two verification tasks were still unticked, and reconciling them
found that the change's own gate table *understated* what had been verified — 2225 tests,
written before the verification pass's fixes added their regression tests, where the
clean-clone run produced **2231**. The table now carries the run's own number and names
the commit it describes, the evidence harness's `task` field was corrected from four tasks
to the ten it actually covers, and the gate table states the lint warning count, because
`npm run lint` exits 0 with warnings and eight had accumulated under a green build. The
repository is at **zero**.

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
- No YouTube audio downloader/extractor exists. **True for v1. Reversed for post-v1 private use
  by M20** — see §18 and §21.5. The v1 line is preserved because it was the v1 release gate.
- No forced background-play circumvention exists.
- No ad-blocking behavior exists.
- No media is proxied through Vercel.
- Backup format/version documented.
- Attribution notices included for substantial Lyrix-derived code.
- Vercel production build passes.
- PWA manifest/service worker validate.
- Critical flows pass automated and manual tests.

**Superseded for v1 only.** The two lines above — "No YouTube audio downloader/extractor exists"
and "No forced background-play circumvention exists" — described the v1 release gate and are
preserved as the v1 record. §12.6 reverses the first one for private/personal post-v1 use, and
§12.5's parked player is the second. The second remains a permanent exclusion.

---

# 11. Feature-Level Acceptance Checklist

This section prevents roadmap phases from accidentally shipping without important user-facing pieces.

### Delivered by M15

- **The permanent product exclusions are enforced.** Eight detectors over the shipped
  sources with 39 violating-shape fixtures each, plus a route-path rule, sweeping `src/`,
  `public/`, `scripts/`, and `next.config.ts` together. ROADMAP §2 called these "deliberate
  product decisions, not temporary MVP shortcuts" and nothing asserted them; they were held
  by review, which is the mechanism that erodes. `no cloud sync` became a ninth checkable
  exclusion as a result, and had none before.
- **One maintained end-to-end suite.** The eleven named flows, in a real browser against a
  production build, driven by accessible name and role. The thirteen per-milestone browser
  harnesses in the archive were the finding: thirteen copies of the same plumbing, none of
  which ran.
- **A runnable release gate.** It prints a per-item result or a not-run reason *with the
  steps to perform it*, and fails if any item on this roadmap's release checklist is
  unrepresented — including partial coverage, which it reports rather than counts as whole.
- **A deployment contract, asserted.** One application, no custom server, no request hook in
  either directory Next reads one from, no required environment variable, the security policy
  declared where a CDN cannot drop it, and the worker served without a cache header that would
  make the application unupdatable.
- **A real deployment defect fixed.** `package.json` declared no `engines` field, so a Vercel
  build would use the host's default Node rather than the Node 26 this repository is
  verified on — and would still have *succeeded*, because the application has no required
  variables, no custom server, and no native dependencies, before differing at runtime from
  anything tested.
  *Corrected after M15: the runtime target is now **Node 24**, because Vercel cannot build on
  Node 26 at all — it offers 24.x, 22.x, and 20.x. The pin M15 added was internally consistent
  and externally unsatisfiable, which is the failure mode the deployment contract could not
  see; it now checks the target's documented set and proves itself by rejecting Node 26. See
  `openspec/changes/archive/2026-10-01-align-vercel-runtime-and-root-commands/`.*
- **The backup format, the browser matrix, and the deployment procedure documented**, each
  held to the code it describes by a test rather than trusted to prose.

### What M15 established about verification

Two independent read-only verification passes ran against this change and **both returned
NOT MERGEABLE**. That is the most transferable thing M15 produced, and it is recorded here
because the lesson generalises past this milestone:

**A rule can be green and wrong because its detector never matched the code's real shape.**
Each of the first pass's critical findings was a check that passed and would have missed the
thing it names. The check on a detector is not that it passes — it is that it has been *seen
to fail*. The first pass probed the exclusion detectors with eighteen realistic violating
snippets and seventeen passed; the second probed the repaired patterns with twenty-five more
and seventeen of those passed too. All forty-three are now fixtures, and thirty-four of them
found something.

The second pass's five criticals were four of the same failure modes the first had already
named, committed a second time and then reported as fixed — including one this change
introduced and then claimed to have fixed. A fix that is half a fix is worse than no fix,
because it is reported as a fix.

### What M15 did not verify

- **A second browser engine.** One is installed on the machine that ran it. The gate reports
  a second-engine run as NOT RUN with the reason and the steps.
- **A real Vercel deployment.** It needs credentials this project does not have and does not
  want. `frontend/docs/DEPLOYMENT.md` is the procedure.
- **Firefox, Android, and iOS.** The automation is a Chromium protocol; all three are manual
  entries with instructions and the evidence each should produce.
- **The DESIGN.md visual audit.** Contrast, accessible names, and keyboard reachability are
  computed; proportion, hierarchy, and visual rhythm are human judgements.
- **The completeness of the pattern-based detectors.** A static pattern cannot enforce a
  semantic property. The three genuine proofs are the allow-lists: the exact runtime
  dependency list, no environment read outside the schema, and the route path rule.
- **A falsifiability proof over every flow.** It covers four of eleven, against a requirement
  that says each.

An evidence record that understates its coverage is the same class of error as one that
overstates it, and the unchecked items above are recorded for that reason rather than ticked
with a note contradicting them.

## Navigation / Shell

- [ ] Desktop sidebar/library.
- [ ] Main content region.
- [ ] Global search/navigation.
- [ ] Persistent player bar.
- [ ] Mobile bottom navigation.
- [ ] Responsive Now Playing.
- [ ] Spotivibe branding/icons.

## Search / Discovery

- [x] YouTube Music Innertube primary.
- [x] YouTube Web Innertube fallback.
- [x] Invidious fallback.
- [x] Piped fallback.
- [x] Local library fallback/search.
- [x] Debounce + abort stale requests.
- [x] Music quality/remix filtering.
- [x] Duplicate handling.
- [x] Search history.
- [x] Artist navigation.
- [x] Album navigation where metadata supports it.
- [x] Podcast search/category.
- [ ] **Post-v1:** search suggestions — query refinements, local recents, empty and no-results
      recovery, with debounce/abort/URL sync preserved (M18).
- [ ] **Post-v1:** richer Home — daily mix cards, Quick Picks, time-aware shelf, and
      `All`/`Music`/`Podcasts` filters over one data model (M17).
- [ ] **Post-v1:** motion polish, with a written and measured decision on `framer-motion` (M19).

## Player

- [x] Single persistent YT player instance.
- [x] Visible/compliant playback surface. **Reversed 2026-10-02**: the player is now parked and
      there is no visible surface by default. See the parked-player change and §18.
- [x] Play/pause.
- [x] Previous/next.
- [x] Seek/progress.
- [x] Volume/mute.
- [x] Shuffle.
- [x] Repeat off/all/one.
- [x] Retry/backoff.
- [x] Skip unavailable tracks.
- [ ] Pre-cue next where safe.
- [x] Session restoration.
- [x] YouTube attribution.
- [ ] **Post-v1:** global keyboard shortcuts, with no shortcut firing in a focused control (M18).
- [ ] **Post-v1:** share current track / catalog surface, Web Share with copy-link fallback (M18).
- [ ] **Post-v1:** download current track to the device, honestly named for its real format (M20).
- [ ] **Post-v1:** synced lyrics with active-line highlight and auto-follow on Now Playing (M16).

## Queue / Radio

- [x] Add/remove/reorder.
- [x] Current/next/upcoming/history.
- [x] Duplicate protection.
- [x] Auto-advance.
- [x] Queue autofill.
- [x] Track Radio.
- [x] Artist Radio.
- [x] Radio refill.
- [x] Played-track dedupe.

## Library

- [x] Liked Songs.
- [x] Create playlist.
- [x] Rename playlist.
- [x] Delete playlist.
- [x] Add/remove playlist tracks.
- [x] Reorder playlist tracks.
- [x] Play/shuffle playlist.
- [x] Playlist hero/cover.
- [x] Public YouTube playlist import into local library.

## Content Pages

- [x] Home.
- [ ] Search.
- [x] Discover.
- [x] Artist.
- [x] Album/release.
- [ ] Playlist.
- [ ] Library/Liked Songs.
- [x] Now Playing.
- [x] History/Stats.
- [x] Podcasts.
- [ ] Settings/Data.

## Personalization

- [x] Language onboarding.
- [x] Local taste profile.
- [x] For You.
- [x] Trending.
- [x] Popular Artists.
- [x] Genre discovery.
- [x] More Like This.
- [x] Smart Mixes.
- [x] Recently Played.
- [x] Listening stats.
- [x] Listening streaks.

## Local-First / PWA

- [x] IndexedDB repositories.
- [x] IndexedDB migrations.
- [x] Versioned JSON export.
- [x] Validated JSON import.
- [x] Merge import.
- [x] Replace import.
- [x] Clear/reset controls.
- [x] Web App Manifest.
- [x] Service Worker.
- [x] Installable standalone app.
- [x] Offline app shell.
- [x] Offline library metadata.
- [x] PWA update flow.
- [x] Online/offline indicators.

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

After v1, new features are not assumed merely because Lyrix or Spotify has them. Additions such as cast support, equalizer, crossfade, licensed-download sources, or new provider types require a deliberate update to this roadmap.

**Updated 2026-10-03 — seven features were approved by this route** and are specified in §12:
synced lyrics (M16), richer Home discovery (M17), global keyboard shortcuts, search suggestions
and sharing (M18), motion polish (M19), and personal-use media downloading (M20). They are no
longer "merely deferred" — see §6.4 for the per-item table, which records the v1 decision beside
the post-v1 status so the history reads as a decision rather than an erasure.

### Reversed on 2026-10-03, with the reversal recorded

**"YouTube audio extraction/download" moves from permanently out of scope to approved post-v1
private/personal-use scope (M20).** This is a deliberate reversal of a v1 decision and is
recorded here rather than deleted. The v1 reasoning was sound: v1 aimed at a public, policy-
compliant, free-tier product, and a permanent download path is incompatible with that. The
post-v1 reasoning is that this instance is for private personal use, where the trade is the
operator's alone to make.

What the reversal explicitly does **not** do:

- It does **not** make the feature compliant. Downloading YouTube audio is not permitted by
  YouTube's documented embedded-player and download policies, and nothing in this repository
  may describe it as compliant. `frontend/docs/DEPLOYMENT.md` states the same for the already-
  reversed parked player.
- It does **not** authorize ad blocking, ad suppression, or any interference with ad serving.
- It does **not** authorize accounts, OAuth, cloud sync, a user database, or any centralized
  profile — in particular, no Google Sign-In is added "merely for downloading".
- It does **not** authorize unrelated media scraping, or a managed offline library in IndexedDB.
  Download-to-device only; a managed offline library requires its own future change.
- It does **not** change the parked-player decision in either direction.

### Still not eligible without reversing a permanent decision

- Spotivibe accounts;
- cloud sync;
- Supabase user storage;
- centralized listening profiles;
- cross-user collaborative filtering;
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
- Never silently introduce accounts, cloud sync, a user database, or background-play circumvention.
- YouTube downloading is **approved, but only through §18's recorded reversal**, as private/personal-use scope, and never described as compliant. It is neither silent nor open-ended.
- When Lyrix changes upstream, Spotivibe does **not** automatically inherit those changes. Port only changes that match this roadmap.

---

# 21. Post-v1 Milestones (Approved 2026-10-03)

These six milestones are approved scope. Each runs the full `AGENTS.md` lifecycle — Propose →
Apply → independent read-only verification → Sync → Archive — on its own branch and PR, merge
commits only.

**What is common to all six**, and is therefore not repeated per milestone:

- **No accounts, no OAuth, no cloud, no centralized profile, no Supabase.** Nothing here may
  introduce one. "Adapting Lyrix" never means importing its `useAuth`/`requireAuth`/`fetchWithAuth`.
- **Local-first stays local.** Taste, history, liked tracks and seeds are read from the existing
  IndexedDB repositories. Nothing new is uploaded anywhere.
- **Every new check must be shown to fail.** This repository has now paid for a green check over a
  live defect four separate times. A detector proved only against phrasing its own author chose
  proves much less than it appears to.
- **Browser verification where UI is involved**, and a stated `NOT VERIFIED` for anything the
  environment cannot exercise (this machine has Edge only, and the YouTube IFrame API is blocked
  by CSP, so playback and lyrics-cue behaviour cannot be observed live here).

## 21.1 M16 — Lyrics and Now Playing enrichment

**Objective.** A lyrics panel on Now Playing that highlights and follows the playing line when
timed lyrics exist, and shows plain lyrics when they do not, with honest empty/error states.

**Depends on.** M9 (Now Playing surface), M12 (podcasts share the Now Playing layout).

**In scope.**

- An LRC parser producing `{ time, text }` lines, handling `[mm:ss]`, `[mm:ss.xx]`, and
  `[mm:ss.xxx]`, ignoring untimed metadata tags, sorting by time, and dropping empty lines.
- A lyrics provider: title/artist/duration lookup against **LRCLIB**, with a duration-aware
  scoring preference for synced over plain and for the closest duration — the behaviour Lyrix's
  `lyricsService.ts` implements — including its title-cleaning and artist/title split.
- Caching **without a database**: an in-process LRU plus negative caching for "not found", since
  Spotivibe has no server-side store. Lyrix's Prisma cache is not portable and is not wanted.
- The active line computed from `playerStore.positionSeconds` by binary search, reset on track
  change, so a new track never inherits the previous track's cursor.
- Auto-scroll to centre the active line, with an explicit user-scroll override that suspends
  following until the user returns to the live position.
- Explicit states: idle, loading, unavailable, error. They must be distinguishable — "no lyrics
  for this track" is not "we could not reach the provider".
- `prefers-reduced-motion`: no animated transitions and no smooth-scroll following.
- Accessible: the active line announced politely rather than read as a live region per line.

**Non-goals.** Lyrics translation or romanization. Lyrics for podcasts (no lyric source). A
lyrics database. Editing or correcting lyrics. Karaoke word-level timing.

**Implementation notes.** Lyrix's `SyncedLyrics.tsx` is 234 lines of inline styles against a
Zustand store; Spotivibe's equivalent must use `playerStore`/`queueStore`, the design-system
primitives, and Tailwind tokens from `frontend/docs/DESIGN.md`. Its scroll maths
(`el.offsetTop - container.offsetTop - ...`) is offset-parent-dependent and is the part most
worth rewriting rather than porting. Note the existing Now Playing surface already has a
long-title treatment and a bottom padding budget that a lyrics panel must respect.

**Automated verification.** Parser unit tests over real LRC fixtures including malformed tags,
duplicate timestamps, and out-of-order lines. Active-line selection at boundaries (exactly on a
timestamp, between timestamps, before the first, after the last). Reset-on-track-change. The four
UI states. Reduced-motion behaviour. Provider scoring and its negative cache.

**Browser verification.** Active-line highlight advancing against a real position source, and
auto-scroll following. **Not verifiable in this environment** (IFrame API blocked by CSP) — the
position *plumbing* is verified in jsdom, the *following* is not.

**Completion criteria.** Lyrics appear on Now Playing for a track that has them, in the correct
format, and the panel is indistinguishable in structure from the rest of the surface. All four
states reachable and distinct. No regression to existing Now Playing tests.

## 21.2 M17 — Home discovery enrichment

**Objective.** A materially richer Home built **entirely on the existing local taste system** —
no cloud, no profile service, no new data models.

**Depends on.** M11 (Smart Mixes: `generateMix`, `mixNaming`, `MixList`), M8 (Home: `HomeView`,
`homeSections`, `localSeeds`, `useDiscoveryShelf`, `genreCatalog`).

**In scope.**

- **Daily mix cards** built on the existing mix generator and naming: the identities Top,
  Discovery, Chill, Night, and language-aware mixes derived from `preferences.languages`. Each is a
  card that starts playback, not a new page. Multi-artwork collages where the mix has several
  tracks.
  **Identity is not display name.** The identity may be `top`; the name it *shows* is its own leading
  taste word, gated by `isHonestMixName`, falling back to a neutral local label. `isHonestMixName`
  rejects `"top"` by construction — "top" is a ranking word — so a card may claim the taste it can
  support and nothing more. The original wording here named the cards "Top Mix, Discovery Mix, …";
  that is the identity list, not a promise of those literal strings, and it could not have been the
  display list.
- **Quick Picks**: a compact artist/content shelf derived from selected languages, the local
  listening profile, liked artists/tracks, and existing provider results. Every card leads to an
  existing artist, album, or search surface — no dead ends.
- **Time-aware shelf**: morning / afternoon / evening / late night, where local time selects a
  **seed set and query construction only**. The listener's clock is the input; their history is
  never sent anywhere. The shelf selects local material *and* carries one action that composes a
  mix from the band's seed set through the shared generator — on activation only, so Home's
  render-time request count is unchanged.
- **Home filters**: `All` / `Music` / `Podcasts`, selecting which shelves are presented. One data
  model, three presentations — explicitly **not** three duplicated models.

**Non-goals.** Any server-side recommendation. Uploading taste or history. A user profile page.
New provider types. Following Lyrix's cloud mix service.

**Implementation notes.** `generateMix`/`mixNaming` already exist and are the substrate; the
work is presentation plus seed strategies, not a new generation engine. The filter must not fork
the section list into three divergent copies — one section model, filtered at render. Time-of-day
buckets must be injectable for tests (no test should depend on the wall clock, which is the same
class of bug as the 2-second wall-clock budget in `podcast-playback-history`).

**Automated verification.** Mix cards render from the existing generator and start playback on
activation. Time-of-day bucketing across all four bands, with an injected clock. Filter switching
presents the right shelves and preserves state. Quick Picks contain only resolvable links.

**Browser verification.** Home layout at 1280×900 and 390×844, filter switching, and a card
starting playback.

**Completion criteria.** Home is visibly richer, every card does something, and no new persistent
state was introduced.

## 21.3 M18 — Keyboard shortcuts, search suggestions, and sharing

**Objective.** Three independent interaction upgrades, grouped because they share the
global-input-handling problem and are each small.

**Depends on.** M5 (search), M7 (library/likes), M9 (catalog pages).

**In scope — shortcuts.** `Space` play/pause, `ArrowLeft`/`ArrowRight` seek ±10s,
`ArrowUp`/`ArrowDown` volume ±5, `M` mute, `L` like/unlike, `?` help, `Escape` dismiss.
**No shortcut may fire while focus is in an input, textarea, `contenteditable`, or any surface
where the key has a local meaning** — that includes the search field, the rename inputs in
playlist dialogs, and sliders, where `ArrowLeft`/`ArrowRight` belong to the slider. A global
handler that overrides a focused control is worse than no shortcut. A discoverable help surface
lists every binding and is reachable by pointer as well as by key.

**In scope — suggestions.** Query-derived refinements; local recent searches; optional
provider-derived discovery for an empty or failed search. Debounce, abort-on-change, and URL
synchronization preserved, and the existing `useSearchController` behaviour unchanged.

**In scope — sharing.** `navigator.share()` where available, copy-link fallback, optional small
menu for supported destinations. Spotivibe URLs and Spotivibe copy. Graceful fallback with no Web
Share API. Tracks and the catalog surfaces that have a shareable URL.

**Non-goals.** Customisable key bindings. Shortcuts while a modal owns the keyboard. A
centralized suggestion or profile service. Social sharing that requires an account.

**Implementation notes.** Lyrix's `useKeyboardShortcuts.ts` fakes mute by setting volume to `0` and
restoring a hardcoded `70` — which destroys the listener's actual volume. Spotivibe has a real
`muted` state and `toggleMute`, and must use it. Its `isContentEditable` check is also
insufficient: a focused `role="slider"` or a dialog's own key handling is equally "local meaning".

**Automated verification.** Every binding fires and does not fire in a focused input, textarea,
`contenteditable`, and slider. Help opens on `?` and closes on `Escape` and on pointer dismissal.
Suggestions debounce and abort; a superseded request never renders. Share falls back when
`navigator.share` is absent, and is a no-op-safe path when it rejects.

**Browser verification.** Shortcuts against a real focused element, help dialog focus trapping
and restoration, share on a real user-gesture path.

**Completion criteria.** No shortcut can break typing anywhere in the application — verified by
test, not by inspection.

## 21.4 M19 — Motion and interaction polish

**Objective.** Motion that improves the product, and an explicit, evidence-backed decision on
whether `framer-motion` is justified.

**Depends on.** M18 — motion is judged against surfaces that exist. (This originally read
"M16, M17, M18", inheriting an M16 motion vocabulary that M16 never shipped; corrected when
M17's archive found the dependency chain asserted a milestone that had nothing to give.)

**In scope.** Shelf and card entrance transitions; hover/tap feedback; player transitions; dialog
and sheet motion; Now Playing transitions; mix/Home content transitions. Every one gated on
`prefers-reduced-motion`.

**Non-goals.** Animating everything. Long or looping decorative motion. Any animation that costs
responsiveness.

**Implementation notes — the dependency decision is the milestone.** `framer-motion` is
**currently absent** from the project. It is ~30kB gzipped before use, and Lyrix uses it for what
CSS transitions and the Web Animations API already do. The decision must be made on measured
grounds: a spike comparing (a) CSS transitions only, (b) `framer-motion` for layout/gesture/
exit animations specifically, against bundle cost and measured frame behaviour. The default
expectation is **(a)**; adding the dependency requires evidence that (a) cannot express what is
needed. "Lyrix uses it" is not evidence — the question is what Spotivibe needs, and the project
has a rule against unexamined dependencies.

**Measured 2026-10-03, in M19's proposal.** A spike installed `framer-motion`, imported `motion`
and `AnimatePresence`, and rendered it from `HomeView` so the library was not tree-shaken away. The
emitted chunks grew from **375.8 kB to 417.2 kB gzipped** in total, and Home's first load from
**221.9 kB to 263.4 kB — +41.5 kB, or +18.7%** — while the other ten routes were byte-identical.
Everything in scope is opacity and transform, and exits are now expressible with
`@starting-style` and `transition-behavior: allow-discrete`, both Baseline since 2024. The decision
is therefore **no `framer-motion`**, recorded with the measurements, and reversed only on evidence:
an interruptible spring or a gesture-following drag would need re-measuring.

**Automated verification.** Every motion is behind a reduced-motion check, asserted by test, so a
component cannot animate under `prefers-reduced-motion` by accident.

**Browser verification.** Frame and responsiveness measurement before/after; visual review of each
transition at both viewports.

**Completion criteria.** A written decision on `framer-motion` with measurements behind it. No
motion without a reduced-motion path.

## 21.5 M20 — Personal-use media downloading

> **This milestone reverses a permanent v1 decision.** See §18 for the full statement of what
> the reversal does and does not authorize. Nothing here may be described as compliant with
> YouTube's documented download policies.

**Objective.** Download a currently playing track to the device, with an honest file format.

**Depends on.** M3 (provider layer — the ID being downloaded is a provider ID), M4 (playback).

**In scope.**

- A Next.js **route handler** under `src/app/api/download/[videoId]/` — the single application,
  no Express backend. Validates the provider ID shape and rejects malformed input with a
  structured error.
- **Primary extractor**: `@distube/ytdl-core` → `getInfo()` → filter `audioonly` formats →
  select the highest **suitable** bitrate → stream the chosen format. "Suitable" is bounded by
  the Vercel constraints below, not simply "highest available".
- **Fallback extractor**: Invidious → video metadata → `adaptiveFormats` filtered to `audio/*` →
  highest suitable bitrate → stream that URL. Bounded instance list with per-attempt timeouts.
- **Streaming, never buffering.** The response is a `ReadableStream`; media is never
  materialised whole in server memory.
- Bounded timeouts, per-instance rate limiting, structured errors, and upstream abort on client
  disconnect where practical.
- **Correct format honesty.** The extension and MIME type come from the container and codec that
  were actually selected. `audio/webm`+Opus → `.webm`/`.opus`; `audio/mp4`+AAC → `.m4a`;
  `audio/mp4`+MP3 → `.mp3`. **A file is never named `.mp3` unless it contains MP3 audio**, and
  format conversion is never faked by renaming. Real transcoding is explicitly out of scope.
- Download-to-device only: a Blob, an object URL, and a temporary `<a download>`. **Nothing is
  written to IndexedDB and nothing changes how playback works.**
- Download actions on the PlayerBar/MiniPlayer overflow, Now Playing, and the track context
  menu, each with idle / busy / success / failure states and **no duplicate concurrent download
  of the same track**.
- No authentication. No Google Sign-In. No accounts.

**Non-goals.** Accounts or auth of any kind. Ad blocking or suppression. A managed offline
library in IndexedDB. Local-file playback. Transcoding. Batch or playlist downloading. Progress
reporting by percentage.

**Deployment constraints — researched 2026-10-03, and they shape the design.** Vercel's documented
limits for the stated target:

| Constraint | Value | Consequence for this feature |
| --- | --- | --- |
| Response/request body size | **4.5 MB** | A full track exceeds this. Vercel documents that **streaming responses do not carry this limit**, so the route **must** stream. Buffering, even once, fails with a 413. |
| Max function duration | **300 s** (Hobby, default *and* maximum, with Fluid compute — default for new projects) | Comfortable. Must be stated explicitly in `export const maxDuration` rather than left to default. |
| Proxied request timeout | **120 s** | The real ceiling. A multi-megabyte stream finishes well inside it, but a very large file on a slow link could not, which is part of why the bitrate selection is bounded rather than maximal. |
| Memory | 2 GB / 1 vCPU (Hobby) | Streaming avoids the buffering spike that would otherwise be the binding constraint. |
| `@distube/ytdl-core` compatibility | Pure JavaScript, no native binary; makes its own outbound requests | Compatible in principle. **Not verified on a real deployment** — see below. |
| Invidious reliability | Public instances are frequently rate-limited or down | The fallback is best-effort by nature. This must be surfaced as a failure state, not hidden. |

**Because the bitrate is bounded, the honest file size is the bound, not the maximum.** Selecting
the highest available bitrate is actively wrong here: it maximises the chance of exceeding the
120 s proxy timeout for no benefit to a personal download. "Highest **suitable**" is therefore
specified as highest-that-fits, with the ladder walked down when a candidate exceeds the budget.

**If these constraints prove materially blocking in practice, the outcome is to document the
constraint and choose the smallest architecture that works for private/personal use** — not to
introduce paid infrastructure silently, and not to quietly buffer past the limit.

**Automated verification.** ID validation and rejection of malformed input. Format→extension/MIME
mapping over real container/codec pairs, including a **fixture proving an Opus-in-WebM stream is
not named `.mp3`**. Format selection prefers the highest bitrate that fits the budget and walks
down when it does not. Rate limiting. Timeout and abort behaviour. The route **streams** — proven
by a test that asserts the response body is a stream and that no whole-body buffer is read.

**Browser verification.** A real download in a real browser: the file lands, plays locally, and
its extension matches its content.

**NOT VERIFIABLE IN THIS ENVIRONMENT, and must not be claimed.** No Vercel deployment exists, so
the 4.5 MB streaming bypass, the 300 s duration, and the 120 s proxy timeout are **documented
constraints this milestone is designed against**, not observed behaviour. The route is verified
locally against a real Next.js server. This mirrors the parked player's known limit and is
recorded the same way.

**Completion criteria.** A track downloads to the device, the file is honestly named, playback is
untouched, and no new persistent state exists.

## 21.6 M21 — Post-v1 integration, regression validation, and documentation

**Objective.** Prove the six milestones did not break each other, fix the release gate so that
proof is worth something, and update the documentation to describe the product as it now is.

**Depends on.** M16, M17, M18, M19, M20.

**In scope.**

- **Fix the flaky release gate.** M15's end-to-end suite fails intermittently on a CDP race in
  its own fixture router — reproduced on the commit before the runtime correction, so it predates
  all post-v1 work. Post-v1 changes must not be gated by a gate that intermittently lies.
- **Make the release gate non-destructive.** Found by running it during M16: its `gates-install` step
  runs `npm ci`, which deletes `node_modules` before installing, so a failed install — an `EPERM` on
  a native module held by a running server, for instance — leaves 19 packages, no `.bin`, and a
  `next` without its `package.json`, after which every later item fails for a reason that is not the
  code. A gate that can silently break a working tree cannot be the thing that validates one. The
  repair is to stage the install (or refuse to run while `node_modules` is in use) and to detect and
  report a broken install as its own named failure rather than as sixteen unrelated ones.
- Full cross-feature regression: every critical flow with lyrics, Home filters, shortcuts,
  sharing, motion, and downloading all present simultaneously.
- `frontend/docs/DEPLOYMENT.md` updated for the download route's deployment implications, and for
  the parked player and download feature both being non-compliant private-use choices.
- `ROADMAP.md` and `MEMORY.md` brought current; `AGENTS.md`'s verified-command list refreshed with
  anything genuinely new.
- The feature-level acceptance checklist (§11) extended with the post-v1 features.
- Re-attempt the parked player's live-browser verification if an environment allows it; otherwise
  restate it as still unverified rather than letting it drift into an implied pass.

**Non-goals.** New features. A public deployment.

**Automated verification.** The full six-gate suite plus the release gate run **repeatedly**
enough to show the flakiness is gone — a single green run is not evidence against an
intermittent defect, which is the whole lesson.

**Browser verification.** Every critical flow, both viewports, with the post-v1 features live.

**Completion criteria.** Six consecutive green gate runs. Documentation describes the product as
built, including the two deliberate non-compliance choices.
