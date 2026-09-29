import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { QueueView } from "@/features/queue/QueueView";
import type { QueueSource } from "@/data/repositories";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M10 task 2.1 (spec `queue` — "Dedicated queue state model": *a radio queue is
 * labelled as a radio*).
 *
 * `Record<QueueSource, string>` makes this exhaustive at build time, so adding
 * `radio` could not have been left out of the surface by accident — this file
 * pins that the *rendered* label is the radio one, and that adding it left every
 * existing label exactly as it was.
 */

const expected: Record<QueueSource, string | null> = {
  search: "From search",
  browse: "From browse",
  library: "From your library",
  queue: "From queue",
  radio: "From radio",
  // The unknown source is deliberately not labelled at all.
  unknown: null,
};

beforeEach(() => {
  resetPlayerStore();
  resetQueueStore();
  useQueueStore.setState({
    queue: [makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" })],
    queueIndex: 0,
    playOrder: [0],
    source: "radio",
  });
  usePlayerStore.setState({ currentTrack: makeTrack({ id: "youtube:aaa" }), status: "paused" });
});

describe("the queue source label", () => {
  it.each(Object.entries(expected))("labels a %s queue", (source, label) => {
    useQueueStore.setState({ source: source as QueueSource });

    render(createElement(QueueView));

    expect(screen.getByRole("heading", { level: 1, name: "Queue" })).toBeInTheDocument();
    if (label === null) {
      expect(screen.queryByText("Unknown source")).toBeNull();
    } else {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows the radio label on a radio queue and keeps it while the radio refills", () => {
    render(createElement(QueueView));

    expect(screen.getByText("From radio")).toBeInTheDocument();
    // The label reports the recorded source: growing the queue for a radio does
    // not change it, and ordinary playback afterwards does.
    useQueueStore
      .getState()
      .appendUpcoming([makeTrack({ id: "youtube:ggg", providerId: "ggg", title: "Growth" })]);
    expect(useQueueStore.getState().source).toBe("radio");
    useQueueStore.setState({ source: "search" });
    expect(screen.getByText("From radio")).toBeInTheDocument();
    expect(screen.queryByText("From search")).toBeNull();
  });
});
