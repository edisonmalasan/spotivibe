import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistRecord, Track } from "@/data/repositories";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { LibraryView } from "@/features/library/LibraryView";
import { PLAYLIST_SAVE_ERROR } from "@/features/playlists/PlaylistFormDialog";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Library surface coverage (tasks 5.1–5.3, design §3/§4): the `/library`
 * sections rendered from local storage (Liked Songs entry, playlist grid,
 * counts, navigation), the empty state with its actions, the local filter
 * (narrowing, no-matches, restore), and the Create playlist dialog (a11y
 * contract, immediate appearance + persistence, failure reporting) — all
 * against the real fake-indexeddb repositories.
 */

// Cold fake-indexeddb hydration can exceed the 1s default (settings precedent).
configure({ asyncUtilTimeout: 5000 });

// next/link renders plain anchors so navigation targets are assertable.
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

// The hosted import dialog reads the router; only mounted on demand here.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn() }),
}));

const originalCreatePlaylist = useLibraryStore.getState().createPlaylist;

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Karma Police" });
const trackB = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Weird Fishes" });

let repositories: RepositorySet;

beforeEach(async () => {
  resetLibraryStore();
  repositories = await getLocalData();
  await repositories.resetAll();
});

afterEach(() => {
  vi.restoreAllMocks();
  // Restore the action a failure test may have spied (a later spy copy can
  // outlive restoreAllMocks on zustand's replaced state object).
  useLibraryStore.setState({ createPlaylist: originalCreatePlaylist });
});

async function seedPlaylist(name: string, tracks: Track[] = []): Promise<PlaylistRecord> {
  const created = await repositories.playlists.create({ name });
  for (const track of tracks) {
    await repositories.playlists.addTrack(created.id, track);
  }
  return created;
}

describe("library surface (tasks 5.1–5.2)", () => {
  it("shows the explanatory empty state with its filter and actions", async () => {
    render(<LibraryView />);

    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();
    expect(
      screen.getByText("Songs, albums, and playlists you save will appear here."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Your Library" })).toBeInTheDocument();
    expect(screen.getByLabelText("Filter your library")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create playlist" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import playlist" })).toBeInTheDocument();
    // No playlist grid while the library is empty.
    expect(screen.queryByRole("link", { name: /Liked Songs/ })).not.toBeInTheDocument();
  });

  it("renders the Liked Songs entry and playlist grid from local storage", async () => {
    await repositories.likedTracks.like(trackA);
    const roadTrip = await seedPlaylist("Road Trip", [trackA, trackB]);
    await seedPlaylist("Focus");

    render(<LibraryView />);

    const likedLink = await screen.findByRole("link", { name: /Liked Songs/ });
    expect(likedLink).toHaveAttribute("href", "/library/liked");
    expect(likedLink).toHaveTextContent("1 song");

    const roadLink = screen.getByRole("link", { name: /Road Trip/ });
    expect(roadLink).toHaveAttribute("href", `/playlist/${roadTrip.id}`);
    expect(roadLink).toHaveTextContent("2 songs");

    expect(screen.getByRole("link", { name: /Focus/ })).toHaveTextContent("0 songs");
  });

  it("filters by name, shows a no-matches line, and restores on clear", async () => {
    await seedPlaylist("Road Trip", [trackA]);
    await seedPlaylist("Focus");

    render(<LibraryView />);
    expect(await screen.findByRole("link", { name: /Road Trip/ })).toBeInTheDocument();

    const filter = screen.getByLabelText("Filter your library");
    fireEvent.change(filter, { target: { value: "road" } });
    expect(screen.getByRole("link", { name: /Road Trip/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Focus/ })).not.toBeInTheDocument();
    // The Liked Songs entry participates in the filter by its title.
    expect(screen.queryByRole("link", { name: /Liked Songs/ })).not.toBeInTheDocument();

    fireEvent.change(filter, { target: { value: "zzz" } });
    expect(screen.queryByRole("link", { name: /Road Trip/ })).not.toBeInTheDocument();
    expect(screen.getByText("No matches")).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: "" } });
    expect(screen.getByRole("link", { name: /Road Trip/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Focus/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Liked Songs/ })).toBeInTheDocument();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });
});

describe("create playlist dialog (task 5.3)", () => {
  it("creates through the store: appears immediately, persists, returns focus", async () => {
    render(<LibraryView />);
    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Create playlist" });
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Create playlist" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus(); // keyboard users land inside the surface

    // Name required: the submit starts disabled and blocks an empty programmatic submit.
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("Name").closest("form") as HTMLFormElement);
    expect(await repositories.playlists.list()).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Road Trip" } });
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "Windows down." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    // The card appears in the surface without a reload (store updates live).
    const card = await screen.findByRole("link", { name: /Road Trip/ });
    expect(card).toHaveTextContent("0 songs");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const stored = await repositories.playlists.list();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Road Trip");
    expect(stored[0].description).toBe("Windows down.");

    // Focus returns to the header control that opened the dialog.
    expect(screen.getByRole("button", { name: "Create playlist" })).toHaveFocus();
  });

  it("honors the dismissal contract: Escape closes and returns focus", async () => {
    render(<LibraryView />);
    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Create playlist" });
    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog", { name: "Create playlist" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(await repositories.playlists.list()).toHaveLength(0); // cancel has no effect
  });

  it("surfaces a save failure without creating anything and stays live", async () => {
    vi.spyOn(useLibraryStore.getState(), "createPlaylist").mockRejectedValueOnce(
      new Error("disk full"),
    );
    render(<LibraryView />);
    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create playlist" }));
    fireEvent.change(await screen.findByLabelText("Name"), {
      target: { value: "Doomed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(PLAYLIST_SAVE_ERROR);
    expect(await repositories.playlists.list()).toHaveLength(0);
    // The dialog survives for another attempt with the typed name intact.
    expect(screen.getByRole("dialog", { name: "Create playlist" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Doomed");
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });
});
