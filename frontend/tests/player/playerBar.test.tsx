import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerBar } from "@/components/layout/PlayerBar";
import { clearPlaybackBridge, resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { makeTrack } from "../helpers/music-fixtures";

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

const track = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const second = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Beta" });
const third = makeTrack({ id: "youtube:ccc", providerId: "ccc", title: "Gamma" });

function state() {
  return usePlayerStore.getState();
}

beforeEach(() => {
  resetPlayerStore();
  localStorage.clear();
  clearPlaybackBridge();
  push.mockClear();
});

describe("PlayerBar", () => {
  it("keeps the idle placeholders with disabled transport and seek", () => {
    render(<PlayerBar />);

    expect(screen.getByText("Nothing playing")).toBeInTheDocument();
    expect(screen.getByText("Choose something to start")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous track" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Track progress" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("renders the active track with enabled transport, toggles, and volume", () => {
    state().playTrack(track, [track]);
    state().pause();

    const { container } = render(<PlayerBar />);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Daft Punk")).toBeInTheDocument();
    expect(container.querySelector('[class*="rounded-images"] img')).toHaveAttribute(
      "src",
      "https://example.test/art.jpg",
    );

    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Previous track" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeEnabled();
    expect(screen.getByRole("slider", { name: "Track progress" })).not.toHaveAttribute(
      "aria-disabled",
    );

    // Store-backed toggles and volume surface on the persistent bar.
    expect(screen.getByRole("button", { name: "Shuffle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repeat: Off" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mute" })).toBeInTheDocument();
    expect(screen.getByLabelText("Volume")).toHaveValue("80");
  });

  it("surfaces playback errors in the subtitle slot without hiding controls", () => {
    state().playTrack(track, [track]);
    usePlayerStore.setState({
      status: "error",
      errorMessage: "Playback failed. Try another track.",
    });

    render(<PlayerBar />);

    expect(screen.getByRole("alert")).toHaveTextContent("Playback failed. Try another track.");
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeEnabled();
  });

  it("navigates to the queue route from the queue control when empty", () => {
    render(<PlayerBar />);

    const queueButton = screen.getByRole("button", { name: "Queue, empty" });
    expect(queueButton).toBeEnabled();

    queueButton.click();

    expect(push).toHaveBeenCalledWith("/queue");
  });

  it("counts upcoming entries in traversal order in the queue control name", () => {
    state().playTrack(track, [track, second, third]);

    render(<PlayerBar />);

    // Current entry is Alpha → two upcoming in traversal order.
    expect(screen.getByRole("button", { name: "Queue, 2 upcoming" })).toBeInTheDocument();
  });
});
