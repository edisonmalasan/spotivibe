import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPlaybackBridge,
  resetPlayerStore,
  setPlaybackBridge,
  usePlayerStore,
  type PlaybackBridge,
} from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";
import { makeTrack } from "../helpers/music-fixtures";

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const trackB = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Bravo" });
const trackC = makeTrack({ id: "youtube:ccc", providerId: "ccc", title: "Charlie" });
const trackD = makeTrack({ id: "youtube:ddd", providerId: "ddd", title: "Delta" });
/** Same provider id from the same source as `trackA` — duplicate by identity. */
const trackAAgain = makeTrack({ id: "youtube:other", providerId: "aaa", title: "Alpha (dup)" });

const ALL = [trackA, trackB, trackC, trackD];

function queueState() {
  return useQueueStore.getState();
}

function playerState() {
  return usePlayerStore.getState();
}

/** Transport snapshot for "queue ops never touch transport" assertions. */
function transport() {
  const { currentTrack, status, positionSeconds, durationSeconds, errorMessage, loadRequest } =
    playerState();
  return { currentTrack, status, positionSeconds, durationSeconds, errorMessage, loadRequest };
}

function makeBridge() {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
  } satisfies PlaybackBridge;
}

/** Titles of the traversal sequence shown as upcoming (after the current entry). */
function upcomingTitles(): string[] {
  const { playOrder, queueIndex, queue } = queueState();
  const position = playOrder.indexOf(queueIndex);
  const upcoming = position === -1 ? playOrder : playOrder.slice(position + 1);
  return upcoming.map((index) => queue[index].title);
}

beforeEach(() => {
  resetPlayerStore();
  resetQueueStore();
  localStorage.clear();
  clearPlaybackBridge();
});

describe("enqueue — duplicate protection (task 3.1)", () => {
  it("rejects a duplicate of the current track", () => {
    playerState().playTrack(trackA, ALL);
    const before = queueState().queue.length;

    expect(queueState().enqueue(trackA)).toBe(false);
    expect(queueState().queue).toHaveLength(before);
  });

  it("rejects a duplicate of an upcoming track (same identity, new id)", () => {
    playerState().playTrack(trackA, ALL); // current index 0, everything else upcoming

    expect(queueState().enqueue(trackAAgain)).toBe(false); // source + providerId match
    expect(queueState().queue).toHaveLength(4);
  });

  it("accepts a double activation exactly once", () => {
    playerState().playTrack(trackA, [trackA, trackB]);

    expect(queueState().enqueue(trackC)).toBe(true);
    expect(queueState().enqueue(trackC)).toBe(false);
    expect(queueState().queue).toHaveLength(3);
    expect(queueState().queue[2]).toEqual(trackC);
  });

  it("accepts a track that only exists behind the current entry", () => {
    playerState().playTrack(trackC, ALL); // index 2: A and B are already played

    expect(queueState().enqueue(trackB)).toBe(true);
    expect(queueState().queue).toHaveLength(5);
    expect(queueState().queue[4]).toEqual(trackB);
  });

  it("appends the new index to the traversal tail under either shuffle state", () => {
    playerState().playTrack(trackB, ALL);
    queueState().enqueue(trackAAgain);
    expect(queueState().playOrder).toEqual([0, 1, 2, 3, 4]); // identity tail append

    resetPlayerStore();
    playerState().playTrack(trackB, ALL);
    queueState().toggleShuffle();
    const orderBefore = queueState().playOrder;
    queueState().enqueue(trackAAgain);

    expect(queueState().playOrder.slice(0, orderBefore.length)).toEqual(orderBefore);
    expect(queueState().playOrder.at(-1)).toBe(4); // new entry reachable last
    expect(queueState().playOrder[0]).toBe(1); // current stays first
  });

  it("works on an empty queue and never touches transport", () => {
    const before = transport();

    expect(queueState().enqueue(trackA)).toBe(true);

    expect(queueState().queue).toEqual([trackA]);
    expect(queueState().playOrder).toEqual([0]);
    expect(transport()).toEqual(before);
    expect(playerState().currentTrack).toBeNull();
  });
});

