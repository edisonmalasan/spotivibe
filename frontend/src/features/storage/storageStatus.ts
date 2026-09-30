import { create } from "zustand";
import { getLocalData } from "@/data/localData";
import { useEffect } from "react";

/**
 * Storage status, and the listener-visible story for it (M14; spec `local-data` —
 * "Versioned IndexedDB storage with durable data"; design decision 5).
 *
 * ## Why this exists
 *
 * The data layer already fails cleanly: `StorageUnavailableError` is a named error and
 * every repository rejects with it. What it did *not* do was tell the listener. A
 * failed read logged a warning and the surface fell through to its **empty state**,
 * which is indistinguishable from "you have no tracks" - and to the person looking at
 * it those are not the same thing at all.
 *
 * ## Why it lives here and not in the data layer
 *
 * The data layer is pure: repositories in, data out, no stores, no React. The
 * dependency in this codebase runs stores → data, so the *shell* observes the
 * connection's outcome and holds the story. `getLocalData()` stays untouched and
 * unremarkable; this module is the one place that decides what a failure means to the
 * person using the application.
 */
export type StorageStatus = "unknown" | "ready" | "unavailable";

export interface StorageState {
  status: StorageStatus;
  /** The failure's own name, when there was one - `StorageUnavailableError`. */
  reason?: string;
  /** Epoch ms when the status was last decided. */
  changedAt: number;
  setStatus(status: StorageStatus, reason?: string): void;
}

export const initialStorageState: {
  status: StorageStatus;
  reason?: string;
  changedAt: number;
} = {
  status: "unknown",
  changedAt: 0,
};

export function resetStorageStore(): void {
  observing = undefined;
  useStorageStore.setState({ ...initialStorageState });
}

export const useStorageStore = create<StorageState>((set) => ({
  ...initialStorageState,
  setStatus(status, reason) {
    set({ status, reason, changedAt: Date.now() });
  },
}));

/**
 * The observation in flight, or `undefined`.
 *
 * The same once-guarded shape as the YouTube API loader and the session attacher:
 * several surfaces can ask, and they must share one observation rather than each
 * starting their own. Cleared when the observation settles, so a *later* attempt can
 * genuinely retry - storage can be unblocked mid-session, for instance after someone
 * leaves a private window.
 */
let observing: Promise<void> | undefined;

/** Observe the connection, at most once at a time. Exported for test isolation. */
export function observeStorage(): Promise<void> {
  if (observing) return observing;
  observing = getLocalData()
    .then(() => {
      useStorageStore.getState().setStatus("ready");
    })
    .catch((error: unknown) => {
      const name = error instanceof Error ? error.name : "unknown";
      useStorageStore.getState().setStatus("unavailable", name);
    })
    .finally(() => {
      observing = undefined;
    });
  return observing;
}

/**
 * Observe the local-data connection once per page load.
 *
 * Idempotent and safe to call from more than one surface. The refusal is *recorded*,
 * not thrown: a failed open must not crash a surface that could otherwise still render
 * the shell, the player region, and anything the network can answer.
 */
export function useStorageStatus(): StorageStatus {
  const status = useStorageStore((state) => state.status);

  useEffect(() => {
    if (useStorageStore.getState().status !== "unknown") return;
    void observeStorage();
  }, []);

  return status;
}
