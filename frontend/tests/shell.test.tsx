import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";

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
    expect(screen.getByRole("searchbox", { name: "Search" })).toBeInTheDocument();
  });

  it("wires the navigation arrows to browser history", () => {
    render(<AppShell>page</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(routerMock.back).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Go forward" }));
    expect(routerMock.forward).toHaveBeenCalledTimes(1);
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
    expect(card.className).toContain("transition-colors");
    expect(card.className).toContain("hover:bg-smoke");
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
