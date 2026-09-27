import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerHost } from "@/components/player/PlayerHost";
import { getLocalData } from "@/data/localData";
import { clearPlaybackBridge, resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { makeTrack } from "../helpers/music-fixtures";

const { attach, suspend } = vi.hoisted(() => ({
  attach: vi.fn(),
  suspend: vi.fn(),
}));

vi.mock("@/player/engine", () => ({
  getPlaybackEngine: () => ({ attach, suspend }),
}));

const track = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });

function state() {
  return usePlayerStore.getState();
}

async function seedSession() {
  const data = await getLocalData();
  await data.session.set({
    queue: [track],
    queueIndex: 0,
    positionSeconds: 42,
    repeatMode: "off",
    shuffle: false,
    volume: 0.55,
  });
}

beforeEach(() => {
  resetPlayerStore();
  localStorage.clear();
  clearPlaybackBridge();
  attach.mockClear();
  suspend.mockClear();
});

describe("PlayerHost boot and video surface", () => {
  it("stays dockless while idle and never attaches the engine", () => {
    const { container } = render(<PlayerHost />);

    expect(container.querySelector('[data-testid="player-dock"]')).toBeNull();
    expect(attach).not.toHaveBeenCalled();
  });

  it("restores a saved session cued-paused and docks the surface", async () => {
    await seedSession();
    render(<PlayerHost />);

    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));

    // Restore: track, position, paused — never autoplay (spec).
    expect(state().currentTrack).toEqual(track);
    expect(state().status).toBe("paused");
    expect(state().positionSeconds).toBe(42);

    // Docked surface owns the engine's container node.
    const surface = screen.getByTestId("player-surface");
    const target = surface.firstElementChild as HTMLElement;
    expect(target).not.toBeNull();
    expect(attach).toHaveBeenCalledWith(target);

    // Policy-compliant attribution: new tab, referrer NOT suppressed.
    const link = screen.getByTestId("watch-on-youtube");
    expect(link).toHaveTextContent("Watch on YouTube");
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=aaa");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
  });

  it("applies the volume/mute boot preference at cold boot", async () => {
    localStorage.setItem("spotivibe.volume", JSON.stringify({ volume: 77, muted: true }));

    render(<PlayerHost />);
    await waitFor(() => expect(state().volume).toBe(77));
    expect(state().muted).toBe(true);
  });

  it("keeps exactly one surface target across remounts", async () => {
    await seedSession();
    const first = render(<PlayerHost />);
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));

    first.unmount();
    expect(suspend).toHaveBeenCalled();

    render(<PlayerHost />);
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(2));

    const surface = screen.getByTestId("player-surface");
    expect(surface.children).toHaveLength(1); // no second container accumulates
    expect(attach).toHaveBeenLastCalledWith(surface.firstElementChild);
  });

  it("styles the dock as the topmost compliant surface above each shell variant", async () => {
    await seedSession();
    render(<PlayerHost />);
    await waitFor(() => expect(screen.getByTestId("player-dock")).toBeInTheDocument());

    const dock = screen.getByTestId("player-dock");
    expect(dock.className).toContain("fixed");
    expect(dock.className).toContain("z-50"); // topmost stack level, nothing overlaps
    expect(dock.className).toContain("bottom-[128px]"); // compact: MiniPlayer + BottomNav (120px) + gap
    expect(dock.className).toContain("lg:bottom-[88px]"); // desktop: above the 72px PlayerBar

    const surface = screen.getByTestId("player-surface");
    expect(surface.className).toContain("aspect-video");
    expect(surface.className).toContain("min-h-[200px]"); // ≥200×200 on the compact stack
    expect(surface.className).toContain("w-[max(200px,56vw)]");
    expect(surface.className).toContain("lg:w-[400px]"); // desktop 400×225
    expect(surface.className).toContain("lg:h-[225px]");
  });

  it("skips restore when playback already started while it loaded", async () => {
    await seedSession();
    // Start playback before the async restore resolves.
    state().playTrack(track, [track]);

    render(<PlayerHost />);
    // Give the restore path time to resolve, then confirm it did not clobber.
    await waitFor(() => expect(attach).toHaveBeenCalled());
    expect(state().status).not.toBe("paused"); // user's loading state intact
    expect(state().currentTrack).toEqual(track); // same track, not reset
  });
});
