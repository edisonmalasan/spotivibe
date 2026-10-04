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
 * - M11: the event is written at the step's start and its **measurements** are
 *   filled in when the step ends — the seconds the engine actually played
 *   (`positionSeconds`, clamped to the track's duration) and whether playback
 *   reached the end. Those are raw observations, never a verdict: `classifyPlay`
 *   reads them later, so the classification rule can change without a migration
 *   and no stored interpretation can disagree with the numbers it came from.
 *   Without this, every recorded event would carry zero seconds and every play
 *   would read as a skip, which is why the write is here rather than invented
 *   inside the statistics derivation.
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
  // A radio is its own listening context (M10): a track heard through one is
  // recorded as radio playback, not as the surface its seed was started from.
  radio: "radio",
  unknown: "other",
};

/** The listening context a queue source is recorded under (never `undefined`). */
export function listeningContextForSource(source: QueueSource): ListeningContext {
  return LISTENING_CONTEXT_BY_SOURCE[source] ?? "other";
}

type Teardown = () => void;

/**
 * How close to the reported duration counts as having played to the end.
 *
 * The engine's final position tick lands a fraction of a second short of the
 * duration, so an exact comparison would never mark a finished track as
 * finished. This is a tolerance on a *measurement*, not a listening threshold:
 * whether that play counts is `classifyPlay`'s question, not this one's.
 */
export const ENDED_POSITION_TOLERANCE_SECONDS = 1.5;

let teardown: Teardown | null = null;
/** Track id of the newest recorded event (or the newest stored one on attach). */
let lastRecordedTrackId: string | null = null;
/** Serializes writes so overlapping steps cannot interleave repository calls. */
let writeChain: Promise<void> = Promise.resolve();
/** One-time history hydration, so an attach never duplicates a past event. */
let historyReady: Promise<void> | null = null;

/** The step whose measurements are still open, and what has been observed. */
interface OpenStep {
  /** Event id the measurements belong to. */
  eventId: string;
  /** Track id of the step, so a state change for another track is ignored. */
  trackId: string;
  /** Last position the engine reported for this step. */
  positionSeconds: number;
  /** Duration the engine reported for this step (`0` when unknown). */
  durationSeconds: number;
  /** Whether the step ever reached its end. */
  reachedEnd: boolean;
}

let openStep: OpenStep | null = null;

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
  openStep = null;
}

/**
 * Wait until every write the recorder has queued has been committed.
 *
 * Writes are serialized through {@link writeChain} and there is no debounce or timer on the path,
 * so awaiting the chain is *sufficient* rather than a hopeful wait: once it settles, the repository
 * has been called for every step recorded so far, and a subsequent read sees them all.
 *
 * ## Why this exists
 *
 * `tests/podcast-playback-history.test.ts` waited for recorded events by **polling with a 2000 ms
 * deadline**, and failed intermittently under load — roughly one run in three on a busy machine. The
 * deadline was standing in for the chain, so its adequacy depended on how slow the surrounding
 * suite happened to be. Raising the number would have made the flake rarer without making it
 * impossible, which is the same as not fixing it.
 *
 * This is a real API rather than a test-only hook: anything that needs the history to be complete
 * before it reads it — an export, a backup, a flush before the page goes away — has the same need.
 */
export async function flushListeningRecorder(): Promise<void> {
  // Hydration first: a write queued behind it waits on it, so awaiting the chain alone would be
  // correct here but reading this in the other order makes the dependency obvious rather than
  // incidental.
  await historyReady;
  await writeChain;
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
      // The previous step's measurements are written before the new event, so
      // the dataset never holds two open steps and a step is never measured
      // against another track's position.
      closeOpenStep();
      const created = await useHistoryStore.getState().record(event);
      lastRecordedTrackId = created.trackId;
      const { durationSeconds } = usePlayerStore.getState();
      openStep = {
        eventId: created.id,
        trackId: track.id,
        // A track with no known duration starts at the position the load
        // requested, so a restored cue is not measured from zero.
        positionSeconds: usePlayerStore.getState().positionSeconds,
        durationSeconds: track.durationSeconds ?? durationSeconds,
        reachedEnd: false,
      };
    })
    .catch((error: unknown) => {
      console.warn("[history] listening event not recorded:", error);
    });
}

/**
 * Write the open step's measurements and close it.
 *
 * A no-op when no step is open, when the step never moved (a load that failed or
 * was immediately replaced writes nothing rather than a zero-length play), and
 * when its event no longer exists — which is exactly what happens if the listener
 * clears history mid-track.
 */
function closeOpenStep(): void {
  const step = openStep;
  openStep = null;
  if (step === null) return;
  const { positionSeconds, durationSeconds, reachedEnd } = step;
  if (positionSeconds <= 0 && !reachedEnd) return;

  const secondsPlayed =
    durationSeconds > 0 ? Math.min(positionSeconds, durationSeconds) : positionSeconds;
  writeChain = writeChain
    .then(async () => {
      await useHistoryStore.getState().updateMeasurements(step.eventId, {
        secondsPlayed: Math.round(secondsPlayed),
        // A track of unknown length can still have played to its end; a known
        // one counts as finished once the reported position reaches it.
        completed: reachedEnd || (durationSeconds > 0 && positionSeconds >= durationSeconds),
      });
    })
    .catch((error: unknown) => {
      // The event itself is already stored; losing its measurement degrades the
      // statistics to "a play with no seconds", which is reported, not hidden.
      console.warn("[history] listening measurements not stored:", error);
    });
}

/**
 * Subscribe to track starts and to the playback ticks of the open step; returns
 * the detacher. Unlike {@link initListeningRecorder} this always attaches, so an
 * explicit re-attach is possible.
 */
export function attachListeningRecorder(): Teardown {
  let lastToken = 0;
  const unsubscribe = usePlayerStore.subscribe((state) => {
    const request = state.loadRequest;
    const isNewStep = request !== null && request.mode === "load" && request.token !== lastToken;

    if (!isNewStep) {
      // Not a step start: this is a playback tick for the step already open.
      // The measurement is captured *here* because by the time the next load
      // request arrives the store has already switched to the next track, and
      // the previous track's final position would be gone.
      if (openStep === null || state.currentTrack?.id !== openStep.trackId) return;
      openStep.positionSeconds = state.positionSeconds;
      if (state.durationSeconds > 0) openStep.durationSeconds = state.durationSeconds;
      if (
        openStep.durationSeconds > 0 &&
        state.positionSeconds >= openStep.durationSeconds - ENDED_POSITION_TOLERANCE_SECONDS
      ) {
        openStep.reachedEnd = true;
      }
      return;
    }

    lastToken = request.token;
    const track = state.currentTrack;
    if (!track) return;
    recordStep(track);
  });

  // A document teardown never runs a React unmount, so the open step's seconds
  // would be lost on a soft navigation or a closed tab — where they were really
  // played. Best effort by nature: a hard close can still beat the write, and a
  // missing measurement is reported as a play with no seconds rather than guessed.
  const flush = () => closeOpenStep();
  window.addEventListener("pagehide", flush);

  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", flush);
    // Detaching is a step ending: the listener closed the tab or the shell
    // unmounted mid-track, and those seconds really were played.
    closeOpenStep();
  };
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
