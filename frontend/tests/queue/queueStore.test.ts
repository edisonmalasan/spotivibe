import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPlayOrder,
  findNextUnfailed,
  findPreviousUnfailed,
  initialQueueState,
  isPermutation,
  resetQueueStore,
  sameQueueIdentity,
  useQueueStore,
} from "@/stores/queueStore";
import { initialPlayerState, resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { makeTrack } from "../helpers/music-fixtures";

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const trackB = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Bravo" });
const trackC = makeTrack({ id: "youtube:ccc", providerId: "ccc", title: "Charlie" });

function queueState() {
  return useQueueStore.getState();
}

function playerState() {
  return usePlayerStore.getState();
}

beforeEach(() => {
  resetPlayerStore(); // cascades into resetQueueStore (paired stores)
  resetQueueStore();
});

describe("initial state and reset isolation (task 1.1)", () => {
  it("starts empty with identity traversal order and neutral mode flags", () => {
    expect(queueState().queue).toEqual([]);
    expect(queueState().queueIndex).toBe(0);
    expect(queueState().playOrder).toEqual([]);
    expect(queueState().history).toEqual([]);
    expect(queueState().source).toBe("unknown");
    expect(queueState().shuffle).toBe(false);
    expect(queueState().repeatMode).toBe("off");
    expect(initialQueueState.history).toEqual([]);
  });

  it("resetQueueStore clears queue data without touching player transport", () => {
    usePlayerStore.getState().playTrack(trackA, [trackA, trackB]);
    queueState().toggleShuffle();
    queueState().cycleRepeat();

    resetQueueStore();

    expect(queueState().queue).toEqual([]);
    expect(queueState().queueIndex).toBe(0);
    expect(queueState().playOrder).toEqual([]);
    expect(queueState().shuffle).toBe(false);
    expect(queueState().repeatMode).toBe("off");
    // Transport state is the player store's half — untouched by a queue reset.
    expect(playerState().currentTrack).toEqual(trackA);
    expect(playerState().status).toBe("loading");
  });

  it("resetPlayerStore resets both stores (test isolation cascade)", () => {
    usePlayerStore.getState().playTrack(trackA, [trackA, trackB]);
    queueState().cycleRepeat();

    resetPlayerStore();

    expect(queueState().queue).toEqual([]);
    expect(queueState().repeatMode).toBe("off");
    expect(playerState().currentTrack).toBeNull();
  });
});

describe("setContext adoption (task 1.1)", () => {
  it("adopts the context and points the index at the activated track", () => {
    const index = queueState().setContext(trackB, [trackA, trackB, trackC], "search");

    expect(index).toBe(1);
    expect(queueState().queueIndex).toBe(1);
    expect(queueState().queue.map((track) => track.id)).toEqual([trackA.id, trackB.id, trackC.id]);
    expect(queueState().playOrder).toEqual([0, 1, 2]);
    expect(queueState().source).toBe("search");
  });

  it("appends an activated track the context does not contain", () => {
    const index = queueState().setContext(trackC, [trackA, trackB], "browse");

    expect(index).toBe(2);
    expect(queueState().queueIndex).toBe(2);
    expect(queueState().queue[2]).toEqual(trackC);
    expect(queueState().playOrder).toEqual([0, 1, 2]);
  });

  it("falls back to a single-track queue without a context", () => {
    const index = queueState().setContext(trackA, undefined);

    expect(index).toBe(0);
    expect(queueState().queue).toEqual([trackA]);
    expect(queueState().source).toBe("unknown"); // default source
  });

  it("keeps the shuffled traversal order when adopting a new context", () => {
    queueState().toggleShuffle();
    queueState().setContext(trackB, [trackA, trackB, trackC], "search");

    const order = queueState().playOrder;
    expect(order[0]).toBe(1); // current track plays first
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });
});

describe("identity matrix (task 1.1)", () => {
  it("matches by id, or by source+providerId, and rejects otherwise", () => {
    const sameId = makeTrack({ id: trackA.id, providerId: "different" });
    const sameProvider = makeTrack({ id: "youtube:other", providerId: trackA.providerId });
    const otherProvider = makeTrack({ id: "youtube:other", providerId: "zzz" });

    expect(sameQueueIdentity(trackA, sameId)).toBe(true);
    expect(sameQueueIdentity(trackA, sameProvider)).toBe(true);
    expect(sameQueueIdentity(trackA, otherProvider)).toBe(false);
    expect(sameQueueIdentity(trackA, trackB)).toBe(false);
    expect(sameQueueIdentity(trackA, trackA)).toBe(true);
  });
});

describe("pure traversal helpers (relocated from playerStore.test)", () => {
  const queue = [trackA, trackB, trackC];

  it("buildPlayOrder returns identity for list order and a current-first shuffle", () => {
    expect(buildPlayOrder(3, 1, false)).toEqual([0, 1, 2]);
    const shuffled = buildPlayOrder(3, 1, true);
    expect(shuffled[0]).toBe(1);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([0, 1, 2]);
    expect(buildPlayOrder(1, 0, true)).toEqual([0]);
  });

  it("findNextUnfailed respects the circular flag and skips failures", () => {
    const order = [0, 1, 2];
    expect(findNextUnfailed(order, queue, 2, [], false)).toBeNull();
    expect(findNextUnfailed(order, queue, 2, [], true)).toBe(0);
    expect(findNextUnfailed(order, queue, 0, [trackB.id], false)).toBe(2);
    expect(findNextUnfailed(order, queue, 0, [trackB.id, trackC.id], false)).toBeNull();
  });

  it("findPreviousUnfailed walks backward and wraps only when circular", () => {
    const order = [0, 1, 2];
    expect(findPreviousUnfailed(order, queue, 1, [], false)).toBe(0);
    expect(findPreviousUnfailed(order, queue, 0, [], false)).toBeNull();
    expect(findPreviousUnfailed(order, queue, 0, [], true)).toBe(2);
    expect(findPreviousUnfailed(order, queue, 2, [trackA.id], false)).toBe(1);
  });
});

describe("isPermutation (session restore validation)", () => {
  it("accepts exact permutations and rejects anything else", () => {
    expect(isPermutation([0, 1, 2], 3)).toBe(true);
    expect(isPermutation([2, 0, 1], 3)).toBe(true);
    expect(isPermutation([], 0)).toBe(true);

    expect(isPermutation([0, 1], 3)).toBe(false); // wrong length
    expect(isPermutation([0, 1, 1], 3)).toBe(false); // duplicate
    expect(isPermutation([0, 1, 3], 3)).toBe(false); // out of range
    expect(isPermutation([0, 1, -1], 3)).toBe(false); // negative
    expect(isPermutation([0, 1, 1.5], 3)).toBe(false); // non-integer
  });
});

describe("transport split (tasks 1.2 / 2.1)", () => {
  it("initialPlayerState carries no queue membership fields", () => {
    const keys = Object.keys(initialPlayerState);
    for (const forbidden of [
      "queue",
      "queueIndex",
      "playOrder",
      "history",
      "shuffle",
      "repeatMode",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(keys).toEqual(
      expect.arrayContaining([
        "currentTrack",
        "status",
        "positionSeconds",
        "durationSeconds",
        "volume",
        "muted",
        "errorMessage",
        "failedTrackIds",
        "loadRequest",
      ]),
    );
  });

  it("shuffle/repeat live in queueStore with their actions", () => {
    expect("shuffle" in initialPlayerState).toBe(false);
    expect("repeatMode" in initialPlayerState).toBe(false);
    expect(queueState().shuffle).toBe(false);
    expect(queueState().repeatMode).toBe("off");

    queueState().toggleShuffle();
    queueState().cycleRepeat();
    expect(queueState().shuffle).toBe(true);
    expect(queueState().repeatMode).toBe("context");
    // Player transport is untouched by queue mode toggles.
    expect(playerState().currentTrack).toBeNull();
    expect(playerState().status).toBe("idle");
  });

  it("playTrack adopts the context into queueStore while holding only transport", () => {
    playerState().playTrack(trackB, [trackA, trackB, trackC], "search");

    expect(queueState().queue).toHaveLength(3);
    expect(queueState().queueIndex).toBe(1);
    expect(queueState().source).toBe("search");

    const playerKeys = Object.keys(playerState());
    for (const forbidden of [
      "queue",
      "queueIndex",
      "playOrder",
      "history",
      "shuffle",
      "repeatMode",
      "source",
    ]) {
      expect(playerKeys).not.toContain(forbidden);
    }
    expect(playerState().currentTrack).toEqual(trackB);
    expect(playerState().loadRequest).toMatchObject({ videoId: "bbb", mode: "load" });
  });

  it("playTrack defaults the source to unknown", () => {
    playerState().playTrack(trackA, [trackA, trackB]);
    expect(queueState().source).toBe("unknown");
  });
});

/**
 * M10 task 2.2 (spec `queue` — "Queue growth by refill and autofill"): growing a
 * playing queue without disturbing it. The store never *decides* to grow — the
 * refill/autofill engine does, from the low-water mark — so these cases pin what
 * growth must preserve: the current track, the play order, the user's entries and
 * their order, and the recorded source.
 */
describe("queue growth: appendUpcoming (task 2.2)", () => {
  const grown1 = makeTrack({ id: "youtube:ggg", providerId: "ggg", title: "Growth One" });
  const grown2 = makeTrack({ id: "youtube:hhh", providerId: "hhh", title: "Growth Two" });

  function queueIds(): string[] {
    return queueState().queue.map((track) => track.id);
  }

  /** The upcoming sequence the queue view displays, in traversal order. */
  function upcomingIds(): string[] {
    const { queue, queueIndex, playOrder } = queueState();
    const position = playOrder.indexOf(queueIndex);
    if (position === -1) return playOrder.map((at) => queue[at].id);
    return playOrder.slice(position + 1).map((at) => queue[at].id);
  }

  it("inserts the growth after the current position and reports what it took", () => {
    queueState().setContext(trackB, [trackA, trackB, trackC], "radio");

    const result = queueState().appendUpcoming([grown1, grown2]);

    expect(result.appended.map((track) => track.id)).toEqual([grown1.id, grown2.id]);
    expect(result.skipped).toEqual([]);
    // Array order reflects the growth; the current entry's own index is unchanged
    // because nothing was inserted before it.
    expect(queueIds()).toEqual([trackA.id, trackB.id, grown1.id, grown2.id, trackC.id]);
    expect(queueState().queueIndex).toBe(1);
    expect(queueState().queue[queueState().queueIndex].id).toBe(trackB.id);
  });

  it("puts the growth at the front of the upcoming sequence", () => {
    queueState().setContext(trackA, [trackA, trackB, trackC], "search");

    queueState().appendUpcoming([grown1, grown2]);

    // They play next, ahead of the entries the user already had queued.
    expect(upcomingIds()).toEqual([grown1.id, grown2.id, trackB.id, trackC.id]);
  });

  it("preserves the existing traversal order under shuffle, appending after the current one", () => {
    // A shuffled traversal: the current entry leads, the rest in shuffled order.
    useQueueStore.setState({
      queue: [trackA, trackB, trackC],
      queueIndex: 0,
      playOrder: [0, 2, 1],
      shuffle: true,
    });

    queueState().appendUpcoming([grown1]);

    const { playOrder, queue } = queueState();
    // Resolved through the traversal: the growth plays next, and the entries the
    // shuffle had already ordered (Charlie, then Bravo) keep that order after it.
    expect(playOrder.map((at) => queue[at].id)).toEqual([
      trackA.id,
      grown1.id,
      trackC.id,
      trackB.id,
    ]);
    expect(playOrder[0]).toBe(queueState().queueIndex);
    // Growing the array in the middle moves later indices along, and the
    // traversal followed them: it is still a permutation of the new length.
    expect([...playOrder].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(queue.map((track) => track.id)).toEqual([trackA.id, grown1.id, trackB.id, trackC.id]);
  });

  it("refuses a track already in the queue, by id and by source+providerId", () => {
    queueState().setContext(trackA, [trackA, trackB, trackC], "search");
    const sameId = makeTrack({ id: trackB.id, providerId: "different" });
    const sameProvider = makeTrack({ id: "youtube:other", providerId: trackB.providerId });

    const result = queueState().appendUpcoming([sameId, sameProvider, grown1]);

    expect(result.appended.map((track) => track.id)).toEqual([grown1.id]);
    expect(result.skipped.map((track) => track.id)).toEqual([sameId.id, sameProvider.id]);
    // The existing entry is untouched, not replaced.
    expect(queueIds()).toEqual([trackA.id, grown1.id, trackB.id, trackC.id]);
    expect(queueState().queue[2]).toEqual(trackB);
  });

  it("is safe to call repeatedly: the same batch appends once", () => {
    queueState().setContext(trackA, [trackA, trackB], "search");

    const first = queueState().appendUpcoming([grown1, grown2]);
    const second = queueState().appendUpcoming([grown1, grown2]);
    const third = queueState().appendUpcoming([grown2]);

    expect(first.appended).toHaveLength(2);
    expect(second.appended).toEqual([]);
    expect(second.skipped.map((track) => track.id)).toEqual([grown1.id, grown2.id]);
    expect(third.appended).toEqual([]);
    expect(queueIds()).toEqual([trackA.id, grown1.id, grown2.id, trackB.id]);
  });

  it("dedupes a batch that repeats one track, and ignores an empty batch", () => {
    queueState().setContext(trackA, [trackA, trackB], "search");

    const result = queueState().appendUpcoming([grown1, grown1, grown2]);
    expect(result.appended.map((track) => track.id)).toEqual([grown1.id, grown2.id]);
    expect(result.skipped.map((track) => track.id)).toEqual([grown1.id]);

    const empty = queueState().appendUpcoming([]);
    expect(empty).toEqual({ appended: [], skipped: [] });
    expect(queueIds()).toEqual([trackA.id, grown1.id, grown2.id, trackB.id]);
  });

  it("appends to the end when nothing is playing", () => {
    // A stopped queue: no current entry to insert after.
    useQueueStore.setState({
      queue: [trackA, trackB],
      queueIndex: -1,
      playOrder: [0, 1],
      source: "radio",
    });

    const result = queueState().appendUpcoming([grown1]);

    expect(result.appended).toEqual([grown1]);
    expect(queueIds()).toEqual([trackA.id, trackB.id, grown1.id]);
    expect(queueState().playOrder).toEqual([0, 1, 2]);
  });

  it("grows an empty queue", () => {
    const result = queueState().appendUpcoming([grown1, grown2]);

    expect(result.appended).toHaveLength(2);
    expect(queueIds()).toEqual([grown1.id, grown2.id]);
    expect(queueState().playOrder).toEqual([0, 1]);
  });

  it("never changes the recorded source, the history, or the mode flags", () => {
    queueState().setContext(trackA, [trackA, trackB], "radio");
    queueState().cycleRepeat();
    useQueueStore.setState({ history: [{ track: trackC, playedAt: 1_000 }] });

    queueState().appendUpcoming([grown1]);

    expect(queueState().source).toBe("radio");
    expect(queueState().history).toEqual([{ track: trackC, playedAt: 1_000 }]);
    expect(queueState().repeatMode).toBe("context");
    expect(queueState().shuffle).toBe(false);
  });

  it("leaves remove, reorder, shuffle, and repeat with an un-grown queue's rules", () => {
    queueState().setContext(trackB, [trackA, trackB, trackC], "radio");
    queueState().appendUpcoming([grown1, grown2]);

    // Removal: the growth is an ordinary entry, and the pointer stays put.
    expect(queueState().remove(3)).toEqual({ currentRemoved: false, nextIndex: null });
    expect(queueIds()).toEqual([trackA.id, trackB.id, grown1.id, trackC.id]);
    expect(queueState().queueIndex).toBe(1);
    expect(queueState().playOrder).toEqual([0, 1, 2, 3]);

    // Reordering: within the upcoming region only, exactly as before growth.
    expect(queueState().reorder(0, 1)).toBe(true);
    expect(queueIds()).toEqual([trackA.id, trackB.id, trackC.id, grown1.id]);
    expect(queueState().queueIndex).toBe(1);
    expect(queueState().playOrder).toEqual([0, 1, 2, 3]);

    // Shuffle: still a current-first permutation over the grown queue.
    queueState().toggleShuffle();
    expect(queueState().shuffle).toBe(true);
    expect(queueState().playOrder[0]).toBe(1);
    expect([...queueState().playOrder].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);

    // Repeat: the same three-state cycle, unaffected by growth.
    queueState().cycleRepeat();
    expect(queueState().repeatMode).toBe("context");
    queueState().cycleRepeat();
    expect(queueState().repeatMode).toBe("track");
    queueState().cycleRepeat();
    expect(queueState().repeatMode).toBe("off");
  });

  it("does not touch transport while growing a playing queue", () => {
    playerState().playTrack(trackB, [trackA, trackB, trackC], "radio");

    queueState().appendUpcoming([grown1]);

    expect(playerState().currentTrack).toEqual(trackB);
    expect(playerState().status).toBe("loading");
    expect(playerState().loadRequest).toMatchObject({ videoId: "bbb", mode: "load" });
  });
});
