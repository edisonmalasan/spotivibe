import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPlaybackBridge,
  resetPlayerStore,
  setPlaybackBridge,
  usePlayerStore,
  type PlaybackBridge,
} from "@/stores/playerStore";
import { HISTORY_LIMIT, resetQueueStore, useQueueStore } from "@/stores/queueStore";
import type { QueueHistoryEntry, Track } from "@/data/repositories";
import { makeTrack } from "../helpers/music-fixtures";

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const trackB = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Bravo" });
const trackC = makeTrack({ id: "youtube:ccc", providerId: "ccc", title: "Charlie" });
/** Never queued — seeds an unresolvable history entry (removed-while-played). */
const trackGone = makeTrack({ id: "youtube:xxx", providerId: "xxx", title: "Gone" });

function queueState() {
  return useQueueStore.getState();
}

function playerState() {
  return usePlayerStore.getState();
}

function historyIds(): string[] {
  return queueState().history.map((entry) => entry.track.id);
}

function seedHistory(...tracks: Array<Track | "gone">): void {
  const entries: QueueHistoryEntry[] = tracks.map((track, i) => ({
    track: track === "gone" ? trackGone : track,
    playedAt: 1_000 + i,
  }));
  useQueueStore.setState({ history: entries });
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

beforeEach(() => {
  resetPlayerStore();
  resetQueueStore();
  localStorage.clear();
  clearPlaybackBridge();
});

describe("history recording on advance (task 4.1)", () => {
  it("records the finished track exactly once per manual next", () => {
    playerState().playTrack(trackA, [trackA, trackB, trackC]);

    playerState().next();

    expect(historyIds()).toEqual([trackA.id]);
    expect(queueState().history[0].playedAt).toBeTypeOf("number");
    expect(playerState().currentTrack).toEqual(trackB);
  });

  it("records once when a track ends and playback advances", () => {
    playerState().playTrack(trackA, [trackA, trackB]);

    expect(playerState()._onEnded()).toBe("advanced");

    expect(historyIds()).toEqual([trackA.id]);
    expect(playerState().currentTrack).toEqual(trackB);
  });

  it("records the failed track once when a failure skips forward", () => {
    playerState().playTrack(trackA, [trackA, trackB]);
    playerState()._markFailed("boom");

    expect(playerState()._advanceAfterFailure()).toBe("advanced");

    expect(historyIds()).toEqual([trackA.id]);
    expect(playerState().currentTrack).toEqual(trackB);
  });

  it("does not record on repeat-track replay", () => {
    playerState().playTrack(trackA, [trackA, trackB]);
    queueState().cycleRepeat();
    queueState().cycleRepeat(); // track

    expect(playerState()._onEnded()).toBe("replay");

    expect(queueState().history).toEqual([]);
    expect(playerState().currentTrack).toEqual(trackA);
  });

  it("does not record when the target is the replayed track itself", () => {
    playerState().playTrack(trackA, [trackA, trackB]);

    queueState().advanceTo(0); // target === current index

    expect(queueState().history).toEqual([]);
    expect(queueState().queueIndex).toBe(0);
  });

  it("bounds history to HISTORY_LIMIT entries, dropping the oldest", () => {
    expect(HISTORY_LIMIT).toBe(50);
    const many = Array.from({ length: HISTORY_LIMIT + 2 }, (_, i) =>
      makeTrack({ id: `youtube:h${i}`, providerId: `h${i}`, title: `H${i}` }),
    );
    playerState().playTrack(many[0], many);

    for (let i = 0; i < HISTORY_LIMIT + 1; i++) playerState().next();

    expect(queueState().history).toHaveLength(HISTORY_LIMIT);
    // Oldest (H0) was dropped; the stack starts at the second-oldest.
    expect(historyIds()[0]).toBe(many[1].id);
    expect(historyIds().at(-1)).toBe(many[HISTORY_LIMIT].id);
  });

  it("failed-skip settling at the end records nothing further", () => {
    playerState().playTrack(trackA, [trackA, trackB]);
    playerState()._markFailed("A");
    playerState()._advanceAfterFailure(); // → B, records A
    playerState()._markFailed("B");

    expect(playerState()._advanceAfterFailure()).toBe("settled");

    expect(historyIds()).toEqual([trackA.id]); // no extra entry on settle
  });
});

describe("history-aware previous (task 4.2)", () => {
  it("restarts past the threshold without consuming history", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    playerState().playTrack(trackB, [trackA, trackB]);
    seedHistory(trackA);
    playerState()._setPosition(10);

    playerState().previous();

    expect(bridge.seekTo).toHaveBeenCalledWith(0);
    expect(playerState().currentTrack).toEqual(trackB);
    expect(historyIds()).toEqual([trackA.id]); // untouched
  });

  it("jumps to the newest resolvable history entry and pops it", () => {
    playerState().playTrack(trackA, [trackA, trackB, trackC]);
    playerState().next(); // → B, history [A]
    playerState().next(); // → C, history [A, B]
    playerState()._setPosition(1);

    playerState().previous();

    expect(playerState().currentTrack).toEqual(trackB); // newest history entry
    expect(playerState().loadRequest).toMatchObject({ videoId: "bbb", mode: "load" });
    expect(historyIds()).toEqual([trackA.id]); // newest entry consumed
  });

  it("pops the whole path back through history on repeat presses", () => {
    playerState().playTrack(trackA, [trackA, trackB, trackC]);
    playerState().next();
    playerState().next(); // history [A, B], current C
    playerState()._setPosition(1);

    playerState().previous(); // → B, pops B
    playerState()._setPosition(1);
    playerState().previous(); // → A, pops A

    expect(playerState().currentTrack).toEqual(trackA);
    expect(queueState().history).toEqual([]);
  });

  it("drops an entry whose track left the queue and tries the next one", () => {
    playerState().playTrack(trackB, [trackA, trackB, trackC]);
    seedHistory(trackA, "gone"); // "gone" is newest but no longer queued
    playerState()._setPosition(1);

    playerState().previous();

    expect(playerState().currentTrack).toEqual(trackA);
    expect(queueState().history).toEqual([]); // the unresolvable entry was dropped
  });

  it("scans backwards from the current position so duplicates resolve behind it", () => {
    // Two copies of the same identity: the played one sits at index 0 while
    // the current copy is at index 2 — the scan must land on the earlier one.
    const secondCopy = makeTrack({ id: "youtube:aaa2", providerId: "aaa", title: "Alpha (2nd)" });
    playerState().playTrack(secondCopy, [trackA, trackB, secondCopy]);
    seedHistory(trackA);
    playerState()._setPosition(1);

    playerState().previous();

    expect(queueState().queueIndex).toBe(0); // the copy behind the pointer
    expect(playerState().currentTrack).toEqual(trackA);
    expect(historyIds()).toEqual([]);
  });

  it("falls back to a context step-back when history is exhausted", () => {
    playerState().playTrack(trackB, [trackA, trackB]);
    seedHistory("gone"); // only entry is unresolvable → exhausted
    playerState()._setPosition(1);

    playerState().previous();

    expect(playerState().currentTrack).toEqual(trackA); // context step-back
    expect(queueState().history).toEqual([]); // drops persisted on the way
  });

  it("restarts the current track when there is nowhere to go", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    playerState().playTrack(trackA, [trackA, trackB]);
    const pendingLoad = playerState().loadRequest; // the activation's own request
    playerState()._setPosition(1);

    playerState().previous(); // no history, already at the start

    expect(playerState().currentTrack).toEqual(trackA);
    expect(playerState().positionSeconds).toBe(0);
    expect(bridge.seekTo).toHaveBeenCalledWith(0);
    expect(playerState().loadRequest).toBe(pendingLoad); // restart, not a new load
  });

  it("still restarts past the threshold even with history pending", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    playerState().playTrack(trackB, [trackA, trackB]);
    seedHistory(trackA);
    playerState()._setPosition(4);

    playerState().previous();

    expect(bridge.seekTo).toHaveBeenCalledWith(0);
    expect(historyIds()).toEqual([trackA.id]);
  });
});
