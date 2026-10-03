import { create } from "zustand";

/**
 * `downloadStore` (M20; spec `download` — "A download is offered where a track is, and only one
 * runs at a time").
 *
 * Per-track download **status only**: whether a track is idle, downloading, done, or failed. It holds
 * no file, no Blob, no object URL, and no bytes — the file is handed to the device and gone, which is
 * what "download-to-device only" means in practice.
 *
 * Layering, deliberately as thin as `radioStore`'s: this module imports only `zustand`. It cannot
 * reach playback, the queue, or the data layer, so downloading cannot start a track, cannot write to
 * IndexedDB, and cannot change what plays. The single-flight map that makes a second activation
 * *join* the first transfer lives in `features/download/useDownloadTrack.ts` beside the request it
 * governs, rather than here, because it is a property of the request and not observable state.
 */

/** A track's download status. `done` is terminal until the next activation; there is no timer. */
export type DownloadStatus = "idle" | "busy" | "done" | "failed";

export interface DownloadState {
  /** Status by track id. Absent means idle. */
  statuses: Readonly<Record<string, DownloadStatus>>;
  /** The last failure message by track id, for a surface that shows one. */
  errors: Readonly<Record<string, string>>;
  /** Mark a track as downloading. */
  markBusy(trackId: string): void;
  /** Mark a track as delivered, clearing any previous failure. */
  markDone(trackId: string): void;
  /** Mark a track as failed with a message a person can read. */
  markFailed(trackId: string, message: string): void;
  /** Return a track to idle — used when a surface unmounts its affordance. */
  clear(trackId: string): void;
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const next: Record<string, T> = { ...record };
  delete next[key];
  return next;
}

export const useDownloadStore = create<DownloadState>()((set) => ({
  statuses: {},
  errors: {},
  markBusy(trackId) {
    set((state) => ({
      statuses: { ...state.statuses, [trackId]: "busy" },
      errors: without(state.errors, trackId),
    }));
  },
  markDone(trackId) {
    set((state) => ({
      statuses: { ...state.statuses, [trackId]: "done" },
      errors: without(state.errors, trackId),
    }));
  },
  markFailed(trackId, message) {
    set((state) => ({
      statuses: { ...state.statuses, [trackId]: "failed" },
      errors: { ...state.errors, [trackId]: message },
    }));
  },
  clear(trackId) {
    set((state) => ({
      statuses: without(state.statuses, trackId),
      errors: without(state.errors, trackId),
    }));
  },
}));

/** How many tracks currently hold an entry — asserted to stay bounded by tests. */
export function trackedDownloadStatuses(state: DownloadState): number {
  return Object.keys(state.statuses).length;
}
