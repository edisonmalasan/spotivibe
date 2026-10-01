import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
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

  // Video mode is a per-visit view state, and it is released on **leaving Now Playing** as
  // well as on going idle.
  //
  // The navigation half is load-bearing, and it was missing. "Off when idle" alone left a
  // branded 640x360 panel following the user onto Home: the host lives in the shell, so
  // nothing unmounted it, and the only escape was playback stopping entirely. Verified in a
  // real browser before this line existed.
  //
  // `usePathname` rather than a prop: the host is in the shell and the toggle is on the route,
  // so the shell is what has to notice the route changing.
  const pathname = usePathname();
  const onNowPlaying = pathname === "/now-playing";
  useEffect(() => {
    if (!currentTrack || !onNowPlaying) setVideoVisible(false);
  }, [currentTrack, onNowPlaying, setVideoVisible]);

  // The engine's node is an <iframe>, and an iframe is a sequential focus navigation target:
  // `pointer-events: none` and `aria-hidden` do **not** remove one from the tab order. It was
  // measurably the last tab stop of the document while parked, so a keyboard user tabbed
  // through the whole app and landed in an invisible video.
  //
  // `tabIndex = -1` on the *host* is not enough either — the iframe is a descendant, not the
  // host. It goes on the iframe itself, after the player creates it, because that node is the
  // one in the tab order and nothing else reaches it. The observer is needed because
  // `YT.Player` replaces the container's contents after construction, not synchronously.
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const unframe = (node: Element): void => {
      if (node instanceof HTMLIFrameElement) node.tabIndex = -1;
    };
    for (const node of surface.querySelectorAll("iframe")) unframe(node);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            unframe(node);
            for (const nested of node.querySelectorAll("iframe")) unframe(nested);
          }
        }
      }
    });
    observer.observe(surface, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [currentTrack, videoVisible]);

  // Attach the singleton engine to the surface's imperative target node whenever a track
  // exists. Re-attaches idempotently after StrictMode's simulated unmount; never creates a
  // second container.
  //
  // Deps are the *boolean*, not the track object. Keying on `currentTrack` re-ran this effect
  // on every track change, tearing down the subscription and calling `suspend()` — and
  // `suspend()` clears the engine's retry and advance timers, which `attach()` does not
  // restore. The host exists for "a track is active", not "which track".
  const docked = currentTrack !== null;
  useEffect(() => {
    if (!docked) return;
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
  }, [docked]);

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
          ? "fixed bottom-[152px] left-1/2 z-50 aspect-video w-[min(92vw,640px)] -translate-x-1/2 overflow-hidden rounded-md bg-void-black shadow-2xl lg:bottom-[104px]"
          : "pointer-events-none fixed bottom-0 left-0 z-0 h-px w-px overflow-hidden opacity-0"
      }
    >
      <div ref={surfaceRef} className="h-full w-full" />
    </div>
  );
}
