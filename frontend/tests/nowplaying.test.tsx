import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NowPlayingPage from "@/app/now-playing/page";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { clearPlaybackBridge, resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetVideoModeStore, useVideoModeStore } from "@/stores/videoModeStore";
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

let repositories: RepositorySet;

beforeEach(async () => {
  resetPlayerStore();
  resetLibraryStore();
  resetVideoModeStore();
  localStorage.clear();
  clearPlaybackBridge();
  push.mockClear();
  repositories = await getLocalData();
  await repositories.resetAll();
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

    // The video is parked by default, so there is nothing on screen to
    // attribute and no caption is rendered. Enabling video mode reveals the
    // player, and only then does the attribution appear beside it.
    expect(screen.queryByTestId("now-playing-attribution")).toBeNull();
    expect(screen.getByTestId("now-playing-video-mode")).toHaveAccessibleName("Show video");

    act(() => useVideoModeStore.getState().setVisible(true));

    // Visible attribution opening the watch page in a new tab (policy:
    // referrer must NOT be suppressed).
    const link = screen.getByTestId("now-playing-attribution");
    expect(link).toHaveTextContent("Watch on YouTube");
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=aaa");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
  });

  it("offers the video control only when there is a track to show", () => {
    render(<NowPlayingPage />);
    expect(screen.queryByTestId("now-playing-video-mode")).toBeNull();

    act(() => usePlayerStore.getState().playTrack(track, [track]));
    expect(screen.getByTestId("now-playing-video-mode")).toBeInTheDocument();
  });

  it("shows the video control as pressed only while the video is shown", () => {
    act(() => usePlayerStore.getState().playTrack(track, [track]));
    render(<NowPlayingPage />);

    const control = screen.getByTestId("now-playing-video-mode");
    expect(control).toHaveAttribute("aria-pressed", "false");

    act(() => useVideoModeStore.getState().toggle());
    expect(screen.getByTestId("now-playing-video-mode")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("now-playing-video-mode")).toHaveAccessibleName("Hide video");

    act(() => useVideoModeStore.getState().toggle());
    expect(screen.getByTestId("now-playing-video-mode")).toHaveAttribute("aria-pressed", "false");
  });

  it("does not start playback when the video control is activated", () => {
    // The parked player is already playing; the control must not be a playback
    // action, and turning the video on must not autoplay anything by itself.
    const playTrack = vi.spyOn(usePlayerStore.getState(), "playTrack");
    act(() => usePlayerStore.getState().playTrack(track, [track]));
    playTrack.mockClear();

    render(<NowPlayingPage />);
    act(() => screen.getByTestId("now-playing-video-mode").click());

    expect(playTrack).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentTrack).toEqual(track);
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

describe("Now Playing like action (task 2.3)", () => {
  const track = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });

  it("saves the current track to Liked Songs and removes it again", async () => {
    usePlayerStore.getState().playTrack(track, [track]);
    usePlayerStore.getState().pause();

    render(<NowPlayingPage />);

    const save = await screen.findByRole("button", { name: "Save to Liked Songs" });
    expect(save).toBeEnabled();

    fireEvent.click(save);
    await waitFor(async () => {
      expect(await repositories.likedTracks.isLiked(track.id)).toBe(true);
    });
    // The store re-reads after the write, so the same control flips label
    // and fills the heart.
    const remove = await screen.findByRole("button", { name: "Remove from Liked Songs" });
    expect(remove.querySelector("svg")?.getAttribute("class")).toContain("fill-current");

    fireEvent.click(screen.getByRole("button", { name: "Remove from Liked Songs" }));
    await waitFor(async () => {
      expect(await repositories.likedTracks.isLiked(track.id)).toBe(false);
    });
    expect(await screen.findByRole("button", { name: "Save to Liked Songs" })).toBeInTheDocument();
  });

  it("shows a like persisted by another surface without a remount (design §11)", async () => {
    usePlayerStore.getState().playTrack(track, [track]);
    usePlayerStore.getState().pause();

    render(<NowPlayingPage />);
    const save = await screen.findByRole("button", { name: "Save to Liked Songs" });
    expect(save.querySelector("svg")?.getAttribute("class")).not.toContain("fill-current");

    // Another surface (search results) likes the same track through the store.
    await useLibraryStore.getState().toggleLike(track);

    const remove = await screen.findByRole("button", { name: "Remove from Liked Songs" });
    expect(remove).not.toBeDisabled();
    expect(remove.querySelector("svg")?.getAttribute("class")).toContain("fill-current");
    expect(await repositories.likedTracks.isLiked(track.id)).toBe(true);
  });
});
