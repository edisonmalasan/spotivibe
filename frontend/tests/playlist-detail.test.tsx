import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/data/repositories";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { PlaylistDetailView } from "@/features/playlists/PlaylistDetailView";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Playlist detail coverage (tasks 7.1–7.3, design §2–§6): hero metadata with
 * derived/placeholder cover and the recoverable not-found state, the toolbar
 * (play-all/shuffle context + source, edit persisting with unchanged
 * identity/membership, both delete branches with navigation), and the ordered
 * track rows (drag == keyboard order, immediate persistence across a fresh
 * hydration, boundary controls, accessible names, transport untouched while
 * playing) — all against the real fake-indexeddb repositories.
 */

// Cold fake-indexeddb hydration can exceed the 1s default (settings precedent).
configure({ asyncUtilTimeout: 5000 });

const nav = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const alpha = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Alpha",
  durationSeconds: 180,
});
const beta = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Beta",
  durationSeconds: 200,
});
const gamma = makeTrack({
  id: "youtube:ccc",
  providerId: "ccc",
  title: "Gamma",
  durationSeconds: undefined, // contributes nothing to the duration sum
});

const dataTransfer = () => ({
  effectAllowed: "",
  dropEffect: "",
  setData: vi.fn(),
  getData: vi.fn(() => ""),
});

let repositories: RepositorySet;

beforeEach(async () => {
  vi.clearAllMocks();
  resetLibraryStore();
  resetPlayerStore();
  resetQueueStore();
  repositories = await getLocalData();
  await repositories.resetAll();
});

async function seedPlaylist(name: string, tracks: Track[], description?: string): Promise<string> {
  const created = await repositories.playlists.create({ name, description });
  for (const track of tracks) {
    await repositories.playlists.addTrack(created.id, track);
  }
  return created.id;
}

/** Stored membership/order of one playlist, in array order. */
function trackOrder(id: string): string[] {
  return (
    useLibraryStore
      .getState()
      .playlists.find((playlist) => playlist.id === id)
      ?.tracks.map((entry) => entry.track.id) ?? []
  );
}

function rows(): HTMLElement[] {
  return screen.getAllByTestId("playlist-track-row");
}

async function openDetail(id: string): Promise<void> {
  render(<PlaylistDetailView playlistId={id} />);
  // The h1 only renders once hydration settles with the playlist present.
  await screen.findByRole("heading", { level: 1 });
}

describe("playlist detail hero (task 7.1)", () => {
  it("renders the hero with derived cover, description, count, and duration", async () => {
    const id = await seedPlaylist("Road Trip", [alpha, beta, gamma], "Windows down.");

    const { container } = render(<PlaylistDetailView playlistId={id} />);

    expect(await screen.findByRole("heading", { level: 1, name: "Road Trip" })).toBeInTheDocument();
    expect(screen.getByText("Windows down.")).toBeInTheDocument();
    // Gamma reports no duration — 180 + 200 = 380s → "6 min", count included.
    expect(screen.getByText("Playlist • 3 songs • 6 min")).toBeInTheDocument();
    // The hero cover derives from distinct track artwork (all rows' images too).
    expect(container.querySelector("img")).not.toBeNull();

    // Opening the surface never autoplays (spec: activation only).
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(usePlayerStore.getState().status).toBe("idle");
    expect(useQueueStore.getState().queue).toHaveLength(0);
  });

  it("falls back to the placeholder cover when no artwork exists", async () => {
    const bareA = { ...alpha, artwork: [] };
    const bareB = { ...beta, artwork: [] };
    const id = await seedPlaylist("Bare Mix", [bareA, bareB]);

    const { container } = render(<PlaylistDetailView playlistId={id} />);

    expect(await screen.findByRole("heading", { level: 1, name: "Bare Mix" })).toBeInTheDocument();
    expect(screen.getByText("Playlist • 2 songs • 6 min")).toBeInTheDocument();
    // No image anywhere → the styled placeholder tile renders instead.
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows a recoverable not-found state for an unknown id", async () => {
    render(<PlaylistDetailView playlistId="does-not-exist" />);

    expect(await screen.findByText("Playlist not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Your Library" })).toHaveAttribute(
      "href",
      "/library",
    );
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull(); // no blank/error page
  });

  it("explains an empty playlist and disables its bulk controls", async () => {
    const id = await seedPlaylist("Empty Mix", []);

    await openDetail(id);

    expect(screen.getByText("No tracks yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Shuffle" })).toBeDisabled();
  });
});

