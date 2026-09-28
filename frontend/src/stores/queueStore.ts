import { create } from "zustand";
import type {
  QueueHistoryEntry,
  QueueSource,
  RepeatMode,
  SessionSnapshot,
  Track,
} from "@/data/repositories";

/**
 * `queueStore` (ROADMAP M6): queue membership, current index, traversal
 * (play) order, played history, queue source, and the shuffle/repeat
 * interaction — the queue half of the M4 playback state, split out of
 * `playerStore` (design §1, two-store split).
 *
 * Layering: components → queueStore; `playerStore` → queueStore is the only
 * store-to-store direction. This module never imports `playerStore` or the
 * engine (enforced by `tests/architecture.test.ts`): it is pure state +
 * transitions over queue data, so queue operations can never touch transport.
 */

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

/**
 * Queue identity for duplicate protection (design §4): same id, or same
 * provider id from the same source — mirrors `derive.ts` song dedupe.
 */
export function sameQueueIdentity(a: Track, b: Track): boolean {
  return a.id === b.id || (a.source === b.source && a.providerId === b.providerId);
}

export interface QueueState {
  // --- queue membership and traversal (M4's playback-context fields) ---
  /** The ordered context list. */
  queue: Track[];
  /** Index of the current track within `queue`. */
  queueIndex: number;
  /** Traversal order over `queue` indices (list order, or shuffled). */
  playOrder: number[];
  /** Bounded played-history stack — session bookkeeping only (design §2). */
  history: QueueHistoryEntry[];
  /** Where the current context came from (displayed by the queue surface). */
  source: QueueSource;
  shuffle: boolean;
  repeatMode: RepeatMode;

  // --- queue actions ---
  /**
   * Adopt `context` as the queue with `source`, returning the index pointing
   * at the activated track (appended when the context lacks it).
   */
  setContext(track: Track, context: Track[] | undefined, source?: QueueSource): number;
  /** Point the current index at `queue[index]` (no history side effects). */
  setQueueIndex(index: number): void;
  /**
   * Append `track` to the queue when its identity is not already current or
   * upcoming (design §4). Never touches transport; returns whether it was
   * accepted.
   */
  enqueue(track: Track): boolean;
  /**
   * Remove `queue[index]` with pointer integrity: before the current entry
   * shifts the index down, after it leaves pointers untouched, and removing
   * the current entry reports the traversal successor so `playerStore` can
   * orchestrate the continuation (load it, or `nextIndex: null` → clean stop).
   */
  remove(index: number): RemoveResult;
  /**
   * Move the entry at position `from` to position `to` within the displayed
   * upcoming sequence (design §4): rewrites the queue's tail region and
   * rebuilds `playOrder` so both stores stay consistent under either shuffle
   * state. The current entry is never a reorder target.
   */
  reorder(from: number, to: number): boolean;
  toggleShuffle(): void;
  cycleRepeat(): void;
  /**
   * Adopt a persisted session's queue half (design §1): validates the
   * snapshot's `queueIndex`/`playOrder` and returns the restored traversal
   * inputs for `playerStore`'s transport restore.
   */
  restoreQueue(snapshot: SessionSnapshot): {
    queueIndex: number;
    shuffle: boolean;
    repeatMode: RepeatMode;
  };
}

/** Outcome of `remove()` — drives the transport side of a current-track removal. */
export interface RemoveResult {
  /** True when the removed entry was the current one (`index === queueIndex`). */
  currentRemoved: boolean;
  /** New index of the entry to continue with; `null` → clean stop (no successor). */
  nextIndex: number | null;
}

/**
 * Whether `order` is a valid traversal permutation of `[0, length)` — used
 * when restoring a persisted `playOrder`; anything else falls back to a
 * freshly built order (defensive against tampered/stale backups).
 */
export function isPermutation(order: number[], length: number): boolean {
  if (order.length !== length) return false;
  const seen = new Set<number>();
  for (const value of order) {
    if (!Number.isInteger(value) || value < 0 || value >= length || seen.has(value)) return false;
    seen.add(value);
  }
  return true;
}

export const initialQueueState = {
  queue: [] as Track[],
  queueIndex: 0,
  playOrder: [] as number[],
  history: [] as QueueHistoryEntry[],
  source: "unknown" as QueueSource,
  shuffle: false,
  repeatMode: "off" as RepeatMode,
};

/** Reset queue data — test isolation and hot-reload hygiene. */
export function resetQueueStore(): void {
  useQueueStore.setState({ ...initialQueueState });
}

