import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { ConnectionBanner } from "@/components/layout/ConnectionBanner";
import { clearPlaybackBridge, resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetNetworkStore, useNetworkStore } from "@/stores/networkStore";
import { makeTrack } from "../helpers/music-fixtures";

/**
 * Connection banner coverage (M6 task 8.2, design §8): copy and role per
 * state, clearing on reconnect, shell-global presence across route changes,
 * and a stacking/position contract that keeps it clear of the player regions.
 */

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

const OFFLINE_COPY = "You're offline — some things won't load until you reconnect.";

beforeEach(() => {
  resetNetworkStore();
  resetPlayerStore();
  localStorage.clear();
  clearPlaybackBridge();
});

describe("ConnectionBanner", () => {
  it("renders nothing while the connection is online", () => {
    const { container } = render(<ConnectionBanner />);

    expect(container.querySelector('[data-testid="connection-banner"]')).toBeNull();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("announces the offline copy through a polite status region", () => {
    useNetworkStore.getState().setConnection("offline");

    render(<ConnectionBanner />);

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(OFFLINE_COPY);
    expect(banner).toHaveAttribute("data-connection", "offline");
    // Token-only surface: graphite card (#1f1f1f), rounded, shadowed.
    expect(banner.className).toContain("bg-graphite");
    expect(banner.className).toContain("rounded-cards");
  });

  it("uses the subdued degraded copy", () => {
    render(<ConnectionBanner />);
    act(() => useNetworkStore.getState().setConnection("degraded"));

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Connection looks slow.");
    expect(banner).toHaveAttribute("data-connection", "degraded");
    // Secondary text (the icon dot stays subdued too — no accent while slow).
    const text = banner.querySelectorAll("span")[1];
    expect(text.className).toContain("text-mist");
    expect(banner.className).toContain("bg-graphite");
  });

  it("disappears as soon as the connection returns", () => {
    useNetworkStore.getState().setConnection("offline");
    const { container } = render(<ConnectionBanner />);
    expect(container.querySelector('[data-testid="connection-banner"]')).not.toBeNull();

    act(() => useNetworkStore.getState().setConnection("online"));

    expect(container.querySelector('[data-testid="connection-banner"]')).toBeNull();
  });
});

describe("ConnectionBanner in the shell", () => {
  it("stays mounted across route changes and clears on reconnect", () => {
    const first = render(<AppShell>Home page</AppShell>);
    expect(screen.queryByTestId("connection-banner")).toBeNull();

    act(() => useNetworkStore.getState().setConnection("offline"));
    const banner = screen.getByTestId("connection-banner");
    expect(banner).toHaveTextContent(OFFLINE_COPY);

    // Route (children) change: the shell-global banner node persists.
    first.rerender(<AppShell>Search page</AppShell>);
    expect(screen.getByTestId("connection-banner")).toBe(banner);
    expect(screen.getByText("Search page")).toBeInTheDocument();

    act(() => useNetworkStore.getState().setConnection("online"));
    expect(screen.queryByTestId("connection-banner")).toBeNull();
  });

  it("sits fixed beneath the top bar and outside the player regions", () => {
    act(() => {
      usePlayerStore.setState({
        currentTrack: makeTrack({ id: "youtube:aaa", providerId: "aaa" }),
        status: "playing",
      });
    });

    const { container } = render(<AppShell>page</AppShell>);
    // After mount: the monitor only re-derives on connectivity events, so a
    // store-driven state is what a real transition would produce anyway.
    act(() => useNetworkStore.getState().setConnection("offline"));
    const banner = screen.getByTestId("connection-banner");

    // Fixed top-right under the 64px top bar (top-18 = 64 + 8px gap) and
    // below the docked player surface (z-40 < z-50): never over the player.
    expect(banner.className).toContain("fixed");
    expect(banner.className).toContain("top-18");
    expect(banner.className).toContain("right-4");
    expect(banner.className).toContain("z-40");
    expect(banner.className).not.toContain("bottom-");

    // Direct shell child: outside the scrolling main and the player dock.
    expect(banner.parentElement).toBe(container.firstElementChild);
    const dock = screen.getByTestId("player-dock");
    expect(banner.closest('[data-testid="player-dock"]')).toBeNull();
    expect(dock.contains(banner)).toBe(false);
  });
});
