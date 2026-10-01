# Design: Lyrix-style parked player

## Context

See `proposal.md` — Why. What shapes the approach technically:

- `engine.ts` already holds one module-scope `YT.Player` for the page session. `attach(target)`
  is idempotent and `PlayerHost` owns exactly one imperative container node, so the *engine*
  needs no architectural change. The change is entirely about what that container looks like.
- The engine's `playerVars` currently include `modestbranding: 1` (`engine.ts:226`), which
  YouTube deprecated. The line reads as effective configuration and is inert.
- `PlayerHost.tsx` renders a `fixed`-positioned dock plus an app-owned "Watch on YouTube" link.
  Both disappear.
- The parked host must survive StrictMode double-mounts, must not be re-parented (re-parenting
  the iframe node is what would restart playback), and must stay mounted on every route.
- Now Playing is the only place the video becomes visible, and it must reuse the same iframe.

## Goals / Non-Goals

**Goals:**

- One `YT.Player` for the page session, created once, never recreated or re-parented on
  navigation.
- During normal music playback the iframe is visually parked: 1×1, `opacity: 0`,
  `pointer-events: none`, behind the app UI, and not reachable by keyboard or pointer.
- Spotivibe's PlayerBar / MiniPlayer is the only visible playback interface, with no duplicate
  play button, position readout, or caption.
- An explicit **Show video** mode on Now Playing reveals the *same* iframe at a proper size.
- The parked state and the single-instance property are both enforced by detectors that can be
  shown to fail.

**Non-Goals:**

- No audio/video extraction, no `yt-dlp`, no stream download, no media proxy, no ad blocking or
  ad suppression, no background-play circumvention. Media flows only through the IFrame player.
- No change to the store split, the queue model, session restore, retry/backoff, or network
  recovery. The engine's control flow is untouched.
- No attempt to suppress YouTube's in-player branding. It cannot be suppressed, and the parked
  approach is chosen *because* it cannot be — that is the whole point.
- No new user preference for the video mode. It is a per-visit view state, not persisted
  personalisation.

## Decisions

### 1. Park by styling the existing host, not by moving the iframe

**Decision.** Keep `PlayerHost`'s single container node exactly where it is in the tree, and
toggle a class that makes it 1×1 / transparent / non-interactive / behind the UI.

**Why not remove the element and re-insert it.** Re-parenting an `<iframe>` reloads it. That
would restart playback, which is precisely what the single-persistent-instance requirement
forbids. Toggling presentation on the same node cannot reload it.

**Why not `display: none`.** A `display: none` iframe is not rendered at all, and its internal
state handling is unreliable across browsers; `opacity`/`pointer-events` with a real 1×1 box
keeps it laid out and alive. It is also the shape Lyrix uses.

**Alternative considered — a separate "parked" wrapper component.** Rejected: it introduces a
second mount path for the same node, and the second mount path is where a second instance would
eventually appear.

### 2. The engine gains a documented way to report its host, not a second host

**Decision.** The parked/visible state is React state owned by `PlayerHost` (and the Now Playing
route reads it through the player store or a small dedicated store slice). The engine is
unchanged: it still receives one container and never learns about the visual state.

**Why.** The engine is deliberately the only module that knows the IFrame API, and its public
surface is a control façade. Adding a `setVisibility()` that does nothing but toggle a class
would leak presentation into it for no benefit.

**Why a store slice rather than prop-drilling.** Now Playing is a different route from
`AppShell`; the parked host lives in the shell. Prop-drilling across the route boundary would
either re-parent the node or duplicate the host. A tiny store field lets the route read the
state and let the shell render it.

### 3. "Show video" is a route-scoped view state, not a player mode

**Decision.** The toggle lives on Now Playing, defaults to off, resets on navigation away, and
changes only the parked host's presentation classes.

**Why it is not a persisted preference.** Persisting it would mean a user could leave the app
with video showing, and a later cold launch would restore into a visible iframe — reintroducing
exactly the visible-player configuration this change parks by default, from stored state. A
per-visit default of off keeps the parked state the resting state.

**Why it is not a "quality" or "pip" mode.** Scope discipline: the request is for the video to
be *available*, not for picture-in-picture or a second window.

### 4. Remove the app-owned "Watch on YouTube" caption

**Decision.** Delete the link at `PlayerHost.tsx:74-82` and the Now Playing attribution
(`now-playing/page.tsx:305-315`), and narrow the spec's attribution requirement accordingly.

