# Proposal: Lyrix-style parked player, with Spotivibe's own controls as the visible surface

## Why

The docked YouTube video panel shows YouTube's own in-player UI — its play button, share and
watch-later actions, its YouTube logo button, and its own "Watch on YouTube" caption — and that
branded chrome dominates the corner of every screen while playing. It also duplicates
Spotivibe's controls: the panel carries a play affordance, a position readout, and a caption
that the PlayerBar already provides in full, better, and in Spotivibe's own visual language.

The project already tried to suppress this. `modestbranding: 1` is set at `engine.ts:226`, and
it does nothing: YouTube deprecated the parameter, and its own documentation says it "has no
effect." The line reads like working configuration and is not. There is no documented
parameter that removes the branding, and because the player is a cross-origin iframe, no CSS or
DOM manipulation can reach inside it either.

So the branded panel cannot be cleaned up. It can only stop being visible. That is the
Lyrix approach: one persistent IFrame engine, visually parked at 1×1 with `opacity: 0` and
`pointer-events: none`, behind the app UI, while the application's own PlayerBar and MiniPlayer
remain the only visible playback interface.

**This is a deliberate reversal of a public-release compliance decision, taken for
private/personal use.** `playback/spec.md` currently requires a permanently visible ≥200×200
surface, forbids a hidden or undersized iframe, and requires that YouTube's in-player branding
be left unmodified. YouTube's Developer Policies require a visible player and forbid obscuring
the attribution it provides inside embedded players. This change knowingly does not meet that
documented visible-player requirement, and the design records that plainly rather than
describing the result as compliant.

## What Changes

- **The floating video dock is removed from normal playback.** `PlayerHost`'s fixed-position
  panel goes away, along with the app-owned "Watch on YouTube" caption it carried. Both were
  visible only to frame a video the user did not need to see.
- **The iframe is parked.** The single persistent engine stays exactly where it is — one
  `YT.Player`, created once, never recreated on navigation — but its host is 1×1, fully
  transparent, non-interactive, and behind the app's own UI. Playback, position, duration, and
  the queue are unaffected.
- **A "Show video" mode on Now Playing.** The same iframe becomes visible and properly sized
  when the user asks for it, reusing the existing instance rather than creating a second one.
  Leaving the mode re-parks it.
- **Spec and test reversal, explicitly scoped.** `playback` requirements that mandate a
  permanently visible surface are modified, and the architecture detectors that currently *forbid*
  a hidden iframe are replaced with detectors that require the parked state and forbid a second
  player instance. The attribution requirement is narrowed to the Now Playing surface.
- **BREAKING for the deployment story:** the release documentation and the deployment contract
  no longer describe a "visible compliant YouTube playback surface," and this configuration
  should not be presented as satisfying YouTube's documented embedded-player requirements.

Explicitly **not** changed, and enforced by detectors: no audio or video extraction, no
`yt-dlp`, no stream download, no media proxying, no ad blocking or ad suppression, and no
background-play circumvention. Media continues to flow only through the YouTube IFrame player.

## Capabilities

### New Capabilities

None. This modifies existing behaviour rather than introducing a new capability.

### Modified Capabilities

- `playback`: the visible-surface requirement becomes a parked-player requirement with an
  explicit opt-in video mode; the attribution requirement narrows to the video surface; and the
  compliance requirement is restated to name what this configuration does and does not do
  rather than claiming documented compliance.
- `app-shell`: the persistent player region's video dock is removed, and the Now Playing route
  gains the opt-in video mode.

## Impact

- **Code**: `frontend/src/components/player/PlayerHost.tsx` (dock removal, parked host), a new
  parked/visible host state, `frontend/src/app/now-playing/page.tsx` (the video mode), and
  `frontend/src/player/engine.ts` (documented parameters only — `fs: 0` added; the inert
  `modestbranding` line either removed or annotated as deprecated, not left looking effective).
- **Tests**: `frontend/tests/architecture.test.ts` (the hidden-iframe detector is replaced, not
  weakened), `frontend/tests/player/playerHost.test.tsx`, `nowplaying*.test.tsx`, and
  `routes.test.tsx` (the dock's "Watch on YouTube" assertions).
- **Docs**: `frontend/docs/DEPLOYMENT.md` and the release documentation, which currently state a
  visible compliant surface exists.
- **Risk**: the parked iframe is what YouTube's visible-player rule exists to prevent. If the
  project is ever deployed publicly or shared, this configuration should be revisited before
  launch. That is recorded as a first-class constraint rather than a caveat in passing.
