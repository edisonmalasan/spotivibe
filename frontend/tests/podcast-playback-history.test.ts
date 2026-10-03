import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalData } from "@/data/localData";
import type { ListeningEventRecord, SessionSnapshot, Track } from "@/data/repositories";
import {
  attachListeningRecorder,
  flushListeningRecorder,
  resetListeningRecorder,
} from "@/features/history/useListeningRecorder";
import {
  clampCuePosition,
  END_CUE_TAIL_SECONDS,
  resetPlayerStore,
  usePlayerStore,
} from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";
import { classifyPlay } from "@/features/insights/classifyPlay";
import { buildStats } from "@/features/insights/buildStats";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M12 tasks 6.1-6.2 and 7.1: long-form playback and podcast history.
 *
 * Two properties with nothing else to prove them:
 *
 * - A multi-hour episode restores at its stored position, and a stored position
 *   past the current duration is clamped **at load time** without rewriting the
 *   snapshot (design decision 7).
 * - A played podcast episode is recorded in the *existing* history dataset with
 *   its category, and the M11 statistics count it — no podcast-specific store
 *   (design decision 8).
 */

const HOUR = 3600;

function episode(overrides: Partial<Track> = {}): Track {
  return makeTrack({
    id: "youtube:ep-long",
    providerId: "ep-long",
    title: "Interview: The Fall of Rome",
    artists: [{ name: "History Hour" }],
    durationSeconds: 3 * HOUR,
    category: "podcast",
    ...overrides,
  });
}

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    queue: [episode()],
    queueIndex: 0,
    positionSeconds: 2 * HOUR,
    repeatMode: "off",
    shuffle: false,
    volume: 0.5,
    ...overrides,
  };
}

beforeEach(() => {
  resetPlayerStore();
  resetQueueStore();
  resetListeningRecorder();
});

/**
 * The recorded events, after every write the recorder has queued has been committed.
 *
 * ## Why this awaits instead of polling
 *
 * This used to poll with a 2000 ms deadline:
 *
 *     const deadline = Date.now() + timeoutMs;
 *     while (events.length < count && Date.now() < deadline) { …await sleep(20)… }
 *
 * and failed intermittently under load — roughly one run in three on a busy machine. The deadline
 * was standing in for the recorder's serialized write chain, so whether it was long enough depended
 * on how slow the surrounding suite happened to be. That is a flaky test wearing a timeout, and
 * raising the number would have made it rarer without making it impossible.
 *
 * `flushListeningRecorder()` awaits the chain itself. There is no debounce or timer on the write
 * path, so once it settles every recorded step has been committed and the read below sees them all.
 * The wait is now bounded by the work rather than by a budget, which is the difference between a
 * deterministic wait and a hopeful one.
 *
 * `count` is asserted **exactly**, and this was the last thing here still describing a polling
 * world. It read `toBeGreaterThanOrEqual`, which is the shape a bounded poll needs — you cannot know
 * whether the thing you are waiting for has arrived or is merely outnumbered, so "at least" is the
 * only honest bound. Once the chain has settled there is nothing in flight, so "at least" stopped
 * being honesty and became slack: an extra event written by the same step, a duplicate write, or a
 * second recording of the same episode all passed, while the surrounding comments described an exact
 * count the assertion never required. The claim and the check have to be the same claim.
 */
async function waitForEvents(count: number): Promise<ListeningEventRecord[]> {
  await flushListeningRecorder();
  const events = await (await getLocalData()).listeningHistory.list();
  expect(
    events.length,
    `expected exactly ${count} committed event(s); the recorder's chain settled with ${events.length}`,
  ).toBe(count);
  return events;
}

describe("a cue inside a multi-hour episode is left alone", () => {
  it("restores a three-hour episode at its stored position", () => {
    usePlayerStore.getState().restoreSession(snapshot());

    const state = usePlayerStore.getState();
    expect(state.currentTrack?.id).toBe("youtube:ep-long");
    expect(state.positionSeconds).toBe(2 * HOUR);
    expect(state.durationSeconds).toBe(3 * HOUR);
    // The cue is what the engine is asked to load, and playback never starts.
    expect(state.loadRequest?.startSeconds).toBe(2 * HOUR);
    expect(state.loadRequest?.mode).toBe("cue");
    expect(state.status).toBe("paused");
  });

  it("keeps the position and the duration on the session snapshot itself", () => {
    const restored = snapshot();
    usePlayerStore.getState().restoreSession(restored);

    // The clamp is a property of the load, never a rewrite: the caller's snapshot
    // still carries its own numbers.
    expect(restored.positionSeconds).toBe(2 * HOUR);
    expect(useQueueStore.getState().queue[0]?.durationSeconds).toBe(3 * HOUR);
  });
});