**Rationale.** Its stated purpose was to be the attribution *next to the video surface*. With
the surface parked there is nothing to attribute next to, so on the dock it is a caption
pointing at a video the user cannot see. On Now Playing it survives only in video mode, where
the visible YouTube player supplies its own attribution.

**This is a real reduction in visible attribution, and it is stated as one.** The
Developer Policies require attribution not be obscured; this change stops *adding* attribution
while continuing to not obscure YouTube's own. The spec will say that plainly rather than
claiming the requirement is still satisfied by an app-owned link.

### 5. Replace the visible-surface detectors; do not weaken them

**Decision.** The `architecture.test.ts` invariant set is changed by *substitution*, not
deletion:

| Was required | Is now required |
| --- | --- |
| a visible ≥200×200 surface | the parked style is present on the single host |
| no hidden/undersized iframe | the parked host is 1×1 + transparent + non-interactive while no track is being shown on video |
| one `new YT.Player` site | unchanged, plus: no second host node is ever created |

**Why this matters.** The old rule exists to enforce a policy this change knowingly abandons.
Keeping the rule and satisfying it would be theatre. Deleting the rule without a replacement
would lose the guarantee that actually still holds — *exactly one player, always parked unless
asked*. The replacement is a real invariant, and it is provable: it can fail if a second host
node is introduced or the parked class is dropped.

### 6. `playerVars`: remove the inert line, add the documented ones

**Decision.** Delete `modestbranding: 1` and add `fs: 0`. Keep `controls: 0`, `rel: 0`,
`playsinline: 1`, `iv_load_policy: 3`, `disablekb: 1`.

**Why remove rather than annotate.** A commented-out deprecated parameter invites someone to
uncomment it. The proposal and design record *why* it is gone, which is the durable place for
that knowledge. A test asserts no deprecated-only parameter reappears, so the removal cannot be
undone by accident.

### 7. The compliance framing is a first-class requirement, not a caveat

**Decision.** The spec states that this configuration intentionally does not meet YouTube's
documented visible-player requirement, and that it is intended for private/personal use.
Deployment documentation is updated in the same change so no document claims a visible
compliant surface exists.

**Why it cannot be a footnote.** The risk is a future reader — or a future deployer — trusting
a claim this change has made false. The requirement exists so that the false claim has
something to contradict it.

## Risks / Trade-offs

- **[The parked iframe is exactly what YouTube's visible-player rule prevents]** → Stated in
  the spec and design as an intentional, scoped deviation for private use. Recorded as a
  constraint to revisit before any public deployment. Nothing in the code can make it safe;
  only a decision to revert can.
- **[A 1×1 iframe might be throttled or paused by the browser as offscreen/hidden]** →
  Mitigation: the parked box stays laid out (`opacity`/`pointer-events`, never `display: none`),
  is not scrolled out of a clipping container, and `disablekb`/`controls: 0` are unchanged.
  Verified by a real browser run asserting position advances while parked, not by inspection.
- **[Autoplay policy]** → Unchanged. `engine.ts` still calls `playVideo()` only from a
  user-initiated action. A parked player does not become an autoplay trigger, and a detector
  holds that.
- **[Focus could reach the parked iframe]** → Mitigation: `pointer-events: none` plus the host
  being non-focusable and removed from tab order; a test asserts no tab stop inside the parked
  host.
- **[Losing visible attribution]** → Accepted and stated (decision 4). The alternative —
  keeping a caption pointing at an invisible video — is worse UI and no better policy.
- **[The end-to-end browser suite may assert the dock]** → Mitigation: the archived M15 suite is
  a historical record and is not edited. Current tests are updated, and the release gate's
  current expectations are checked for a dock assumption before the change is called done.

## Migration Plan

1. Land the parked-host presentation and remove the dock, with the replacement detectors.
2. Add the video mode and its store slice.
3. Remove the attribution links and update their tests.
4. Clean `playerVars`; add the deprecated-parameter detector.
5. Update the specs (via sync) and the deployment/release documentation.
6. Verify: full gate suite, a real-browser pass asserting position advances while parked and
   across Home → Search → Library → Now Playing, and session restore cued-paused.

Rollback is a revert. No data migration, no stored-format change, no dependency change — the
parked state is presentation only.

## Open Questions

None that change the specs, the approach, or the task breakdown. One implementation detail is
left to the implementer and is deliberately not decided here: whether the parked host keeps a
1×1 box or is clipped to 1×1 via `clip-path`. Both satisfy the spec; the tests must not
distinguish them, and the choice should be whichever is more robust in a real browser.
