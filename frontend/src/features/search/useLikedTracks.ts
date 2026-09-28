"use client";

import { useCallback, useEffect, useState } from "react";
import { getLocalData } from "@/data/localData";
import type { Track } from "@/data/repositories";

/**
 * Like state for a rendered result set (design §8): `likedTracks.list()` is
 * read when results render, and every toggle awaits the repository before the
 * UI updates — the visible state is always the persisted state, with no
 * optimistic rollback to reconcile.
 */
export function useLikedTracks(): {
  /** `null` until the first read settles. */
  likedIds: ReadonlySet<string> | null;
  toggleLike(track: Track): Promise<void>;
} {
  const [likedIds, setLikedIds] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getLocalData()
      .then((data) => data.likedTracks.list())
      .then((records) => {
        if (!cancelled) setLikedIds(new Set(records.map((record) => record.trackId)));
      })
      .catch((error: unknown) => {
        // Storage unavailable: expose "nothing liked" rather than a stuck menu;
        // the toggle path reports its own failures when the user acts.
        console.warn("[search] liked tracks unavailable:", error);
        if (!cancelled) setLikedIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleLike = useCallback(async (track: Track): Promise<void> => {
    try {
      const data = await getLocalData();
      const liked = await data.likedTracks.isLiked(track.id);
      if (liked) {
        await data.likedTracks.unlike(track.id);
      } else {
        await data.likedTracks.like(track);
      }
      // Repository first, UI second (design §8).
      setLikedIds((previous) => {
        const next = new Set(previous ?? []);
        if (liked) next.delete(track.id);
        else next.add(track.id);
        return next;
      });
    } catch (error) {
      // Explicit failure: keep the persisted state on screen.
      console.warn("[search] like toggle failed:", error);
    }
  }, []);

  return { likedIds, toggleLike };
}
