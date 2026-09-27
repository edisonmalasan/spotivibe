import {
  clearPlaybackBridge,
  setPlaybackBridge,
  usePlayerStore,
  type LoadRequest,
  type PlaybackBridge,
} from "@/stores/playerStore";
import type { YtNamespace, YtPlayer } from "./types";
import { YT_ERROR, YT_STATE, isFatalPlayerError } from "./types";
import { loadYouTubeIframeApi } from "./ytApi";

/**
 * The playback engine (ROADMAP M4): the only code that knows the YouTube
 * IFrame Player API. One module-scope instance owns one `YT.Player` for the
 * page session — `attach()` is idempotent, so StrictMode double-mounts and
 * route changes never recreate the player (spec: single persistent instance).
 *
 * Control flow:
 *  - store → engine: the store's {@link PlaybackBridge} calls (play/pause/
 *    seek/volume/mute) and `loadRequest` tokens (cue/load) via subscription;
 *  - engine → store: player events map to `_setStatus`/`_setPosition`/
 *    `_setDuration`, plus the failure taxonomy (`_markFailed` → delayed
 *    `_advanceAfterFailure`).
 *
 * Loads requested from inside a player event callback are deferred to a
 * microtask so the engine never re-enters the IFrame API synchronously.
 */

export const RETRY_BASE_MS = 1000;
export const RETRY_MAX_MS = 30_000;
export const MAX_RETRY_ATTEMPTS = 5;
/** Fatal failures surface the error first, then advance (Lyrix-verified). */
export const FAILURE_ADVANCE_DELAY_MS = 1000;
export const POLL_INTERVAL_MS = 1000;

