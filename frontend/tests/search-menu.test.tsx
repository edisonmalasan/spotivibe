import "fake-indexeddb/auto";
import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "@/app/search/page";
import type { Track } from "@/data/repositories";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { useQueueStore } from "@/stores/queueStore";
import { resetRadioStore, useRadioStore } from "@/stores/radioStore";
import { resetSearchStore, useSearchStore } from "@/stores/searchStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Context-action coverage (tasks 5.1–5.4, spec "Result context actions")
 * against the real (fake-indexeddb) local-data layer: menu mechanics,
 * repository-persisted likes, playlist add/inline create, the go-to
 * navigation that opens the real artist/album surfaces (M9 task 6.1), and
 * M10's "Start track radio" item.
 */

// Rendering + IndexedDB round-trips can exceed the 1s default on a cold
// jsdom worker (same reason as settings-ui.test.tsx).
configure({ asyncUtilTimeout: 5000 });

const nav = vi.hoisted(() => ({
  q: "",
  back: vi.fn(),
  forward: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(nav.q === "" ? {} : { q: nav.q }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const trackA = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Karma Police",
  artists: [{ name: "Radiohead" }],
  album: { title: "OK Computer" },
});
const trackB = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Weird Fishes",
  artists: [{ name: "Radiohead" }],
  album: { title: "In Rainbows" },
});

function okResponse(tracks: Track[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ tracks, diagnostics: {} }),
  } as unknown as Response;
}

function stubSuccessfulFetch(tracks: Track[]) {
  const mock = vi.fn(async () => okResponse(tracks));
  vi.stubGlobal("fetch", mock);
  return mock;
}

let repositories: RepositorySet;

beforeEach(async () => {
  resetSearchStore();
  resetPlayerStore();
  resetLibraryStore();
  resetRadioStore();
  nav.q = "";
  repositories = await getLocalData();
  await repositories.resetAll();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Render the Search route with results for "radio" and await the surface. */
async function renderResults(): Promise<void> {
  stubSuccessfulFetch([trackA, trackB]);
  nav.q = "radio";
  render(<SearchPage />);
  await screen.findByTestId("search-results");
}

function openMenuFor(title: string): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: `More options for ${title}` }));
  return screen.getByRole("menu", { name: `Actions for ${title}` });
}

