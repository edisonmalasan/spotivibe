import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressSlider } from "@/components/player/ProgressSlider";
import {
  clearPlaybackBridge,
  resetPlayerStore,
  setPlaybackBridge,
  usePlayerStore,
  type PlaybackBridge,
} from "@/stores/playerStore";
import { makeTrack } from "../helpers/music-fixtures";

const track = makeTrack({ id: "youtube:aaa", providerId: "aaa", durationSeconds: 180 });

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

function slider() {
  return screen.getByRole("slider", { name: "Track progress" });
}

beforeEach(() => {
  resetPlayerStore();
  localStorage.clear();
  clearPlaybackBridge();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProgressSlider", () => {
  it("renders a disabled zeroed slider while idle", () => {
    render(<ProgressSlider />);

    expect(slider()).toHaveAttribute("aria-disabled", "true");
    expect(slider()).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByTestId("progress-position")).toHaveTextContent("0:00");
    expect(screen.getByTestId("progress-duration")).toHaveTextContent("0:00");
  });

  it("reflects store position and the track's metadata duration", () => {
    state().playTrack(track, [track]);
    state()._setPosition(45);

    render(<ProgressSlider />);

    expect(slider()).toHaveAttribute("aria-valuenow", "45");
    expect(slider()).toHaveAttribute("aria-valuemax", "180");
    expect(slider()).toHaveAttribute("aria-valuetext", "0:45 of 3:00");
    expect(slider()).not.toHaveAttribute("aria-disabled");
    expect(screen.getByTestId("progress-fill")).toHaveStyle({ width: "25%" });
  });

  it("pointer down and drag seek to the pointer position", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    state().playTrack(track, [track]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 100,
      bottom: 10,
      width: 100,
      height: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    render(<ProgressSlider />);

    fireEvent(slider(), new MouseEvent("pointerdown", { bubbles: true, clientX: 50 }));
    expect(state().positionSeconds).toBe(90); // 50% of 180s
    expect(bridge.seekTo).toHaveBeenCalledWith(90);

    fireEvent(slider(), new MouseEvent("pointermove", { bubbles: true, buttons: 1, clientX: 25 }));
    expect(state().positionSeconds).toBe(45); // drag keeps seeking while held
  });

  it("supports keyboard seeking with arrows, Home, and End", () => {
    const bridge = makeBridge();
    setPlaybackBridge(bridge);
    state().playTrack(track, [track]);
    state()._setPosition(60);

    render(<ProgressSlider />);

    fireEvent.keyDown(slider(), { key: "ArrowRight" });
    expect(state().positionSeconds).toBe(65);
    fireEvent.keyDown(slider(), { key: "ArrowLeft" });
    expect(state().positionSeconds).toBe(60);
    fireEvent.keyDown(slider(), { key: "End" });
    expect(state().positionSeconds).toBe(180); // clamped to duration
    fireEvent.keyDown(slider(), { key: "Home" });
    expect(state().positionSeconds).toBe(0);
    expect(bridge.seekTo).toHaveBeenCalledTimes(4);
  });

  it("ignores seek interaction while idle", () => {
    render(<ProgressSlider />);

    fireEvent.keyDown(slider(), { key: "ArrowRight" });
    expect(state().positionSeconds).toBe(0);
  });
});
