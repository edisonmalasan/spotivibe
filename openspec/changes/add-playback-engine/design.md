# Design

## Context

M1 built inert player surfaces (`PlayerBar`, `MiniPlayer`, Now Playing route) mounted in `AppShell`, which already lives in the root layout **outside route children** — so structural persistence (layout survives navigation) exists; what is missing is everything behind those surfaces. M2 provides the persistence seams this change consumes: the `session` dataset (`queue`, `queueIndex`, `positionSeconds`, `repeatMode`, backup-importable), repositories behind `localData`, and `RepeatMode = "off" | "context" | "track"`. M3 provides `Track` (provider identity `youtube:<videoId>`) but no UI consumes search results yet. `zustand` is declared in the AGENTS.md stack but not installed. See proposal.md for motivation; the playback spec defines the contract.

Reference behavior studied (not copied wholesale): Lyrix `usePlayer.ts` + `store/index.ts` — module-level singleton loader, `onStateChange`/`onError` mapping, fatal `{2,100,101,150}` vs retry-with-backoff (base 1s, cap 30s, 5 attempts), pending-seek after load, 1s position interval. Explicitly **not** ported: analytics, radio/autofill, auth logging, reconnect logic (M6), localStorage session key (we use IndexedDB), and the 120×68 hidden iframe.

Policy rechecked 2026-09-28 (YouTube revision 2026-09-14): embedded players need a ≥200×200 viewport (recommend 16:9 ≥480×270); no overlays/frames in front of or obscuring the player; autoplay may only initiate when the player is ≥½ visible; player attributes/branding only as documented; the browser must send `Referer` (do not set `noreferrer`/`Referrer-Policy: no-referrer`).

## Goals / Non-Goals

**Goals:** one `YT.Player` for the page session; a store that mirrors the player; persistent surfaces wired to the store; a compliant always-visible video surface; resilient error handling; session restore that never autoplays.

**Non-Goals:** queue editing/history/upcoming UI, `queueStore` extraction, pre-cue, network state/recovery, search or library UI wiring (M5/M7), a large Now Playing "video stage" presentation, and podcasts/offline-media concerns. `playerStore` carries only the minimal playback context (`queue` + `queueIndex`) that next/previous and the session snapshot require; M6's own task is to move queue state into a dedicated `queueStore` — this design must not pre-build that model.

## Decisions

### 1. Add `zustand`; three-layer split: components → `playerStore` → engine bridge → IFrame API

`npm install zustand` (runtime dependency, concrete reason: AGENTS stack + M4 task "Build `playerStore`"). State lives in a module-scope Zustand store (no provider; client-only access). UI components subscribe with hooks and dispatch actions; components never touch `YT` directly (architecture invariant). The **engine** is the only module that imports/knows the IFrame API.

*Alternatives:* React context + `useReducer` (rejected: re-renders the whole shell on every 1s position tick without selectors; Zustand is stack-sanctioned); Redux (heavier, no roadmap basis); putting actions directly on `window` (untestable, no reactivity).

