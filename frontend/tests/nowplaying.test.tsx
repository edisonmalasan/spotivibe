import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NowPlayingPage from "@/app/now-playing/page";
import { clearPlaybackBridge, resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { makeTrack } from "./helpers/music-fixtures";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

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
  useRouter: () => ({ back: vi.fn(), forward: vi.fn(), push, replace: vi.fn() }),
}));

beforeEach(() => {
  resetPlayerStore();
  localStorage.clear();
  clearPlaybackBridge();
  push.mockClear();
});

describe("Now Playing surface", () => {
  it("renders the expanded view with artwork, placeholders, and controls", () => {
    const { container } = render(<NowPlayingPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Now Playing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Close Now Playing" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Nothing playing")).toBeInTheDocument();
    expect(screen.getByText("Choose something to start")).toBeInTheDocument();
    expect(container.querySelector('[class*="rounded-images"] svg')).not.toBeNull();
  });

  it("exposes disabled transport and like placeholders with an active queue control", () => {
    render(<NowPlayingPage />);

    const play = screen.getByRole("button", { name: "Play" });
    expect(play).toBeDisabled();
    expect(play.className).toContain("bg-spotify-green");

    expect(screen.getByRole("button", { name: "Previous track" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save to Liked Songs" })).toBeDisabled();

    // The queue control is an enabled navigation placeholder (design §5).
    const queue = screen.getByRole("button", { name: "Queue" });
    expect(queue).toBeEnabled();

    queue.click();

    expect(push).toHaveBeenCalledWith("/queue");
  });

  it("renders a zeroed seekable progress track", () => {
    render(<NowPlayingPage />);

    expect(screen.getByRole("slider", { name: "Track progress" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
});

describe("Now Playing with an active track", () => {
  const track = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });

  it("renders the track with enabled transport, toggles, volume, and attribution", () => {
    usePlayerStore.getState().playTrack(track, [track]);
    usePlayerStore.getState().pause();

    const { container } = render(<NowPlayingPage />);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Daft Punk")).toBeInTheDocument();
    expect(container.querySelector('[class*="rounded-images"] img')).toHaveAttribute(
      "src",
      "https://example.test/art.jpg",
    );

    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Previous track" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeEnabled();
    expect(screen.getByRole("slider", { name: "Track progress" })).toHaveAttribute(
      "aria-valuemax",
      "249",
    );

    expect(screen.getByRole("button", { name: "Shuffle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repeat: Off" })).toBeInTheDocument();
    expect(screen.getByLabelText("Volume")).toBeInTheDocument();

    // Visible attribution opening the watch page in a new tab (policy:
    // referrer must NOT be suppressed).
    const link = screen.getByTestId("now-playing-attribution");
    expect(link).toHaveTextContent("Watch on YouTube");
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=aaa");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
  });

  it("surfaces a playback error while keeping the controls operable", () => {
    usePlayerStore.getState().playTrack(track, [track]);
    usePlayerStore.setState({ status: "error", errorMessage: "Video unavailable" });

    render(<NowPlayingPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Video unavailable");
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeEnabled();
  });
});
