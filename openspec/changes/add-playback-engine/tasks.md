# Tasks

## 1. Foundation — dependency, API loader, types

- [ ] 1.1 Install `zustand` in `frontend/` and verify `npm ls zustand` shows it in dependencies and `npm run typecheck` still exits 0 with an empty-store smoke module compiling
- [ ] 1.2 Implement `src/player/ytApi.ts` (once-guarded script injection resolving on `onYouTubeIframeAPIReady`) and verify with a Vitest suite asserting exactly one script tag and one resolve under double/concurrent calls and pre-existing `window.YT`
- [ ] 1.3 Implement `src/player/types.ts` minimal hand-written YT types (Player, PlayerState, event shapes) and verify `npm run typecheck` passes with no `@types/youtube` dependency added

## 2. `playerStore` — state, actions, resilience logic

- [ ] 2.1 Implement `src/stores/playerStore.ts` with state (current track, status, position, duration, volume/mute, repeat, shuffle, error, queue, queueIndex, failed set) and the bridge interface plus actions (playTrack, play/pause, seek, next, previous, volume/mute, repeat cycle, shuffle toggle) and verify unit tests with a fake bridge covering action→bridge calls, optimistic no-bridge behavior, and status selectors
- [ ] 2.2 Implement repeat-context advancement, shuffle-order traversal (on/off), previous-restart-near-start, and player-duration override handling as pure helpers on the store and verify unit tests cover repeat off/context/track end-of-track paths, shuffled vs list order, and duration adoption
- [ ] 2.3 Implement the error taxonomy in the store/engine seam — transient retry with exponential backoff (1s base, 30s cap, 5 attempts/track, reset on success), fatal `{2,100,101,150}` mark-failed-advance, and all-failed settle — and verify fake-timer tests cover backoff schedule, retry reset, skip-with-next, exhaustion settle, and no-infinite-loop when every track fails

## 3. Engine — singleton bridge to the IFrame API

- [ ] 3.1 Implement `src/player/engine.ts` (module singleton, idempotent `init`, YT.Player creation, event→store mapping per design table, pending-seek, duration correction, 1s polling only while playing/buffering with single-shot capture on pause) and verify unit tests with a fake YT object driving onStateChange/onError/onReady through the mapping table, double-init returning the same instance, and poll timers starting/stopping correctly
- [ ] 3.2 Integrate session persistence (debounced writes of queue/index/position/repeat plus flush on visibilitychange/pagehide) and cold-launch restore (cue at saved position, paused, no autoplay) and verify with fake-indexeddb tests that playback writes the M2 session record and a boot with a saved session cues paused at position with the play affordance
- [ ] 3.3 Implement volume/mute `localStorage` boot preference (read on boot, write on change, apply to bridge) and verify unit tests round-trip values including corrupt/missing keys falling back to defaults

## 4. Host and control surfaces

- [ ] 4.1 Implement `src/components/player/PlayerHost.tsx` (attaches bridge, restores session, renders the fixed video dock only when a track is active) and mount it in `AppShell` outside route children; verify with a component test that the dock renders on track state and not when idle, and that mounting twice does not create a second player container
- [ ] 4.2 Wire `PlayerBar` to the store (real track metadata, seekable progress slider with keyboard support, previous/play-pause/next, error message, enabled-state rules) and verify RTL tests cover idle placeholders, playing/paused control states, seek dispatch, and error display
- [ ] 4.3 Add the new controls required by the spec — shuffle toggle, repeat cycle indicator, mute + volume slider on desktop/Now Playing, play/pause on `MiniPlayer` — and verify RTL tests assert repeat cycles off→context→track→off with visible mode, shuffle toggles, and volume/mute dispatch and reflect store values
- [ ] 4.4 Wire the Now Playing page to the store (track info, full transport/progress/volume/error, bottom clearance for the dock, "Watch on YouTube" attribution link opening the video in a new tab) and verify RTL tests assert live state rendering, the attribution link href/target/rel, and keep/adjust the M1 placeholder assertions that this spec intentionally changed (idle placeholders stay, controls now enabled with a track)
- [ ] 4.5 Apply the compliant surface styling (desktop 400×225 dock above PlayerBar, compact ≥200×200 above the bottom stack, `z-50` topmost, both shell variants, every route) and verify with a component/structure test asserting the dock's data attributes and size/z classes exist while a track is active

## 5. Architecture invariants

- [ ] 5.1 Extend `frontend/tests/architecture.test.ts`: PlayerHost imported only by `AppShell` (which is mounted in the root layout); UI components import store/engine interfaces but never YT types or `ytApi` directly; no audio-extraction surfaces (`MediaRecorder`, `decodeAudioData`, blob-backed `<audio>`/`<video>`); no referrer-suppressing config (`noreferrer` on the watch link, `Referrer-Policy: no-referrer`) — and verify each detector with positive/negative self-tests in the same file

## 6. Verification and evidence

- [ ] 6.1 Run the full quality gates from `frontend/` (`npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`) and verify each exits 0 with the new suites included
- [ ] 6.2 Run `openspec validate add-playback-engine --strict` and verify it passes with no errors
- [ ] 6.3 Capture browser evidence against a production build (CDP script under `evidence/`): import a backup fixture containing a session → reload → verify the track is restored cued/paused with no autoplay and the dock measures ≥200×200 → trusted click play → verify playing state, controls synchronized, and `elementsFromPoint` at the dock center returns the player (no overlay) → navigate Home → Search → Library → Now Playing → verify the same connected iframe element persists, playback continues, and controls stay synchronized; verify `results.json` records `"pass": true` with zero console errors and an evidence README documenting reproduce steps
- [ ] 6.4 Clone the branch into a temporary directory and verify `npm ci` + all six gates (`lint`, `format:check`, `typecheck`, `test`, `build`, `openspec validate --strict`) exit 0 from the clean checkout
- [ ] 6.5 Update `ROADMAP.md` M4 → `DONE` and tick the §11 Player checkboxes actually delivered by this change (single persistent instance, visible compliant surface, play/pause, previous/next, seek/progress, volume/mute, shuffle, repeat off/all/one, retry/backoff, skip unavailable, session restoration, YouTube attribution; leave pre-cue unticked for M6) and verify the diff shows only the M4 status row and Player checkbox lines changing, then run the gates once more
