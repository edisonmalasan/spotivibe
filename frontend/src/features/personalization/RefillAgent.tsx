"use client";

import { Button } from "@/components/design-system/Button";
import { IconButton } from "@/components/design-system/IconButton";
import type { ListeningEventRecord } from "@/data/repositories";
import { X } from "lucide-react";
import {
  countUpcomingTracks,
  planRefill,
  radioRequestFor,
  rankCandidates,
  recentWindowIds,
  selectAppendable,
  REFILL_RECENCY_WINDOW_MS,
  LOW_WATER,
  type RefillPlan,
  type RefillPolicy,
} from "@/features/personalization/refillEngine";
import {
  fetchRadioFeed,
  isRetryableRadioError,
  RadioApiError,
} from "@/features/personalization/radioApi";
import { buildTasteProfile } from "@/features/personalization/tasteProfile";
import { useHistoryStore } from "@/stores/historyStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePlayerStore } from "@/stores/playerStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useQueueStore } from "@/stores/queueStore";
import { useRadioStore } from "@/stores/radioStore";
import { type JSX, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * The refill/autofill **agent** (M10 task 4.2/4.3/4.4; spec `radio` — "Radio
 * refill" / "Queue autofill"; design §5/§7).
 *
 * One agent, two policies: it watches the queue's unplayed upcoming tracks and,
 * at the low-water mark, runs the *policy* the current state implies — a radio
 * refill (seeded from the radio's identity, excluding its session played set) or
 * ordinary autofill (seeded from the current track, excluding the recent window,
 * and only when the setting is on). Both then go through the identical
 * request → filter → score → append path in `refillEngine`, which is where the
 * *what* is decided; this module owns only the *when*, the latching, and the
 * error affordance.
 *
 * **Why it is mounted with the persistent player.** The player is the only
 * surface that outlives route changes, and "the queue is running low" is a
 * property of a queue that keeps playing while the user browses elsewhere. An
 * agent on a page would stop refilling the moment the user navigated away.
 * Mount `<RefillAgent />` once in the app shell next to the persistent player
 * (`useListeningRecorder` is the existing precedent in `AppShell`).
 *
 * The four properties the spec rests on, and how each is enforced:
 *
 * 1. **One request per low-water crossing.** A `latched` ref is set the moment a
 *    request is issued and cleared only when the queue has *grown* — above
 *    {@link LOW_WATER}, or past the count the request was made at. A failure, a
 *    slow response, or unrelated store churn cannot start a second request
 *    (nothing grew), and a genuine recovery re-arms on its own.
 * 2. **At most one request in flight.** An `inFlight` ref holds the live
 *    `AbortController`; the effect returns early while it is set, so an
 *    overlapping effect pass can never double-request.
 * 3. **Abort on unmount.** The unmount effect aborts the in-flight request, and
 *    an aborted request is never reported as a failure — a cancelled refill is
 *    not an error to show the user. The latch is released at the same time so a
 *    remount (including a StrictMode double-mount) can refill again.
 * 4. **A non-blocking, non-looping failure affordance.** A failed cycle reports
 *    through {@link reportRefillFailure}, which a small cross-surface channel
 *    carries to {@link RefillFailureNotice}. Recovery is an explicit user
 *    gesture ({@link requestRefillRetry}), never a timer.
 *
 * Layering: this is the cross-store wiring point, exactly as
 * `useListeningRecorder` is — it reads stores and writes through them, so no
 * store imports another and the queue store stays free of transport. It never
 * touches transport itself: appending to a queue is not starting playback, and
 * the currently playing track is never disturbed.
 */

/** The low-water mark is re-exported here so the mounted agent is one import. */
export { LOW_WATER };

/** Options {@link useRefillAgent} accepts. */
export interface RefillAgentOptions {
  /** Master switch; `false` detaches the agent without unmounting it. */
  enabled?: boolean;
}

// --- the failure/retry channel -------------------------------------------------

/**
 * The one piece of cross-cutting state the agent shares with a surface it is not
 * mounted next to.
 *
 * The engine is mounted in the app shell while the affordance belongs to the
 * queue surface (a different route, a different subtree), so the failure message
 * and the retry gesture travel through this tiny external store rather than
 * through a second queue state or a prop chain. It is a *notification*, not
 * queue state: nothing here can change what plays, which is the property that
 * keeps the affordance non-blocking and the queue untouchable by a failure.
 *
 * Deliberately not a zustand store and not a repo: it holds one message and one
 * counter for the lifetime of the session and nothing durable.
 */
interface RefillChannel {
  /** The last retryable failure worth showing, or `null`. */
  error: string | null;
  /** Bumped by every explicit retry; the agent re-arms on the change. */
  retryToken: number;
}

let channel: RefillChannel = { error: null, retryToken: 0 };
const channelListeners = new Set<() => void>();

function publish(next: RefillChannel): void {
  if (next.error === channel.error && next.retryToken === channel.retryToken) return;
  channel = next;
  for (const listener of [...channelListeners]) listener();
}

function subscribeToChannel(listener: () => void): () => void {
  channelListeners.add(listener);
  return () => {
    channelListeners.delete(listener);
  };
}

const readChannel = (): RefillChannel => channel;

/** Record a retryable refill failure for the queue surface to offer against. */
function reportRefillFailure(message: string): void {
  publish({ ...channel, error: message });
}

/**
 * Publish a retryable "keep playing" failure from outside this module.
 *
 * The start path (`startRadio.ts`) fails for the same reason a refill does — the
 * provider would not answer — and the user should meet the same single,
 * non-blocking retry affordance rather than two competing ones. Exported so the
 * start path reports here instead of inventing a second channel.
 */
export { reportRefillFailure };

/** Clear the message — a successful cycle, a dismissal, or a graceful end. */
function clearRefillFailure(): void {
  publish({ ...channel, error: null });
}

/** Clear a published failure from outside this module (a successful start). */
export { clearRefillFailure };

/**
 * The explicit retry gesture: clear the message and bump the token. The agent
 * watches the token, so this is the only thing that re-arms a failed cycle — a
 * timer or a retry counter would be the loop the spec forbids.
 */
function requestRefillRetry(): void {
  publish({ error: null, retryToken: channel.retryToken + 1 });
}

/**
 * Forget the failure message and the retry counter — test isolation and
 * hot-reload hygiene, the counterpart of the stores' own `reset*` helpers. The
 * channel is module state because it is shared across surfaces, so it needs the
 * same treatment the stores get.
 */
export function resetRefillChannel(): void {
  publish({ error: null, retryToken: 0 });
}

/** The queue surface's view of the failure affordance. */
export interface RefillFailure {
  /** The message to show, or `null` when there is nothing to offer. */
  error: string | null;
  /** Re-arm the failed cycle and try once. */
  retry: () => void;
  /** Dismiss the message without retrying. */
  clear: () => void;
}

/**
 * Read the failure affordance. Renders nothing by itself, so a surface can place
 * it wherever it fits without the agent having to know the queue's layout.
 */
export function useRefillFailure(): RefillFailure {
  const { error } = useSyncExternalStore(subscribeToChannel, readChannel, readChannel);
  return { error, retry: requestRefillRetry, clear: clearRefillFailure };
}

// --- the pipeline ---------------------------------------------------------------

/** End a policy gracefully: a radio with no material left simply ends. */
function endRefill(plan: RefillPlan): void {
  clearRefillFailure();
  if (plan.policy === "radio") useRadioStore.getState().setStatus("ended");
}

/**
 * Map a failed cycle onto a designed state.
 *
 * `unresolvable` is the route's answer for "no usable material", not a failure:
 * a radio ends on it, and an autofill cycle simply stops asking — neither
 * retries, and neither shows an error. Every other code reports the message and,
 * when the code is worth retrying, offers the affordance. An unrecognised
 * throwable is treated as a transport failure, so nothing escapes silently.
 */
function reportRefillProblem(plan: RefillPlan, error: unknown): void {
  const failure = error instanceof RadioApiError ? error : new RadioApiError("network");
  if (failure.code === "unresolvable") {
    endRefill(plan);
    return;
  }
  if (plan.policy === "radio") useRadioStore.getState().setStatus("error", failure.message);
  if (isRetryableRadioError(failure.code)) reportRefillFailure(failure.message);
}

/**
 * The listener's recent plays, one entry per track: the newest play wins, so the
 * recency penalty reads the listener's *latest* verdict (they completed it, then
 * skipped it) rather than an older one. `historyStore` is newest-first, so the
 * oldest entry is written first and the newest overwrites it — the store's own
 * array is never mutated.
 */
function recentPlays(
  events: readonly ListeningEventRecord[],
): Map<string, { playedAt: number; completed?: boolean }> {
  const plays = new Map<string, { playedAt: number; completed?: boolean }>();
  for (const event of [...events].reverse()) {
    plays.set(event.trackId, { playedAt: event.playedAt, completed: event.completed });
  }
  return plays;
}

/**
 * One cycle: request → filter → score → append (design §5's single path).
 *
 * Every stage is the one the engine documents, and each of them can refuse to
 * append anything: a response that resolved only already-played or
 * already-queued tracks is "no material", which ends a radio gracefully instead
 * of appending a duplicate or looping on the same exhausted question.
 *
 * The variant advances **only** here, after a successful append, so a failed
 * cycle asks the same seeds again rather than skipping a rotation step.
 */
async function performRefill(plan: RefillPlan, signal: AbortSignal): Promise<void> {
  try {
    const feed = await fetchRadioFeed(radioRequestFor(plan), { signal });

    // Design §3: the server can only honor the ids it was given, so the
    // invariant is enforced here too — a cached or truncated response that
    // re-serves a played or queued track still cannot append it. The played set
    // is re-read *after* the response, not captured before the request, so a
    // track that finished playing while the request was in flight is still
    // refused.
    const playedIds = useRadioStore.getState().playedIds;
    // A radio can end while its request is in flight (the user started ordinary
    // playback, or ended it deliberately). The response then belongs to a radio
    // that no longer exists, so it must not touch the queue that replaced it, and
    // it must not write the radio status back onto a cleared store.
    if (plan.policy === "radio" && useRadioStore.getState().seed === null) return;
    const playable = selectAppendable(feed.tracks, useQueueStore.getState().queue, playedIds);
    if (playable.length === 0) {
      endRefill(plan);
      return;
    }

    const now = Date.now();
    const { events } = useHistoryStore.getState();
    const { likedTracks } = useLibraryStore.getState();
    const { languages } = usePreferencesStore.getState();
    const ranked = rankCandidates(playable, {
      profile: buildTasteProfile({ likedTracks, events, languages, now }),
      now,
      playedIds,
      playedRecently: recentPlays(events),
      recencyWindowMs: REFILL_RECENCY_WINDOW_MS,
      limit: plan.limit,
    });

    const { appended } = useQueueStore.getState().appendUpcoming(ranked);
    if (appended.length === 0) {
      endRefill(plan);
      return;
    }
    if (plan.policy === "radio") {
      useRadioStore.getState().setStatus("active");
      useRadioStore.getState().advanceVariant();
    }
    clearRefillFailure();
  } catch (error) {
    // A cancelled refill is not a failure to report: the caller is gone.
    if (signal.aborted) return;
    reportRefillProblem(plan, error);
  }
}

/**
 * The agent's core (M10 task 4.2). Mounted by {@link RefillAgent}; separated out
 * so the latch, the abort, and the policy choice are testable without a
 * component, and so `enabled` can pause it without unmounting.
 */
export function useRefillAgent(options: RefillAgentOptions = {}): void {
  const enabled = options.enabled ?? true;

  // The queue is the only thing that can make the queue low (M10 task 2.2: the
  // store never triggers its own growth), and the current track is the autofill
  // identity. Everything else is read at request time, from the stores, so a
  // plan is always made against live state.
  const queue = useQueueStore((state) => state.queue);
  const queueIndex = useQueueStore((state) => state.queueIndex);
  const playOrder = useQueueStore((state) => state.playOrder);
  const history = useQueueStore((state) => state.history);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const radioSeed = useRadioStore((state) => state.seed);
  const radioStatus = useRadioStore((state) => state.status);
  const queueSource = useQueueStore((state) => state.source);
  const autofillEnabled = usePreferencesStore((state) => state.autofillQueue);
  // Only the retry token drives the engine; the message itself is the queue
  // surface's business (`useRefillFailure`).
  const retryToken = useSyncExternalStore(subscribeToChannel, readChannel, readChannel).retryToken;

  /** Set when a request has been issued for the current low-water crossing. */
  const latched = useRef(false);
  /** Unplayed upcoming count at the moment the latch was set (-1 = never). */
  const latchedAt = useRef(-1);
  /** The in-flight controller, or `null` — the one-request-in-flight gate. */
  const inFlight = useRef<AbortController | null>(null);
  /** The retry token already applied, so a retry is applied exactly once. */
  const seenRetryToken = useRef(retryToken);

  const remaining = countUpcomingTracks({ queue, playOrder, queueIndex, history });

  useEffect(() => {
    if (!enabled) return;

    // **Leaving a radio ends it** (spec: "Leaving a radio restores ordinary
    // playback"), and this check comes *before* the latch and the low-water gate
    // on purpose: it is a correction of state, not a refill decision, so it must
    // not be skipped because a previous cycle is latched or a request is still
    // in flight. Ordinary playback replaces the queue's context, so the source
    // moving off `"radio"` is the signal that this queue is no longer the
    // radio's. Without this the radio kept refilling somebody else's queue and
    // kept claiming the Now Playing indicator over it.
    const radioState = useRadioStore.getState();
    if (radioState.seed !== null && radioState.status !== "ended" && queueSource !== "radio") {
      radioState.stopRadio();
      clearRefillFailure();
      // An in-flight request belonged to the radio that just ended.
      inFlight.current?.abort();
      inFlight.current = null;
      latched.current = false;
      return;
    }

    // Re-arm when the queue is no longer in the state that latched this crossing:
    // either it climbed back above the mark, or a small refill still grew it past
    // where it was. Re-arming on *growth only* is what makes the latch safe — a
    // failure leaves the queue exactly where it was, so it can never re-request
    // — and it is what stops a one-track refill from wedging a radio at the mark.
    if (remaining > LOW_WATER || remaining > latchedAt.current) latched.current = false;
    if (remaining > LOW_WATER) return;
    // An explicit retry re-arms the crossing, and nothing else does.
    if (seenRetryToken.current !== retryToken) {
      seenRetryToken.current = retryToken;
      latched.current = false;
    }
    if (latched.current || inFlight.current !== null) return;

    const radio = useRadioStore.getState();
    // A cycle that failed leaves the radio in `"error"`; reaching the mark again
    // (or a retry) is a new cycle for the same radio, so it resumes rather than
    // staying wedged on its last failure. `"ended"` is the opposite — material
    // is exhausted, and the radio stops refilling for good. The *next* status is
    // what the plan is built from: resuming must not pass the stale `"error"`.
    const radioRunning = radio.seed !== null && radio.status !== "ended";
    if (radioRunning && radio.status === "error") radio.setStatus("active");
    // A radio takes over from autofill while it runs (spec: "A radio takes over
    // from autofill"); with no radio, the setting and the current track decide.
    const policy: RefillPolicy = radioRunning ? "radio" : "autofill";
    const plan = planRefill({
      policy,
      radioSeed: radio.seed,
      radioStatus: radioRunning ? "active" : radio.status,
      radioVariant: radio.variant,
      playedIds:
        policy === "radio"
          ? radio.playedIds
          : recentWindowIds(useHistoryStore.getState().events, Date.now()),
      currentTrack,
      autofillEnabled,
      now: Date.now(),
    });
    if (plan === null) return;

    // Latch before the request: the latch is what makes this one request per
    // crossing even if everything below resolves or rejects asynchronously.
    latched.current = true;
    latchedAt.current = remaining;
    const controller = new AbortController();
    inFlight.current = controller;
    void performRefill(plan, controller.signal).finally(() => {
      if (inFlight.current === controller) inFlight.current = null;
    });
  }, [
    enabled,
    remaining,
    currentTrack,
    radioSeed,
    radioStatus,
    // The radio ends when the queue's recorded source leaves it, so the source
    // is a real dependency of this effect, not an incidental read.
    queueSource,
    autofillEnabled,
    retryToken,
  ]);

  // Abort on unmount. The latch is released with it so a remount (a StrictMode
  // double-mount, or a shell that is torn down and rebuilt) can refill again
  // rather than staying latched on a request that was cancelled.
  useEffect(
    () => () => {
      inFlight.current?.abort();
      inFlight.current = null;
      latched.current = false;
      latchedAt.current = -1;
    },
    [],
  );
}

/**
 * The mounted agent: run the engine and render the queue's failure affordance.
 *
 * Mount it once, next to the persistent player, in the app shell — the same place
 * `useListeningRecorder` is mounted and for the same reason.
 */
export function RefillAgent(): JSX.Element {
  useRefillAgent();
  return <RefillFailureNotice />;
}

/**
 * The non-blocking refill-failure affordance (M10 task 4.4).
 *
 * A polite live region rather than a modal, positioned like the connectivity
 * banner: beneath the top bar, clear of the player regions and the docked video
 * surface, so a failed refill can never take playback away or cover the queue the
 * user is reading. It renders nothing at all unless there is a retryable failure
 * to offer, and both actions it exposes — retry and dismiss — leave the existing
 * queue exactly as it is (spec: "the existing queue keeps playing").
 */
export function RefillFailureNotice(): JSX.Element | null {
  const { error, retry, clear } = useRefillFailure();
  if (error === null) return null;
  return (
    <div
      role="status"
      data-testid="refill-failure"
      className="fixed right-4 top-18 z-40 flex max-w-96 items-center gap-2 rounded-cards bg-graphite px-4 py-3 shadow-lg"
    >
      <span className="text-body font-regular text-pure-white">{error}</span>
      <Button variant="pill" onClick={retry}>
        Try again
      </Button>
      <IconButton label="Dismiss refill message" onClick={clear}>
        <X className="size-4" aria-hidden="true" />
      </IconButton>
    </div>
  );
}