describe("remove — pointer integrity (task 3.2)", () => {
  /** Current-by-identity invariant: the pointer still names the same track. */
  function expectCurrentIntact(title: string) {
    const { queue, queueIndex } = queueState();
    expect(queue[queueIndex]?.title).toBe(title);
    expect(playerState().currentTrack?.title).toBe(title);
  }

  it("wraps to the first entry under repeat context when the successor runs out", () => {
    playerState().playTrack(trackC, [trackA, trackB, trackC]); // current = last in order
    queueState().cycleRepeat(); // off -> context: the traversal is circular

    playerState().removeFromQueue(2);

    // The successor wraps to the first traversal entry — matching next()/ended
    // semantics; only a genuinely exhausted traversal stops cleanly.
    expect(queueState().queue.map((t) => t.title)).toEqual(["Alpha", "Bravo"]);
    expect(queueState().playOrder).toEqual([0, 1]);
    expectCurrentIntact("Alpha"); // pointer and transport both landed on A
    expect(playerState().loadRequest?.videoId).toBe(trackA.providerId);
    expect(playerState().errorMessage).toBeNull();
  });

  it("removing after the current entry splices only and keeps pointers", () => {
    playerState().playTrack(trackA, ALL);
    const before = transport();

    const result = queueState().remove(2);

    expect(result).toEqual({ currentRemoved: false, nextIndex: null });
    expect(queueState().queue.map((t) => t.title)).toEqual(["Alpha", "Bravo", "Delta"]);
    expect(queueState().queueIndex).toBe(0);
    expect(queueState().playOrder).toEqual([0, 1, 2]); // reindexed (2 dropped, 3 → 2)
    expectCurrentIntact("Alpha");
    expect(transport()).toEqual(before);
  });

  it("removing before the current entry shifts the index down", () => {
    playerState().playTrack(trackC, ALL); // index 2

    const result = queueState().remove(0);

    expect(result).toEqual({ currentRemoved: false, nextIndex: null });
    expect(queueState().queueIndex).toBe(1);
    expect(queueState().queue[1]).toEqual(trackC);
    expect(queueState().playOrder).toEqual([0, 1, 2]);
    expectCurrentIntact("Charlie");
  });

  it("removing the current entry hands the pointer to the traversal successor", () => {
    playerState().playTrack(trackA, ALL);

    const result = queueState().remove(0);

    expect(result.currentRemoved).toBe(true);
    expect(result.nextIndex).toBe(0); // Bravo shifted from 1 → 0
    expect(queueState().queue[0]).toEqual(trackB);
    expect(queueState().queueIndex).toBe(0);
    expect(queueState().playOrder).toEqual([0, 1, 2]);
  });

  it("removing the current entry under shuffle keeps the successor traversal-order", () => {
    playerState().playTrack(trackB, ALL); // index 1
    queueState().toggleShuffle();
    const successor = queueState().playOrder[queueState().playOrder.indexOf(1) + 1];

    const result = queueState().remove(1);

    expect(result.currentRemoved).toBe(true);
    expect(result.nextIndex).not.toBeNull();
    // The pointer names the successor track after the splice shift.
    const expectedTitle = ALL[successor].title;
    expect(queueState().queue[queueState().queueIndex].title).toBe(expectedTitle);
    expect(new Set(queueState().playOrder)).toEqual(new Set([0, 1, 2]));
    expect(queueState().playOrder).toHaveLength(3);
  });

  it("removing the current entry with no traversal successor reports no continuation", () => {
    playerState().playTrack(trackD, ALL); // last entry, shuffle off

    const result = queueState().remove(3);

    expect(result).toEqual({ currentRemoved: true, nextIndex: null });
    expect(queueState().queue).toHaveLength(3); // the rest stays queued
    expect(queueState().queueIndex).toBe(-1); // no current entry remains
    expect(queueState().playOrder).toEqual([0, 1, 2]);
  });

  it("removing the only queued entry empties the queue and play order", () => {
    playerState().playTrack(trackA, [trackA]);

    const result = queueState().remove(0);

    expect(result).toEqual({ currentRemoved: true, nextIndex: null });
    expect(queueState().queue).toEqual([]);
    expect(queueState().playOrder).toEqual([]);
  });

  it("rejects out-of-range removals", () => {
    playerState().playTrack(trackA, [trackA, trackB]);

    expect(queueState().remove(-1)).toEqual({ currentRemoved: false, nextIndex: null });
    expect(queueState().remove(5)).toEqual({ currentRemoved: false, nextIndex: null });
    expect(queueState().queue).toHaveLength(2);
  });

  it("table: pointer integrity holds after every mutation", () => {
    const cases: Array<{ current: number; removed: number; expectedIndex: number }> = [
      { current: 2, removed: 0, expectedIndex: 1 }, // before
      { current: 2, removed: 1, expectedIndex: 1 }, // before
      { current: 2, removed: 3, expectedIndex: 2 }, // after
    ];
    for (const { current, removed, expectedIndex } of cases) {
      resetPlayerStore();
      playerState().playTrack(ALL[current], ALL);

      queueState().remove(removed);

      expect(queueState().queueIndex).toBe(expectedIndex);
      expect(queueState().queue[expectedIndex]).toEqual(ALL[current]);
      expect(queueState().playOrder).toHaveLength(3);
      expect(new Set(queueState().playOrder)).toEqual(new Set([0, 1, 2]));
    }
  });
});

