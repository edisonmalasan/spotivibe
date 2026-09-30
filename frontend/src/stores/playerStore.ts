import { create } from "zustand";
import type { QueueSource, SessionSnapshot, Track } from "@/data/repositories";
import { readVolumePreference, writeVolumePreference } from "@/player/volumePref";
import { useNetworkStore } from "@/stores/networkStore";
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

/**
 * How far inside the end a cue may land (M12 design decision 7).
 *
 * A cue exactly at the duration is the end, so the clamp stops short of it: the
 * listener hears the last moments rather than being dropped straight into the
 * "ended" state they were trying to resume from.
 */
export const END_CUE_TAIL_SECONDS = 2;

/**
 * Clamp a requested start position into `[0, duration]`.
 *
 * A track with no known duration (`0`) is never clamped — there is nothing to
 * compare against, and the player is the authority once it reports one. An
 * unknown position is treated as the start, because a cue that cannot be read is
 * a cue that cannot be resumed from.
 */
export function clampCuePosition(positionSeconds: number, durationSeconds: number): number {
  const position = Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) : 0;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return position;
  return Math.min(position, Math.max(0, durationSeconds - END_CUE_TAIL_SECONDS));
}

/** Offline parking copy (design §9) — replaces a failure message while offline. */
export const OFFLINE_PARKED_MESSAGE = "You're offline — playback will resume when you reconnect.";

/**
 * The offline half of the suppression funnel (design §9): the network store
 * is authoritative when the monitor is running, with `navigator.onLine` as
 * the fallback before it initializes.
 */
