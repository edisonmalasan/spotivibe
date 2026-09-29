"use client";

import { useEffect } from "react";
import type { Track } from "@/data/repositories";
import { useLibraryStore } from "@/stores/libraryStore";

/**
 * Like state for a rendered result set (design §11): a thin wrapper over
 * `libraryStore` — the hook triggers `hydrate()` and selects the shared
 * `likedIds`, so a like toggled anywhere else (Liked Songs, Now Playing,
 * another result set) reflects here without a remount.
 *
 * The API is unchanged from the M5 repository-backed hook: `likedIds` is
 * `null` until the first read settles, and `toggleLike` never rejects —
 * surfaces fire and forget it, so failures are logged rather than surfacing
 * as unhandled rejections.
 */
export function useLikedTracks(): {
  /** `null` until the first read settles. */
  likedIds: ReadonlySet<string> | null;
  toggleLike(track: Track): Promise<void>;
} {
  const likedIds = useLibraryStore((state) => state.likedIds);
  const hydrated = useLibraryStore((state) => state.hydrated);
  const storeToggleLike = useLibraryStore((state) => state.toggleLike);

  useEffect(() => {
    void useLibraryStore
      .getState()
      .hydrate()
      .catch((error: unknown) => {
        // Storage unavailable: expose "nothing liked" rather than a stuck menu;
        // the toggle path reports its own failures when the user acts.
        console.warn("[search] liked tracks unavailable:", error);
      });
  }, []);

  const toggleLike = async (track: Track): Promise<void> => {
    try {
      await storeToggleLike(track);
    } catch (error) {
      // Explicit failure: keep the persisted state on screen.
      console.warn("[search] like toggle failed:", error);
    }
  };

  return { likedIds: hydrated ? likedIds : null, toggleLike };
}
