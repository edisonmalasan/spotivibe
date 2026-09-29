import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListeningEventRecord, Track } from "@/data/repositories";
import { getLocalData } from "@/data/localData";
import { groupEventsByDay, HistoryView } from "@/features/history/HistoryView";
import { resetHistoryStore, RECENT_HISTORY_LIMIT, useHistoryStore } from "@/stores/historyStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M11 task 4.1: the History surface.
 *
 * The requirement is specific about what the page must *not* claim — no
 * ranking, no completeness, no sharing — so the cases below pin the day grouping,
 * the read-time verdict, the links to the M9 artist/album surfaces, the empty
 * state, and a clear that empties both the list and storage.
 */

// Cold fake-indexeddb hydration can exceed the 1s default (settings precedent).
configure({ asyncUtilTimeout: 5000 });

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NOW = new Date(2026, 8, 30, 21, 30).getTime();

function playedTrack(overrides: Partial<Track> = {}): Track {
  return makeTrack({
    id: "youtube:aaa",
    providerId: "aaa",
    title: "Alpha",
    artists: [{ name: "Aurora" }],
    ...overrides,
  });
}

function event(overrides: Partial<ListeningEventRecord> = {}): ListeningEventRecord {
  return {
    id: "e1",
    trackId: "youtube:aaa",
    track: playedTrack(),
    playedAt: NOW - 60 * 60 * 1000,
    secondsPlayed: 180,
    completed: true,
    context: "home",
    ...overrides,
  };
}

/** Record events through the real repository, then let the store read them. */
async function seed(events: ListeningEventRecord[]): Promise<void> {
  const data = await getLocalData();
  await data.listeningHistory.clear();
  for (const entry of events) await data.listeningHistory.record(entry);
  await useHistoryStore.getState().hydrate();
}

