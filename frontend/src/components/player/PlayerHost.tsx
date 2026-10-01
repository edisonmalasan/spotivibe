import { useEffect, useRef } from "react";
import { getPlaybackEngine } from "@/player/engine";
import { attachSessionPersistence, restorePlaybackSession } from "@/player/persistence";
import { initNetworkMonitor } from "@/stores/networkStore";
import { initNetworkRecovery, usePlayerStore } from "@/stores/playerStore";
import { useVideoModeStore } from "@/stores/videoModeStore";

/**
 * Playback bootstrap and the parked player host.
 *
 * Rendered once by the AppShell, outside route content, so navigating between
 * pages never unmounts it. Responsibilities:
 *
 * 1. Cold boot: volume/mute preference + session restore (cued paused) and
 *    debounced session persistence writes.
 * 2. Cross-cutting init in one place (design §9): the connectivity monitor and
 *    the reconnect-recovery subscription, each cleaned up on unmount.
 * 3. Own the video host: an imperative child node that `YT.Player` may replace
 *    freely — React only manages the outer container, so the player element
 *    survives re-renders and route navigation.
 *
 * **The host is parked, not displayed** (`lyrix-style-hidden-player`). YouTube's
 * in-player branding cannot be suppressed — `modestbranding` is deprecated and
 * inert, and a cross-origin iframe cannot be reached by CSS or DOM — so the
 * single persistent player is laid out at 1x1 with zero opacity, takes no
 * pointer events, and sits behind the app's own UI. `PlayerBar`/`MiniPlayer` are
 * the only visible playback interface. The Now Playing route can reveal this
 * same node through {@link useVideoModeStore}; it is never re-parented, because
 * re-parenting an iframe reloads it and would restart playback.
 *
 * This is an intentional departure from YouTube's documented visible-player
 * requirement, taken for private/personal use. See design.md decision 7.
 */
export function PlayerHost() {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const videoVisible = useVideoModeStore((state) => state.visible);
  const setVideoVisible = useVideoModeStore((state) => state.setVisible);
  const surfaceRef = useRef<HTMLDivElement>(null);

  // Boot: apply the volume preference, restore the saved session, persist
  // session snapshots while playback runs, watch connectivity, and recover
  // playback automatically when the connection returns.
  useEffect(() => {
    void restorePlaybackSession();
    const detachPersistence = attachSessionPersistence();
    const stopMonitor = initNetworkMonitor();
    const stopRecovery = initNetworkRecovery();
    return () => {
      detachPersistence();
      stopMonitor();
      stopRecovery();
    };
  }, []);

  // Video mode is a per-visit view state, so it is released when the app goes
  // idle: a cold launch with a restored session must never open with a visible
  // player, and leaving a stale `true` behind would be exactly that.
  useEffect(() => {
    if (!currentTrack) setVideoVisible(false);
  }, [currentTrack, setVideoVisible]);

  // Attach the singleton engine to the surface's imperative target node
  // whenever a track exists. Re-attaches idempotently after StrictMode's
  // simulated unmount; never creates a second container.
  useEffect(() => {
    if (!currentTrack) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    let target = surface.firstElementChild as HTMLElement | null;
    if (!target) {
      target = document.createElement("div");
      target.style.width = "100%";
      target.style.height = "100%";
      surface.appendChild(target);
    }
    const engine = getPlaybackEngine();
    engine.attach(target);
    return () => engine.suspend();
  }, [currentTrack]);

  if (!currentTrack) return null;

  return (
    <div
      data-testid="player-host"
      data-video-mode={videoVisible ? "visible" : "parked"}
      aria-hidden={videoVisible ? undefined : true}
      /*
        Parked: 1x1, transparent, non-interactive, behind the app. The box stays
        laid out rather than `display: none` — a display-hidden iframe is not
        rendered at all and its internal state handling is unreliable across
        browsers. `z-0` puts it under the shell's own layers.

        Visible: the SAME node, only re-presented — never re-parented, because
        re-parenting an iframe reloads it and would restart playback. It is
        positioned over the content rather than in flow so the route that
        requested it does not have to own it, and it sits above the app's chrome
        so nothing renders in front of the player (spec: "Nothing renders in
        front of the surface").
      */
      className={
        videoVisible
          ? "fixed bottom-[152px] left-1/2 z-40 aspect-video w-[min(92vw,640px)] -translate-x-1/2 overflow-hidden rounded-md bg-void-black shadow-2xl lg:bottom-[104px]"
          : "pointer-events-none fixed bottom-0 left-0 z-0 h-px w-px overflow-hidden opacity-0"
      }
    >
      <div ref={surfaceRef} className="h-full w-full" />
    </div>
  );
}
