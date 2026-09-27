import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RETRY_ATTEMPTS,
  PlaybackEngine,
  RETRY_MAX_MS,
  backoffDelay,
  playerErrorMessage,
  resetPlaybackEngineForTests,
} from "@/player/engine";
import type { YtNamespace, YtPlayer, YtPlayerOptions } from "@/player/types";
import { YT_STATE } from "@/player/types";
import { initialPlayerState, resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { makeTrack } from "../helpers/music-fixtures";

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const trackB = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Bravo" });

class FakePlayer implements YtPlayer {
  cueVideoById = vi.fn();
  loadVideoById = vi.fn();
  playVideo = vi.fn();
  pauseVideo = vi.fn();
  seekTo = vi.fn();
  setVolume = vi.fn();
  mute = vi.fn();
  unMute = vi.fn();
  getPlayerState = vi.fn(() => YT_STATE.PLAYING);
  currentTime = 0;
  duration = 0;
  getCurrentTime = vi.fn(() => this.currentTime);
  getDuration = vi.fn(() => this.duration);
  private events: NonNullable<YtPlayerOptions["events"]>;

  constructor(_element: HTMLElement, options: YtPlayerOptions) {
    this.events = options.events ?? {};
  }

  fireReady(): void {
    this.events.onReady?.({ target: this });
  }
  fireState(data: number): void {
    this.events.onStateChange?.({ target: this, data });
  }
  fireError(data: number): void {
    this.events.onError?.({ target: this, data });
  }
}

function makeFakeYT(): { yt: YtNamespace; players: FakePlayer[] } {
  const players: FakePlayer[] = [];
  const yt: YtNamespace = {
    Player: class extends FakePlayer {
      constructor(element: HTMLElement, options: YtPlayerOptions) {
        super(element, options);
        players.push(this);
      }
    } as unknown as YtNamespace["Player"],
  };
  return { yt, players };
}

function state() {
  return usePlayerStore.getState();
}

/** Drain native promise/queueMicrotask work under fake timers. */
async function microtasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makeEngine(): {
  engine: PlaybackEngine;
  players: FakePlayer[];
  container: HTMLElement;
} {
  const { yt, players } = makeFakeYT();
  const engine = new PlaybackEngine({ loadApi: async () => yt });
  const container = document.createElement("div");
  document.body.appendChild(container);
  engine.attach(container);
  return { engine, players, container };
}

/** Read the engine's private player handle without duplicating construction. */
function playerOf(engine: PlaybackEngine): FakePlayer {
  return (engine as unknown as { player: FakePlayer }).player;
}

// Fake only the timers the engine schedules — `queueMicrotask`/promises stay
// native so microtask-deferred loads run under `await`.
const FAKED_TIMERS = [
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
] as const;

beforeEach(() => {
  resetPlayerStore();
  vi.useFakeTimers({ toFake: [...FAKED_TIMERS] });
});

afterEach(() => {
  resetPlaybackEngineForTests();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("engine: single instance and event mapping", () => {
  it("creates exactly one player across repeated attaches and loads the track", async () => {
    const { engine, players, container } = makeEngine();
    state().playTrack(trackA);
    await microtasks();
    players[0].fireReady(); // the real API fires this itself
    expect(players).toHaveLength(1);

    engine.attach(container); // idempotent
    engine.suspend();
    engine.attach(container); // StrictMode-style re-attach
    await microtasks();
    expect(players).toHaveLength(1); // never recreated

    expect(players[0].loadVideoById).toHaveBeenCalledWith({
      videoId: "aaa",
      startSeconds: 0,
    });
  });

  it("picks up a load request that existed before attach (restore-first boot)", async () => {
    const { yt, players } = makeFakeYT();
    const engine = new PlaybackEngine({ loadApi: async () => yt });
    state().restoreSession({
      queue: [trackA],
      queueIndex: 0,
      positionSeconds: 42,
      repeatMode: "off",
      shuffle: false,
      volume: 0.8,
    }); // request set before any subscription exists

    const container = document.createElement("div");
    document.body.appendChild(container);
    engine.attach(container);
    await microtasks();
    players[0].fireReady(); // the real API fires this itself

    expect(players).toHaveLength(1);
    expect(players[0].cueVideoById).toHaveBeenCalledWith({
      videoId: "aaa",
      startSeconds: 42,
    });
  });

  it("maps player state events to store status, duration, and polling", async () => {
    const { engine } = makeEngine();
    state().playTrack(trackA); // metadata duration 249
    await microtasks();
    const player = playerOf(engine);

    player.duration = 251; // player is authoritative
    player.currentTime = 12;
    player.fireState(YT_STATE.PLAYING);
    expect(state().status).toBe("playing");
    expect(state().durationSeconds).toBe(251); // corrected from the player
    expect(vi.getTimerCount()).toBe(1); // exactly one poll interval

    vi.advanceTimersByTime(1000); // one poll tick
    expect(state().positionSeconds).toBe(12);

    player.currentTime = 20;
    player.fireState(YT_STATE.PAUSED);
    expect(state().status).toBe("paused");
    expect(state().positionSeconds).toBe(20); // captured at pause

    vi.advanceTimersByTime(5000); // polling stopped: no further ticks
    expect(state().positionSeconds).toBe(20);
    expect(vi.getTimerCount()).toBe(0);

    player.fireState(YT_STATE.BUFFERING);
    expect(state().status).toBe("buffering");
    expect(vi.getTimerCount()).toBe(1);
    player.fireState(YT_STATE.CUED);
    expect(state().status).toBe("paused");
    expect(vi.getTimerCount()).toBe(0); // polling stopped again
  });

  it("applies volume and mute on ready, then follows post-ready changes", async () => {
    const { engine } = makeEngine();
    state().restoreSession({
      queue: [trackA],
      queueIndex: 0,
      positionSeconds: 42,
      repeatMode: "off",
      shuffle: false,
      volume: 0.55,
    });
    await microtasks();
    const player = playerOf(engine);
    player.fireReady();

    expect(player.cueVideoById).toHaveBeenCalledWith({ videoId: "aaa", startSeconds: 42 });
    expect(player.setVolume).toHaveBeenCalledWith(initialPlayerState.volume); // store default at ready
    expect(player.unMute).toHaveBeenCalledTimes(1); // default unmuted

    state().setVolume(70);
    expect(player.setVolume).toHaveBeenCalledTimes(2); // ready + change, never doubled
    expect(player.setVolume).toHaveBeenLastCalledWith(70);

    state().toggleMute();
    expect(player.mute).toHaveBeenCalledTimes(1);
    state().toggleMute();
    expect(player.unMute).toHaveBeenCalledTimes(2); // ready + unmute
    expect(state().volume).toBe(70);
  });

  it("restores cue-first, and play() before ready starts playback after ready", async () => {
    const { engine } = makeEngine();
    state().restoreSession({
      queue: [trackA],
      queueIndex: 0,
      positionSeconds: 42,
      repeatMode: "off",
      shuffle: false,
      volume: 0.8,
    });
    await microtasks();
    expect(state().status).toBe("paused"); // no autoplay before user action

    state().play(); // user acts before the API finishes loading
    expect(state().status).toBe("buffering");

    const player = playerOf(engine);
    player.fireReady();
    expect(player.cueVideoById).toHaveBeenCalledWith({ videoId: "aaa", startSeconds: 42 });
    expect(player.playVideo).toHaveBeenCalledTimes(1); // …then playback starts
    expect(player.pauseVideo).not.toHaveBeenCalled();
  });

  it("keeps the bridge detached while suspended (controls reach nothing)", async () => {
    const { engine } = makeEngine();
    state().playTrack(trackA);
    await microtasks();
    const player = playerOf(engine);

    engine.suspend();
    state().play();
    expect(player.playVideo).not.toHaveBeenCalled();
  });
});

describe("engine: ended handling", () => {
  it("advances to the next track when a track ends", async () => {
    const { engine } = makeEngine();
    state().playTrack(trackA, [trackA, trackB]);
    await microtasks();
    const player = playerOf(engine);
    player.fireReady();

    player.fireState(YT_STATE.ENDED);
    await microtasks();
    expect(state().currentTrack).toEqual(trackB);
    expect(player.loadVideoById).toHaveBeenLastCalledWith({ videoId: "bbb", startSeconds: 0 });
  });

  it("replays the current track under repeat track", async () => {
    const { engine } = makeEngine();
    state().playTrack(trackA, [trackA, trackB]);
    state().cycleRepeat();
    state().cycleRepeat(); // track
    await microtasks();
    const player = playerOf(engine);

    player.fireState(YT_STATE.ENDED);
    expect(player.seekTo).toHaveBeenCalledWith(0, true);
    expect(player.playVideo).toHaveBeenCalledTimes(1);
    expect(state().currentTrack).toEqual(trackA);
    expect(state().status).toBe("buffering");
  });

  it("settles stopped at the end of the list with repeat off", async () => {
    const { engine } = makeEngine();
    state().playTrack(trackA, [trackA, trackB]);
    await microtasks();
    const player = playerOf(engine);
    player.fireReady(); // initial load of trackA

    player.fireState(YT_STATE.ENDED);
    await microtasks(); // -> trackB
    player.fireState(YT_STATE.ENDED);
    expect(state().status).toBe("paused");
    expect(state().currentTrack).toEqual(trackB);
    expect(player.loadVideoById).toHaveBeenCalledTimes(2); // A, then B — and no more
  });
});

describe("engine: retry/backoff and unplayable handling", () => {
  it("retries transient errors with exponential backoff and resets on success", async () => {
    const { engine } = makeEngine();
    state().playTrack(trackA, [trackA, trackB]);
    await microtasks();
    const player = playerOf(engine);
    player.currentTime = 50;
    player.fireState(YT_STATE.PLAYING);
    vi.advanceTimersByTime(1000); // one poll tick captures the position

    const expectedDelays = [1000, 2000, 4000, 8000, 16000];
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      const before = player.loadVideoById.mock.calls.length;
      player.fireError(5); // transient HTML5 error
      expect(player.loadVideoById.mock.calls.length).toBe(before); // not yet
      vi.advanceTimersByTime(expectedDelays[attempt] - 1);
      expect(player.loadVideoById.mock.calls.length).toBe(before); // still waiting
      vi.advanceTimersByTime(1);
      expect(player.loadVideoById.mock.calls.length).toBe(before + 1);
      expect(player.loadVideoById).toHaveBeenLastCalledWith({
        videoId: "aaa",
        startSeconds: 50, // resume near the last captured position
      });
    }

    // A successful PLAYING resets the budget: the next retry is 1s again.
    player.fireState(YT_STATE.PLAYING);
    player.fireError(5);
    vi.advanceTimersByTime(1000);
    expect(player.loadVideoById.mock.calls.length).toBe(MAX_RETRY_ATTEMPTS + 1);
  });

  it("treats retry exhaustion as fatal: mark failed, advance once, settle", async () => {
    const { engine } = makeEngine();
    state().playTrack(trackA, [trackA]); // single-track context
    await microtasks();
    const player = playerOf(engine);
    player.fireReady(); // initial load counts as attempt-free

    for (let i = 0; i < MAX_RETRY_ATTEMPTS; i++) {
      player.fireError(5);
      vi.advanceTimersByTime(RETRY_MAX_MS);
    }
    player.fireError(5); // attempt budget spent
    expect(state().status).toBe("error");
    expect(state().errorMessage).toContain("error 5");
    expect(state().failedTrackIds).toContain(trackA.id);

    vi.advanceTimersByTime(1000); // failure-advance delay
    await microtasks();
    expect(state().status).toBe("error"); // settled: nothing left to play
    expect(player.loadVideoById).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS + 1);

    const loads = player.loadVideoById.mock.calls.length;
    vi.advanceTimersByTime(120_000);
    await microtasks();
    expect(player.loadVideoById.mock.calls.length).toBe(loads); // no retry loop
    expect(vi.getTimerCount()).toBe(0); // no orphan timers
  });

  it("marks embedding-restricted videos failed and advances after the delay", async () => {
    const { engine } = makeEngine();
    state().playTrack(trackA, [trackA, trackB]);
    await microtasks();
    const player = playerOf(engine);
    player.fireReady(); // initial load of trackA

    player.fireError(101); // fatal — no retries
    expect(state().status).toBe("error");
    expect(state().errorMessage).toContain("disabled embedding");
    expect(player.loadVideoById).toHaveBeenCalledTimes(1); // no immediate reload

    vi.advanceTimersByTime(1000);
    await microtasks();
    expect(state().currentTrack).toEqual(trackB);
    expect(player.loadVideoById).toHaveBeenLastCalledWith({
      videoId: "bbb",
      startSeconds: 0,
    });
    expect(state().status).toBe("loading");
  });

  it("does not loop when every track in the context is unplayable", async () => {
    const { engine } = makeEngine();
    state().playTrack(trackA, [trackA, trackB]);
    await microtasks();
    const player = playerOf(engine);
    player.fireReady(); // initial load of trackA

    player.fireError(100);
    vi.advanceTimersByTime(1000);
    await microtasks(); // -> trackB
    player.fireError(150);
    vi.advanceTimersByTime(1000);
    await microtasks(); // -> settled

    expect(state().status).toBe("error");
    expect(state().failedTrackIds).toEqual(expect.arrayContaining([trackA.id, trackB.id]));
    expect(player.loadVideoById).toHaveBeenCalledTimes(2); // A, then B — no third

    const loads = player.loadVideoById.mock.calls.length;
    vi.advanceTimersByTime(300_000);
    await microtasks();
    expect(player.loadVideoById.mock.calls.length).toBe(loads);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("explicit play() after a settled failure retries the current track once", async () => {
    const { engine } = makeEngine();
    state().playTrack(trackA, [trackA]);
    await microtasks();
    const player = playerOf(engine);
    player.fireReady();

    player.fireError(100);
    vi.advanceTimersByTime(1000);
    await microtasks();
    const loads = player.loadVideoById.mock.calls.length;

    state().play(); // manual retry — not an automatic loop
    expect(player.loadVideoById.mock.calls.length).toBe(loads + 1);
    player.fireState(YT_STATE.PLAYING);
    expect(state().status).toBe("playing");
    expect(state().errorMessage).toBeNull();
  });
});

describe("engine helpers", () => {
  it("backoffDelay grows exponentially and caps at the maximum", () => {
    expect(backoffDelay(0)).toBe(1000);
    expect(backoffDelay(1)).toBe(2000);
    expect(backoffDelay(4)).toBe(16000);
    expect(backoffDelay(30)).toBe(RETRY_MAX_MS);
  });

  it("playerErrorMessage distinguishes fatal codes", () => {
    expect(playerErrorMessage(2)).toContain("invalid");
    expect(playerErrorMessage(100)).toContain("unavailable");
    expect(playerErrorMessage(101)).toContain("disabled embedding");
    expect(playerErrorMessage(150)).toContain("can't be played here");
    expect(playerErrorMessage(5)).toContain("error 5");
  });
});
