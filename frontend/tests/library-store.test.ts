import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { useQueueStore } from "@/stores/queueStore";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M7 tasks 1.1–1.3: `libraryStore` behavior against the real (fake-indexeddb)
 * local-data layer — hydration idempotence, reset isolation, repository-first
 * actions, the duplicate matrix, reorder, rollback on import failure, and the
 * transport-untouched guarantee for every mutation.
 */

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const trackB = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Beta" });
const trackC = makeTrack({ id: "youtube:ccc", providerId: "ccc", title: "Gamma" });

let repositories: RepositorySet;

beforeEach(async () => {
  resetLibraryStore();
  resetPlayerStore();
  repositories = await getLocalData();
  await repositories.resetAll();
});

describe("libraryStore hydration (task 1.1)", () => {
  it("populates liked ids and playlists from the repositories", async () => {
    await repositories.likedTracks.like(trackA);
    const playlist = await repositories.playlists.create({ name: "Road Trip" });
    await repositories.playlists.addTrack(playlist.id, trackB);

    await useLibraryStore.getState().hydrate();

    const state = useLibraryStore.getState();
    expect(state.hydrated).toBe(true);
    expect([...state.likedIds]).toEqual([trackA.id]);
    expect(state.likedTracks.map((track) => track.id)).toEqual([trackA.id]);
    expect(state.playlists).toHaveLength(1);
    expect(state.playlists[0]?.name).toBe("Road Trip");
    expect(state.playlists[0]?.tracks.map((entry) => entry.track.id)).toEqual([trackB.id]);
  });

  it("stays stable across double hydration (no duplicated state)", async () => {
    await repositories.likedTracks.like(trackA);
    await repositories.playlists.create({ name: "Mix" });

    const store = useLibraryStore.getState();
    await Promise.all([store.hydrate(), store.hydrate()]); // concurrent callers share one read
    await store.hydrate(); // and a later call re-reads, never appends

    expect(useLibraryStore.getState().likedIds.size).toBe(1);
    expect(useLibraryStore.getState().playlists).toHaveLength(1);
  });

  it("resyncs after a bulk clear + hydrate (Settings reset / backup import)", async () => {
    await repositories.likedTracks.like(trackA);
    await repositories.playlists.create({ name: "Mix" });
    await useLibraryStore.getState().hydrate();

    await repositories.resetAll();
    await useLibraryStore.getState().hydrate();

    expect(useLibraryStore.getState().likedIds.size).toBe(0);
    expect(useLibraryStore.getState().playlists).toHaveLength(0);
    expect(useLibraryStore.getState().hydrated).toBe(true);
  });

  it("resetLibraryStore returns the store to its initial state", async () => {
    await repositories.likedTracks.like(trackA);
    await repositories.playlists.create({ name: "Mix" });
    await useLibraryStore.getState().hydrate();
    expect(useLibraryStore.getState().hydrated).toBe(true);

    resetLibraryStore();

    const state = useLibraryStore.getState();
    expect(state.hydrated).toBe(false);
    expect(state.likedIds.size).toBe(0);
    expect(state.likedTracks).toHaveLength(0);
    expect(state.playlists).toHaveLength(0);
  });

  it("keeps liked records newest-first (spec ordering for the liked surface)", async () => {
    await repositories.likedTracks.like(trackA, 1_000);
    await repositories.likedTracks.like(trackB, 2_000); // liked later — first

    await useLibraryStore.getState().hydrate();

    expect(useLibraryStore.getState().likedTracks.map((track) => track.id)).toEqual([
      trackB.id,
      trackA.id,
    ]);
  });
});

