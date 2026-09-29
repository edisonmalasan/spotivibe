import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalData, type RepositorySet } from "@/data/localData";
import type { ListeningContext } from "@/data/repositories";
import {
  RECENT_HISTORY_LIMIT,
  initialHistoryState,
  resetHistoryStore,
  useHistoryStore,
} from "@/stores/historyStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M8 task 4.1: `historyStore` over the existing listening-history repository —
 * hydration, newest-first ordering, the repository-first round trip for
 * `record`, and a clear that empties both state and storage while leaving every
 * other dataset alone.
 */

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const trackB = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Beta" });
const trackC = makeTrack({ id: "youtube:ccc", providerId: "ccc", title: "Gamma" });

let repositories: RepositorySet;

beforeEach(async () => {
  resetHistoryStore();
  repositories = await getLocalData();
  await repositories.resetAll();
});

function event(
  track = trackA,
  playedAt: number,
  context: ListeningContext = "home",
): Parameters<RepositorySet["listeningHistory"]["record"]>[0] {
  return { trackId: track.id, track, playedAt, secondsPlayed: 0, context };
}

describe("historyStore hydration", () => {
  it("starts empty and unhydrated", () => {
    const state = useHistoryStore.getState();
    expect(state.events).toEqual([]);
    expect(state.hydrated).toBe(false);
    expect(initialHistoryState.events).toEqual([]);
  });

  it("reads stored events newest-first", async () => {
    await repositories.listeningHistory.record(event(trackA, 1_000));
    await repositories.listeningHistory.record(event(trackB, 3_000));
    await repositories.listeningHistory.record(event(trackC, 2_000));

    await useHistoryStore.getState().hydrate();

    const state = useHistoryStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.events.map((record) => record.trackId)).toEqual([trackB.id, trackC.id, trackA.id]);
  });

  it("is idempotent: concurrent and repeated hydration never appends or duplicates", async () => {
    await repositories.listeningHistory.record(event(trackA, 1_000));
    const store = useHistoryStore.getState();

    await Promise.all([store.hydrate(), store.hydrate()]);
    await store.hydrate();

    expect(useHistoryStore.getState().events).toHaveLength(1);
  });

  it("resyncs after a bulk clear + hydrate (Settings clear listening history)", async () => {
    await repositories.listeningHistory.record(event(trackA, 1_000));
    await useHistoryStore.getState().hydrate();
    expect(useHistoryStore.getState().events).toHaveLength(1);

    await repositories.listeningHistory.clear();
    await useHistoryStore.getState().hydrate();

    expect(useHistoryStore.getState().events).toEqual([]);
    expect(useHistoryStore.getState().hydrated).toBe(true);
  });

  it("resetHistoryStore returns the store to its initial state", async () => {
    await repositories.listeningHistory.record(event(trackA, 1_000));
    await useHistoryStore.getState().hydrate();

    resetHistoryStore();

    expect(useHistoryStore.getState().events).toEqual([]);
    expect(useHistoryStore.getState().hydrated).toBe(false);
  });
});

describe("historyStore.record", () => {
  it("persists the event, returns it, and reflects the refreshed newest-first list", async () => {
    await useHistoryStore.getState().record(event(trackA, 1_000, "search"));
    const created = await useHistoryStore.getState().record(event(trackB, 2_000, "home"));

    expect(created.trackId).toBe(trackB.id);
    expect(created.id).toBeTruthy();
    expect(created.context).toBe("home");
    expect(created.secondsPlayed).toBe(0);
    expect((await repositories.listeningHistory.list()).map((e) => e.trackId)).toEqual([
      trackB.id,
      trackA.id,
    ]);
    expect(useHistoryStore.getState().events.map((e) => e.trackId)).toEqual([trackB.id, trackA.id]);
    expect(useHistoryStore.getState().hydrated).toBe(true);
  });

  it("stores the full track snapshot alongside the id", async () => {
    await useHistoryStore.getState().record(event(trackA, 1_000));

    const [stored] = useHistoryStore.getState().events;
    expect(stored?.track).toEqual(trackA);
    expect(stored?.track.artists[0]?.name).toBe("Daft Punk");
  });

  it("leaves state and storage unchanged when the write fails", async () => {
    await useHistoryStore.getState().record(event(trackA, 1_000));
    const before = useHistoryStore.getState().events;

    const spy = vi
      .spyOn(repositories.listeningHistory, "record")
      .mockRejectedValueOnce(new Error("write failed"));

    await expect(useHistoryStore.getState().record(event(trackB, 2_000))).rejects.toThrow(
      "write failed",
    );
    spy.mockRestore();

    expect(useHistoryStore.getState().events).toEqual(before);
    expect(await repositories.listeningHistory.list()).toHaveLength(1);
  });

  it("bounds the hydrated list to RECENT_HISTORY_LIMIT newest events", async () => {
    for (let index = 0; index < RECENT_HISTORY_LIMIT + 5; index += 1) {
      await repositories.listeningHistory.record(event(trackA, 1_000 + index));
    }

    await useHistoryStore.getState().hydrate();

    const events = useHistoryStore.getState().events;
    expect(events).toHaveLength(RECENT_HISTORY_LIMIT);
    // The newest events survive the bound; the oldest five are dropped.
    expect(events[0].playedAt).toBe(1_000 + RECENT_HISTORY_LIMIT + 4);
  });
});

describe("historyStore.clear", () => {
  it("empties state and storage while leaving other datasets alone", async () => {
    await repositories.likedTracks.like(trackA, 1);
    await repositories.listeningHistory.record(event(trackA, 1_000));
    await repositories.listeningHistory.record(event(trackB, 2_000));
    await useHistoryStore.getState().hydrate();

    await useHistoryStore.getState().clear();

    expect(useHistoryStore.getState().events).toEqual([]);
    expect(useHistoryStore.getState().hydrated).toBe(true);
    expect(await repositories.listeningHistory.list()).toEqual([]);
    expect(await repositories.likedTracks.list()).toHaveLength(1);
  });

  it("rejects and keeps state when the clear fails", async () => {
    await useHistoryStore.getState().record(event(trackA, 1_000));
    const before = useHistoryStore.getState().events;

    const spy = vi
      .spyOn(repositories.listeningHistory, "clear")
      .mockRejectedValueOnce(new Error("clear failed"));

    await expect(useHistoryStore.getState().clear()).rejects.toThrow("clear failed");
    spy.mockRestore();

    expect(useHistoryStore.getState().events).toEqual(before);
    expect(await repositories.listeningHistory.list()).toHaveLength(1);
  });
});
