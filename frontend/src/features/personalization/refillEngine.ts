import type { ListeningEventRecord, QueueHistoryEntry, Track } from "@/data/repositories";
import { MAX_RADIO_EXCLUDE, type RadioFeedRequest } from "@/features/personalization/radioApi";
import { scoreCandidates, type ScoreContext } from "@/features/personalization/scoreCandidates";
import type { TasteProfile } from "@/features/personalization/tasteProfile";
import { sameQueueIdentity } from "@/stores/queueStore";
import { radioIdentity, type RadioSeed, type RadioStatus } from "@/stores/radioStore";

/**
 * The **policy** half of the refill engine (M10 task 4.2/4.3; spec `radio` —
 * "Radio refill" / "Played-track dedupe" / "Queue autofill"; design §2/§3/§5).
 *
 * One pipeline, two policies (design §5): *decide what to ask for* (this module)
 * and *do it* (the agent in `RefillAgent.tsx`, which is the only thing that
 * mounts, latches, and requests). Everything here is pure — no React, no fetch,
 * no store reads, no clock of its own — so every rule below is a testable
 * function of data the caller hands in.
 *
 * The three stages are deliberately separate and in this order:
 *
 * 1. {@link planRefill} — which identity to ask for, from which policy.
 * 2. {@link selectAppendable} — refuse anything this listener already played or
 *    already has queued, **client-side** (design §3: the server can only honor
 *    the ids it was given).
 * 3. {@link rankCandidates} — order the survivors with the local taste profile.
 *
 * Then the agent appends through `queueStore.appendUpcoming`, which enforces
 * the queue's own duplicate rule as the last line of defence.
 *
 * **Nothing here may leave the device.** A plan carries an identity, the
 * caller's own refill counter, a limit, and the ids it wants kept out — the same
 * six keys `buildRadioQuery` can construct. There is no code path from the taste
 * profile to a request; the profile steers *ranking* (stage 3), which happens
 * after the response, locally.
 */

/** Which refill policy a plan was built under (design §5). */
export type RefillPolicy = "radio" | "autofill";

/**
 * How many unplayed upcoming tracks are enough to stop asking (M10 task 4.2).
 *
 * A refill is a network round trip plus a local ranking pass, so the mark has to
 * be deep enough that the material is usually ready before the queue reaches its
 * end, and shallow enough that a slow or failing provider still leaves time to
 * recover. Three upcoming tracks is the documented mark; the constant is
 * exported so the agent, its tests, and the spec's "low-water mark" all read one
 * value.
 */
export const LOW_WATER = 3;

/**
 * How many tracks one refill asks for.
 *
 * Large enough that one cycle covers a whole low-water run and a short
 * provider gap, small enough to stay inside the route's own bound
 * (`MAX_RADIO_LIMIT`) with room to spare.
 */
export const REFILL_LIMIT = 12;

/** Everything one policy decision reads. All of it is already on this device. */
export interface RefillPlanInput {
  /** Which policy to apply. The agent picks it; this module validates it. */
  policy: RefillPolicy;
  /** The radio's seed, or `null` when no radio is running. */
  radioSeed: RadioSeed | null;
  /** The radio's status (`"active"` is the only refillable one). */
  radioStatus: RadioStatus;
  /** The radio's own refill counter — the request's only rotation input. */
  radioVariant: number;
  /**
   * Ids to keep out of the response: the radio's session played set under the
   * `radio` policy, and the listener's recent-play window under `autofill`
   * (design §5 — the two policies differ in *how much* is excluded, which is
   * data, not code). Oldest first; the bound keeps the most recent.
   */
  playedIds: readonly string[];
  /** The track ordinary playback is on — the autofill identity. */
  currentTrack: Track | null;
  /** The `autofillQueue` setting; read by the agent, honored here. */
  autofillEnabled: boolean;
  /** Epoch milliseconds; carried so a plan is a function of its input only. */
  now: number;
}

/** One request's worth of decision: exactly what to ask the radio route for. */
export interface RefillPlan {
  /** The policy this plan was built under. */
  policy: RefillPolicy;
  /** Which identity the request follows: the seed track, or a whole artist. */
  kind: "track" | "artist";
  /** Public track title. Present for every `track` plan, absent otherwise. */
  title?: string;
  /** Public artist name. Present only when the identity names one. */
  artist?: string;
  /**
   * The rotation index this cycle is planned from.
   *
   * The radio policy uses the radio's own counter, which advances only after a
   * *successful* refill (design §2) — that is what makes each cycle ask for
   * different curated seeds and what keeps a failed cycle from asking the same
   * dead question.
   *
   * The autofill policy uses **0**, deliberately: autofill is not a radio, so it
   * has no refill counter and no seed rotation to drive. Its variety comes from
   * the changing current track and from the local ranking of the response, and a
   * stable rotation index is what lets the route's request-keyed TTL cache
   * dedupe a repeat ask instead of spending provider work on it.
   */
  variant: number;
  /**
   * Ids to keep out of the response: deduped, bounded to {@link
   * MAX_RADIO_EXCLUDE}, and **most recent last**. The bound is a truncation of
   * the oldest ids only, so the ids the listener cares about most are the ones
   * guaranteed to survive it.
   */
  exclude: string[];
  /** How many tracks to ask for. */
  limit: number;
}

