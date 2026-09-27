import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RESTART_THRESHOLD_SECONDS,
  buildPlayOrder,
  clearPlaybackBridge,
  findNextUnfailed,
  findPreviousUnfailed,
  initialPlayerState,
  resetPlayerStore,
  setPlaybackBridge,
  usePlayerStore,
  type PlaybackBridge,
} from "@/stores/playerStore";
import { DEFAULT_VOLUME_PREFERENCE } from "@/player/volumePref";
import type { SessionSnapshot } from "@/data/repositories";
import { makeTrack } from "../helpers/music-fixtures";

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const trackB = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Bravo",
  durationSeconds: 180,
});
const trackC = makeTrack({
  id: "youtube:ccc",
  providerId: "ccc",
  title: "Charlie",
  durationSeconds: 90,
});

function makeBridge() {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
  } satisfies PlaybackBridge;
}

function state() {
  return usePlayerStore.getState();
}

beforeEach(() => {
  resetPlayerStore();
  localStorage.clear();
  clearPlaybackBridge();
});

describe("playerStore actions and bridge dispatch", () => {
  it("playTrack loads the track within its context", () => {
    state().playTrack(trackB, [trackA, trackB, trackC]);

    expect(state().status).toBe("loading");
    expect(state().currentTrack).toEqual(trackB);
    expect(state().queue).toHaveLength(3);
    expect(state().queueIndex).toBe(1);
    expect(state().durationSeconds).toBe(180); // metadata duration until corrected
    expect(state().loadRequest).toMatchObject({
      videoId: "bbb",
      startSeconds: 0,
      mode: "load",
    });
    expect(state().errorMessage).toBeNull();
  });

  it("playTrack keeps queue/index coherent when the context lacks the track", () => {
    state().playTrack(trackC, [trackA, trackB]);

    expect(state().queueIndex).toBe(2);
    expect(state().queue[2]).toEqual(trackC);
    expect(state().currentTrack).toEqual(trackC);
  });

  it("play/pause dispatch to the bridge and update status", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    state().playTrack(trackA);

    state().play();
    expect(bridge.play).toHaveBeenCalledTimes(1);
    expect(state().status).toBe("buffering"); // optimistic until PLAYING confirms

    state().pause();
    expect(bridge.pause).toHaveBeenCalledTimes(1);
    expect(state().status).toBe("paused");
  });

  it("actions are safe no-ops without an attached bridge", () => {
    expect(() => {
      state().playTrack(trackA);
      state().play();
      state().seek(30);
      state().pause();
    }).not.toThrow();
    expect(state().status).toBe("paused"); // play then pause with no bridge
  });

  it("seek clamps to the track bounds and dispatches", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    state().playTrack(trackA); // duration 249

    state().seek(100);
    expect(state().positionSeconds).toBe(100);
    expect(bridge.seekTo).toHaveBeenLastCalledWith(100);

    state().seek(-5);
    expect(state().positionSeconds).toBe(0);

    state().seek(9999);
    expect(state().positionSeconds).toBe(249);
    expect(bridge.seekTo).toHaveBeenLastCalledWith(249);
  });

  it("does nothing for track-less play/pause/seek", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);

    state().play();
    state().pause();
    state().seek(10);

    expect(bridge.play).not.toHaveBeenCalled();
    expect(bridge.pause).not.toHaveBeenCalled();
    expect(bridge.seekTo).not.toHaveBeenCalled();
    expect(state().status).toBe("idle");
  });
});

describe("session restore (no autoplay)", () => {
  const snapshot: SessionSnapshot = {
    queue: [trackA, trackB],
    queueIndex: 1,
    positionSeconds: 42,
    repeatMode: "context",
    shuffle: false,
    volume: 0.8,
  };

  it("restores the session cued paused at the saved position", () => {
    state().restoreSession(snapshot);

    expect(state().status).toBe("paused"); // play affordance — no autoplay
    expect(state().currentTrack).toEqual(trackB);
    expect(state().queueIndex).toBe(1);
    expect(state().positionSeconds).toBe(42);
    expect(state().repeatMode).toBe("context");
    expect(state().loadRequest).toMatchObject({
      videoId: "bbb",
      startSeconds: 42,
      mode: "cue",
    });
  });

  it("ignores invalid snapshots (empty queue or out-of-range index)", () => {
    state().restoreSession({ ...snapshot, queue: [], queueIndex: 0 });
    expect(state().currentTrack).toBeNull();
    expect(state().status).toBe("idle");

    state().restoreSession({ ...snapshot, queueIndex: 5 });
    expect(state().currentTrack).toBeNull();
    expect(state().status).toBe("idle");
  });
});

