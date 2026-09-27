/**
 * Minimal hand-written types for the subset of the YouTube IFrame Player API
 * Spotivibe uses (ROADMAP M4). Keeping this surface small isolates everything
 * except the engine from the external API shape and avoids an extra type
 * dependency (`@types/youtube`).
 */

/** Methods the engine calls on the player instance. */
export interface YtPlayer {
  cueVideoById(video: { videoId: string; startSeconds?: number }): void;
  loadVideoById(video: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  getPlayerState(): number;
  getCurrentTime(): number;
  getDuration(): number;
}

/** Player construction options — only the documented fields we set. */
export interface YtPlayerOptions {
  height?: string | number;
  width?: string | number;
  videoId?: string;
  playerVars?: Record<string, string | number | boolean>;
  events?: {
    onReady?: (event: { target: YtPlayer }) => void;
    onStateChange?: (event: { target: YtPlayer; data: number }) => void;
    onError?: (event: { target: YtPlayer; data: number }) => void;
  };
}

/** The `YT` namespace surface consumed by the engine. */
export interface YtNamespace {
  Player: new (element: HTMLElement, options: YtPlayerOptions) => YtPlayer;
}

/** Numeric `YT.PlayerState` values (stable across API versions). */
export const YT_STATE = {
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

/** Player error codes Spotivibe handles (ROADMAP M4 error taxonomy). */
export const YT_ERROR = {
  /** Invalid parameter — the video cannot be loaded at all. */
  INVALID: 2,
  /** HTML5 player failure — treated as transient and retried. */
  HTML5: 5,
  /** Video does not exist (deleted/removed). */
  NOT_FOUND: 100,
  /** The owner has disabled embedding. */
  EMBEDDING_DISABLED: 101,
  /** The owner has restricted embedding to specific domains. */
  EMBEDDING_RESTRICTED: 150,
} as const;

/**
 * Fatal (non-retryable) player errors: the video is unplayable in this
 * context, so the track is marked failed and playback advances instead of
 * retrying (spec: unplayable track handling).
 */
export function isFatalPlayerError(code: number): boolean {
  return (
    code === YT_ERROR.INVALID ||
    code === YT_ERROR.NOT_FOUND ||
    code === YT_ERROR.EMBEDDING_DISABLED ||
    code === YT_ERROR.EMBEDDING_RESTRICTED
  );
}