/** A non-blank trimmed value, or `undefined`. */
function usableText(raw: string | undefined): string | undefined {
  const text = raw?.trim();
  return text === undefined || text.length === 0 ? undefined : text;
}

/**
 * The exclusion list a plan carries: trimmed, deduped, and bounded to the
 * contract's {@link MAX_RADIO_EXCLUDE}.
 *
 * The bound is taken from the **end** of the list on purpose. The caller hands
 * these ids in play order, so slicing the tail keeps the most recently played
 * ones (with the most recent last) and drops the oldest — the only ids whose
 * loss can still let an old, well-liked track back in, which is exactly the
 * re-serve the exclusion exists to prevent. `buildRadioQuery` re-validates the
 * bound, so an over-long list never reaches the network even if this is bypassed.
 */
function boundedExclude(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    cleaned.push(id);
  }
  return cleaned.length > MAX_RADIO_EXCLUDE
    ? cleaned.slice(cleaned.length - MAX_RADIO_EXCLUDE)
    : cleaned;
}

/**
 * Decide what — if anything — to request now.
 *
 * Returns `null` for every case where a request would be wrong, and the caller
 * does nothing at all (no latch, no retry, no error):
 *
 * - **`radio` policy, no seed** — an active radio with nothing to follow has no
 *   identity to request, so there is nothing to ask for.
 * - **`radio` policy, not `"active"`** — an `"ended"` radio has no material
 *   left and an `"error"`/`"idle"` one is not refilling.
 * - **`autofill` policy, setting off** — autofill spends provider requests on
 *   the listener's behalf, so the setting gates it (design §6).
 * - **`autofill` policy, no current track** — an ordinary queue with nothing
 *   playing has no identity to follow.
 * - **an identity with no usable text** — a request that could only be rejected
 *   as `invalid_request` is never planned.
 *
 * Together, "no active radio and autofill off" is the no-op case the agent
 * reaches: neither policy yields a plan, so the engine stays silent and the
 * queue plays to its end.
 */
export function planRefill(input: RefillPlanInput): RefillPlan | null {
  if (input.policy === "radio") {
    if (input.radioStatus !== "active" || input.radioSeed === null) return null;
    const identity = radioIdentity(input.radioSeed);
    const plan: RefillPlan = {
      policy: "radio",
      kind: identity.kind,
      variant: input.radioVariant,
      exclude: boundedExclude(input.playedIds),
      limit: REFILL_LIMIT,
    };
    if (identity.kind === "track") {
      const title = usableText(identity.title);
      if (title === undefined) return null;
      plan.title = title;
      const artist = usableText(identity.artist);
      if (artist !== undefined) plan.artist = artist;
      return plan;
    }
    const artist = usableText(identity.artist);
    if (artist === undefined) return null;
    plan.artist = artist;
    return plan;
  }

  if (!input.autofillEnabled || input.currentTrack === null) return null;
  const title = usableText(input.currentTrack.title);
  if (title === undefined) return null;
  const plan: RefillPlan = {
    policy: "autofill",
    kind: "track",
    title,
    variant: 0,
    exclude: boundedExclude(input.playedIds),
    limit: REFILL_LIMIT,
  };
  const artist = usableText(input.currentTrack.artists[0]?.name);
  if (artist !== undefined) plan.artist = artist;
  return plan;
}

/**
 * The request a plan describes — the whole of what may cross the network.
 *
 * Exactly the documented keys, assembled once so there is a single place to read
 * and test: an identity, the rotation index, a limit, and the exclusion list. No
 * liked track, playlist, history row, language, or taste-profile weight is
 * reachable from here.
 */
export function radioRequestFor(plan: RefillPlan): RadioFeedRequest {
  return {
    kind: plan.kind,
    ...(plan.title === undefined ? {} : { title: plan.title }),
    ...(plan.artist === undefined ? {} : { artist: plan.artist }),
    variant: plan.variant,
    limit: plan.limit,
    exclude: plan.exclude,
  };
}

/** Everything the local ranking needs for one cycle. */
export interface RankContext {
  /** The derived local profile — never sent anywhere (design §4). */
  profile: TasteProfile;
  /** The ranking's single reference instant, in epoch milliseconds. */
  now: number;
  /** Ids this radio already played: a hard penalty, ranked last. */
  playedIds: readonly string[];
  /** The listener's recent plays with their instants and verdicts. */
  playedRecently: ReadonlyMap<string, { playedAt: number; completed?: boolean }>;
  /** How far back a play still counts as recent, in milliseconds. */
  recencyWindowMs: number;
  /** How many ranked tracks to keep. */
  limit: number;
}

