import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueueView } from "@/features/queue/QueueView";
import { clearPlaybackBridge, resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";
import { makeTrack } from "../helpers/music-fixtures";

const alpha = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const beta = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Beta" });
const gamma = makeTrack({ id: "youtube:ccc", providerId: "ccc", title: "Gamma" });
const delta = makeTrack({ id: "youtube:ddd", providerId: "ddd", title: "Delta" });
const played = makeTrack({ id: "youtube:eee", providerId: "eee", title: "Epsilon" });

const dataTransfer = () => ({
  effectAllowed: "",
  dropEffect: "",
  setData: vi.fn(),
  getData: vi.fn(() => ""),
});

function seed(source: "search" | "unknown" = "search") {
  useQueueStore.setState({
    queue: [alpha, beta, gamma, delta],
    queueIndex: 0,
    playOrder: [0, 1, 2, 3],
    history: [{ track: played, playedAt: 1_000 }],
    source,
    shuffle: false,
  });
  usePlayerStore.setState({ currentTrack: alpha, status: "paused" });
}

/** Track ids of the rows listed inside one section region, in DOM order. */
function rowIds(region: HTMLElement): string[] {
  return within(region)
    .getAllByTestId("queue-row")
    .map((row) => row.dataset.trackId ?? "");
}

function queueIds(): string[] {
  return useQueueStore.getState().queue.map((track) => track.id);
}

beforeEach(() => {
  resetPlayerStore();
  resetQueueStore();
  localStorage.clear();
  clearPlaybackBridge();
});

describe("Queue surface", () => {
  it("lists now playing, upcoming in traversal order, and recently played", () => {
    seed();

    render(<QueueView />);

    expect(screen.getByRole("heading", { level: 1, name: "Queue" })).toBeInTheDocument();
    expect(screen.getByText("From search")).toBeInTheDocument();

    const nowPlaying = screen.getByRole("region", { name: "Now playing" });
    expect(rowIds(nowPlaying)).toEqual(["youtube:aaa"]);
    expect(within(nowPlaying).getByText("Alpha")).toBeInTheDocument();
    expect(within(nowPlaying).getByText("Daft Punk")).toBeInTheDocument();
    expect(within(nowPlaying).getByText("4:09")).toBeInTheDocument();
    // Read-only section: the current entry has no remove/move affordances.
    expect(within(nowPlaying).queryByRole("button")).toBeNull();

    const upcoming = screen.getByRole("region", { name: "Next & upcoming" });
    expect(rowIds(upcoming)).toEqual(["youtube:bbb", "youtube:ccc", "youtube:ddd"]);
    expect(within(upcoming).getByText("Beta")).toBeInTheDocument();

    const history = screen.getByRole("region", { name: "Recently played" });
    expect(rowIds(history)).toEqual(["youtube:eee"]);
    expect(within(history).getByText("Epsilon")).toBeInTheDocument();
    expect(within(history).queryByRole("button")).toBeNull();
  });

  it("follows the traversal order when shuffle is on", () => {
    seed();
    // Shuffled traversal: Delta leads the upcoming region, not the array order.
    useQueueStore.setState({ shuffle: true, playOrder: [0, 3, 1, 2] });

    render(<QueueView />);

    expect(rowIds(screen.getByRole("region", { name: "Next & upcoming" }))).toEqual([
      "youtube:ddd",
      "youtube:bbb",
      "youtube:ccc",
    ]);
  });

  it("shows the empty state instead of sections when nothing is queued", () => {
    render(<QueueView />);

    expect(screen.getByText("Nothing queued yet")).toBeInTheDocument();
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });

  it("omits the source label when the queue source is unknown", () => {
    seed("unknown");

    render(<QueueView />);

    expect(screen.getByRole("heading", { level: 1, name: "Queue" })).toBeInTheDocument();
    expect(screen.queryByText("From search")).toBeNull();
    expect(screen.queryByText("Unknown source")).toBeNull();
  });

  it("shows a placeholder in the upcoming section when only the current entry remains", () => {
    useQueueStore.setState({ queue: [alpha], queueIndex: 0, playOrder: [0] });
    usePlayerStore.setState({ currentTrack: alpha, status: "paused" });

    render(<QueueView />);

    expect(screen.getByText("Nothing up next.")).toBeInTheDocument();
    expect(screen.getAllByTestId("queue-row")).toHaveLength(1);
  });

  it("removes an upcoming entry immediately without touching transport", () => {
    seed();

    render(<QueueView />);

    const upcoming = screen.getByRole("region", { name: "Next & upcoming" });
    const betaRow = within(upcoming).getAllByTestId("queue-row")[0];
    fireEvent.click(within(betaRow).getByRole("button", { name: "Remove from queue" }));

    expect(queueIds()).toEqual(["youtube:aaa", "youtube:ccc", "youtube:ddd"]);
    expect(within(upcoming).queryByText("Beta")).toBeNull();
    // Queue edits are transport-neutral: current track and status unchanged.
    expect(usePlayerStore.getState().currentTrack).toBe(alpha);
    expect(usePlayerStore.getState().status).toBe("paused");
  });

  it("moves an entry with the move controls without disturbing playback", () => {
    seed();

    render(<QueueView />);

    const upcoming = screen.getByRole("region", { name: "Next & upcoming" });
    const rows = within(upcoming).getAllByTestId("queue-row");
    // Gamma (position 1) moves down one slot.
    fireEvent.click(within(rows[1]).getByRole("button", { name: "Move down" }));

    expect(queueIds()).toEqual(["youtube:aaa", "youtube:bbb", "youtube:ddd", "youtube:ccc"]);
    expect(rowIds(screen.getByRole("region", { name: "Next & upcoming" }))).toEqual([
      "youtube:bbb",
      "youtube:ddd",
      "youtube:ccc",
    ]);
    expect(usePlayerStore.getState().currentTrack).toBe(alpha);
    expect(usePlayerStore.getState().status).toBe("paused");
  });

  it("produces the identical order from dragging as from the move controls", () => {
    // Pointer path: drag Gamma down onto Delta.
    seed();
    const pointer = render(<QueueView />);
    const pointerUpcoming = screen.getByRole("region", { name: "Next & upcoming" });
    const pointerRows = within(pointerUpcoming).getAllByTestId("queue-row");
    fireEvent.dragStart(pointerRows[1], { dataTransfer: dataTransfer() });
    fireEvent.dragOver(pointerRows[2], { dataTransfer: dataTransfer() });
    fireEvent.drop(pointerRows[2], { dataTransfer: dataTransfer() });
    const pointerOrder = queueIds();
    pointer.unmount();

    // Keyboard path: the same single move via the move control.
    resetPlayerStore();
    resetQueueStore();
    seed();
    render(<QueueView />);
    const keyUpcoming = screen.getByRole("region", { name: "Next & upcoming" });
    const keyRows = within(keyUpcoming).getAllByTestId("queue-row");
    fireEvent.click(within(keyRows[1]).getByRole("button", { name: "Move down" }));
    const keyboardOrder = queueIds();

    expect(pointerOrder).toEqual(["youtube:aaa", "youtube:bbb", "youtube:ddd", "youtube:ccc"]);
    expect(keyboardOrder).toEqual(pointerOrder);
  });

  it("keeps every move/remove control named, enabled at the edge, and focusable", () => {
    seed();

    render(<QueueView />);

    const upcoming = screen.getByRole("region", { name: "Next & upcoming" });
    const rows = within(upcoming).getAllByTestId("queue-row");
    expect(rows).toHaveLength(3);

    const firstUp = within(rows[0]).getByRole("button", { name: "Move up" });
    const firstDown = within(rows[0]).getByRole("button", { name: "Move down" });
    const lastDown = within(rows[2]).getByRole("button", { name: "Move down" });

    // Edge controls stay rendered but disabled; middle controls operable.
    expect(firstUp).toBeDisabled();
    expect(firstDown).toBeEnabled();
    expect(lastDown).toBeDisabled();
    expect(within(rows[1]).getByRole("button", { name: "Remove from queue" })).toBeEnabled();

    // Hidden behind hover, still in the tab order with visible focus.
    expect(firstUp.parentElement).toHaveClass("opacity-0");
    expect(firstUp.parentElement).toHaveClass("group-hover:opacity-100");
    expect(firstUp).not.toHaveAttribute("tabindex", "-1");
    firstDown.focus();
    expect(firstDown).toHaveFocus();
  });
});