describe("removeFromQueue — transport orchestration (task 3.2)", () => {
  it("continues playback with the successor when the current track is removed", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    playerState().playTrack(trackA, ALL);
    playerState().play();
    playerState()._setStatus("playing");

    playerState().removeFromQueue(0);

    expect(playerState().currentTrack).toEqual(trackB); // traversal successor
    expect(playerState().status).toBe("loading");
    expect(playerState().loadRequest).toMatchObject({ videoId: "bbb", mode: "load" });
    expect(playerState().errorMessage).toBeNull();
  });

  it("stops cleanly when the last entry is removed — idle, no error, no autoplay", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    playerState().playTrack(trackA, [trackA]);
    playerState().play();

    playerState().removeFromQueue(0);

    expect(playerState().status).toBe("idle");
    expect(playerState().currentTrack).toBeNull();
    expect(playerState().positionSeconds).toBe(0);
    expect(playerState().durationSeconds).toBe(0);
    expect(playerState().errorMessage).toBeNull();
    expect(playerState().loadRequest).toBeNull();
    expect(bridge.pause).toHaveBeenCalledTimes(1);
    expect(bridge.play).toHaveBeenCalledTimes(1); // only the setup press
    expect(queueState().queue).toEqual([]);
  });

  it("stops cleanly when the current track is last in traversal order, keeping the rest queued", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    playerState().playTrack(trackD, ALL);
    playerState().play();

    playerState().removeFromQueue(3);

    expect(playerState().status).toBe("idle");
    expect(playerState().currentTrack).toBeNull();
    expect(playerState().errorMessage).toBeNull();
    expect(bridge.pause).toHaveBeenCalledTimes(1);
    expect(queueState().queue.map((t) => t.title)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(queueState().queueIndex).toBe(-1); // nothing is current
  });

  it("queue-only removals leave transport untouched", () => {
    playerState().playTrack(trackA, ALL);
    playerState()._setPosition(42);
    const before = transport();

    playerState().removeFromQueue(3);

    expect(transport()).toEqual(before);
    expect(queueState().queue).toHaveLength(3);
  });

  it("removing while idle never starts playback (no autoplay)", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    queueState().setContext(trackA, ALL, "search");
    // No current track: the pointer still names an entry (index 0).

    playerState().removeFromQueue(0);

    expect(playerState().currentTrack).toBeNull();
    expect(playerState().status).toBe("idle");
    expect(playerState().loadRequest).toBeNull();
    expect(bridge.play).not.toHaveBeenCalled();
    expect(bridge.pause).not.toHaveBeenCalled();
    expect(queueState().queue).toHaveLength(3);
  });
});

