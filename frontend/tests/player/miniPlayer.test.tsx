import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MiniPlayer } from "@/components/layout/MiniPlayer";
import { clearPlaybackBridge, resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { makeTrack } from "../helpers/music-fixtures";

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

const track = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });

function state() {
  return usePlayerStore.getState();
}

beforeEach(() => {
  resetPlayerStore();
  localStorage.clear();
  clearPlaybackBridge();
});

describe("MiniPlayer", () => {
  it("keeps the idle placeholders with a disabled play affordance", () => {
    render(<MiniPlayer />);

    expect(screen.getByText("Nothing playing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
  });

  it("shows the active track and dispatches play/pause from the store", () => {
    state().playTrack(track, [track]);
    state().pause();

    render(<MiniPlayer />);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Daft Punk")).toBeInTheDocument();

    const play = screen.getByRole("button", { name: "Play" });
    expect(play).toBeEnabled();
    fireEvent.click(play);
    expect(state().status).toBe("buffering");

    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(state().status).toBe("paused");
  });

  it("surfaces playback errors in the subtitle slot", () => {
    state().playTrack(track, [track]);
    usePlayerStore.setState({ status: "error", errorMessage: "Video unavailable" });

    render(<MiniPlayer />);

    expect(screen.getByRole("alert")).toHaveTextContent("Video unavailable");
  });
});