beforeEach(async () => {
  resetHistoryStore();
  const data = await getLocalData();
  await data.listeningHistory.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("groupEventsByDay", () => {
  it("groups events into local days, newest day first, newest play first within a day", () => {
    const groups = groupEventsByDay(
      [
        event({ id: "morning", playedAt: new Date(2026, 8, 29, 9, 0).getTime() }),
        event({ id: "evening", playedAt: new Date(2026, 8, 29, 20, 0).getTime() }),
        event({ id: "today", playedAt: new Date(2026, 8, 30, 8, 0).getTime() }),
      ],
      "2026-09-30",
      "2026-09-29",
    );

    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday"]);
    expect(groups[1].events.map((entry) => entry.id)).toEqual(["evening", "morning"]);
  });

  it("keeps a 23:59 play and a 00:01 play on different days", () => {
    const groups = groupEventsByDay(
      [
        event({ id: "late", playedAt: new Date(2026, 8, 29, 23, 59).getTime() }),
        event({ id: "early", playedAt: new Date(2026, 8, 30, 0, 1).getTime() }),
      ],
      "2026-09-30",
      "2026-09-29",
    );
    expect(groups).toHaveLength(2);
  });

  it("labels a day outside the current year with its year", () => {
    const groups = groupEventsByDay(
      [event({ id: "old", playedAt: new Date(2024, 4, 2, 12, 0).getTime() })],
      "2026-09-30",
      "2026-09-29",
    );
    expect(groups[0].label).toMatch(/2024/);
  });
});

describe("HistoryView", () => {
  it("lists events most recent first, grouped by day, with track, artists, time, and verdict", async () => {
    await seed([
      event({ id: "today", playedAt: new Date(2026, 8, 30, 12, 0).getTime() }),
      event({
        id: "yesterday",
        playedAt: new Date(2026, 8, 29, 12, 0).getTime(),
        trackId: "youtube:bbb",
        track: playedTrack({ id: "youtube:bbb", providerId: "bbb", title: "Beta" }),
      }),
    ]);
    render(<HistoryView />);

    await waitFor(() => expect(screen.getAllByTestId("history-row")).toHaveLength(2));
    expect(screen.getByTestId("history-day-2026-09-30")).toBeInTheDocument();
    expect(screen.getByTestId("history-day-2026-09-29")).toBeInTheDocument();

    const firstRow = screen.getAllByTestId("history-row")[0];
    expect(within(firstRow).getByText("Alpha")).toBeInTheDocument();
    expect(within(firstRow).getByText("Aurora")).toBeInTheDocument();
    expect(within(firstRow).getByTestId("history-verdict")).toHaveTextContent("Played through");
  });

  it("shows how each play ended, distinguishing partial plays from skips", async () => {
    // 20s of a 249s track: past the 10s skip threshold, short of both the 30s
    // minimum and the half-duration rule — so it is genuinely partial.
    await seed([
      event({ id: "partial", secondsPlayed: 20, completed: false, playedAt: NOW - 60_000 }),
      event({
        id: "skip",
        secondsPlayed: 2,
        completed: false,
        skipped: true,
        trackId: "youtube:bbb",
        track: playedTrack({ id: "youtube:bbb", providerId: "bbb", title: "Beta" }),
        playedAt: NOW - 120_000,
      }),
    ]);
    render(<HistoryView />);

    await waitFor(() => expect(screen.getAllByTestId("history-verdict")).toHaveLength(2));
    const verdicts = screen.getAllByTestId("history-verdict").map((node) => node.textContent);
    expect(verdicts).toEqual(["Played partly", "Skipped"]);
  });

  it("links the artist and album to their own surfaces", async () => {
    await seed([
      event({
        track: playedTrack({
          artists: [{ id: "UC_aurora", name: "Aurora" }],
          album: { id: "MPREb_album1", title: "Night Signals" },
        }),
      }),
    ]);
    render(<HistoryView />);

    const artistLink = await screen.findByRole("link", { name: "Aurora" });
    // A provider artist id is the canonical key, so the link resolves to it.
    expect(artistLink).toHaveAttribute("href", "/artist/UC_aurora");
    expect(screen.getByRole("link", { name: "Night Signals" })).toHaveAttribute(
      "href",
      "/album/MPREb_album1",
    );
  });

  it("falls back to the artist name when the credit has no provider id", async () => {
    await seed([event({ track: playedTrack({ artists: [{ name: "Aurora" }] }) })]);
    render(<HistoryView />);

    expect(await screen.findByRole("link", { name: "Aurora" })).toHaveAttribute(
      "href",
      "/artist/Aurora",
    );
  });

  it("explains itself instead of rendering an empty list", async () => {
    render(<HistoryView />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Nothing here yet" })).toBeInTheDocument(),
    );
    expect(screen.queryAllByTestId("history-row")).toHaveLength(0);
  });

  it("states that the record is local, unranked, and bounded", async () => {
    render(<HistoryView />);

    // The requirement forbids a completeness/ranking/sharing claim, so the
    // surface says what the record is and nothing more.
    expect(screen.getByText(/not a ranking/i)).toBeInTheDocument();
    expect(screen.getByText(/not shared/i)).toBeInTheDocument();
    // It also discloses its own window, because "the local record" over a
    // bounded list would be a completeness claim the page cannot support.
    expect(screen.getByText(/most recent plays/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${RECENT_HISTORY_LIMIT}`))).toBeInTheDocument();
  });

  it("shows no total, ranking, or completeness claim even with plays present", async () => {
    await seed([
      event(),
      event({
        id: "e2",
        trackId: "youtube:bbb",
        track: playedTrack({ id: "youtube:bbb", providerId: "bbb", title: "Beta" }),
      }),
    ]);
    render(<HistoryView />);
    await waitFor(() => expect(screen.getAllByTestId("history-row")).toHaveLength(2));

    // A negative assertion, so adding "Total listening time: 12 min" or
    // "your complete history" to this surface fails the suite rather than
    // shipping a claim the device cannot support.
    const view = screen.getByTestId("history-view").textContent ?? "";
    for (const claim of [
      /total/i,
      /listening time/i,
      /you listened/i,
      /complete/i,
      /every (?:track|song) you/i,
      /most played/i,
      /top (?:track|artist|song)/i,
    ]) {
      expect(view, claim.source).not.toMatch(claim);
    }
  });

  it("clears the history from the surface, emptying both the list and storage", async () => {
    await seed([
      event(),
      event({
        id: "e2",
        trackId: "youtube:bbb",
        track: playedTrack({ id: "youtube:bbb", providerId: "bbb", title: "Beta" }),
      }),
    ]);
    render(<HistoryView />);
    await waitFor(() => expect(screen.getAllByTestId("history-row")).toHaveLength(2));

    fireEvent.click(screen.getByTestId("history-clear"));

    await waitFor(() => expect(screen.queryAllByTestId("history-row")).toHaveLength(0));
    expect(screen.getByRole("heading", { name: "Nothing here yet" })).toBeInTheDocument();
    expect(await (await getLocalData()).listeningHistory.list()).toEqual([]);
  });

  it("disables the clear action when there is nothing to clear", async () => {
    render(<HistoryView />);
    await waitFor(() => expect(screen.getByTestId("history-clear")).toBeDisabled());
  });
});