describe("libraryStore actions (task 1.2)", () => {
  it("persists like toggles and reflects them in likedIds", async () => {
    await useLibraryStore.getState().hydrate();

    await useLibraryStore.getState().toggleLike(trackA);
    expect(await repositories.likedTracks.isLiked(trackA.id)).toBe(true);
    expect(useLibraryStore.getState().likedIds.has(trackA.id)).toBe(true);
    expect(useLibraryStore.getState().likedTracks.map((track) => track.id)).toEqual([trackA.id]);

    await useLibraryStore.getState().toggleLike(trackA);
    expect(await repositories.likedTracks.isLiked(trackA.id)).toBe(false);
    expect(useLibraryStore.getState().likedIds.has(trackA.id)).toBe(false);
    expect(useLibraryStore.getState().likedTracks).toHaveLength(0);
  });

  it("creates a playlist with an immutable id and no tracks", async () => {
    const created = await useLibraryStore
      .getState()
      .createPlaylist({ name: "Road Trip", description: "Highway songs" });

    expect(created.id).toBeTruthy();
    expect(created.tracks).toEqual([]);
    const stored = await repositories.playlists.get(created.id);
    expect(stored?.name).toBe("Road Trip");
    expect(stored?.description).toBe("Highway songs");
    expect(useLibraryStore.getState().playlists.some((p) => p.id === created.id)).toBe(true);
  });

  it("renames a playlist without touching its id, tracks, or order", async () => {
    const created = await useLibraryStore.getState().createPlaylist({ name: "Old name" });
    await useLibraryStore.getState().addTrackToPlaylist(created.id, trackA);
    await useLibraryStore.getState().addTrackToPlaylist(created.id, trackB);
    const before = useLibraryStore.getState().playlists.find((p) => p.id === created.id);

    const updated = await useLibraryStore
      .getState()
      .updatePlaylist(created.id, { name: "New name", description: "Edited" });

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("New name");
    expect(updated.tracks.map((entry) => entry.track.id)).toEqual([trackA.id, trackB.id]);
    const after = useLibraryStore.getState().playlists.find((p) => p.id === created.id);
    expect(after?.tracks).toEqual(before?.tracks);
    expect(after?.name).toBe("New name");
  });

  it("deletes a playlist from state and storage", async () => {
    const created = await useLibraryStore.getState().createPlaylist({ name: "Doomed" });
    expect(useLibraryStore.getState().playlists).toHaveLength(1);

    await useLibraryStore.getState().deletePlaylist(created.id);

    expect(await repositories.playlists.get(created.id)).toBeUndefined();
    expect(useLibraryStore.getState().playlists).toHaveLength(0);
  });

  it("answers the duplicate matrix: present → duplicate/unchanged, absent → appended", async () => {
    const playlist = await useLibraryStore.getState().createPlaylist({ name: "Matrix" });
    await useLibraryStore.getState().addTrackToPlaylist(playlist.id, trackA);

    const before = useLibraryStore.getState().playlists.find((p) => p.id === playlist.id);
    const first = await useLibraryStore.getState().addTrackToPlaylist(playlist.id, trackA);
    expect(first).toBe("duplicate");
    const unchanged = useLibraryStore.getState().playlists.find((p) => p.id === playlist.id);
    expect(unchanged).toEqual(before);
    expect((await repositories.playlists.get(playlist.id))?.tracks).toHaveLength(1);

    const second = await useLibraryStore.getState().addTrackToPlaylist(playlist.id, trackB);
    expect(second).toBe("added");
    expect(
      useLibraryStore
        .getState()
        .playlists.find((p) => p.id === playlist.id)
        ?.tracks.map((entry) => entry.track.id),
    ).toEqual([trackA.id, trackB.id]);
  });

  it("rejects an addition to a missing playlist", async () => {
    await expect(
      useLibraryStore.getState().addTrackToPlaylist("nope", trackA),
    ).rejects.toMatchObject({ name: "LocalDataError" });
  });

  it("removes a track through the store", async () => {
    const playlist = await useLibraryStore.getState().createPlaylist({ name: "Removals" });
    await useLibraryStore.getState().addTrackToPlaylist(playlist.id, trackA);
    await useLibraryStore.getState().addTrackToPlaylist(playlist.id, trackB);

    await useLibraryStore.getState().removeTrackFromPlaylist(playlist.id, trackA.id);

    const stored = await repositories.playlists.get(playlist.id);
    expect(stored?.tracks.map((entry) => entry.track.id)).toEqual([trackB.id]);
    expect(
      useLibraryStore
        .getState()
        .playlists.find((p) => p.id === playlist.id)
        ?.tracks.map((entry) => entry.track.id),
    ).toEqual([trackB.id]);
  });

  it("reorders tracks to the resulting order in state and storage", async () => {
    const playlist = await useLibraryStore.getState().createPlaylist({ name: "Order" });
    for (const track of [trackA, trackB, trackC]) {
      await useLibraryStore.getState().addTrackToPlaylist(playlist.id, track);
    }

    await useLibraryStore.getState().reorderPlaylistTrack(playlist.id, 2, 0);

    const expected = [trackC.id, trackA.id, trackB.id];
    expect(
      useLibraryStore
        .getState()
        .playlists.find((p) => p.id === playlist.id)
        ?.tracks.map((entry) => entry.track.id),
    ).toEqual(expected);
    const stored = await repositories.playlists.get(playlist.id);
    expect(stored?.tracks.map((entry) => entry.track.id)).toEqual(expected);
  });

  it("leaves state unchanged when a repository write fails", async () => {
    const playlist = await useLibraryStore.getState().createPlaylist({ name: "Flaky" });
    await useLibraryStore.getState().addTrackToPlaylist(playlist.id, trackA);
    const before = useLibraryStore.getState().playlists;

    const spy = vi
      .spyOn(repositories.playlists, "addTrack")
      .mockRejectedValueOnce(new Error("write failed"));

    await expect(
      useLibraryStore.getState().addTrackToPlaylist(playlist.id, trackB),
    ).rejects.toThrow("write failed");
    spy.mockRestore();

    expect(useLibraryStore.getState().playlists).toEqual(before);
    expect((await repositories.playlists.get(playlist.id))?.tracks).toHaveLength(1);
  });

  it("never disturbs transport fields across every mutation (spec)", async () => {
    await useLibraryStore.getState().hydrate();
    const playlist = await useLibraryStore.getState().createPlaylist({ name: "Playing" });
    usePlayerStore.getState().playTrack(trackA, [trackA, trackB], "search");
    usePlayerStore.getState().pause();
    usePlayerStore.setState({ positionSeconds: 42 });

    const snapshot = () => ({
      currentTrack: usePlayerStore.getState().currentTrack,
      status: usePlayerStore.getState().status,
      positionSeconds: usePlayerStore.getState().positionSeconds,
      queue: useQueueStore.getState().queue,
      queueIndex: useQueueStore.getState().queueIndex,
      shuffle: useQueueStore.getState().shuffle,
      source: useQueueStore.getState().source,
    });
    const before = snapshot();

    await useLibraryStore.getState().toggleLike(trackA);
    await useLibraryStore.getState().toggleLike(trackA);
    await useLibraryStore.getState().addTrackToPlaylist(playlist.id, trackA);
    await useLibraryStore.getState().addTrackToPlaylist(playlist.id, trackB);
    await useLibraryStore.getState().reorderPlaylistTrack(playlist.id, 1, 0);
    await useLibraryStore.getState().removeTrackFromPlaylist(playlist.id, trackA.id);
    await useLibraryStore.getState().updatePlaylist(playlist.id, { name: "Renamed" });
    await useLibraryStore.getState().deletePlaylist(playlist.id);

    expect(snapshot()).toEqual(before);
  });
});