describe("result menu (task 5.1)", () => {
  it("opens from its trigger, lists items in DOM order, and moves focus into the menu", async () => {
    await renderResults();

    const trigger = screen.getByRole("button", { name: "More options for Karma Police" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    const items = within(openMenuFor("Karma Police")).getAllByRole("menuitem"); // opens the menu
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // Every pre-M10 item keeps its position; M10's radio item is appended last,
    // because it is the only one that replaces what plays.
    expect(items.map((item) => item.textContent)).toEqual([
      "Play",
      "Save to Liked Songs",
      "Add to queue",
      "Add to playlist",
      "Go to artist",
      "Go to album",
      "Start track radio",
    ]);
    expect(items[0]).toHaveFocus(); // keyboard users land on the first item
  });

  it("closes on Escape with focus returned to the trigger, and on outside press", async () => {
    await renderResults();

    const trigger = screen.getByRole("button", { name: "More options for Karma Police" });
    openMenuFor("Karma Police");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    openMenuFor("Karma Police");
    fireEvent.mouseDown(document.body); // outside press
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("dispatches item activation, starting playback for the Play item", async () => {
    await renderResults();

    const [playItem] = within(openMenuFor("Karma Police")).getAllByRole("menuitem");
    fireEvent.click(playItem);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument(); // menu closes
    expect(usePlayerStore.getState().status).toBe("loading");
    expect(usePlayerStore.getState().currentTrack?.id).toBe(trackA.id);
  });
});

describe("like action (task 5.2)", () => {
  it("persists a like through the repository and unlikes back to baseline", async () => {
    await renderResults();

    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Save to Liked Songs" }));

    await waitFor(async () => {
      expect(await repositories.likedTracks.isLiked(trackA.id)).toBe(true);
    });

    // Reopen: the menu reflects the persisted state, and toggling removes it.
    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove from Liked Songs" }));

    await waitFor(async () => {
      expect(await repositories.likedTracks.isLiked(trackA.id)).toBe(false);
    });
    expect(await repositories.likedTracks.list()).toHaveLength(0);
  });

  it("shows the persisted like after the surface remounts (spec: like survives reload)", async () => {
    stubSuccessfulFetch([trackA, trackB]);
    nav.q = "radio";
    const first = render(<SearchPage />);
    await screen.findByTestId("search-results");

    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Save to Liked Songs" }));
    await waitFor(async () => {
      expect(await repositories.likedTracks.isLiked(trackA.id)).toBe(true);
    });

    // Simulated reload: tear the whole surface down and mount it fresh, so
    // nothing from the previous mount's state survives.
    first.unmount();
    render(<SearchPage />);
    await screen.findByTestId("search-results");

    // useLikedTracks re-reads likedTracks.list() on mount, so the fresh menu
    // reflects the persisted like (label flips once the read settles).
    fireEvent.click(openMenuFor("Karma Police"));
    expect(
      await screen.findByRole("menuitem", { name: "Remove from Liked Songs" }),
    ).toBeInTheDocument();
    expect(await repositories.likedTracks.list()).toHaveLength(1);
  });

  it("reflects a like toggled elsewhere without a remount (design §11)", async () => {
    await renderResults();

    // Another surface (e.g. Now Playing) likes the track through the store.
    await useLibraryStore.getState().toggleLike(trackB);

    fireEvent.click(openMenuFor("Weird Fishes"));
    expect(
      await screen.findByRole("menuitem", { name: "Remove from Liked Songs" }),
    ).toBeInTheDocument();
    expect(await repositories.likedTracks.isLiked(trackB.id)).toBe(true);
  });
});

describe("add to queue (task 7.1)", () => {
  it("appends once with duplicate protection, closes the menu, and leaves playback untouched", async () => {
    await renderResults();

    // A track is already playing with its own context (spec scenario).
    usePlayerStore.getState().playTrack(trackA, [trackA]);
    usePlayerStore.setState({ positionSeconds: 42 });
    const statusBefore = usePlayerStore.getState().status;

    fireEvent.click(openMenuFor("Weird Fishes"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to queue" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(useQueueStore.getState().queue.map((entry) => entry.id)).toEqual([trackA.id, trackB.id]);

    // Duplicate protection: the same result again appends nothing.
    fireEvent.click(openMenuFor("Weird Fishes"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to queue" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(useQueueStore.getState().queue).toHaveLength(2);

    const after = usePlayerStore.getState();
    expect(after.currentTrack?.id).toBe(trackA.id);
    expect(after.status).toBe(statusBefore);
    expect(after.positionSeconds).toBe(42);
  });
});

describe("start track radio (M10 task 5.2)", () => {
  /**
   * Answer the search endpoint as before and the radio endpoint with real
   * material, so the item runs the whole request path rather than a mocked
   * outcome: the assertion is that the *real* engine replaced the queue.
   */
  function stubRadioFeed(radioTracks: Track[]): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        const body = url.pathname === "/api/radio" ? { tracks: radioTracks, variant: 0 } : null;
        return {
          ok: true,
          status: 200,
          json: async () => body ?? { tracks: [trackA, trackB], diagnostics: {} },
        } as unknown as Response;
      }),
    );
  }

  it("starts a radio for that result, closes the menu, and leaves every other item intact", async () => {
    const radioTracks = [
      makeTrack({ id: "youtube:r1", providerId: "r1", title: "Radio One" }),
      makeTrack({ id: "youtube:r2", providerId: "r2", title: "Radio Two" }),
    ];
    await renderResults();
    stubRadioFeed(radioTracks);

    // Something is already playing, so "the queue is replaced" is observable.
    usePlayerStore.getState().playTrack(trackB, [trackA, trackB]);

    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Start track radio" }));

    // The menu dismisses immediately — the action never waits on the network.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await waitFor(() => expect(useRadioStore.getState().seed).not.toBeNull());

    // A radio for *that* result: the queue is the radio's own tracks under the
    // radio source, and playback started on its first track.
    expect(useRadioStore.getState().seed).toEqual({ kind: "track", track: trackA });
    expect(useQueueStore.getState().source).toBe("radio");
    expect(useQueueStore.getState().queue.map((track) => track.id)).toEqual([
      radioTracks[0].id,
      radioTracks[1].id,
    ]);
    expect(usePlayerStore.getState().currentTrack?.id).toBe(radioTracks[0].id);

    // Every prior item is still there, in order, and still works.
    fireEvent.click(openMenuFor("Karma Police"));
    expect(
      within(screen.getByRole("menu", { name: "Actions for Karma Police" }))
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Play",
      "Save to Liked Songs",
      "Add to queue",
      "Add to playlist",
      "Go to artist",
      "Go to album",
      "Start track radio",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Save to Liked Songs" }));
    await waitFor(async () => {
      expect(await repositories.likedTracks.isLiked(trackA.id)).toBe(true);
    });
  });

  it("leaves the current queue and playback alone when the provider answers nothing", async () => {
    await renderResults();
    stubRadioFeed([]);

    usePlayerStore.getState().playTrack(trackB, [trackA, trackB]);
    usePlayerStore.setState({ positionSeconds: 17 });

    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Start track radio" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // A refused start is a no-op, not a half-started radio.
    expect(useRadioStore.getState().seed).toBeNull();
    expect(useQueueStore.getState().source).toBe("unknown");
    expect(useQueueStore.getState().queue.map((track) => track.id)).toEqual([trackA.id, trackB.id]);
    expect(usePlayerStore.getState().currentTrack?.id).toBe(trackB.id);
    expect(usePlayerStore.getState().positionSeconds).toBe(17);
  });
});

describe("playlist picker (task 5.3)", () => {
  it("appends the track to a chosen existing playlist", async () => {
    const playlist = await repositories.playlists.create({ name: "Road Trip" });
    await renderResults();

    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to playlist" }));

    const dialog = await screen.findByRole("dialog", { name: "Add to playlist" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Road Trip" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const stored = await repositories.playlists.get(playlist.id);
    expect(stored?.tracks.map((entry) => entry.track.id)).toEqual([trackA.id]);
  });

  it("creates a playlist inline and adds the track to it", async () => {
    await renderResults();

    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to playlist" }));

    const dialog = await screen.findByRole("dialog", { name: "Add to playlist" });
    expect(
      await within(dialog).findByText("No playlists yet — create one below."),
    ).toBeInTheDocument();

    fireEvent.change(within(dialog).getByPlaceholderText("Playlist name"), {
      target: { value: "Fresh Mix" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create and add" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const playlists = await repositories.playlists.list();
    expect(playlists.map((entry) => entry.name)).toEqual(["Fresh Mix"]);
    expect(playlists[0].tracks.map((entry) => entry.track.id)).toEqual([trackA.id]);
  });

  it("reports a duplicate add without changing the playlist (design §11)", async () => {
    const playlist = await repositories.playlists.create({ name: "Road Trip" });
    await repositories.playlists.addTrack(playlist.id, trackA);
    await renderResults();

    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to playlist" }));

    const dialog = await screen.findByRole("dialog", { name: "Add to playlist" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Road Trip" }));

    // The picker stays open and reports the duplicate inline.
    expect(await within(dialog).findByRole("status")).toHaveTextContent(/Already in playlist/);
    const stored = await repositories.playlists.get(playlist.id);
    expect(stored?.tracks.map((entry) => entry.track.id)).toEqual([trackA.id]);

    // Dismissing returns focus to the trigger as with any other close path.
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses on Escape and on the close control, returning focus to the trigger", async () => {
    await renderResults();
    const trigger = screen.getByRole("button", { name: "More options for Karma Police" });

    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to playlist" }));
    await screen.findByRole("dialog", { name: "Add to playlist" });

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to playlist" }));
    const dialog = await screen.findByRole("dialog", { name: "Add to playlist" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("go to artist / go to album (task 5.4)", () => {
  it("opens the artist route instead of refining the query", async () => {
    const fetchMock = await renderResultsWithFetch();

    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Go to artist" }));

    expect(nav.push).toHaveBeenCalledWith("/artist/Radiohead");
    // The search is left alone: no refined query, no re-issued request, no URL write.
    expect(useSearchStore.getState().query).toBe("radio");
    expect(nav.replace).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("opens the album route instead of refining the query", async () => {
    const fetchMock = await renderResultsWithFetch();

    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Go to album" }));

    expect(nav.push).toHaveBeenCalledWith("/album/OK%20Computer%20-%20Radiohead");
    expect(useSearchStore.getState().query).toBe("radio");
    expect(nav.replace).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

async function renderResultsWithFetch(): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = stubSuccessfulFetch([trackA, trackB]);
  nav.q = "radio";
  render(<SearchPage />);
  await screen.findByTestId("search-results");
  return fetchMock;
}
