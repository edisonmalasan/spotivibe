import "fake-indexeddb/auto";
import { configure, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalData, type RepositorySet } from "@/data/localData";
import type { ListeningContext, QueueSource } from "@/data/repositories";
import {
  LISTENING_CONTEXT_BY_SOURCE,
  attachListeningRecorder,
  initListeningRecorder,
  isListeningRecorderActive,
  listeningContextForSource,
  resetListeningRecorder,
  useListeningRecorder,
} from "@/features/history/useListeningRecorder";
import { buildStats } from "@/features/insights/buildStats";
import { classifyPlay } from "@/features/insights/classifyPlay";
import { resetHistoryStore, useHistoryStore } from "@/stores/historyStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M8 task 4.2: `useListeningRecorder` — one event per track step, the queue
 * source mapped to its listening context, nothing written for position/status
 * ticks or a session restore, and no second event for a same-track
 * re-activation.
 */

// The recorder serializes hydrate → write → re-read through IndexedDB, which
// can exceed the 1s default on a cold jsdom worker.
configure({ asyncUtilTimeout: 5000 });

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const trackB = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Beta" });
const trackC = makeTrack({ id: "youtube:ccc", providerId: "ccc", title: "Gamma" });

let repositories: RepositorySet;

/** Play `track` from a queue context, exactly as every surface activates it. */
function play(track: typeof trackA, source: QueueSource = "unknown", context = [track]): void {
  usePlayerStore.getState().playTrack(track, context, source);
}

async function storedEvents() {
  return repositories.listeningHistory.list();
}

async function expectEventCount(count: number): Promise<void> {
  await waitFor(async () => {
    expect((await storedEvents()).length).toBe(count);
  });
  expect(useHistoryStore.getState().events).toHaveLength(count);
}