describe("traversal: next/previous, repeat, shuffle, duration", () => {
  it("next advances through list order and stays put at the end with repeat off", () => {
    state().playTrack(trackA, [trackA, trackB, trackC]);

    state().next();
    expect(state().queueIndex).toBe(1);
    expect(state().currentTrack).toEqual(trackB);
    expect(state().loadRequest).toMatchObject({ videoId: "bbb", mode: "load" });

    state().next();
    expect(state().queueIndex).toBe(2);

    state().next(); // end of list, repeat off: no-op
    expect(state().queueIndex).toBe(2);
    expect(state().currentTrack).toEqual(trackC);
  });

  it("next wraps to the first track under repeat context", () => {
    state().playTrack(trackA, [trackA, trackB, trackC]);
    state().cycleRepeat(); // off -> context

    state().next();
    state().next();
    state().next();
    expect(state().queueIndex).toBe(0); // wrapped past the end
  });

  it("previous restarts the current track once past the threshold", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    state().playTrack(trackB, [trackA, trackB]);
    state()._setPosition(RESTART_THRESHOLD_SECONDS + 10);

    state().previous();

    expect(state().queueIndex).toBe(1);
    expect(state().positionSeconds).toBe(0);
    expect(bridge.seekTo).toHaveBeenCalledWith(0);
  });

  it("previous steps back before the threshold and restarts at the start", () => {
    state().playTrack(trackB, [trackA, trackB]);
    state()._setPosition(1);

    state().previous();
    expect(state().queueIndex).toBe(0);
    expect(state().currentTrack).toEqual(trackA);

    state().previous(); // at the start of a bounded order: restart current
    expect(state().queueIndex).toBe(0);
    expect(state().positionSeconds).toBe(0);
  });

  it("shuffle builds a current-first permutation and toggling off restores list order", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      makeTrack({ id: `youtube:t${i}`, providerId: `t${i}`, title: `T${i}` }),
    );
    state().playTrack(many[0], many);
    expect(state().playOrder).toEqual(many.map((_, i) => i));

    state().toggleShuffle();
    const order = state().playOrder;
    expect(order).toHaveLength(10);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => i));
    expect(order[0]).toBe(0); // current track plays first

    state().next();
    expect(state().queueIndex).toBe(order[1]); // next follows the shuffled order

    state().toggleShuffle();
    expect(state().playOrder).toEqual(Array.from({ length: 10 }, (_, i) => i));
    // Back in list order, the next advance is strict index + 1 from here.
    const before = state().queueIndex;
    state().next();
    expect(state().queueIndex).toBe(Math.min(before + 1, 9));
  });

  it("cycleRepeat walks off -> context -> track -> off", () => {
    expect(state().repeatMode).toBe("off");
    state().cycleRepeat();
    expect(state().repeatMode).toBe("context");
    state().cycleRepeat();
    expect(state().repeatMode).toBe("track");
    state().cycleRepeat();
    expect(state().repeatMode).toBe("off");
  });

  it("onEnded replays under repeat track, advances otherwise, stops at the end", () => {
    state().playTrack(trackA, [trackA, trackB]);

    state().cycleRepeat();
    state().cycleRepeat(); // track
    expect(state()._onEnded()).toBe("replay");
    expect(state().positionSeconds).toBe(0);
    expect(state().status).toBe("buffering");

    state().cycleRepeat(); // off
    expect(state()._onEnded()).toBe("advanced");
    expect(state().currentTrack).toEqual(trackB);

    expect(state()._onEnded()).toBe("stopped"); // end of list, repeat off
    expect(state().status).toBe("paused");
  });

  it("adopts the player-reported duration when it is authoritative", () => {
    state().playTrack(trackA); // metadata duration 249
    expect(state().durationSeconds).toBe(249);

    state()._setDuration(251);
    expect(state().durationSeconds).toBe(251);

    state()._setDuration(251); // unchanged: no redundant state churn
    state()._setDuration(0); // unknown duration is ignored
    expect(state().durationSeconds).toBe(251);
  });
});

