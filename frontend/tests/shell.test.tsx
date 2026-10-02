import "fake-indexeddb/auto";
import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { makeTrack } from "./helpers/music-fixtures";

const routerMock = vi.hoisted(() => ({
  back: vi.fn(),
  forward: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
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

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  usePathname: () => "/",
}));

// Cold fake-indexeddb hydration can exceed the 1s default (settings precedent).
configure({ asyncUtilTimeout: 5000 });

let repositories: RepositorySet;

beforeEach(async () => {
  resetLibraryStore();
  repositories = await getLocalData();
  await repositories.resetAll();
  // Drain any hydration still in flight from the previous test, so this
  // test's render starts a fresh read against the freshly reset database.
  await useLibraryStore.getState().hydrate();
});

describe("AppShell", () => {
  it("exposes the shell landmarks (banner, navigation, main, complementary)", () => {
    render(<AppShell>page content</AppShell>);

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("keeps the player regions mounted across children (route) changes", () => {
    const { rerender, container } = render(<AppShell>Home page</AppShell>);
    const playerBar = container.querySelector('[data-testid="player-bar"]');
    const miniPlayer = container.querySelector('[data-testid="mini-player"]');
    expect(playerBar).not.toBeNull();
    expect(miniPlayer).not.toBeNull();

    rerender(<AppShell>Search page</AppShell>);

    expect(container.querySelector('[data-testid="player-bar"]')).toBe(playerBar);
    expect(container.querySelector('[data-testid="mini-player"]')).toBe(miniPlayer);
    expect(screen.getByText("Search page")).toBeInTheDocument();
  });

  it("applies the mutually-exclusive responsive variant class contract", () => {
    const { container } = render(<AppShell>page</AppShell>);

    const sidebar = container.querySelector("aside");
    expect(sidebar!.className).toContain("hidden");
    expect(sidebar!.className).toContain("lg:flex");
    expect(sidebar!.className).toContain("w-[340px]");

    const playerBar = container.querySelector('[data-testid="player-bar"]')!;
    expect(playerBar.className).toContain("hidden");
    expect(playerBar.className).toContain("lg:flex");

    const compact = container.querySelector('[data-testid="compact-shell"]')!;
    expect(compact.className).toContain("lg:hidden");
  });

  it("scrolls main content while the shell regions stay fixed", () => {
    const { container } = render(<AppShell>long page</AppShell>);
    const shell = container.firstElementChild!;

    expect(shell.className).toContain("h-dvh");
    expect(shell.className).toContain("overflow-hidden");

    const main = container.querySelector("main")!;
    expect(main.className).toContain("overflow-y-auto");
  });
});

describe("TopBar", () => {
  it("renders the 64px top bar with branding, navigation arrows, and search", () => {
    render(<AppShell>page</AppShell>);
    const banner = screen.getByRole("banner");

    expect(banner.className).toContain("h-16");
    expect(banner.className).toContain("bg-void-black");
    expect(screen.getByRole("link", { name: "Spotivibe" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go forward" })).toBeInTheDocument();
    // M18 (design decision 6): the top-bar field is the application's only
    // combobox, so it announces that role rather than `searchbox`. The three
    // filter fields elsewhere still announce `searchbox`.
    expect(screen.getByRole("combobox", { name: "Search" })).toBeInTheDocument();
  });

  it("wires the navigation arrows to browser history", () => {
    render(<AppShell>page</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(routerMock.back).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Go forward" }));
    expect(routerMock.forward).toHaveBeenCalledTimes(1);
  });

  it("exposes a settings control with a non-empty accessible name", () => {
    render(<AppShell>page</AppShell>);

    const settings = screen.getByRole("link", { name: "Settings" });
    expect(settings.getAttribute("href")).toBe("/settings");
    expect(settings.getAttribute("aria-label")?.trim().length).toBeGreaterThan(0);
  });
});

describe("Sidebar", () => {
  it("renders the Your Library panel with prompt cards and pill actions", () => {
    render(<AppShell>page</AppShell>);
    const sidebar = screen.getByRole("complementary");

    expect(screen.getByRole("heading", { level: 2, name: "Your Library" })).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("button", { name: "Add to Your Library" }),
    ).toBeInTheDocument();

    expect(
      within(sidebar).getByRole("heading", { name: "Start your library" }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole("heading", { name: "Discover something new" }),
    ).toBeInTheDocument();

    const libraryCta = within(sidebar).getByRole("link", { name: "Open library" });
    expect(libraryCta).toHaveAttribute("href", "/library");
    expect(libraryCta.className).toContain("rounded-buttons");
    expect(libraryCta.className).toContain("bg-pure-white");

    expect(within(sidebar).getByRole("link", { name: "Search now" })).toHaveAttribute(
      "href",
      "/search",
    );
  });

  it("hovers the elevated prompt cards to the #292929 card-hover surface", () => {
    render(<AppShell>page</AppShell>);
    const card = screen.getByRole("heading", { name: "Start your library" }).parentElement!;

    expect(card.className).toContain("bg-graphite");
    // M19 replaced the raw `transition-colors` with the vocabulary's hover feedback. The
    // assertion is kept rather than dropped: a card that stopped responding to a pointer
    // would otherwise look identical here.
    expect(card.className).toContain("motion-feedback");
    expect(card.className).toContain("hover:bg-smoke");
  });

  it("lists Liked Songs and playlist entries with navigation when populated (task 8.1)", async () => {
    await repositories.likedTracks.like(
      makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" }),
    );
    const playlist = await repositories.playlists.create({ name: "Road Trip" });

    render(<AppShell>page</AppShell>);
    const sidebar = screen.getByRole("complementary");

    const likedEntry = await within(sidebar).findByRole("link", { name: "Liked Songs" });
    expect(likedEntry).toHaveAttribute("href", "/library/liked");
    expect(within(sidebar).getByRole("link", { name: "Road Trip" })).toHaveAttribute(
      "href",
      `/playlist/${playlist.id}`,
    );
    // The guidance cards are replaced once the library has content.
    expect(
      within(sidebar).queryByRole("heading", { name: "Start your library" }),
    ).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole("link", { name: "Open library" })).not.toBeInTheDocument();
  });

  it("shows entries appearing and disappearing without a reload (task 8.1)", async () => {
    render(<AppShell>page</AppShell>);
    expect(screen.getByRole("heading", { name: "Start your library" })).toBeInTheDocument();

    // Live create: the entry replaces the prompts with no remount.
    let createdId = "";
    await act(async () => {
      createdId = (await useLibraryStore.getState().createPlaylist({ name: "Road Trip" })).id;
    });
    expect(await screen.findByRole("link", { name: "Road Trip" })).toHaveAttribute(
      "href",
      `/playlist/${createdId}`,
    );
    expect(screen.queryByRole("heading", { name: "Start your library" })).not.toBeInTheDocument();

    // Live delete: the prompts return, again with no remount.
    await act(async () => {
      await useLibraryStore.getState().deletePlaylist(createdId);
    });
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Road Trip" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "Start your library" })).toBeInTheDocument();
  });

  it("opens the create dialog from the + control and shows the new entry (task 8.2)", async () => {
    render(<AppShell>page</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "Add to Your Library" }));
    const dialog = await screen.findByRole("dialog", { name: "Create playlist" });
    expect(dialog).toHaveAttribute("aria-modal", "true");

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Night Drive" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("link", { name: "Night Drive" })).toBeInTheDocument();
    // Focus returns to the opener, and the playlist was persisted through the store.
    expect(screen.getByRole("button", { name: "Add to Your Library" })).toHaveFocus();
    expect((await repositories.playlists.list()).map((entry) => entry.name)).toEqual([
      "Night Drive",
    ]);
  });
});

describe("Compact shell", () => {
  it("renders bottom navigation with every destination and the active state", () => {
    render(<AppShell>page</AppShell>);
    const nav = screen.getByRole("navigation", { name: "Primary" });

    const home = within(nav).getByRole("link", { name: "Home" });
    expect(home).toHaveAttribute("href", "/");
    expect(home).toHaveAttribute("aria-current", "page");
    expect(home.className).toContain("text-pure-white");

    const search = within(nav).getByRole("link", { name: "Search" });
    expect(search).toHaveAttribute("href", "/search");
    expect(search).not.toHaveAttribute("aria-current");
    expect(search.className).toContain("text-fog");

    expect(within(nav).getByRole("link", { name: "Library" })).toHaveAttribute("href", "/library");
  });

  it("renders the idle player slots with a Now Playing affordance", () => {
    render(<AppShell>page</AppShell>);

    const nowPlayingLinks = screen.getAllByRole("link", { name: "Open Now Playing" });
    expect(nowPlayingLinks).toHaveLength(2);
    for (const link of nowPlayingLinks) {
      expect(link).toHaveAttribute("href", "/now-playing");
    }

    expect(screen.getAllByText("Nothing playing")).toHaveLength(2);

    const playButtons = screen.getAllByRole("button", { name: "Play" });
    expect(playButtons.length).toBeGreaterThanOrEqual(2);
    for (const button of playButtons) {
      expect(button).toBeDisabled();
      expect(button.className).toContain("bg-spotify-green");
    }

    expect(screen.getByTestId("mini-player").className).toContain("h-14");
    expect(screen.getByTestId("player-bar").className).toContain("h-18");
  });
});
