import { create } from "zustand";
import type { QueueSource, SessionSnapshot, Track } from "@/data/repositories";
import { readVolumePreference, writeVolumePreference } from "@/player/volumePref";
import {
  findNextUnfailed,
  findPreviousUnfailed,
  resetQueueStore,
  useQueueStore,
} from "@/stores/queueStore";

/**
 * `playerStore` (ROADMAP M4/M6): the transport half of playback state —
 * current track, status, position, duration, volume, mute, errors, and load
 * requests. The queue half (membership, index, traversal order, history,
 * source, shuffle/repeat) lives in `queueStore` (design §1): this store is
 * the orchestration façade the engine and controls use, and it depends on the
 * queue store — never the reverse. The store is pure state + transitions —
 * it never imports the YouTube IFrame API. It talks to the player only
 * through the injected {@link PlaybackBridge} (engine → attached by the
 * persistent player host), which keeps every transition unit-testable with a
 * fake bridge.
 *
 * Layering: components → playerStore → queueStore; playerStore →
 * PlaybackBridge → engine → IFrame API.
 */

export type PlaybackStatus = "idle" | "loading" | "playing" | "buffering" | "paused" | "error";

/** Control surface the engine exposes to the store. Loads/cues do not appear
 * here — they flow through {@link LoadRequest} tokens so a newer request
 * always supersedes an older one. */
export interface PlaybackBridge {
  play(): void;
  pause(): void;
  seekTo(seconds: number): void;
  /** Player volume in 0..100 (the store's unit; snapshots store 0..1). */
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
}

/** A request for the engine to put a video into the player. */
export interface LoadRequest {
  /** Monotonic id — the engine reacts only to newer requests. */
  token: number;
  videoId: string;
  startSeconds: number;
  /** `load` starts playback; `cue` prepares paused at `startSeconds` (restore). */
  mode: "load" | "cue";
}

export type EndedOutcome = "replay" | "advanced" | "stopped";
export type FailureOutcome = "advanced" | "settled";

/** Previous restarts the current track once playback is past this point. */
export const RESTART_THRESHOLD_SECONDS = 3;

let bridge: PlaybackBridge | null = null;
let loadToken = 0;

/** Attach/detach the engine's control surface (called by the player host). */
export function setPlaybackBridge(next: PlaybackBridge): void {
  bridge = next;
}

export function clearPlaybackBridge(): void {
  bridge = null;
}

export function getPlaybackBridge(): PlaybackBridge | null {
  return bridge;
}

export interface PlayerState {
  // --- transport only (queue membership lives in queueStore) ---
  currentTrack: Track | null;
  status: PlaybackStatus;
  positionSeconds: number;
  /** 0 until known; corrected from the player when it is authoritative. */
  durationSeconds: number;
  volume: number; // 0..100
  muted: boolean;
  errorMessage: string | null;
  failedTrackIds: string[];
  loadRequest: LoadRequest | null;

  // --- user-facing actions ---
  /**
   * Load `track` (optionally within a surrounding list) and start it,
   * adopting the context and its `source` into `queueStore`.
   */
  playTrack(track: Track, context?: Track[], source?: QueueSource): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  next(): void;
  previous(): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  /** Re-apply the persisted volume/mute boot preference (client boot only). */
  applyVolumePreference(): void;
  /** Restore a persisted session, cued paused at the saved position (no autoplay). */
  restoreSession(snapshot: SessionSnapshot): void;

  // --- engine-only transitions (underscore-prefixed; called by the engine) ---
  _setStatus(status: PlaybackStatus): void;
  _setPosition(seconds: number): void;
  _setDuration(seconds: number): void;
  _onEnded(): EndedOutcome;
  _markFailed(message: string): void;
  _advanceAfterFailure(): FailureOutcome;
}

const NEXT_RESTART_THRESHOLD = RESTART_THRESHOLD_SECONDS;

export const initialPlayerState = {
  currentTrack: null as Track | null,
  status: "idle" as PlaybackStatus,
  positionSeconds: 0,
  durationSeconds: 0,
  volume: 80,
  muted: false,
  errorMessage: null as string | null,
  failedTrackIds: [] as string[],
  loadRequest: null as LoadRequest | null,
};

/** Reset store data (and the bridge) — test isolation and hot-reload hygiene. */
export function resetPlayerStore(): void {
  clearPlaybackBridge();
  resetQueueStore(); // queue state belongs to the paired queue store
  usePlayerStore.setState({ ...initialPlayerState, volume: 80, muted: false });
}

