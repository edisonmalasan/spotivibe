# Proposal

## Why

M0–M3 delivered the shell, local persistence, and music discovery, but nothing can actually play: there is no YouTube IFrame player, no playback state, and the M1 player surfaces are inert placeholders. ROADMAP M4 requires one reliable player instance that survives route changes with controls synchronized to real player state, so that queue (M6), search (M5), and library (M7) work have a playback foundation to build on.

## What Changes

- Add **zustand** (the state library already declared in AGENTS.md's stack) and a `playerStore` holding current track, status, position, duration, volume/mute, repeat mode, shuffle, and playback error state, with actions: play track, play/pause, seek, next, previous, volume/mute, repeat, shuffle.
- Add a **singleton playback engine** that loads the YouTube IFrame Player API exactly once, owns the single `YT.Player` instance, maps player events/errors into the store, runs bounded progress polling only while a track is active, corrects track duration when the player is more authoritative, and implements controlled retry/backoff plus skip-on-unplayable handling (`2/100/101/150` fatal, transient errors retried with exponential backoff, no wedge/infinite loops).
- Mount a **persistent player host** in the root `AppShell` (outside route children) rendering a **policy-compliant visible video surface** — viewport ≥200×200, never overlaid or obscured — per the YouTube Required Minimum Functionality rules rechecked for this change; explicitly not Lyrix's tiny 120×68 hidden iframe.
- Wire the existing M1 surfaces (`PlayerBar`, `MiniPlayer`, Now Playing) to real state: track metadata, seekable progress, transport controls, plus newly added shuffle/repeat/volume controls, playback error display, and a "Watch on YouTube" attribution link.
- **Persist session state** (queue, index, position, repeat) through M2's session repository with debounced writes and a `pagehide` flush; on cold launch restore the track **cued and paused at its position — never autoplay**. Volume/mute persist as a tiny `localStorage` boot preference.
- Extend architecture invariants (single host mounted only in `AppShell`, no audio-extraction pipelines) and capture browser evidence against a production build.

## Capabilities

### New Capabilities

- `playback`: Client-side YouTube playback engine — persistent single-instance IFrame player outside route content, store-backed playback state and control synchronization, visible compliant surface, error taxonomy with retry/backoff and safe skip, session restore without autoplay, volume/repeat/shuffle behavior, and YouTube attribution/compliance.

### Modified Capabilities

- (none — `app-shell`'s "Persistent player region" and "Now Playing surface" requirements remain satisfied unchanged; `local-data`'s session repository is consumed as specified; `music-provider` is server-side and untouched)

## Impact

- **New code:** `frontend/src/stores/playerStore.ts`, `frontend/src/player/` (API loader, engine bridge, minimal YT types), `frontend/src/components/player/PlayerHost.tsx`.
- **Modified UI:** `AppShell` (mount host), `PlayerBar`, `MiniPlayer`, Now Playing page — all become client components wired to the store; `layout.tsx` unchanged (AppShell already persists across routes).
- **Dependencies:** `+ zustand` (runtime dependency with a concrete roadmap/AGENTS-sanctioned reason).
- **Persistence:** writes M2's existing `session` dataset (`queue`, `queueIndex`, `positionSeconds`, `repeatMode`) — no schema/whitelist changes; volume/mute via `localStorage`.
- **External services:** YouTube IFrame Player API (`https://www.youtube.com/iframe_api`); policies rechecked 2026-09-28 (revision 2026-09-14): ≥200×200 viewport, no overlays over the player, no suppressed Referer, documented player parameters only. No extraction, no background-play circumvention, no ad blocking, no media proxying.
- **Reference:** Lyrix `usePlayer.ts`/store patterns selectively ported (singleton loader, event mapping, backoff constants, pending-seek); analytics/radio/auth/network-retry and the undersized iframe explicitly not ported.
- **Tests/evidence:** new store/engine/component/architecture tests; CDP evidence script under `openspec/changes/add-playback-engine/evidence/`.
- **Not in scope (M6/M5/M7/M9):** `queueStore`, queue UI/autofill/radio, pre-cue, network recovery, search UI wiring, library play affordances, Now Playing video stage polish.