describe("failure handling", () => {
  it("markFailed surfaces the error and records the track", () => {
    state().playTrack(trackA);
    state()._markFailed("This video can't be played here.");

    expect(state().status).toBe("error");
    expect(state().errorMessage).toBe("This video can't be played here.");
    expect(state().failedTrackIds).toContain(trackA.id);
  });

  it("advanceAfterFailure moves to the next unfailed track", () => {
    state().playTrack(trackA, [trackA, trackB]);
    state()._markFailed("boom");

    expect(state()._advanceAfterFailure()).toBe("advanced");
    expect(state().currentTrack).toEqual(trackB);
    expect(state().status).toBe("loading");
    expect(state().errorMessage).toBe("boom"); // still surfaced until playback succeeds
  });

  it("advanceAfterFailure wraps circularly to an earlier unfailed track", () => {
    state().playTrack(trackB, [trackA, trackB]);
    state()._markFailed("boom");

    expect(state()._advanceAfterFailure()).toBe("advanced");
    expect(state().queueIndex).toBe(0);
  });

  it("settles into a stable error state when every track has failed", () => {
    state().playTrack(trackA, [trackA, trackB]);
    state()._markFailed("first");
    state()._advanceAfterFailure(); // -> trackB
    state()._markFailed("second");

    expect(state()._advanceAfterFailure()).toBe("settled");
    expect(state().status).toBe("error");
    expect(state().failedTrackIds).toEqual(expect.arrayContaining([trackA.id, trackB.id]));
    expect(state().errorMessage).toBe("second");
    expect(state().currentTrack).toEqual(trackB); // last position preserved
  });

  it("skips failed tracks when ending a track", () => {
    state().playTrack(trackA, [trackA, trackB, trackC]);
    state()._markFailed("A is gone");
    state()._advanceAfterFailure(); // -> trackB (trackA failed)
    expect(state().currentTrack).toEqual(trackB);

    expect(state()._onEnded()).toBe("advanced");
    expect(state().currentTrack).toEqual(trackC);

    state()._markFailed("C is gone");
    state()._advanceAfterFailure(); // circular past failed C -> trackB remains
    expect(state().currentTrack).toEqual(trackB);
  });

  it("successful playback clears the surfaced error message", () => {
    state().playTrack(trackA);
    state()._markFailed("boom");
    state()._setStatus("playing");

    expect(state().errorMessage).toBeNull();
    expect(state().status).toBe("playing");
    // The failed set survives: the loop guard is per-context, not per-message.
    expect(state().failedTrackIds).toContain(trackA.id);
  });
});

describe("volume and mute boot preference", () => {
  it("setVolume clamps to 0..100, dispatches, and persists", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);

    state().setVolume(150);
    expect(state().volume).toBe(100);
    state().setVolume(-20);
    expect(state().volume).toBe(0);
    state().setVolume(55);
    expect(state().volume).toBe(55);

    expect(bridge.setVolume).toHaveBeenLastCalledWith(55);
    expect(localStorage.getItem("spotivibe.volume")).toContain('"volume":55');
  });

  it("toggleMute dispatches and persists the muted flag", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);

    state().toggleMute();
    expect(state().muted).toBe(true);
    expect(bridge.setMuted).toHaveBeenCalledWith(true);
    expect(localStorage.getItem("spotivibe.volume")).toContain('"muted":true');

    state().toggleMute();
    expect(state().muted).toBe(false);
    expect(bridge.setMuted).toHaveBeenLastCalledWith(false);
  });

  it("applyVolumePreference restores persisted values, falling back to defaults", () => {
    expect(state().volume).toBe(initialPlayerState.volume);

    localStorage.setItem("spotivibe.volume", JSON.stringify({ volume: 33, muted: true }));
    state().applyVolumePreference();
    expect(state().volume).toBe(33);
    expect(state().muted).toBe(true);

    localStorage.setItem("spotivibe.volume", "{not json");
    state().applyVolumePreference();
    expect(state().volume).toBe(DEFAULT_VOLUME_PREFERENCE.volume);
    expect(state().muted).toBe(DEFAULT_VOLUME_PREFERENCE.muted);
  });
});

describe("pure traversal helpers", () => {
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
