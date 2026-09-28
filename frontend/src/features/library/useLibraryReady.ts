"use client";

import { useEffect, useState } from "react";
import { useLibraryStore } from "@/stores/libraryStore";

/**
 * Settle the shared library read on mount (design §1: `hydrate()` is
 * idempotent and shell-global, so any surface may trigger it): returns
 * `false` until the first read resolves or fails, letting surfaces show
 * their loading status instead of flashing the empty state at cold start.
 * A failed read still settles — storage-unavailable surfaces fall through
 * to their empty state rather than loading forever.
 */
export function useLibraryReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void useLibraryStore
      .getState()
      .hydrate()
      .catch((error: unknown) => {
        console.warn("[library] library unavailable:", error);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
