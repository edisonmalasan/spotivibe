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
