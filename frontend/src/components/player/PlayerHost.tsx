"use client";

import { getPlaybackEngine } from "@/player/engine";
import { attachSessionPersistence, restorePlaybackSession } from "@/player/persistence";
import { usePlayerStore } from "@/stores/playerStore";
import { useEffect, useRef } from "react";

/**
 * Playback bootstrap and video host (spec: single persistent player instance).
 *
 * Rendered once by the AppShell, outside route content, so navigating between
 * pages never unmounts it. Responsibilities:
 *
 * 1. Cold boot: volume/mute preference + session restore (cued paused) and
 *    debounced session persistence writes.
 * 2. Own the docked video surface: an imperative child node that
 *    `YT.Player` may replace freely — React only manages the outer container,
 *    so the player element survives re-renders and route navigation.
 */
export function PlayerHost() {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const docked = currentTrack !== null;
  const surfaceRef = useRef<HTMLDivElement>(null);

  // Boot: apply the volume preference, restore the saved session, and start
  // persisting session snapshots while playback runs.
  useEffect(() => {
    void restorePlaybackSession();
    return attachSessionPersistence();
  }, []);

  // Attach the singleton engine to the surface's imperative target node
  // whenever a track exists. Re-attaches idempotently after StrictMode's
  // simulated unmount; never creates a second container.
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

  if (!docked || !currentTrack) return null;

  return (
    <div
      data-testid="player-dock"
      className="fixed right-2 bottom-[128px] z-50 flex flex-col items-end gap-1 lg:right-4 lg:bottom-[88px]"
    >
      <div
        data-testid="player-surface"
        ref={surfaceRef}
        className="aspect-video min-h-[200px] w-[max(200px,56vw)] bg-void-black lg:aspect-auto lg:h-[225px] lg:w-[400px]"
      />
      <a
        href={`https://www.youtube.com/watch?v=${currentTrack.providerId}`}
        target="_blank"
        rel="noopener"
        data-testid="watch-on-youtube"
        className="text-caption font-regular text-mist underline-offset-2 transition-colors hover:text-pure-white hover:underline"
      >
        Watch on YouTube
      </a>
    </div>
  );
}