export const usePlayerStore = create<PlayerState>()((set, get) => {
  /** Queue a load/cue for the engine and optimistically adopt its status. */
  function requestTrack(
    index: number,
    mode: "load" | "cue",
    startSeconds: number,
    clearError = false,
  ): void {
    const track = useQueueStore.getState().queue[index];
    if (!track) return;
    useQueueStore.getState().setQueueIndex(index);
    set({
      currentTrack: track,
      positionSeconds: startSeconds,
      durationSeconds: track.durationSeconds ?? 0,
      status: mode === "load" ? "loading" : "paused",
      errorMessage: clearError ? null : get().errorMessage,
      loadRequest: {
        token: ++loadToken,
        videoId: track.providerId,
        startSeconds,
        mode,
      },
    });
  }

  return {
    ...initialPlayerState,

    playTrack(track, context, source = "unknown") {
      useQueueStore.getState().setContext(track, context, source);
      set({
        currentTrack: track,
        status: "loading",
        positionSeconds: 0,
        durationSeconds: track.durationSeconds ?? 0,
        errorMessage: null,
        failedTrackIds: [],
        loadRequest: {
          token: ++loadToken,
          videoId: track.providerId,
          startSeconds: 0,
          mode: "load",
        },
      });
    },

    play() {
      if (!get().currentTrack) return;
      set({ status: "buffering" }); // until the player confirms PLAYING
      bridge?.play();
    },

    pause() {
      if (!get().currentTrack) return;
      set({ status: "paused" });
      bridge?.pause();
    },

    seek(seconds) {
      if (!get().currentTrack) return;
      const { durationSeconds } = get();
      const bounded = Math.max(
        0,
        durationSeconds > 0 ? Math.min(seconds, durationSeconds) : seconds,
      );
      set({ positionSeconds: bounded });
      bridge?.seekTo(bounded);
    },

    next() {
      const { queue, queueIndex, playOrder, repeatMode } = useQueueStore.getState();
      if (queue.length === 0) return;
      const target = findNextUnfailed(
        playOrder,
        queue,
        queueIndex,
        get().failedTrackIds,
        repeatMode === "context",
      );
      if (target === null) return; // end of list with repeat off: stay put
      requestTrack(target, "load", 0, true);
    },

    previous() {
      const queueState = useQueueStore.getState();
      if (queueState.queue.length === 0 || !get().currentTrack) return;
      // Past the threshold, "previous" restarts the current track (spec).
      if (get().positionSeconds > NEXT_RESTART_THRESHOLD) {
        get().seek(0);
        return;
      }
      const { queue, queueIndex, playOrder, repeatMode } = useQueueStore.getState();
      const circular = repeatMode === "context";
      const target =
        findPreviousUnfailed(playOrder, queue, queueIndex, get().failedTrackIds, circular) ??
        // At the start of a bounded order, previous restarts the current track.
        queueIndex;
      if (target === queueIndex) {
        get().seek(0);
        return;
      }
      requestTrack(target, "load", 0, true);
    },

    setVolume(volume) {
      const clamped = Math.min(100, Math.max(0, Math.round(volume)));
      set({ volume: clamped });
      writeVolumePreference({ volume: clamped, muted: get().muted });
      bridge?.setVolume(clamped);
    },

    toggleMute() {
      const muted = !get().muted;
      set({ muted });
      writeVolumePreference({ volume: get().volume, muted });
      bridge?.setMuted(muted);
    },

    applyVolumePreference() {
      const preference = readVolumePreference();
      set({ volume: preference.volume, muted: preference.muted });
    },

    restoreSession(snapshot) {
      const { queue, queueIndex } = snapshot;
      if (queue.length === 0 || queueIndex < 0 || queueIndex >= queue.length) return;
      useQueueStore.getState().restoreQueue(snapshot);
      const track = queue[queueIndex];
      set({
        currentTrack: track,
        status: "paused", // cued, play affordance — never autoplay (spec)
        positionSeconds: Math.max(0, snapshot.positionSeconds),
        durationSeconds: track.durationSeconds ?? 0,
        errorMessage: null,
        failedTrackIds: [],
        loadRequest: {
          token: ++loadToken,
          videoId: track.providerId,
          startSeconds: Math.max(0, snapshot.positionSeconds),
          mode: "cue",
        },
      });
    },

    _setStatus(status) {
      // Successful playback clears any surfaced failure message (spec).
      if (status === "playing") set({ status, errorMessage: null });
      else set({ status });
    },

    _setPosition(seconds) {
      set({ positionSeconds: Math.max(0, seconds) });
    },

    _setDuration(seconds) {
      if (seconds > 0 && seconds !== get().durationSeconds) {
        set({ durationSeconds: seconds });
      }
    },

    _onEnded() {
      const { repeatMode } = useQueueStore.getState();
      if (repeatMode === "track") {
        set({ positionSeconds: 0, status: "buffering" });
        return "replay";
      }
      const { queue, queueIndex, playOrder } = useQueueStore.getState();
      const target = findNextUnfailed(
        playOrder,
        queue,
        queueIndex,
        get().failedTrackIds,
        repeatMode === "context",
      );
      if (target === null) {
        // Repeat off at the end of the list: stable stopped state (spec).
        set({ status: "paused" });
        return "stopped";
      }
      requestTrack(target, "load", 0);
      return "advanced";
    },

    _markFailed(message) {
      const track = get().currentTrack;
      const failedTrackIds = track
        ? [...new Set([...get().failedTrackIds, track.id])]
        : get().failedTrackIds;
      set({ status: "error", errorMessage: message, failedTrackIds });
    },

    _advanceAfterFailure() {
      const { queue, queueIndex, playOrder } = useQueueStore.getState();
      // Circular on purpose: the failed set only grows, so this terminates;
      // any remaining unfailed track is preferable to wedging playback (spec).
      const target = findNextUnfailed(playOrder, queue, queueIndex, get().failedTrackIds, true);
      if (target === null) return "settled";
      requestTrack(target, "load", 0);
      return "advanced";
    },
  };
});