describe("playlist toolbar (task 7.2)", () => {
  it("play all adopts the ordered playlist with the library source", async () => {
    const id = await seedPlaylist("Road Trip", [alpha, beta, gamma]);
    await openDetail(id);

    fireEvent.click(screen.getByRole("button", { name: "Play all" }));

    expect(useQueueStore.getState().queue.map((track) => track.id)).toEqual([
      alpha.id,
      beta.id,
      gamma.id,
    ]);
    expect(useQueueStore.getState().queueIndex).toBe(0);
    expect(useQueueStore.getState().source).toBe("library");
    expect(useQueueStore.getState().shuffle).toBe(false); // plain play-all leaves shuffle alone
    expect(usePlayerStore.getState().currentTrack?.id).toBe(alpha.id);
  });

  it("shuffle enables shuffle and starts within the playlist", async () => {
    const id = await seedPlaylist("Road Trip", [alpha, beta, gamma]);
    await openDetail(id);

    fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));

    expect(useQueueStore.getState().shuffle).toBe(true);
    expect(useQueueStore.getState().source).toBe("library");
    expect(useQueueStore.getState().queueIndex).toBe(0);
    expect(usePlayerStore.getState().currentTrack?.id).toBe(alpha.id);
  });

  it("edits persist with unchanged identity and membership", async () => {
    const id = await seedPlaylist("Road Trip", [alpha, beta], "Windows down.");
    await openDetail(id);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit playlist" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("Name")).toHaveValue("Road Trip"); // prefilled
    expect(screen.getByLabelText("Description (optional)")).toHaveValue("Windows down.");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Road Trip 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(
      await screen.findByRole("heading", { level: 1, name: "Road Trip 2" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus(); // focus returns

    const stored = await repositories.playlists.get(id);
    expect(stored?.id).toBe(id); // immutable id
    expect(stored?.name).toBe("Road Trip 2");
    expect(stored?.description).toBe("Windows down.");
    expect(stored?.tracks.map((entry) => entry.track.id)).toEqual([alpha.id, beta.id]); // membership + order
  });

  it("cancels deletion without effect and confirms deletion with navigation", async () => {
    const id = await seedPlaylist("Road Trip", [alpha]);
    await openDetail(id);

    // Cancel branch: nothing changes anywhere.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const cancelDialog = await screen.findByRole("dialog", { name: "Delete playlist?" });
    fireEvent.click(within(cancelDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await repositories.playlists.get(id)).toBeDefined();
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Road Trip" })).toBeInTheDocument();

    // Confirm branch: removed everywhere and navigated back to the library.
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "Delete playlist?" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/library"));
    expect(await repositories.playlists.get(id)).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("playlist tracks (task 7.3)", () => {
  it("produces the identical order from dragging as from the move controls", async () => {
    // Pointer path: drag Beta down onto Gamma.
    const pointerId = await seedPlaylist("Road Trip", [alpha, beta, gamma]);
    const pointer = render(<PlaylistDetailView playlistId={pointerId} />);
    await screen.findByRole("heading", { level: 1, name: "Road Trip" });
    const pointerRows = rows();
    fireEvent.dragStart(pointerRows[1], { dataTransfer: dataTransfer() });
    fireEvent.dragOver(pointerRows[2], { dataTransfer: dataTransfer() });
    fireEvent.drop(pointerRows[2], { dataTransfer: dataTransfer() });
    await waitFor(() => expect(trackOrder(pointerId)).toEqual([alpha.id, gamma.id, beta.id]));
    const pointerOrder = trackOrder(pointerId);
    pointer.unmount();

    // Keyboard path: the same single move via the move control, fresh database.
    await repositories.resetAll();
    resetLibraryStore();
    const keyboardId = await seedPlaylist("Road Trip", [alpha, beta, gamma]);
    await openDetail(keyboardId);
    const keyRows = rows();
    fireEvent.click(within(keyRows[1]).getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(trackOrder(keyboardId)).toEqual([alpha.id, gamma.id, beta.id]));
    expect(trackOrder(keyboardId)).toEqual(pointerOrder);
  });

  it("removes a track through the row control and persists the result", async () => {
    const id = await seedPlaylist("Road Trip", [alpha, beta, gamma]);
    await openDetail(id);

    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Remove Alpha from playlist" }));
    await waitFor(() => expect(trackOrder(id)).toEqual([beta.id, gamma.id]));

    // Persisted immediately: a fresh repository read shows the same result.
    const stored = await repositories.playlists.get(id);
    expect(stored?.tracks.map((entry) => entry.track.id)).toEqual([beta.id, gamma.id]);
    // Positions renumber after the removal.
    expect(rows()[0]).toHaveAttribute("data-track-id", beta.id);
    expect(within(rows()[0]).getByRole("button", { name: "Play Beta" })).toBeInTheDocument();
  });

  it("keeps removal and reorder across a reload (fresh hydration)", async () => {
    const id = await seedPlaylist("Road Trip", [alpha, beta, gamma]);
    const view = render(<PlaylistDetailView playlistId={id} />);
    await screen.findByRole("heading", { level: 1, name: "Road Trip" });

    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(trackOrder(id)).toEqual([beta.id, alpha.id, gamma.id]));
    fireEvent.click(within(rows()[2]).getByRole("button", { name: "Remove Gamma from playlist" }));
    await waitFor(() => expect(trackOrder(id)).toEqual([beta.id, alpha.id]));

    // Reload: unmount, drop all store state, and mount fresh — the surface
    // re-reads storage from scratch.
    view.unmount();
    resetLibraryStore();
    render(<PlaylistDetailView playlistId={id} />);
    await screen.findByRole("heading", { level: 1, name: "Road Trip" });
    expect(trackOrder(id)).toEqual([beta.id, alpha.id]);
    expect(rows().map((row) => row.dataset.trackId)).toEqual([beta.id, alpha.id]);
  });

  it("disables boundary move controls and exposes accessible row names", async () => {
    const id = await seedPlaylist("Road Trip", [alpha, beta, gamma]);
    await openDetail(id);
    const [first, , last] = rows();

    expect(within(first).getByRole("button", { name: "Play Alpha" })).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(first).getByRole("button", { name: "Move down" })).toBeEnabled();
    expect(
      within(first).getByRole("button", { name: "Remove Alpha from playlist" }),
    ).toBeInTheDocument();

    expect(within(last).getByRole("button", { name: "Move down" })).toBeDisabled();
    expect(within(last).getByRole("button", { name: "Move up" })).toBeEnabled();
  });

  it("leaves transport untouched across reorder and removal while playing", async () => {
    const id = await seedPlaylist("Road Trip", [alpha, beta, gamma]);
    await openDetail(id);

    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Play Alpha" }));
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
    expect(before.currentTrack?.id).toBe(alpha.id);

    fireEvent.click(within(rows()[1]).getByRole("button", { name: "Move down" }));
    await waitFor(() => expect(trackOrder(id)).toEqual([alpha.id, gamma.id, beta.id]));
    fireEvent.click(within(rows()[0]).getByRole("button", { name: "Remove Alpha from playlist" }));
    await waitFor(() => expect(trackOrder(id)).toEqual([gamma.id, beta.id]));

    expect(snapshot()).toEqual(before);
  });
});
