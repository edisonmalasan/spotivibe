import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "@/app/search/page";
import type { Track } from "@/data/repositories";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { useQueueStore } from "@/stores/queueStore";
import { resetSearchStore, useSearchStore } from "@/stores/searchStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Context-action coverage (tasks 5.1–5.4, spec "Result context actions")
 * against the real (fake-indexeddb) local-data layer: menu mechanics,
 * repository-persisted likes, playlist add/inline create, and menu-driven
 * query refinement.
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
    expect(items.map((item) => item.textContent)).toEqual([
      "Play",
      "Save to Liked Songs",
      "Add to queue",
      "Add to playlist",
      "Go to artist",
      "Go to album",
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
  it("refines the query to the artist name and re-issues the search", async () => {
    const fetchMock = await renderResultsWithFetch();

    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Go to artist" }));

    expect(useSearchStore.getState().query).toBe("Radiohead");

    await waitFor(() => {
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe("/api/search?q=Radiohead&limit=20");
    });
    // Results re-derive for the refined query (exact artist match → Top Result).
    await screen.findByTestId("top-result");
    expect(nav.replace).toHaveBeenCalledWith("/search?q=Radiohead");
  });

  it("refines the query to the album name when album metadata exists", async () => {
    const fetchMock = await renderResultsWithFetch();

    fireEvent.click(openMenuFor("Karma Police"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Go to album" }));

    expect(useSearchStore.getState().query).toBe("OK Computer");

    await waitFor(() => {
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe("/api/search?q=OK%20Computer&limit=20");
    });
    await screen.findByTestId("top-result"); // exact album match renders as Top Result
  });
});

async function renderResultsWithFetch(): Promise<ReturnType<typeof vi.fn>> {
  const fetchMock = stubSuccessfulFetch([trackA, trackB]);
  nav.q = "radio";
  render(<SearchPage />);
  await screen.findByTestId("search-results");
  return fetchMock;
}
