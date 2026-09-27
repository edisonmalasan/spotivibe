import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PlayPauseButton,
  RepeatToggle,
  ShuffleToggle,
  VolumeControls,
} from "@/components/player/PlaybackControls";
import {
  clearPlaybackBridge,
  resetPlayerStore,
  setPlaybackBridge,
  usePlayerStore,
  type PlaybackBridge,
} from "@/stores/playerStore";
import { makeTrack } from "../helpers/music-fixtures";

const track = makeTrack({ id: "youtube:aaa", providerId: "aaa" });

function state() {
  return usePlayerStore.getState();
}

function makeBridge() {
  return {
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
  } satisfies PlaybackBridge;
}

beforeEach(() => {
  resetPlayerStore();
  localStorage.clear();
  clearPlaybackBridge();
});

describe("PlayPauseButton", () => {
  it("is disabled while idle", () => {
    render(<PlayPauseButton />);
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
  });

  it("shows the pause affordance while a load or playback is pending", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    state().playTrack(track, [track]); // status: loading

    render(<PlayPauseButton />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(state().status).toBe("paused");
    expect(bridge.pause).toHaveBeenCalled();

    // Player-confirmed playback keeps the pause affordance visible.
    act(() => {
      usePlayerStore.setState({ status: "playing" });
    });
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("dispatches play from the paused state (buffering until confirmed)", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    state().playTrack(track, [track]);
    state().pause();

    render(<PlayPauseButton />);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    expect(state().status).toBe("buffering");
    expect(bridge.play).toHaveBeenCalled();
  });

  it("keeps Play enabled in the error state for manual retry", () => {
    state().playTrack(track, [track]);
    usePlayerStore.setState({ status: "error", errorMessage: "This video is unavailable" });

    render(<PlayPauseButton />);
    const play = screen.getByRole("button", { name: "Play" });
    expect(play).toBeEnabled();

    fireEvent.click(play);
    expect(state().status).toBe("buffering"); // explicit retry attempt
  });
});

describe("ShuffleToggle", () => {
  it("toggles shuffle with aria-pressed tracking the store", () => {
    render(<ShuffleToggle />);
    const button = screen.getByRole("button", { name: "Shuffle" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);
    expect(state().shuffle).toBe(true);
    expect(button).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(button);
    expect(state().shuffle).toBe(false);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });
});

describe("RepeatToggle", () => {
  it("cycles off → all → one → off with the active mode in its label", () => {
    render(<RepeatToggle />);

    const off = screen.getByRole("button", { name: "Repeat: Off" });
    expect(off).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(off);
    expect(state().repeatMode).toBe("context");
    const all = screen.getByRole("button", { name: "Repeat: All" });
    expect(all).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(all);
    expect(state().repeatMode).toBe("track");
    expect(screen.getByRole("button", { name: "Repeat: One" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Repeat: One" }));
    expect(state().repeatMode).toBe("off");
    expect(screen.getByRole("button", { name: "Repeat: Off" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("VolumeControls", () => {
  it("reflects store volume/mute and dispatches changes", () => {
    state().setVolume(35);
    render(<VolumeControls />);

    expect(screen.getByLabelText("Volume")).toHaveValue("35");

    fireEvent.change(screen.getByLabelText("Volume"), { target: { value: "64" } });
    expect(state().volume).toBe(64);

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect(state().muted).toBe(true);
    expect(screen.getByRole("button", { name: "Unmute" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    expect(state().muted).toBe(false);
  });

  it("persists volume and mute to the boot preference", () => {
    render(<VolumeControls />);

    fireEvent.change(screen.getByLabelText("Volume"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));

    expect(localStorage.getItem("spotivibe.volume")).toBe(
      JSON.stringify({ volume: 42, muted: true }),
    );
  });
});