describe("libraryStore import creation (task 1.3)", () => {
  it("writes tracks sequentially in input order", async () => {
    const created = await useLibraryStore.getState().createPlaylistFromResolved({
      name: "Imported mix",
      description: "Resolved remotely",
      tracks: [trackC, trackA, trackB],
    });

    expect(created.tracks.map((entry) => entry.track.id)).toEqual([
      trackC.id,
      trackA.id,
      trackB.id,
    ]);
    const stored = await repositories.playlists.get(created.id);
    expect(stored?.name).toBe("Imported mix");
    expect(stored?.description).toBe("Resolved remotely");
    expect(stored?.tracks.map((entry) => entry.track.id)).toEqual([
      trackC.id,
      trackA.id,
      trackB.id,
    ]);
    expect(
      useLibraryStore
        .getState()
        .playlists.find((p) => p.id === created.id)
        ?.tracks.map((entry) => entry.track.id),
    ).toEqual([trackC.id, trackA.id, trackB.id]);
  });

  it("rolls the partial playlist back and rejects on a mid-sequence failure", async () => {
    const spy = vi
      .spyOn(repositories.playlists, "addTrack")
      .mockRejectedValueOnce(new Error("mid-sequence write failed"));

    await expect(
      useLibraryStore.getState().createPlaylistFromResolved({
        name: "Broken import",
        tracks: [trackA, trackB, trackC],
      }),
    ).rejects.toThrow("mid-sequence write failed");
    spy.mockRestore();

    expect(await repositories.playlists.list()).toHaveLength(0);
    expect(useLibraryStore.getState().playlists).toHaveLength(0);
  });
});
