import { create } from "zustand";
import type { RepeatMode, SessionSnapshot, Track } from "@/data/repositories";
import { readVolumePreference, writeVolumePreference } from "@/player/volumePref";

/**
 * `playerStore` (ROADMAP M4): the single client-side source of truth for
 * playback state. The store is pure state + transitions — it never imports
 * the YouTube IFrame API. It talks to the player only through the injected
 * {@link PlaybackBridge} (engine → attached by the persistent player host),
 * which keeps every transition unit-testable with a fake bridge.
 *
 * Layering: components → playerStore → PlaybackBridge → engine → IFrame API.
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

/**
 * Traversal order over queue indices. With shuffle on, the current track
 * comes first and the rest are shuffled — `previous`/`next` follow this order.
 */
export function buildPlayOrder(length: number, currentIndex: number, shuffle: boolean): number[] {
  const list = Array.from({ length }, (_, index) => index);
  if (!shuffle || length <= 1) return list;
  const rest = list.filter((index) => index !== currentIndex);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [currentIndex, ...rest];
}

function isFailed(track: Track | undefined, failedTrackIds: string[]): boolean {
  return track !== undefined && failedTrackIds.includes(track.id);
}

/**
 * First unfailed queue index after `fromIndex` in traversal order. `circular`
 * wraps past the end (repeat context / failure chains — failures only ever
 * grow, so circular failure search terminates); otherwise it stops at the end.
 */
export function findNextUnfailed(
  playOrder: number[],
  queue: Track[],
  fromIndex: number,
  failedTrackIds: string[],
  circular: boolean,
): number | null {
  const start = playOrder.indexOf(fromIndex);
  if (start === -1) return null;
  const steps = circular ? playOrder.length : playOrder.length - 1;
  for (let step = 1; step <= steps; step++) {
    let position = start + step;
    if (position >= playOrder.length) {
      if (!circular) break; // bounded order: no wrap past the end
      position %= playOrder.length;
    }
    const candidate = playOrder[position];
    if (!isFailed(queue[candidate], failedTrackIds)) return candidate;
  }
  return null;
}

/** First unfailed queue index before `fromIndex` in traversal order. */
export function findPreviousUnfailed(
  playOrder: number[],
  queue: Track[],
  fromIndex: number,
  failedTrackIds: string[],
  circular: boolean,
): number | null {
  const start = playOrder.indexOf(fromIndex);
  if (start === -1) return null;
  const steps = circular ? playOrder.length : playOrder.length - 1;
  for (let step = 1; step <= steps; step++) {
    let position = start - step;
    if (position < 0) {
      if (!circular) break; // bounded order: no wrap before the start
      position = ((position % playOrder.length) + playOrder.length) % playOrder.length;
    }
    const candidate = playOrder[position];
    if (!isFailed(queue[candidate], failedTrackIds)) return candidate;
  }
  return null;
}

export interface PlayerState {
  // --- playback context (mirrors the M2 SessionSnapshot) ---
  queue: Track[];
  queueIndex: number;
  currentTrack: Track | null;
  /** Traversal order over `queue` indices (list order, or shuffled). */
  playOrder: number[];
  repeatMode: RepeatMode;
  shuffle: boolean;

  // --- player state/status ---
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
  /** Load `track` (optionally within a surrounding list) and start it. */
  playTrack(track: Track, context?: Track[]): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  next(): void;
  previous(): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  cycleRepeat(): void;
  toggleShuffle(): void;
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
  queue: [] as Track[],
  queueIndex: 0,
  currentTrack: null as Track | null,
  playOrder: [] as number[],
  repeatMode: "off" as RepeatMode,
  shuffle: false,
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
    const { queue } = get();
    const track = queue[index];
    if (!track) return;
    set({
      queueIndex: index,
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

    playTrack(track, context) {
      const list = context && context.length > 0 ? context : [track];
      let index = list.findIndex((entry) => entry.id === track.id);
      const queue = [...list];
      if (index === -1) {
        // Defensive: keep queue/queueIndex coherent when the caller's context
        // does not contain the clicked track (session restore reads both).
        queue.push(track);
        index = queue.length - 1;
      }
      set({
        queue,
        queueIndex: index,
        currentTrack: track,
        playOrder: buildPlayOrder(queue.length, index, get().shuffle),
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
      const bounded = Math.max(0, durationSeconds > 0 ? Math.min(seconds, durationSeconds) : seconds);
      set({ positionSeconds: bounded });
      bridge?.seekTo(bounded);
    },

    next() {
      const { queue, queueIndex, playOrder, failedTrackIds, repeatMode } = get();
      if (queue.length === 0) return;
      const target = findNextUnfailed(
        playOrder,
        queue,
        queueIndex,
        failedTrackIds,
        repeatMode === "context",
      );
      if (target === null) return; // end of list with repeat off: stay put
      requestTrack(target, "load", 0, true);
    },

    previous() {
      const { queue, queueIndex, playOrder, failedTrackIds, repeatMode, positionSeconds } = get();
      if (queue.length === 0 || !get().currentTrack) return;
      // Past the threshold, "previous" restarts the current track (spec).
      if (positionSeconds > NEXT_RESTART_THRESHOLD) {
        get().seek(0);
        return;
      }
      const circular = repeatMode === "context";
      const target =
        findPreviousUnfailed(playOrder, queue, queueIndex, failedTrackIds, circular) ??
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

    cycleRepeat() {
      const order: RepeatMode[] = ["off", "context", "track"];
      const nextMode = order[(order.indexOf(get().repeatMode) + 1) % order.length];
      set({ repeatMode: nextMode });
    },

    toggleShuffle() {
      const shuffle = !get().shuffle;
      const { queue, queueIndex } = get();
      set({
        shuffle,
        playOrder: buildPlayOrder(queue.length, queueIndex, shuffle),
      });
    },

    applyVolumePreference() {
      const preference = readVolumePreference();
      set({ volume: preference.volume, muted: preference.muted });
    },

    restoreSession(snapshot) {
      const { queue, queueIndex } = snapshot;
      if (queue.length === 0 || queueIndex < 0 || queueIndex >= queue.length) return;
      set({
        queue: [...queue],
        queueIndex,
        currentTrack: queue[queueIndex],
        playOrder: buildPlayOrder(queue.length, queueIndex, snapshot.shuffle),
        repeatMode: snapshot.repeatMode,
        shuffle: snapshot.shuffle,
        status: "paused", // cued, play affordance — never autoplay (spec)
        positionSeconds: Math.max(0, snapshot.positionSeconds),
        durationSeconds: queue[queueIndex].durationSeconds ?? 0,
        errorMessage: null,
        failedTrackIds: [],
        loadRequest: {
          token: ++loadToken,
          videoId: queue[queueIndex].providerId,
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
      const { repeatMode } = get();
      if (repeatMode === "track") {
        set({ positionSeconds: 0, status: "buffering" });
        return "replay";
      }
      const { queue, queueIndex, playOrder, failedTrackIds } = get();
      const target = findNextUnfailed(
        playOrder,
        queue,
        queueIndex,
        failedTrackIds,
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
      const { queue, queueIndex, playOrder, failedTrackIds } = get();
      // Circular on purpose: the failed set only grows, so this terminates;
      // any remaining unfailed track is preferable to wedging playback (spec).
      const target = findNextUnfailed(playOrder, queue, queueIndex, failedTrackIds, true);
      if (target === null) return "settled";
      requestTrack(target, "load", 0);
      return "advanced";
    },
  };
});
