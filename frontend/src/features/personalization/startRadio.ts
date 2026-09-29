import type { Track } from "@/data/repositories";
import { clearRefillFailure, reportRefillFailure } from "@/features/personalization/RefillAgent";
import {
  fetchRadioFeed,
  isRetryableRadioError,
  RadioApiError,
  type RadioFeed,
  type RadioFeedRequest,
} from "@/features/personalization/radioApi";
import { REFILL_LIMIT } from "@/features/personalization/refillEngine";
import { usePlayerStore } from "@/stores/playerStore";
import { radioIdentity, useRadioStore, type RadioSeed } from "@/stores/radioStore";

/**
 * The radio **start path** (M10 tasks 5.2–5.4; spec `radio` — "Radio modes" /
 * "Radio entry points"; design §1/§6).
 *
 * Everything else in M10 is *continuation* — the refill agent keeps a running
 * radio alive — but this module is where a radio actually begins, and it is the
 * one place the "a radio is a mode of the one queue" decision is turned into
 * state: the seed goes to `radioStore`, and the tracks go to the ordinary
 * `playerStore`/`queueStore` pair under `source: "radio"`. There is no second
 * player, no second queue, and no third way to start playback from a track plus
 * a context — the same single call the M8 shelves make, with a different
 * `source`.
 *
 * **The order below is the contract, and each step exists for a reason.**
 *
 * 1. **Resolve first.** The identity's first batch is fetched with
 *    `variant: 0` and no exclusions (nothing has played yet, so the played set
 *    is empty by definition). Nothing local moves until material exists.
 * 2. **Nothing resolved → nothing started.** An empty feed reports `empty` and
 *    calls `stopRadio()`, so a radio is never left half-started — no seed with
 *    an empty queue, no refill agent counting down a queue that does not exist.
 *    The queue is not touched.
 * 3. **Register the radio before the queue.** `startRadio` runs before the
 *    transport call, so by the time a track is current the radio it belongs to
 *    is already recorded. The reverse order would let the first
 *    `useRefillAgent` pass see a low ordinary queue instead of a radio.
 * 4. **Adopt the batch once.** `playerStore.playTrack` performs the single
 *    documented `setContext(track, context, "radio")` plus the one `load`
 *    request, so starting a radio replaces the queue and starts playback exactly
 *    once — never a second autoplay over the first track.
 * 5. **Failure touches nothing.** An `unavailable` outcome leaves the queue,
 *    the pointer, the transport, and any running radio exactly as they were, and
 *    records the message on `radioStore` so a surface can offer the retry. A
 *    cancelled request rethrows instead: the caller is gone, so there is nothing
 *    to report and nothing to keep.
 *
 * **Nothing here may leave the device** (spec `personalization` — "Nothing is
 * uploaded"). The only request built below is the identity, the caller's own
 * rotation index, a limit, and (later, for refills) an id exclusion list —
 * assembled by `radioApi`, which has no liked-track, history, language, or
 * taste-profile parameter at all. The local profile steers *ranking* of a
 * refill's candidates, after the response, in the agent.
 */

/**
 * How a start attempt settled.
 *
 * `empty` and `unavailable` are both refusals, and they are different ones:
 * `empty` means the provider resolved no material for this identity (the route's
 * `unresolvable` answer), which is a graceful end rather than a fault;
 * `unavailable` means the request itself could not be completed, and is the only
 * outcome worth offering a retry against. Neither carries a queue, and neither
 * leaves a radio behind.
 */
export type StartRadioOutcome =
  | { status: "started"; track: Track; queue: Track[] }
  | { status: "empty" }
  | { status: "unavailable" };

/**
 * Options every start entry point accepts.
 *
 * `signal` exists so a surface that goes away mid-request (a route change, an
 * unmount) can cancel it; a cancelled request rethrows rather than reporting a
 * failure nobody is left to read.
 */
export interface StartRadioOptions {
  signal?: AbortSignal;
}

/**
 * The rotation index every *start* asks with.
 *
 * Zero, always: a radio's first batch is its seed cycle, and the counter only
 * advances after a *successful refill* (design §2), so nothing here can consume
 * a rotation step and desynchronise the server's curated-seed rotation from the
 * radio's own history.
 */
const START_VARIANT = 0;

/**
 * The first batch's request: the seed identity, no exclusions, the engine's own
 * limit.
 *
 * `REFILL_LIMIT` is reused deliberately rather than re-invented. A start is not
 * a refill (it is `variant: 0` with nothing played), but both draw material
 * from the same endpoint with the same bounds, and one constant means the start
 * batch and the first refill cannot drift apart — for instance the start batch
 * being so small that the radio would be at the low-water mark before the first
 * track finished.
 */
function startRequest(seed: RadioSeed): RadioFeedRequest {
  const identity = radioIdentity(seed);
  return {
    ...identity,
    variant: START_VARIANT,
    limit: REFILL_LIMIT,
    exclude: [],
  };
}

/** A start attempt's worth of options, defaulted once. */
function optionsOf(opts: StartRadioOptions | undefined): { signal?: AbortSignal } {
  return opts?.signal === undefined ? {} : { signal: opts.signal };
}

/**
 * Record a start failure so a surface can offer a retry, without touching the
 * queue or the transport.
 *
 * `radioStore.lastError` is the store's own documented slot for "the last
 * failure worth showing on the queue", and it is reached through
 * `setStatus("error", …)` — the same transition a failed refill uses, so there
 * is one place that decides what a radio failure looks like. Nothing here can
 * move playback: a preference-like field plus a message.
 *
 * Only a *retryable* code is recorded. `unresolvable` (handled as `empty`) and
 * `invalid_request` are settled answers — re-sending the same dead question
 * would only fail the same way, and offering a retry that cannot succeed is
 * worse than silence.
 */