/**
 * Order candidates with the local taste profile and return at most `limit` of
 * them.
 *
 * A thin, total wrapper over {@link scoreCandidates}: it returns plain `Track`s
 * in scored order, truncated, so the engine's contract is "the order to append
 * in" rather than "the score breakdown" — the breakdown stays available to a
 * future explainable surface without this pipeline having to expose it.
 *
 * The ranking is deterministic: no randomness, no clock of its own (`now`
 * arrives as data), and ties break on the canonical id. Two cycles over the same
 * candidates therefore produce the same append order, which is what makes
 * "the appended order is the ranked order" a real assertion.
 */
export function rankCandidates(tracks: readonly Track[], context: RankContext): Track[] {
  const scoreContext: ScoreContext = {
    profile: context.profile,
    now: context.now,
    playedIds: context.playedIds,
    playedRecently: context.playedRecently,
    recencyWindowMs: context.recencyWindowMs,
  };
  const limit = Math.max(0, Math.trunc(context.limit));
  return scoreCandidates(tracks, scoreContext)
    .slice(0, limit)
    .map((scored) => scored.track);
}

/**
 * Keep only the candidates that may actually be appended: drop anything this
 * listener **played** (the radio's session set — design §3) and anything already
 * **in the queue**, in either order, and dedupe the response against itself.
 *
 * The queue comparison uses the store's own {@link sameQueueIdentity} rule, so
 * a candidate is refused when it matches a queued entry by `id` *or* by
 * source+providerId — the same identity the queue itself uses, rather than a
 * second, looser comparison that could disagree with it.
 *
 * Provider order is preserved: this is a filter, not a ranker, and the order the
 * ranking stage sees is the one the provider returned.
 */
export function selectAppendable(
  tracks: readonly Track[],
  queued: readonly Track[],
  playedIds: readonly string[],
): Track[] {
  const played = new Set(playedIds);
  const present = [...queued];
  const result: Track[] = [];
  for (const track of tracks) {
    if (played.has(track.id)) continue;
    if (present.some((entry) => sameQueueIdentity(entry, track))) continue;
    present.push(track);
    result.push(track);
  }
  return result;
}

/**
 * How far back a play still counts as "recent" for autofill's exclusion window
 * and the ranking's recency penalty.
 *
 * A day is long enough that a track heard this morning cannot come back this
 * evening, and short enough that tomorrow's queue is not permanently narrowed by
 * it. The exclusion list is bounded independently ({@link MAX_RADIO_EXCLUDE}), so
 * a long listening session cannot grow a request without limit.
 */
export const REFILL_RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The ids the `autofill` policy keeps out of a request: this device's listening
 * events that fall inside the recency window, **oldest first** so the plan's
 * bound keeps the most recent.
 *
 * Deliberately weaker than the radio's rule (design §3/§5): autofill excludes
 * only the recent window, because an ordinary queue has no session played set
 * and must still be able to bring a track back on a later day. The radio's hard
 * "played in this radio, never again" rule stays a radio rule.
 *
 * `events` is newest-first (`historyStore` exposes repository order), a track
 * that appears more than once contributes one id, and a future-dated event is
 * ignored rather than read as infinitely old.
 */
export function recentWindowIds(
  events: readonly ListeningEventRecord[],
  now: number,
  windowMs: number = REFILL_RECENCY_WINDOW_MS,
): string[] {
  const seen = new Set<string>();
  const newestFirst: string[] = [];
  for (const event of events) {
    const age = now - event.playedAt;
    if (!Number.isFinite(age) || age < 0 || age > windowMs) continue;
    if (seen.has(event.trackId)) continue;
    seen.add(event.trackId);
    newestFirst.push(event.trackId);
  }
  return newestFirst.reverse();
}

/** The queue's own state a low-water measurement reads. */
export interface UpcomingMeasure {
  /** The ordered context list. */
  queue: readonly Track[];
  /** Traversal order over `queue` indices. */
  playOrder: readonly number[];
  /** Index of the current track, or `-1` when nothing is playing. */
  queueIndex: number;
  /** The bounded played-history stack — the queue's own "already played" record. */
  history: readonly QueueHistoryEntry[];
}

/**
 * How many upcoming tracks are still unplayed — the quantity the low-water mark
 * is measured against.
 *
 * The upcoming region is the traversal entries **after** the current one (the
 * same region `reorder` and the queue view use), and an entry is "played" when
 * the queue's own history stack has it. When nothing is playing there is no
 * current position, so the whole traversal is upcoming.
 *
 * It is measured from the queue, deliberately, and never from the radio's played
 * set: the played set is scoped to one radio's life and says nothing about an
 * ordinary queue, while the history stack is the queue's own record. A radio
 * therefore cannot make an ordinary queue look full, and the two dedupe
 * mechanisms stay separate — one decides *when* to ask, the other decides
 * *whether a track may be appended*.
 */
export function countUpcomingTracks(input: UpcomingMeasure): number {
  const { queue, playOrder, queueIndex, history } = input;
  const currentPos = playOrder.indexOf(queueIndex);
  const upcoming = currentPos === -1 ? playOrder : playOrder.slice(currentPos + 1);
  const played = new Set(history.map((entry) => entry.track.id));
  return upcoming.reduce((count, at) => {
    const track = queue[at];
    if (track === undefined || played.has(track.id)) return count;
    return count + 1;
  }, 0);
}