Control flow (mirrors Lyrix's proven pattern, adapted):
- **Actions → engine:** `playerStore` actions call an attached bridge (`setPlaybackBridge(bridge)` / `clearPlaybackBridge()`), a small interface (`cue`, `load`, `play`, `pause`, `seek`, `setVolume`, `setMuted`). `PlayerHost` attaches the singleton engine on mount and detaches on unmount. When no bridge is attached (SSR, tests without host), actions still mutate optimistic state and no-op the bridge call.
- **Events → store:** the engine subscribes to store changes it must react to (`currentTrack` identity → cue/load; `volume`/`muted` → apply) and writes status/position/duration/error back via reserved setters (`_setStatus`, `_setPosition`, `_setDuration`, `_setError` — underscore-prefixed as engine-only).
- **Tests** attach a fake bridge and/or drive fake YT events; no real network in unit tests.

### 2. Singleton engine + once-guarded API loader (`src/player/`)

- `src/player/ytApi.ts`: `loadYouTubeIframeApi()` — module-level `started` flag, injects one `<script src="https://www.youtube.com/iframe_api">`, resolves on `window.onYouTubeIframeAPIReady` (or immediately if `window.YT?.Player` already exists). Idempotent under StrictMode double-invocation and repeated mounts. Returns the `YT` namespace type only — no store imports.
- `src/player/types.ts`: hand-written minimal `YT` types (`Player`, `PlayerState`, event shapes) — **no `@types/youtube` dependency** (boundary isolation; only the ~6 members we use).
- `src/player/engine.ts`: module-scope `let engine: PlaybackEngine | null` created lazily by `PlayerHost`. Owns: the `YT.Player` instance, retry state, polling interval, pending-seek. `init()` is idempotent (returns existing). No explicit `dispose()` — the player instance is intentionally never destroyed for the page session (spec: exactly one instance). React StrictMode double-mount is tolerated because `init()` returns the existing engine.
- `PlayerHost` (`src/components/player/PlayerHost.tsx`, `"use client"`) renders the video container `div`, attaches the bridge, and is imported **only** by `AppShell` (architecture invariant test).

*Alternative:* creating `YT.Player` in a React ref inside a component (rejected: StrictMode remounts destroy/recreate the player, violating "recreate/restart" AC; a module singleton is how Lyrix keeps one instance and matches AGENTS' sanctioned "persistent YouTube player bridge" singleton).

### 3. Statuses, event mapping, polling, duration

Store `status: "idle" | "loading" | "playing" | "buffering" | "paused" | "error"` (plus `currentTrack: Track | null`).

| YT event | Store status |
|---|---|
| `cueVideoById` sent / `onReady` | `paused` (cued, play affordance shown) |
| `loadVideoById` sent | `loading` |
| `PLAYING` (1) | `playing` |
| `PAUSED` (2) | `paused` |
| `BUFFERING` (3) | `buffering` |
| `CUED` (5) | `paused` |
| `ENDED` (0) | advance logic (below) |
| error event | retry/error taxonomy (below) |

- **Duration:** on the first `PLAYING`, `getDuration()` > 0 and ≠ store duration → `_setDuration(playerDuration)` (player authoritative); seek/progress use store duration thereafter.
- **Polling:** one `setInterval(1000)` started when status ∈ {playing, buffering} and `currentTrack != null`; cleared on pause/idle/error/unmount. On pause, position is captured once from `getCurrentTime()` before the interval clears. Timer handle lives on the engine (single instance ⇒ never accumulates).
- **Pending seek:** restore/`seek()` before ready stores `pendingSeek`; applied after the first `PLAYING` (Lyrix pattern).

### 4. Error taxonomy (spec: retry/backoff + unplayable handling)

- **Transient** (any code not in the fatal set — in practice 5/HTML5): reload current video with exponential backoff `min(1000·2^attempt, 30000)`, max 5 attempts per track (Lyrix-verified constants). Success on `PLAYING` resets the per-track attempt counter.
- **Fatal** (2 invalid, 100 deleted, 101/150 embedding-restricted): mark track failed in store (`failedTrackIds: Set<string>`), surface `_setError`, then advance to the next **unfailed** track after ~1s (Lyrix timing). If the wrap reaches only failed tracks or the context is exhausted → settle: status `error`, keep last track displayed, controls operable (no wedge, no infinite loop — `failedTrackIds` is the loop guard).
- Retry exhaustion ⇒ same settle path as fatal (advance if unfailed tracks remain, else `error`).
- **No auto-resume:** external `PAUSED` events are honored as final; there is no timer or event that calls `playVideo()` except (a) explicit user actions, and (b) the ENDED-advance path within a session the user started. Restore never auto-plays (spec).

### 5. Session persistence + cold-launch restore (no autoplay)

- **Write:** debounced (≈2s) `sessionRepository.set({queue, queueIndex, positionSeconds, repeatMode})` triggered by track change, repeat change, and position ticks (each poll updates a `lastPersistedPosition`; flush also on `visibilitychange → hidden` / `pagehide`). Import path untouched — no schema/whitelist changes (local-data spec unmodified).
- **Read (boot):** `PlayerHost` effect: `sessionRepository.get()` → if `queue[queueIndex]` exists, set store (`queue`, `index`, `repeatMode`, `currentTrack`) and `cueVideoById(id, startSeconds: positionSeconds)` — status `paused`, no `play`. Play button therefore shows the play affordance (spec scenario).
- **Shuffle** is *not* in the snapshot schema ⇒ session-only (resets to off on cold launch); documented in §Open Questions as intentionally deferred to M6 rather than a schema change.
- **Volume/mute:** `localStorage` key `spotivibe.volume` (`{volume, muted}`) — AGENTS allows `localStorage` for tiny boot-time preferences; adding volume to the IndexedDB `preferences` dataset would modify the local-data/backup schemas (out of scope). Reapplied on boot.

### 6. Compliant video surface: single fixed dock, both shell variants

`PlayerHost` renders (only when a track is active) a fixed-position video panel, rendered once in `AppShell`:

- **Desktop (≥1024):** `fixed right-4 bottom-[calc(72px+16px)]` (above the 72px PlayerBar), `w-100 h-56` (400×225, 16:9 — ≥200×200 and close to the recommended 480×270).
- **Compact (<1024):** `fixed right-2` above MiniPlayer+BottomNav stack, `w-50 min-w-50 h-50`… concretely: `w-[max(200px,56vw)] aspect-video min-h-[200px]` so both dimensions are ≥200 even on 320px-wide viewports (the iframe letterboxes the 16:9 video internally — the *viewport* is what the policy measures).
- The panel is the **topmost stacking context in the shell** (`z-50`): nothing renders in front of it (policy: no overlays *over* the player). Our custom controls live in PlayerBar/MiniPlayer/Now Playing — all outside the iframe rectangle (policy: we must not obscure it).
- No `position: absolute` inside scrolling content, no `transform` re-parenting, no display toggling while a track is active — the same DOM node persists across routes (spec scenario "same element remains mounted").
- The Now Playing route keeps its artwork + controls; the dock remains visible in the corner simultaneously (smallest coherent scope — spec requires ≥200×200 visible, not a large stage; a stage presentation is deferred to M9 polish and would need cross-component layout coordination that risks re-parenting the iframe).

*Alternatives rejected:* iframe inside Now Playing route content (unmounts on navigation); `position: hidden` on browse routes (permanently hidden iframe = the prohibited pattern); moving the node between dock/stage containers (iframe reload); 120×68-style corner chip (violates ≥200×200).

### 7. Controls & surfaces wiring

- `PlayerBar` (desktop), `MiniPlayer` (compact), Now Playing page become `"use client"` components reading the store:
  - track cluster: real title/artist/artwork (`<img>`/background from `track.artwork`), still linking to Now Playing.
  - transport: previous (restart-current when >3s per spec), play/pause (enabled whenever a track exists), next.
  - progress: `role="slider"` bar; click/drag seeks (`seek(seconds)`); shows `position / duration` from store.
  - **new controls (spec):** shuffle toggle, repeat cycle (`off → context → track`), mute + volume slider (desktop PlayerBar + Now Playing; compact keeps mute only if space demands — decide by fitting the M1 layout; Now Playing gets the full set).
  - error banner: when `status === "error"` show the failure message (and Now Playing offers retry via Play).
  - attribution: "Watch on YouTube" link (`https://www.youtube.com/watch?v=<videoId>`, `target="_blank" rel="noopener noreferrer"` — outbound link *from* our page, referrer sent, allowed) near the dock and on Now Playing.
- The Now Playing page also renders `data-testid` placeholders the dock overlays around; keep M1 tests green where behavior is unchanged (idle placeholders), update expectations only where the spec changed behavior (disabled → enabled controls).

### 8. Player params & compliance posture

`playerVars`: `{controls: 0, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, disablekb: 1}` — all documented parameters; `controls: 0` because our custom UI is the control surface (spec allows documented params; YouTube's branding/watermark remains untouched and unobscured). No CSS injected into the iframe, no `noreferrer`, no `MediaRecorder`/`decodeAudioData`/`<audio>` blob paths (architecture detector). Autoplay policy: engine only calls `playVideo()` from user-initiated actions or within an already-user-initiated session's ENDED advance (the user is engaged; not an "automatic playback" trigger), and the surface is ≥½ visible by construction.

## Risks / Trade-offs

- [StrictMode double effects re-create the player] → module-scope singleton + idempotent `init()`; loader once-guard; verified by loader/host tests with double invocation.
- [Volume drift between store and YT events (YT echoes volume/mute events)] → engine treats its own `setVolume` as authoritative echo: apply-on-change subscription only when values differ from the player's last known value; no event loop.
- [Debounced persistence loses last seconds on kill] → flush on `visibilitychange`/`pagehide`; acceptable residual (<2s) loss documented in spec scenario wording ("during use").
- [Dock overlays content on small screens] → dock sits above the bottom stack and the Now Playing page adds bottom padding while active; policy requires visibility, and M9 owns presentation polish.
- [Fake YT in tests diverges from real player behavior] → CDP evidence against a production build with the real IFrame API (import backup → restore → trusted click → navigate → assert single connected iframe, ≥200×200, `elementsFromPoint` center = iframe, zero console errors); unit tests cover taxonomy/limits with fakes.
- [YouTube policy drift] → rechecked for this change (rev 2026-09-14); ROADMAP §19 already requires a pre-release recheck at M14/M15.
- [Autoplay-blocking browsers reject the trusted-gesture play] → evidence script treats "playing" as the success signal but reports blocked-autoplay distinctly from app failure (control state must still be consistent).

## Migration Plan

Additive: new modules + zustand install; existing M1 surfaces change from static → store-driven. No data migration (session dataset schema unchanged). Rollback = revert the merge; no persisted format is introduced beyond the existing session snapshot and the `spotivibe.volume` localStorage key (harmless orphan).

## Open Questions

- Whether Now Playing gains a large video stage (docked → full-stage) — presentation-only; deferred to M9, does not alter the ≥200×200 contract.
- Whether shuffle state should persist — currently session-only (snapshot schema has no field); M6 owns queue/session persistence extensions and can add it there.
