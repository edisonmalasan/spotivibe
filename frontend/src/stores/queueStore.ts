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