describe("reorder — displayed upcoming sequence (task 3.3)", () => {
  it("shuffle off: rewrites the queue tail and keeps identity traversal order", () => {
    playerState().playTrack(trackA, ALL);
    const before = transport();

    expect(queueState().reorder(0, 2)).toBe(true);

    // Displayed upcoming moved from [B, C, D] to [C, D, B].
    expect(upcomingTitles()).toEqual(["Charlie", "Delta", "Bravo"]);
    expect(queueState().playOrder).toEqual([0, 1, 2, 3]); // sequential identity
    expect(queueState().queueIndex).toBe(0);
    expect(queueState().queue[0]).toEqual(trackA); // current untouched
    expect(transport()).toEqual(before); // current track/status/position unchanged
  });

  it("drag and keyboard produce the same result for the same operation", () => {
    // One path "drags" row 1 onto row 2, the other presses "Move down" on row 1:
    // both dispatch the identical `reorder(from, to)` operation.
    playerState().playTrack(trackA, ALL);
    queueState().reorder(1, 2);
    const dragResult = {
      queue: queueState().queue.map((t) => t.title),
      playOrder: queueState().playOrder,
      upcoming: upcomingTitles(),
    };

    resetQueueStore();
    resetPlayerStore();
    playerState().playTrack(trackA, ALL);
    queueState().reorder(1, 2);
    const keyboardResult = {
      queue: queueState().queue.map((t) => t.title),
      playOrder: queueState().playOrder,
      upcoming: upcomingTitles(),
    };

    expect(keyboardResult).toEqual(dragResult);
    expect(dragResult.upcoming).toEqual(["Bravo", "Delta", "Charlie"]); // C and D swapped
  });

  it("shuffle on: keeps the current first and the display equals the moved order", () => {
    playerState().playTrack(trackA, ALL);
    queueState().toggleShuffle();
    const displayed = upcomingTitles();

    expect(queueState().reorder(0, 1)).toBe(true);

    expect(upcomingTitles()).toEqual([displayed[1], displayed[0], displayed[2]]);
    expect(queueState().playOrder[0]).toBe(0); // current leads the traversal
    expect(queueState().queue[0]).toEqual(trackA);
    expect(queueState().queueIndex).toBe(0);
    // Pointer consistency: play order remains a full permutation of the queue.
    expect(new Set(queueState().playOrder)).toEqual(new Set([0, 1, 2, 3]));
  });

  it("a manual order survives toggling shuffle off (array tail rewritten)", () => {
    playerState().playTrack(trackA, ALL);
    queueState().toggleShuffle();
    const moved = upcomingTitles();
    queueState().reorder(0, 1);

    queueState().toggleShuffle(); // off → identity order reads the array tail

    expect(upcomingTitles()).toEqual([moved[1], moved[0], moved[2]]);
  });

  it("does not move the current entry and rejects out-of-range positions", () => {
    playerState().playTrack(trackA, ALL);

    expect(queueState().reorder(0, 0)).toBe(false); // same position
    expect(queueState().reorder(-1, 0)).toBe(false);
    expect(queueState().reorder(0, 3)).toBe(false); // upcoming has 3 rows (0..2)
    expect(upcomingTitles()).toEqual(["Bravo", "Charlie", "Delta"]);
    expect(queueState().queue.map((t) => t.title)).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
  });

  it("reorder on an empty queue is a no-op", () => {
    expect(queueState().reorder(0, 1)).toBe(false);
  });

  it("shuffled reorder then remove keeps the current-by-identity invariant", () => {
    playerState().playTrack(trackB, ALL);
    queueState().toggleShuffle();
    queueState().reorder(0, 2);

    playerState().removeFromQueue(3); // an upcoming entry

    const { queue, queueIndex } = queueState();
    expect(queue[queueIndex]).toEqual(trackB);
    expect(playerState().currentTrack).toEqual(trackB);
    expect(queue).toHaveLength(3);
    expect(new Set(queueState().playOrder)).toEqual(new Set([0, 1, 2]));
  });
});
