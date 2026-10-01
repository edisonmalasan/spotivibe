# Tasks

## 1. Park the player and remove the dock

- [ ] 1.1 Remove the fixed-position video dock and the app-owned "Watch on YouTube" link from `PlayerHost`, keeping the single imperative host node the engine attaches to — verify: no `player-dock` or `watch-on-youtube` test id remains in `src`, and `engine.attach` still receives exactly one node (spec: `app-shell` — "The player region is the only visible playback interface").
- [ ] 1.2 Style the host so it is parked during normal playback: ~1×1, `opacity: 0`, `pointer-events: none`, behind the app UI, and not focusable or tab-reachable — verify: a test asserts the computed/inline parked values and asserts the host contains no tabbable element (spec: `playback` — "Normal music playback parks the player visually").
- [ ] 1.3 Confirm the parked host is never collapsed to zero, destroyed, or removed while a track is active, and stays mounted across navigation — verify: a test asserts the host node is the same node identity before and after a route change and is still connected (spec: `playback` — "The active surface meets the minimum size everywhere"; `app-shell` — "The player stays mounted while parked").
- [ ] 1.4 Keep playback fully functional while parked: position advances, duration is known, and tracks advance on completion — verify: a test drives the store/engine and asserts position and advancement with the host parked, and an integration test covers Home → Search → Library → Now Playing with playback continuing (spec: `playback` — "A parked player still plays and still advances"; "Route navigation does not restart playback").

## 2. The video mode on Now Playing

- [ ] 2.1 Add the video-mode state as a per-visit view state readable by both the shell and the Now Playing route, defaulting to off and not persisted — verify: a test asserts it defaults off, that it is absent from the persisted session snapshot, and that a cold launch restores a session with the player parked (spec: `app-shell` — "Video mode does not persist as visible"; `playback` — "Video mode never survives a reload as visible").
- [ ] 2.2 Add the video-mode control to Now Playing, omitted when there is no current track, with an accessible name and no autoplay side effect — verify: tests cover presence with a track, absence without one, and that enabling it does not start playback on its own (spec: `app-shell` — "Video mode is opt-in and off by default"; "The video control is absent with nothing to show"; "More Like This is offered without autoplaying").
- [ ] 2.3 Make video mode reveal the **existing** player — same instance, no second `YT.Player`, no second API script tag, no second host node — and re-park it on disable or navigation away, without interrupting playback — verify: tests count player constructions and host nodes before and after toggling, and assert playback position is unbroken across the toggle (spec: `playback` — "Video mode reveals the existing player"; "Leaving video mode re-parks the same player"; `app-shell` — "Enabling video mode reuses the one player"; "Disabling video mode returns to the parked player").
- [ ] 2.4 Assert the parked and visible states never render an application overlay above the player — verify: a test inspects the topmost element at the host centre in both states (spec: `playback` — "Nothing renders in front of the surface").

## 3. Player parameters and the architecture invariants

- [ ] 3.1 Remove the inert `modestbranding: 1` parameter and add `fs: 0`, keeping every remaining parameter documented and currently functional — verify: a test asserts the supplied parameter set and fails if a deprecated-only parameter (`modestbranding`, `showinfo`, `autohide`, `theme`) reappears (spec: `playback` — "Only functional documented parameters are used").
- [ ] 3.2 Replace the now-inapplicable visible-surface architecture detector with detectors that require the parked state and forbid a second player instance or host node — verify: the new detectors are each shown failing against a violating fixture (a dropped parked class; a second `new YT.Player`; a second host), because a detector never seen to fail is not evidence (spec: `playback` — "Normal music playback parks the player visually").
- [ ] 3.3 Keep every existing playback detector green: the player host is imported only by the shell, UI code stays off the IFrame API loader and YT types, no capture or decode surfaces, and outbound links never suppress the referrer — verify: `architecture.test.ts` passes, and the extraction detector is proven to still catch a `<video>`/`<audio>`/`MediaRecorder` fixture after this change.
- [ ] 3.4 Add a detector that parked playback is never used as a background-play workaround — no timer, visibility handler, or media-session call that resumes or un-mutes to keep a hidden player playing — verify: the detector is shown failing against a violating fixture (spec: `playback` — "Parked playback is never a background-play workaround").

## 4. Update the tests that encoded the old contract

- [ ] 4.1 Update `playerHost.test.tsx` for the parked host: it currently asserts the dock, the ≥200px surface, and the app-owned watch link — verify: the file passes and asserts the parked state and the unchanged engine attachment (spec: `playback`).
- [ ] 4.2 Update `nowplaying.test.tsx`, `nowplaying-presentation.test.tsx`, and `routes.test.tsx`, which assert a "Watch on YouTube" link on Now Playing, and `connectionBanner.test.tsx`, which locates the banner relative to `player-dock` — verify: all pass; the banner assertion is re-expressed against a still-present element rather than deleted (spec: `app-shell` — "The banner never covers the player surface" scenario naming retained).
- [ ] 4.3 Confirm the shell suite and every other test that referenced a floating video surface still passes, and that no test now asserts a visible ≥200×200 surface — verify: a search for the removed assertions returns nothing, and the full suite is green.

## 5. Documentation and the honest compliance framing

- [ ] 5.1 Update the deployment/release documentation to state that the player is parked and that this does **not** meet YouTube's documented visible-player requirement, replacing any "visible compliant YouTube playback surface" claim — verify: a test asserts the documentation contains the departure statement and no longer claims a visible compliant surface (spec: `playback` — "The departure is stated rather than implied").
- [ ] 5.2 Record in the archived-free documentation that this configuration is intended for private, personal use and SHALL be revisited before any public deployment, and update the roadmap to note the departure from the M4 visible-player decision — verify: a test asserts the private-use constraint is present in the documentation.
- [ ] 5.3 Verify `openspec validate lyrix-style-hidden-player --strict` and `openspec validate --specs --strict` are both clean after the change is applied — verify: both commands exit `0`.

## 6. Integration verification

- [ ] 6.1 Run the full quality gate suite from the repository root under Node 24 — verify: install, lint, format:check, typecheck, test, and build each exit `0`, with the interpreter version recorded.
- [ ] 6.2 Drive the real application in a browser and confirm: exactly one IFrame player instance exists; the player is visually hidden during normal playback; the application's own controls drive play/pause, seek, volume, queue, shuffle, and repeat; and there are no console errors or player regressions — verify: an end-to-end run asserting each of these, with a screenshot of both the parked and video-mode states.
- [ ] 6.3 Confirm session restore still cues without autoplay and that queue/shuffle/repeat/seek/volume behaviour is unchanged by this change — verify: an end-to-end cold-launch run asserting a cued-paused restore with the player parked, and the existing playback suites still green.
