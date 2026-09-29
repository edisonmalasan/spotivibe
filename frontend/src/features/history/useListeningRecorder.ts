import { useEffect } from "react";
import type { ListeningContext, NewListeningEvent, QueueSource, Track } from "@/data/repositories";
import { useHistoryStore } from "@/stores/historyStore";
import { usePlayerStore } from "@/stores/playerStore";
import { useQueueStore } from "@/stores/queueStore";

/**
 * `useListeningRecorder` (ROADMAP M8, design §5/§6): records **one** local
 * listening event per track step so Home can render "recently played" without
 * any account, server profile, or analytics.
 *
 * Recording semantics (design §6, deliberately minimal):
 * - A step is a *load* request — `playerStore` issues one when playback really
 *   starts a track (`playTrack`, `next`, `previous`, auto-advance). A session
 *   restore cues a track paused (`mode: "cue"`) and is therefore not a step.
 * - An event is written only when the started track is **not** the track of the
 *   newest recorded event, so re-activating the same track adds nothing.
 * - `secondsPlayed` starts at 0; meaningful-play thresholds, completion, and
 *   retention are the M11 model, not invented here.
 * - Position/status ticks never produce a load request, so they can never
 *   produce an event.
 *
 * Layering: the hook is the single cross-store wiring point (design §5) — it
 * reads `playerStore`/`queueStore` and writes through `historyStore`, so no
 * store ever imports another. It never imports `player/engine` or the IFrame
 * API loader.
 */

/**
 * Queue source → listening context. `browse` is the label Home/Discover shelves
 * use (M7 evidence), and it is recorded as the `home` context the spec defines.
 */
export const LISTENING_CONTEXT_BY_SOURCE: Readonly<Record<QueueSource, ListeningContext>> = {
  search: "search",
  browse: "home",
  library: "library",
  queue: "queue",
  unknown: "other",
};

/** The listening context a queue source is recorded under (never `undefined`). */
export function listeningContextForSource(source: QueueSource): ListeningContext {
  return LISTENING_CONTEXT_BY_SOURCE[source] ?? "other";
}

type Teardown = () => void;

let teardown: Teardown | null = null;
/** Track id of the newest recorded event (or the newest stored one on attach). */
let lastRecordedTrackId: string | null = null;
/** Serializes writes so overlapping steps cannot interleave repository calls. */
let writeChain: Promise<void> = Promise.resolve();
/** One-time history hydration, so an attach never duplicates a past event. */
let historyReady: Promise<void> | null = null;

/** Whether the recorder subscription is currently attached. */
export function isListeningRecorderActive(): boolean {
  return teardown !== null;
}

/** Forget module state and detach — test isolation and hot-reload hygiene. */
export function resetListeningRecorder(): void {
  teardown?.();
  teardown = null;
  lastRecordedTrackId = null;
  historyReady = null;
  writeChain = Promise.resolve();
}

/** Read the newest stored event once, so a replayed track is not re-recorded. */
function ensureHistoryReady(): Promise<void> {
  if (!historyReady) {
    historyReady = useHistoryStore
      .getState()
      .hydrate()
      .then(() => {
        lastRecordedTrackId = useHistoryStore.getState().events[0]?.trackId ?? null;
      })
      .catch((error: unknown) => {
        // Storage unavailable/blocked: playback continues in memory and the
        // next step retries. Never reject the chain (that would kill later writes).
        console.warn("[history] listening history unavailable:", error);
      });
  }
  return historyReady;
}

/** Queue one repository write for a started track. */
function recordStep(track: Track): void {
  if (lastRecordedTrackId === track.id) return;
  const event: NewListeningEvent = {
    trackId: track.id,
    track,
    playedAt: Date.now(),
    secondsPlayed: 0,
    context: listeningContextForSource(useQueueStore.getState().source),
  };
  writeChain = writeChain
    .then(async () => {
      // Re-check after hydration: an earlier session may already own this track.
      await ensureHistoryReady();
      if (lastRecordedTrackId === track.id) return;
      const created = await useHistoryStore.getState().record(event);
      lastRecordedTrackId = created.trackId;
    })
    .catch((error: unknown) => {
      console.warn("[history] listening event not recorded:", error);
    });
}

/**
 * Subscribe to track starts; returns the detacher. Unlike
 * {@link initListeningRecorder} this always attaches, so an explicit
 * re-attach is possible.
 */
export function attachListeningRecorder(): Teardown {
  let lastToken = 0;
  const unsubscribe = usePlayerStore.subscribe((state) => {
    const request = state.loadRequest;
    // A step is a *new load* request: ticks (position/status/duration) reuse
    // the previous request object and can never reach this branch.
    if (!request || request.mode !== "load" || request.token === lastToken) return;
    lastToken = request.token;
    const track = state.currentTrack;
    if (!track) return;
    recordStep(track);
  });
  return unsubscribe;
}

/**
 * Attach the recorder once. A second init attaches no second subscription and
 * returns a no-op teardown (the `initNetworkRecovery` convention), so a
 * StrictMode remount cannot double-record.
 */
export function initListeningRecorder(): Teardown {
  if (teardown) return () => {};
  const detach = attachListeningRecorder();
  teardown = () => {
    detach();
    teardown = null;
  };
  return teardown;
}

/** Mount point for the shell: attach on mount, detach on unmount. */
export function useListeningRecorder(): void {
  useEffect(() => initListeningRecorder(), []);
}