function isOffline(): boolean {
  if (useNetworkStore.getState().connection === "offline") return true;
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

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
  /**
   * Remove `queue[index]`, orchestrating the transport half when the removed
   * entry is the current one (design §4): continue with the traversal
   * successor (the removal click is the user gesture), or issue a clean stop
   * when there is none. Queue-only removals never touch transport.
   */
  removeFromQueue(index: number): void;
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
    const durationSeconds = track.durationSeconds ?? 0;
    // M12: a stored position can disagree with the track's current duration — an
    // episode re-cut shorter, or a snapshot from a different metadata revision.
    // Cueing past the end is what the IFrame player treats as the end (or an
    // error), so the *load* is clamped while the stored snapshot keeps its
    // original position: a later restore against a known duration resumes where
    // the listener left off (design decision 7).
    const cueSeconds = clampCuePosition(startSeconds, durationSeconds);
    set({
      currentTrack: track,
      positionSeconds: cueSeconds,
      durationSeconds,
      status: mode === "load" ? "loading" : "paused",
      errorMessage: clearError ? null : get().errorMessage,
      loadRequest: {
        token: ++loadToken,
        videoId: track.providerId,
        startSeconds: cueSeconds,
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
      useQueueStore.getState().advanceTo(target); // history + pointer (design §3)
      requestTrack(target, "load", 0, true);
    },

    previous() {
      const queueState = useQueueStore.getState();
      if (queueState.queue.length === 0 || !get().currentTrack) return;
      // (1) Past the threshold, "previous" restarts the current track (spec).
      if (get().positionSeconds > NEXT_RESTART_THRESHOLD) {
        get().seek(0);
        return;
      }
      // (2) Newest history entry that still resolves in the queue → jump back,
      // consuming the entry (design §3); unresolvable entries were dropped.
      const jump = queueState.historyJump();
      if (jump !== null) {
        requestTrack(jump, "load", 0, true);
        return;
      }
      // (3) History exhausted → context step-back; (4) nothing → restart.
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

    removeFromQueue(index) {
      // Removing the current entry is the only branch with transport meaning,
      // and only while something is actually playing (an idle queue edit must
      // never start playback — no autoplay).
      const hasCurrent = get().currentTrack !== null;
      const { currentRemoved, nextIndex } = useQueueStore.getState().remove(index);
      if (!currentRemoved || !hasCurrent) return;
      const queue = useQueueStore.getState().queue;
      if (nextIndex !== null && queue[nextIndex]) {
        requestTrack(nextIndex, "load", 0, true);
        return;
      }
      // Clean stop: no successor (design §4) — idle, no error, no autoplay.
      set({
        status: "idle",
        currentTrack: null,
        positionSeconds: 0,
        durationSeconds: 0,
        errorMessage: null,
        loadRequest: null,
      });
      bridge?.pause();
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
      const durationSeconds = track.durationSeconds ?? 0;
      // M12: clamp the cue to the duration when the two disagree (an episode
      // re-cut shorter than the stored position). The snapshot keeps the original
      // position - the clamp is a property of this load, not a rewrite.
      const cueSeconds = clampCuePosition(snapshot.positionSeconds, durationSeconds);
      set({
        currentTrack: track,
        status: "paused", // cued, play affordance — never autoplay (spec)
        positionSeconds: cueSeconds,
        durationSeconds,
        errorMessage: null,
        failedTrackIds: [],
        loadRequest: {
          token: ++loadToken,
          videoId: track.providerId,
          startSeconds: cueSeconds,
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
      useQueueStore.getState().advanceTo(target); // records the finished track
      requestTrack(target, "load", 0);
      return "advanced";
    },

    _markFailed(message) {
      // Offline suppression (design §9): park without consuming the track —
      // the failed set never grows offline, so reconnect cannot inherit a
      // burned queue, and no advance is scheduled while offline.
      if (isOffline()) {
        set({ status: "error", errorMessage: OFFLINE_PARKED_MESSAGE });
        return;
      }
      const track = get().currentTrack;
      const failedTrackIds = track
        ? [...new Set([...get().failedTrackIds, track.id])]
        : get().failedTrackIds;
      set({ status: "error", errorMessage: message, failedTrackIds });
    },

    _advanceAfterFailure() {
      // Offline (design §9): stay parked on the same track — no advance, no
      // failed-set growth; the reconnect path retries it (initNetworkRecovery).
      if (isOffline()) {
        set({ status: "error", errorMessage: OFFLINE_PARKED_MESSAGE });
        return "settled";
      }
      const { queue, queueIndex, playOrder } = useQueueStore.getState();
      // Circular on purpose: the failed set only grows, so this terminates;
      // any remaining unfailed track is preferable to wedging playback (spec).
      const target = findNextUnfailed(playOrder, queue, queueIndex, get().failedTrackIds, true);
      if (target === null) return "settled";
      useQueueStore.getState().advanceTo(target); // failed-skip records too (§3)
      requestTrack(target, "load", 0);
      return "advanced";
    },
  };
});

let recoveryTeardown: (() => void) | null = null;

/** Whether the reconnect-recovery subscription is currently active. */
export function isNetworkRecoveryActive(): boolean {
  return recoveryTeardown !== null;
}

/**
 * Reconnect recovery (design §9): on a transition **to** `online`, inspect the
 * transport once — `status ∈ {error, loading, buffering}` with a current track
 * issues exactly one `loadRequest` (`mode: "load"`, resuming at the current
 * position); `playing` / `paused` / `idle` take no action (paused and idle
 * never resume on their own, and playing is unaffected). One retry per
 * transition; a failed retry surfaces through the normal error path. Idempotent:
 * a second init attaches no second subscription and returns a no-op teardown.
 */
export function initNetworkRecovery(): () => void {
  if (recoveryTeardown) return () => {};
  let previous = useNetworkStore.getState().connection;
  const unsubscribe = useNetworkStore.subscribe((state) => {
    const next = state.connection;
    const becameOnline = previous !== "online" && next === "online";
    previous = next;
    if (!becameOnline) return;
    const { currentTrack, status, positionSeconds } = usePlayerStore.getState();
    if (!currentTrack) return;
    if (status !== "error" && status !== "loading" && status !== "buffering") return;
    // Exactly one reload at the stored position — same track, same lineage.
    const startSeconds = Math.max(0, positionSeconds);
    usePlayerStore.setState({
      status: "loading",
      errorMessage: null,
      loadRequest: {
        token: ++loadToken,
        videoId: currentTrack.providerId,
        startSeconds,
        mode: "load",
      },
    });
  });
  recoveryTeardown = () => {
    unsubscribe();
    recoveryTeardown = null;
  };
  return recoveryTeardown;
}