/** Exponential backoff for transient errors: 1s, 2s, 4s… capped at 30s. */
export function backoffDelay(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

/** Human-readable failure text surfaced in the controls (spec). */
export function playerErrorMessage(code: number): string {
  switch (code) {
    case YT_ERROR.INVALID:
      return "This video can't be played (invalid video).";
    case YT_ERROR.NOT_FOUND:
      return "This video is unavailable.";
    case YT_ERROR.EMBEDDING_DISABLED:
      return "The owner has disabled embedding for this video.";
    case YT_ERROR.EMBEDDING_RESTRICTED:
      return "This video can't be played here.";
    default:
      return `Playback failed (error ${code}).`;
  }
}

interface EngineDeps {
  loadApi: () => Promise<YtNamespace>;
}

export class PlaybackEngine implements PlaybackBridge {
  private container: HTMLElement | null = null;
  private player: YtPlayer | null = null;
  private ready = false;
  private starting = false;
  private attached = false;
  private detachStore: (() => void) | null = null;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private playWhenReady = false;
  private videoErrored = false;
  private pendingLoad: LoadRequest | null = null;
  private appliedLoadToken = 0;

  constructor(private readonly deps: EngineDeps = { loadApi: loadYouTubeIframeApi }) {}

  /**
   * Idempotent: attach the bridge/subscription and start player creation once.
   * Re-attach after a `suspend()` (StrictMode) reuses the same player.
   */
  attach(container: HTMLElement): void {
    if (!this.container) this.container = container;
    if (this.attached) return;
    this.attached = true;
    setPlaybackBridge(this);
    this.detachStore = usePlayerStore.subscribe((state, previous) => {
      this.onStoreChange(state, previous);
    });
    // A request set before attach (session restore runs before the host's
    // effects) must not be missed — subscriptions only see later changes.
    const current = usePlayerStore.getState();
    if (current.loadRequest && current.loadRequest.token > this.appliedLoadToken) {
      this.pendingLoad = current.loadRequest;
      queueMicrotask(() => this.flushLoad());
    }
    // A suspend may have stopped polling mid-playback; resume it, and make
    // sure the player matches the store after any changes made while detached.
    const { status, currentTrack, volume, muted } = current;
    if (this.player) {
      this.player.setVolume(volume);
      this.setMuted(muted);
    }
    if (currentTrack && (status === "playing" || status === "buffering")) this.startPoll();
    void this.startPlayer();
  }

  /** Detach from the store (player instance survives — see class note). */
  suspend(): void {
    this.attached = false;
    this.playWhenReady = false;
    clearPlaybackBridge();
    this.detachStore?.();
    this.detachStore = null;
    this.stopPoll();
    this.clearRetry();
    this.clearAdvance();
  }

  // ------------------------------------------------------------------ bridge

  play(): void {
    if (!this.player) {
      this.playWhenReady = true; // applied when onReady fires
      void this.startPlayer(); // no-op while a start is already in flight; retries a failed API load
      return;
    }
    if (this.videoErrored) {
      // Explicit user retry after a failure: fresh load, fresh retry budget
      // (manual retries never loop — each requires a user action).
      const { currentTrack, positionSeconds } = usePlayerStore.getState();
      if (!currentTrack) return;
      this.videoErrored = false;
      this.retryAttempt = 0;
      this.clearRetry();
      this.player.loadVideoById({
        videoId: currentTrack.providerId,
        startSeconds: positionSeconds,
      });
      return;
    }
    this.player.playVideo();
  }

  pause(): void {
    if (!this.player) return;
    this.playWhenReady = false;
    this.capturePosition();
    this.player.pauseVideo();
  }

  seekTo(seconds: number): void {
    this.player?.seekTo(seconds, true);
  }

  setVolume(volume: number): void {
    this.player?.setVolume(volume);
  }

  setMuted(muted: boolean): void {
    if (!this.player) return;
    if (muted) this.player.mute();
    else this.player.unMute();
  }

  // ------------------------------------------------------------------ store

  private onStoreChange(
    state: ReturnType<typeof usePlayerStore.getState>,
    previous: ReturnType<typeof usePlayerStore.getState>,
  ): void {
    const request = state.loadRequest;
    if (request && request.token !== previous.loadRequest?.token) {
      this.pendingLoad = request;
      // Microtask-deferred so loads triggered inside player callbacks never
      // re-enter the IFrame API synchronously.
      queueMicrotask(() => this.flushLoad());
    }
    // Volume/mute deliberately NOT mirrored here: they already flow through
    // the bridge (user actions) and `handleReady` (pre-ready changes), and a
    // subscription would apply every change twice.
  }

  private flushLoad(): void {
    const request = this.pendingLoad;
    if (!request || request.token === this.appliedLoadToken) return;
    if (!this.player) {
      void this.startPlayer(); // (re)try player creation (e.g. after an API-load failure)
      return;
    }
    if (!this.ready) return; // onReady flushes again
    this.pendingLoad = null;
    this.appliedLoadToken = request.token;
    this.retryAttempt = 0;
    this.videoErrored = false;
    this.clearRetry();
    this.clearAdvance();
    if (request.mode === "cue") {
      this.player.cueVideoById({
        videoId: request.videoId,
        startSeconds: request.startSeconds,
      });
    } else {
      this.player.loadVideoById({
        videoId: request.videoId,
        startSeconds: request.startSeconds,
      });
    }
  }

  // ---------------------------------------------------------------- player

  private async startPlayer(): Promise<void> {
    if (this.player || this.starting || !this.container) return;
    this.starting = true;
    try {
      const yt = await this.deps.loadApi();
      if (this.player || !this.container) return; // suspended/created meanwhile
      this.player = new yt.Player(this.container, {
        width: "100%",
        height: "100%",
        playerVars: {
          controls: 0, // Spotivibe's custom controls drive the player (documented param)
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          iv_load_policy: 3,
          disablekb: 1,
        },
        events: {
          onReady: (event) => this.handleReady(event.target),
          onStateChange: (event) => this.handleState(event.data),
          onError: (event) => this.handleError(event.data),
        },
      });
    } catch (error: unknown) {
      // The IFrame API could not load (offline/blocked): surface a stable
      // error instead of an eternal loading state. Controls stay operable —
      // `play()` retries player creation, and nothing retries on its own.
      const message =
        error instanceof Error ? error.message : "The YouTube player could not be loaded.";
      usePlayerStore.getState()._markFailed(`Playback failed: ${message}`);
    } finally {
      this.starting = false;
    }
  }

  private handleReady(player: YtPlayer): void {
    this.player = player;
    this.ready = true;
    const { volume, muted } = usePlayerStore.getState();
    player.setVolume(volume);
    if (muted) player.mute();
    else player.unMute();
    this.flushLoad();
    if (this.playWhenReady) {
      this.playWhenReady = false;
      player.playVideo();
    }
  }

  private handleState(data: number): void {
    const store = usePlayerStore.getState();
    switch (data) {
      case YT_STATE.PLAYING:
        this.retryAttempt = 0; // successful playback resets the retry budget
        this.videoErrored = false;
        this.adoptAuthoritativeDuration();
        store._setStatus("playing");
        this.startPoll();
        break;
      case YT_STATE.PAUSED:
        store._setStatus("paused");
        this.capturePosition();
        this.stopPoll();
        break;
      case YT_STATE.BUFFERING:
        store._setStatus("buffering");
        this.startPoll();
        break;
      case YT_STATE.CUED:
        store._setStatus("paused"); // cued = ready to play, never auto-started
        this.stopPoll();
        break;
      case YT_STATE.ENDED:
        this.stopPoll();
        if (store._onEnded() === "replay") {
          // Repeat track: replay in place (load path handles `advanced`).
          this.player?.seekTo(0, true);
          this.player?.playVideo();
        }
        break;
      default:
        break;
    }
  }

  private handleError(code: number): void {
    this.stopPoll();
    this.videoErrored = true;
    const store = usePlayerStore.getState();
    const fatal = isFatalPlayerError(code);
    if (!fatal && this.retryAttempt < MAX_RETRY_ATTEMPTS) {
      // Transient: reload the current track with exponential backoff, resuming
      // near the last captured position.
      const delay = backoffDelay(this.retryAttempt);
      this.retryAttempt += 1;
      this.clearRetry();
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        const { currentTrack, positionSeconds } = usePlayerStore.getState();
        if (!currentTrack || !this.player) return;
        this.player.loadVideoById({
          videoId: currentTrack.providerId,
          startSeconds: positionSeconds,
        });
      }, delay);
      return;
    }
    // Fatal, or retries exhausted: mark the track failed, then advance.
    store._markFailed(playerErrorMessage(code));
    this.scheduleAdvance();
  }

  private scheduleAdvance(): void {
    this.clearAdvance();
    this.advanceTimer = setTimeout(() => {
      this.advanceTimer = null;
      // "advanced" → store queues a loadRequest (subscription picks it up);
      // "settled" → stable error state, controls stay operable (no loop).
      usePlayerStore.getState()._advanceAfterFailure();
    }, FAILURE_ADVANCE_DELAY_MS);
  }

  // ----------------------------------------------------------------- polling

  private startPoll(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.pollTick(), POLL_INTERVAL_MS);
  }

  private stopPoll(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private pollTick(): void {
    if (!this.player) return;
    const { currentTrack } = usePlayerStore.getState();
    if (!currentTrack) {
      this.stopPoll(); // no active track ⇒ no polling (spec)
      return;
    }
    this.capturePosition();
    this.adoptAuthoritativeDuration();
  }

  private capturePosition(): void {
    if (!this.player) return;
    const time = this.player.getCurrentTime();
    if (Number.isFinite(time) && time >= 0) usePlayerStore.getState()._setPosition(time);
  }

  private adoptAuthoritativeDuration(): void {
    if (!this.player) return;
    const duration = this.player.getDuration();
    if (Number.isFinite(duration) && duration > 0) {
      usePlayerStore.getState()._setDuration(duration);
    }
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private clearAdvance(): void {
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
  }
}

let engine: PlaybackEngine | null = null;

/** The process-wide playback bridge (AGENTS.md sanctioned singleton). */
export function getPlaybackEngine(): PlaybackEngine {
  if (!engine) engine = new PlaybackEngine();
  return engine;
}

/** Test-only: suspend and drop the singleton between tests. */
export function resetPlaybackEngineForTests(): void {
  engine?.suspend();
  engine = null;
}