function reportStartFailure(error: unknown): void {
  const failure = error instanceof RadioApiError ? error : new RadioApiError("network");
  if (!isRetryableRadioError(failure.code)) return;
  useRadioStore.getState().setStatus("error", failure.message);
  // The same channel the refill agent publishes to, so a failed start and a
  // failed refill offer the user one retry affordance rather than two.
  reportRefillFailure(failure.message);
}

/**
 * The single resolution step both entry points share: fetch, classify, and
 * either adopt the batch or leave everything alone.
 *
 * Returns the resolved feed, or `null` after recording the refusal. Split out so
 * the two public entry points cannot diverge in *when* they resolve, *what* they
 * send, or *what* a failure does — the only thing that differs between them is
 * the seed.
 */
async function resolveFirstBatch(
  seed: RadioSeed,
  opts: StartRadioOptions | undefined,
): Promise<{ feed: RadioFeed } | { outcome: StartRadioOutcome }> {
  try {
    const feed = await fetchRadioFeed(startRequest(seed), optionsOf(opts));
    // `parseRadioResponse` already turns a resolved-nothing body into
    // `unresolvable`, so an empty list reaching here would mean the contract was
    // violated — refuse rather than adopt an empty queue.
    if (feed.tracks.length === 0) {
      useRadioStore.getState().stopRadio();
      return { outcome: { status: "empty" } };
    }
    return { feed };
  } catch (error) {
    // Cancellation is not a failure to report: the caller has gone.
    if (opts?.signal?.aborted) throw error;
    const failure = error instanceof RadioApiError ? error : new RadioApiError("network");
    if (failure.code === "unresolvable") {
      // Nothing to play for this identity: end gracefully rather than retrying
      // or substituting material the user did not ask for.
      useRadioStore.getState().stopRadio();
      return { outcome: { status: "empty" } };
    }
    reportStartFailure(failure);
    return { outcome: { status: "unavailable" } };
  }
}

/**
 * Start a **track** radio (spec: "Starting a track radio replaces the queue and
 * plays").
 *
 * On success the queue is the radio's own tracks with its first track current
 * and playing, the queue source is `radio`, and the listening context recorded
 * for what plays is `radio`. On either refusal the previous queue and playback
 * are untouched.
 */
export async function startTrackRadio(
  track: Track,
  opts?: StartRadioOptions,
): Promise<StartRadioOutcome> {
  const seed: RadioSeed = { kind: "track", track };
  const resolved = await resolveFirstBatch(seed, opts);
  if ("outcome" in resolved) return resolved.outcome;

  const queue = resolved.feed.tracks;
  const first = queue[0];
  // Register the radio *before* the queue (step 3 of the contract).
  useRadioStore.getState().startRadio(seed);
  // A start that succeeds clears any failure a previous attempt left behind.
  clearRefillFailure();
  // One `setContext` + one `load`: the queue is replaced and playback starts
  // exactly once, through the same path every other track+context start uses.
  usePlayerStore.getState().playTrack(first, queue, "radio");
  return { status: "started", track: first, queue };
}

/**
 * Start an **artist** radio (spec: "Starting an artist radio seeds from that
 * artist").
 *
 * Identical mechanics to {@link startTrackRadio}; the only difference is the
 * identity the request carries, which is why the entry point decides the seed and
 * this module never learns whether a caller was a menu, a page, or a button.
 */
export async function startArtistRadio(
  artist: { id?: string; name: string },
  opts?: StartRadioOptions,
): Promise<StartRadioOutcome> {
  const seed: RadioSeed = { kind: "artist", artist: { ...artist } };
  const resolved = await resolveFirstBatch(seed, opts);
  if ("outcome" in resolved) return resolved.outcome;

  const queue = resolved.feed.tracks;
  const first = queue[0];
  useRadioStore.getState().startRadio(seed);
  // A start that succeeds clears any failure a previous attempt left behind.
  clearRefillFailure();
  usePlayerStore.getState().playTrack(first, queue, "radio");
  return { status: "started", track: first, queue };
}

/**
 * The radio's state as a surface needs to present it.
 *
 * `active` answers "is a radio the current queue's mode", which is what the
 * Now Playing indicator reflects — deliberately *not* `status === "active"`, so
 * a radio whose refill failed is still labelled a radio (the refill agent
 * resumes it on its next pass) rather than silently dropping the label.
 * `"ended"` is the one status that is not a radio: the identity is exhausted, so
 * nothing is refilled and the queue plays out as an ordinary one.
 */
export interface RadioStatusView {
  active: boolean;
  /** The radio's refill counter, for a surface that shows which cycle is next. */
  variant: number;
  /** The last failure worth offering a retry against, or `null`. */
  error: string | null;
}

/**
 * Read the radio's status. Subscribes to the four store slices it renders from,
 * so a surface re-renders on exactly the changes that matter and never polls.
 */
export function useRadioStatus(): RadioStatusView {
  const seed = useRadioStore((state) => state.seed);
  const status = useRadioStore((state) => state.status);
  const variant = useRadioStore((state) => state.variant);
  const error = useRadioStore((state) => state.lastError);
  return { active: seed !== null && status !== "ended", variant, error };
}