export const useQueueStore = create<QueueState>()((set, get) => ({
  ...initialQueueState,

  setContext(track, context, source = "unknown") {
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
      playOrder: buildPlayOrder(queue.length, index, get().shuffle),
      source,
    });
    return index;
  },

  setQueueIndex(index) {
    if (index < 0 || index >= get().queue.length) return;
    set({ queueIndex: index });
  },

  enqueue(track) {
    const { queue, queueIndex, playOrder } = get();
    // Duplicate protection covers the current entry and everything after it
    // (design §4); already-played entries may legitimately be queued again.
    const start = Math.max(queueIndex, 0);
    for (let i = start; i < queue.length; i++) {
      if (sameQueueIdentity(queue[i], track)) return false;
    }
    const nextQueue = [...queue, track];
    // Always append to the traversal tail: identity order needs the new index
    // too, and a shuffled order keeps the current entry first either way.
    set({ queue: nextQueue, playOrder: [...playOrder, nextQueue.length - 1] });
    return true;
  },

  remove(index) {
    const { queue, queueIndex, playOrder } = get();
    if (!Number.isInteger(index) || index < 0 || index >= queue.length) {
      return { currentRemoved: false, nextIndex: null };
    }
    const removingCurrent = index === queueIndex;
    let nextIndex: number | null = null;
    if (removingCurrent) {
      // Continuation = traversal successor (design §4); resolve it against the
      // pre-removal queue, then translate through the splice shift below.
      const position = playOrder.indexOf(queueIndex);
      const successor = position !== -1 ? playOrder[position + 1] : undefined;
      if (successor !== undefined) {
        nextIndex = successor > index ? successor - 1 : successor;
      }
    }
    const reindex = (value: number): number => (value > index ? value - 1 : value);
    const nextQueue = queue.filter((_, i) => i !== index);
    const nextPlayOrder = playOrder.filter((value) => value !== index).map(reindex);
    // Pointer integrity: before → shift down; after → untouched; current →
    // hand the pointer to the continuation (or -1: no current, clean stop).
    let nextQueueIndex = index < queueIndex ? queueIndex - 1 : queueIndex;
    if (removingCurrent) nextQueueIndex = nextIndex ?? -1;
    set({ queue: nextQueue, queueIndex: nextQueueIndex, playOrder: nextPlayOrder });
    return { currentRemoved: removingCurrent, nextIndex };
  },

  reorder(from, to) {
    const { queue, queueIndex, playOrder, shuffle } = get();
    const length = queue.length;
    if (length === 0 || from === to) return false;
    const currentPos = playOrder.indexOf(queueIndex);
    // Displayed upcoming = traversal entries after the current one (the whole
    // order when there is no current entry — `queueIndex === -1`).
    const ahead = currentPos === -1 ? [] : playOrder.slice(0, currentPos);
    const upcoming = currentPos === -1 ? playOrder : playOrder.slice(currentPos + 1);
    if (from < 0 || from >= upcoming.length || to < 0 || to >= upcoming.length) return false;

    const moved = [...upcoming];
    const [entry] = moved.splice(from, 1);
    moved.splice(to, 0, entry);

    // Rewrite the queue's tail slots (everything after the current entry) so
    // the array order reflects the manual order: first the moved sequence's
    // after-current entries in moved order, then the traversal-behind ones
    // (design §4 — behind-current queue entries are otherwise untouched).
    const tailSlots: number[] = [];
    for (let i = queueIndex + 1; i < length; i++) tailSlots.push(i);
    const tailValues = [
      ...moved.filter((value) => value > queueIndex),
      ...ahead.filter((value) => value > queueIndex),
    ];
    if (tailValues.length !== tailSlots.length) return false; // broken invariant
    const nextQueue = [...queue];
    const newIndexOf = new Map<number, number>();
    tailSlots.forEach((slot, i) => {
      nextQueue[slot] = queue[tailValues[i]];
      newIndexOf.set(tailValues[i], slot);
    });
    const map = (value: number): number => newIndexOf.get(value) ?? value;
    // Rebuild the traversal order so display and queue stay consistent: the
    // moved upcoming sequence right after the current entry (traversal-behind
    // entries keep their side of the pointer), or sequential identity when
    // shuffle is off — a manual order outranks the shuffled permutation until
    // the next context load or shuffle toggle.
    const nextPlayOrder = shuffle
      ? currentPos === -1
        ? moved.map(map)
        : [...ahead.map(map), queueIndex, ...moved.map(map)]
      : Array.from({ length }, (_, i) => i);
    set({ queue: nextQueue, playOrder: nextPlayOrder });
    return true;
  },

  toggleShuffle() {
    const shuffle = !get().shuffle;
    const { queue, queueIndex } = get();
    set({
      shuffle,
      playOrder: buildPlayOrder(queue.length, queueIndex, shuffle),
    });
  },

  restoreQueue(snapshot) {
    const queue = snapshot.queue.map((track) => ({ ...track }));
    const shuffle = snapshot.shuffle;
    const rawIndex = snapshot.queueIndex;
    const queueIndex =
      Number.isInteger(rawIndex) && rawIndex >= 0
        ? Math.min(rawIndex as number, Math.max(queue.length - 1, 0))
        : 0;
    const playOrder = isPermutation(snapshot.playOrder ?? [], queue.length)
      ? [...(snapshot.playOrder as number[])]
      : buildPlayOrder(queue.length, queueIndex, shuffle);
    set({
      queue,
      queueIndex,
      playOrder,
      history: snapshot.history ? snapshot.history.map((entry) => ({ ...entry })) : [],
      source: snapshot.source ?? "unknown",
      shuffle,
      repeatMode: snapshot.repeatMode,
    });
    return { queueIndex, shuffle, repeatMode: snapshot.repeatMode };
  },

  cycleRepeat() {
    const order: RepeatMode[] = ["off", "context", "track"];
    const nextMode = order[(order.indexOf(get().repeatMode) + 1) % order.length];
    set({ repeatMode: nextMode });
  },
}));