describe("a stored position beyond the duration is clamped at load time", () => {
  it("cues inside the episode instead of past its end", () => {
    usePlayerStore.getState().restoreSession(
      // The episode was re-cut shorter than the snapshot remembers.
      snapshot({ queue: [episode({ durationSeconds: 30 * 60 })], positionSeconds: 2 * HOUR }),
    );

    const state = usePlayerStore.getState();
    expect(state.durationSeconds).toBe(30 * 60);
    expect(state.positionSeconds).toBeLessThanOrEqual(30 * 60);
    expect(state.loadRequest?.startSeconds).toBe(state.positionSeconds);
    // And never the very end, which the player reads as "ended".
    expect(state.positionSeconds).toBe(30 * 60 - END_CUE_TAIL_SECONDS);
  });

  it("leaves the music path untouched when the two agree", () => {
    usePlayerStore.getState().restoreSession(
      snapshot({
        queue: [episode({ durationSeconds: 3 * HOUR, category: "music" })],
        positionSeconds: 5,
      }),
    );

    expect(usePlayerStore.getState().positionSeconds).toBe(5);
    expect(usePlayerStore.getState().loadRequest?.startSeconds).toBe(5);
  });

  it("clamps through the same helper, and never clamps an unknown duration", () => {
    // A track with no known duration has nothing to compare against.
    expect(clampCuePosition(5000, 0)).toBe(5000);
    expect(clampCuePosition(Number.NaN, 0)).toBe(0);
    expect(clampCuePosition(-10, 0)).toBe(0);
    expect(clampCuePosition(100, 3600)).toBe(100);
    expect(clampCuePosition(4000, 3600)).toBe(3600 - END_CUE_TAIL_SECONDS);
    // A cue exactly at the end still lands short of it.
    expect(clampCuePosition(3600, 3600)).toBe(3600 - END_CUE_TAIL_SECONDS);
    // An episode shorter than the tail cues at zero rather than negative.
    expect(clampCuePosition(100, 1)).toBe(0);
  });
});

describe("a played podcast episode is recorded in the existing dataset", () => {
  it("stores one event carrying the episode's category and canonical metadata", async () => {
    const data = await getLocalData();
    await data.listeningHistory.clear();
    attachListeningRecorder();

    const played = episode();
    const second = episode({ id: "youtube:ep-two", providerId: "ep-two", title: "Episode two" });
    usePlayerStore.getState().playTrack(played, [played, second], "search");
    // The recorder writes through a serialized repository chain, so the event is
    // not there the instant `playTrack` returns.
    const events = await waitForEvents(1);
    expect(events).toHaveLength(1);
    expect(events[0].trackId).toBe("youtube:ep-long");
    expect(events[0].track.category).toBe("podcast");
    expect(events[0].track.title).toBe("Interview: The Fall of Rome");
    expect(events[0].track.durationSeconds).toBe(3 * HOUR);
    expect(events[0].context).toBe("search");

    // The step's measurements land when the step ends — here, by advancing to the
    // next episode — and they are what make the play countable rather than a
    // zero-second touch. Advancing also records the *second* episode, so the
    // dataset holds exactly two events once the chain settles — `waitForEvents`
    // asserts that count exactly, not as a lower bound.
    usePlayerStore.getState()._setDuration(3 * HOUR);
    usePlayerStore.getState()._setPosition(120);
    usePlayerStore.getState().next();
    const afterStep = await waitForEvents(2);
    const firstEpisode = afterStep.find((entry) => entry.trackId === "youtube:ep-long");
    expect(firstEpisode?.secondsPlayed).toBe(120);
  });

  it("counts the podcast play in the local statistics, with no new dataset", async () => {
    const data = await getLocalData();
    await data.listeningHistory.clear();
    await data.likedTracks.clear();

    // 20s of a 3-hour episode: past the skip floor, short of the completion
    // minimum, so a partial play — the shape a podcast-heavy listener produces
    // constantly, because an episode is long.
    await data.listeningHistory.record({
      trackId: "youtube:ep-long",
      track: episode(),
      playedAt: Date.now() - HOUR * 1000,
      secondsPlayed: 20,
      context: "search",
    });

    const events = await data.listeningHistory.list();
    expect(
      classifyPlay({ secondsPlayed: events[0].secondsPlayed, durationSeconds: 3 * HOUR }),
    ).toBe("partial");

    const stats = buildStats(events, { now: Date.now() });
    expect(stats.playCount).toBe(1);
    expect(stats.hasSignal).toBe(true);
    expect(stats.topTracks[0]?.label).toBe("Interview: The Fall of Rome");
    expect(stats.topArtists[0]?.label).toBe("History Hour");
    // The category breakdown reports podcasts as podcasts (M11's `genreKeysOf`).
    expect(stats.categories.map((entry) => entry.key)).toContain("podcast");
    expect(stats.streak.current).toBeGreaterThanOrEqual(1);

    // No podcast-specific store was added: the repository set is unchanged by M12.
    expect(Object.keys(data)).not.toContain("podcastHistory");
    expect(Object.keys(data)).toContain("listeningHistory");
  });
  it("clears podcast plays the same way it clears music plays", async () => {
    const data = await getLocalData();
    await data.listeningHistory.clear();
    await data.listeningHistory.record({
      trackId: "youtube:ep-long",
      track: episode(),
      playedAt: Date.now(),
      secondsPlayed: 120,
      context: "search",
    });
    expect(await data.listeningHistory.list()).toHaveLength(1);

    await useHistoryStoreClear();
    expect(await data.listeningHistory.list()).toEqual([]);
    // And the statistics follow the clear with no separate step.
    expect(buildStats(await data.listeningHistory.list(), { now: Date.now() }).playCount).toBe(0);
  });
});

/** Clear through the store the History surface uses, not the repository directly. */
async function useHistoryStoreClear(): Promise<void> {
  const { useHistoryStore } = await import("@/stores/historyStore");
  await useHistoryStore.getState().clear();
}

/** A cue helper guard: no test may leave a spy on the global fetch behind. */
it("does not issue any provider request for playback or history", async () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const data = await getLocalData();
  await data.listeningHistory.clear();
  attachListeningRecorder();

  const played = episode();
  usePlayerStore.getState().playTrack(played, [played], "search");
  await data.listeningHistory.clear();
  attachListeningRecorder();
  usePlayerStore.getState().playTrack(played, [played], "search");
  await new Promise((resolve) => setTimeout(resolve, 50));

  // Playback and history are local: a podcast is no more an upstream question than
  // a song is.
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