/** Let every queued write settle so "no extra event" is a real assertion. */
async function settle(): Promise<void> {
  await useHistoryStore.getState().hydrate();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(async () => {
  resetListeningRecorder();
  resetHistoryStore();
  resetPlayerStore();
  repositories = await getLocalData();
  await repositories.resetAll();
});

describe("queue source → listening context mapping", () => {
  it("maps every queue source onto its designed context", () => {
    expect(LISTENING_CONTEXT_BY_SOURCE).toEqual({
      search: "search",
      browse: "home",
      library: "library",
      queue: "queue",
      // M10: a track heard through a radio is radio playback, whatever surface
      // the radio was started from.
      radio: "radio",
      unknown: "other",
    });
  });

  it("never returns undefined, even for an unmapped value", () => {
    expect(listeningContextForSource("browse")).toBe("home");
    expect(listeningContextForSource("unknown")).toBe("other");
    expect(listeningContextForSource("mystery" as QueueSource)).toBe("other");
  });
});

describe("listening recorder attachment", () => {
  it("reports whether the subscription is attached and detaches cleanly", () => {
    expect(isListeningRecorderActive()).toBe(false);

    const detach = attachListeningRecorder();
    expect(isListeningRecorderActive()).toBe(false); // only init sets the guard

    const detachInit = initListeningRecorder();
    expect(isListeningRecorderActive()).toBe(true);
    detachInit();
    expect(isListeningRecorderActive()).toBe(false);
    detach();
  });

  it("records exactly once per step when init is called twice (StrictMode safe)", async () => {
    initListeningRecorder();
    initListeningRecorder(); // a no-op teardown, not a second subscription

    play(trackA, "search");

    await expectEventCount(1);
  });

  it("records nothing after the recorder is detached", async () => {
    const detach = initListeningRecorder();
    detach();

    play(trackA, "search");
    await settle();

    expect(await storedEvents()).toEqual([]);
  });

  it("mounts from the shell hook and detaches on unmount", async () => {
    function RecorderHost(): null {
      useListeningRecorder();
      return null;
    }

    const view = render(createElement(RecorderHost));
    expect(isListeningRecorderActive()).toBe(true);
    play(trackA, "library");
    await expectEventCount(1);

    view.unmount();
    expect(isListeningRecorderActive()).toBe(false);
    play(trackB, "library");
    await settle();
    expect(await storedEvents()).toHaveLength(1);
  });
});

describe("one event per track step", () => {
  beforeEach(() => {
    initListeningRecorder();
  });

  it("records the started track with its identity, snapshot, and context", async () => {
    play(trackA, "search");

    await expectEventCount(1);
    const [event] = await storedEvents();
    expect(event?.trackId).toBe(trackA.id);
    expect(event?.track).toEqual(trackA);
    expect(event?.context).toBe("search");
    expect(event?.secondsPlayed).toBe(0);
    expect(event?.id).toBeTruthy();
    expect(event?.playedAt).toBeGreaterThan(0);
  });

  it("records once per step across a queue, in step order", async () => {
    const queue = [trackA, trackB, trackC];
    play(trackA, "browse", queue);
    await expectEventCount(1);

    usePlayerStore.getState().next();
    await expectEventCount(2);

    usePlayerStore.getState().next();
    await expectEventCount(3);

    const events = await storedEvents();
    expect(events.map((entry) => entry.trackId)).toEqual([trackC.id, trackB.id, trackA.id]);
    expect(new Set(events.map((entry) => entry.context))).toEqual(new Set(["home"]));
  });

  it("records the context of the surface the step came from", async () => {
    const cases: Array<[QueueSource, ListeningContext]> = [
      ["search", "search"],
      ["browse", "home"],
      ["library", "library"],
      ["queue", "queue"],
      ["radio", "radio"],
      ["unknown", "other"],
    ];

    for (const [source, expected] of cases) {
      const track = makeTrack({ id: `youtube:ctx-${source}`, providerId: `ctx-${source}` });
      play(track, source);
      await waitFor(async () => {
        expect((await storedEvents()).some((entry) => entry.trackId === track.id)).toBe(true);
      });
      const stored = await repositories.listeningHistory.list();
      expect(stored.find((entry) => entry.trackId === track.id)?.context).toBe(expected);
    }
  });

  it("records nothing on position, status, or duration ticks", async () => {
    play(trackA, "search");
    await expectEventCount(1);

    usePlayerStore.getState()._setPosition(12);
    usePlayerStore.getState()._setPosition(24);
    usePlayerStore.getState()._setDuration(249);
    usePlayerStore.getState()._setStatus("playing");
    usePlayerStore.getState().setVolume(40);
    usePlayerStore.getState().pause();
    usePlayerStore.getState().play();
    await settle();

    expect(await storedEvents()).toHaveLength(1);
  });

  it("records nothing for a session restore, which cues a track paused", async () => {
    usePlayerStore.getState().restoreSession({
      queue: [trackA, trackB],
      queueIndex: 0,
      positionSeconds: 30,
      repeatMode: "off",
      shuffle: false,
      volume: 0.5,
      source: "search",
    });
    await settle();

    expect(await storedEvents()).toEqual([]);
  });

  it("adds no event when the same track is re-activated", async () => {
    play(trackA, "search");
    await expectEventCount(1);

    play(trackA, "search");
    play(trackA, "browse");
    await settle();

    expect(await storedEvents()).toHaveLength(1);
  });

  it("records again once a different track is played in between", async () => {
    play(trackA, "search");
    await expectEventCount(1);
    play(trackA, "search");
    await settle();
    expect(await storedEvents()).toHaveLength(1);

    play(trackB, "search");
    await expectEventCount(2);
    play(trackA, "search");
    await expectEventCount(3);

    const events = await storedEvents();
    expect(events.map((entry) => entry.trackId)).toEqual([trackA.id, trackB.id, trackA.id]);
    // The newest event reflects the latest activation.
    expect(events[0].context).toBe("search");
  });

  it("does not duplicate the newest event an earlier session already recorded", async () => {
    await repositories.listeningHistory.record({
      trackId: trackA.id,
      track: trackA,
      playedAt: 5,
      secondsPlayed: 0,
      context: "home",
    });

    initListeningRecorder(); // attach after the event exists
    play(trackA, "search");
    await settle();

    expect(await storedEvents()).toHaveLength(1);

    // A different track is still recorded normally.
    play(trackB, "search");
    await expectEventCount(2);
  });

  it("keeps recording when a repository write fails", async () => {
    const spy = vi
      .spyOn(repositories.listeningHistory, "record")
      .mockRejectedValueOnce(new Error("write failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await useHistoryStore.getState().hydrate();

    play(trackA, "search");
    await waitFor(() => expect(spy).toHaveBeenCalled());
    warn.mockRestore();
    spy.mockRestore();

    play(trackB, "search");
    await expectEventCount(1);
    expect((await storedEvents())[0].trackId).toBe(trackB.id);
  });
});

describe("M11: raw measurements, never a verdict", () => {
  /** Drive the transport's position tick the engine would send. */
  const tickTo = (seconds: number) => usePlayerStore.getState()._setPosition(seconds);
  const setDuration = (seconds: number) => usePlayerStore.getState()._setDuration(seconds);

  it("records the seconds a step actually played when the next step starts", async () => {
    initListeningRecorder();
    play(trackA, "search");
    await expectEventCount(1);
    setDuration(240);
    tickTo(120);
    tickTo(180);

    play(trackB, "search");
    await expectEventCount(2);

    const events = await storedEvents();
    const first = events.find((entry) => entry.trackId === trackA.id);
    // A raw measurement of the position the engine reported — not a verdict:
    // 180s of a 240s track is data the read-time rule decides about later.
    expect(first?.secondsPlayed).toBe(180);
    expect(first?.completed).toBe(false);
  });

  it("marks a step completed once playback reached the track's end", async () => {
    initListeningRecorder();
    play(trackA, "search");
    await expectEventCount(1);
    setDuration(200);
    // The engine's last tick lands a fraction short of the duration.
    tickTo(199);

    play(trackB, "search");
    await expectEventCount(2);

    const first = (await storedEvents()).find((entry) => entry.trackId === trackA.id);
    expect(first?.completed).toBe(true);
    expect(first?.secondsPlayed).toBe(199);
  });

  it("never reports more seconds than the track's duration", async () => {
    initListeningRecorder();
    play(trackA, "search");
    await expectEventCount(1);
    setDuration(100);
    tickTo(140); // a seek or a provider quirk past the end

    play(trackB, "search");
    await expectEventCount(2);

    const first = (await storedEvents()).find((entry) => entry.trackId === trackA.id);
    expect(first?.secondsPlayed).toBe(100);
    expect(first?.completed).toBe(true);
  });

  it("leaves a step that never moved at zero seconds rather than inventing a play", async () => {
    initListeningRecorder();
    play(trackA, "search");
    await expectEventCount(1);

    play(trackB, "search");
    await expectEventCount(2);

    const first = (await storedEvents()).find((entry) => entry.trackId === trackA.id);
    // Untouched, not rewritten: no patch means no stored `completed` marker, so
    // nothing can be read as a claim that the track was played.
    expect(first?.secondsPlayed).toBe(0);
    expect(first?.completed).toBeUndefined();
  });

  it("writes the open step's measurements when the recorder detaches", async () => {
    const detach = initListeningRecorder();
    play(trackA, "search");
    await expectEventCount(1);
    setDuration(300);
    tickTo(45);

    detach();
    await settle();

    const first = (await storedEvents()).find((entry) => entry.trackId === trackA.id);
    expect(first?.secondsPlayed).toBe(45);
  });

  it("does not measure one step against another track's position", async () => {
    initListeningRecorder();
    play(trackA, "search");
    await expectEventCount(1);
    setDuration(240);
    tickTo(60);

    play(trackB, "search");
    await expectEventCount(2);
    // A tick that arrives after the switch belongs to track B's step; it must not
    // rewrite track A's measurement.
    tickTo(5);

    play(makeTrack({ id: "youtube:ccc", providerId: "ccc", title: "Gamma" }), "search");
    await expectEventCount(3);

    const first = (await storedEvents()).find((entry) => entry.trackId === trackA.id);
    expect(first?.secondsPlayed).toBe(60);
  });

  it("stores a measurement that classifies as a real play, through the M11 rule", async () => {
    // The point of measuring: without it every recorded event would read as a
    // skip, so no statistic could ever report a play.
    initListeningRecorder();
    play(trackA, "search");
    await expectEventCount(1);
    setDuration(240);
    tickTo(150);

    play(trackB, "search");
    await expectEventCount(2);

    const first = (await storedEvents()).find((entry) => entry.trackId === trackA.id);
    const verdict = classifyPlay({
      secondsPlayed: first?.secondsPlayed ?? 0,
      durationSeconds: 240,
      completed: first?.completed,
    });
    expect(verdict).toBe("completed");
    expect(buildStats(await storedEvents(), { now: Date.now() }).playCount).toBeGreaterThan(0);
  });

  it("keeps recording when the measurement write fails", async () => {
    initListeningRecorder();
    play(trackA, "search");
    await expectEventCount(1);
    setDuration(240);
    tickTo(90);

    const spy = vi
      .spyOn(repositories.listeningHistory, "update")
      .mockRejectedValueOnce(new Error("write failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    play(trackB, "search");
    await expectEventCount(2);

    // The event itself survives: a lost measurement degrades one statistic, it
    // does not drop the play.
    expect((await storedEvents()).length).toBe(2);
    warn.mockRestore();
    spy.mockRestore();
  });

  it("writes measurements through the repository's update, not a second record", async () => {
    initListeningRecorder();
    play(trackA, "search");
    await expectEventCount(1);
    setDuration(240);
    tickTo(30);

    const spy = vi.spyOn(repositories.listeningHistory, "update");
    play(trackB, "search");
    await expectEventCount(2);

    expect(spy).toHaveBeenCalledTimes(1);
    // One event for track A, patched in place — the id never changes.
    const first = (await storedEvents()).find((entry) => entry.trackId === trackA.id);
    expect(spy.mock.calls[0][0]).toBe(first?.id);
    expect(spy.mock.calls[0][1]).toMatchObject({ secondsPlayed: 30 });
    spy.mockRestore();
  });
});
