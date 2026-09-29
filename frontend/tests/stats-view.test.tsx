import "fake-indexeddb/auto";
import { configure, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ListeningEventRecord } from "@/data/repositories";
import { getLocalData } from "@/data/localData";
import { formatDuration, StatsView } from "@/features/insights/StatsView";
import { resetHistoryStore, useHistoryStore } from "@/stores/historyStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M11 task 4.2: the statistics surface.
 *
 * The requirement it has to satisfy is that the numbers are *derived*: every case
 * here writes raw events, reads the surface, and then checks that clearing or
 * deleting the events changes the report with no invalidation step — because no
 * aggregate exists to go stale.
 */

// Cold fake-indexeddb hydration can exceed the 1s default (settings precedent).
configure({ asyncUtilTimeout: 5000 });

const trackAlpha = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Alpha",
  artists: [{ name: "Aurora" }],
  language: "en",
});
const trackBeta = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Beta",
  artists: [{ name: "Aurora" }],
  language: "ja",
});
const trackNoLanguage = makeTrack({
  id: "youtube:ccc",
  providerId: "ccc",
  title: "Gamma",
  artists: [{ name: "Beacon" }],
});

function event(overrides: Partial<ListeningEventRecord> = {}): ListeningEventRecord {
  return {
    id: "e1",
    trackId: "youtube:aaa",
    track: trackAlpha,
    playedAt: Date.now() - 3_600_000,
    secondsPlayed: 200,
    completed: true,
    context: "home",
    ...overrides,
  };
}

async function seed(events: ListeningEventRecord[]): Promise<void> {
  const data = await getLocalData();
  await data.listeningHistory.clear();
  for (const entry of events) await data.listeningHistory.record(entry);
  // The surface re-reads on a change signal from the store, so the window is
  // refreshed the same way a real play would refresh it.
  await useHistoryStore.getState().hydrate();
}

beforeEach(async () => {
  resetHistoryStore();
  const data = await getLocalData();
  await data.listeningHistory.clear();
});

afterEach(() => {
  useHistoryStore.setState({ events: [] });
});

describe("formatDuration", () => {
  it("reads the way a person would say it", () => {
    expect(formatDuration(0)).toBe("0 sec");
    expect(formatDuration(13)).toBe("13 sec");
    expect(formatDuration(59)).toBe("59 sec");
    expect(formatDuration(60)).toBe("1 min");
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(3750)).toBe("1 h 2 min");
  });

  it("never reports a minute of listening as zero minutes", () => {
    // Four 13-second plays is nearly a minute of listening; truncating that to
    // "0 min" would report a floor as a total.
    expect(formatDuration(52)).not.toMatch(/^0 /u);
  });
});

describe("StatsView", () => {
  it("explains itself on a fresh install instead of showing zeroes", async () => {
    await seed([]);
    render(<StatsView />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Nothing here yet" })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("stats-total-time")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stats-top-tracks")).not.toBeInTheDocument();
  });

  it("reports total listening time, play count, and the verdict summary", async () => {
    await seed([
      event({ id: "a", secondsPlayed: 200, playedAt: Date.now() - 7_200_000 }),
      // 20s of a 249s track: past the 10s skip threshold, short of the 30s
      // minimum and of half the duration, so it is a partial play.
      event({
        id: "b",
        trackId: "youtube:bbb",
        track: trackBeta,
        secondsPlayed: 20,
        completed: false,
        playedAt: Date.now() - 3_600_000,
      }),
      event({
        id: "c",
        trackId: "youtube:ccc",
        track: trackNoLanguage,
        secondsPlayed: 2,
        completed: false,
        skipped: true,
        playedAt: Date.now() - 1_800_000,
      }),
    ]);
    render(<StatsView />);

    // 220s across two non-skipped plays; the skip adds no time and no play.
    await waitFor(() => expect(screen.getByTestId("stats-total-time")).toHaveTextContent("3 min"));
    expect(screen.getByTestId("stats-play-count")).toHaveTextContent("2");
    expect(screen.getByTestId("stats-verdicts")).toHaveTextContent("1 played through");
    expect(screen.getByTestId("stats-verdicts")).toHaveTextContent("1 partly");
    expect(screen.getByTestId("stats-verdicts")).toHaveTextContent("1 skipped");
  });

  it("reports top tracks and top artists", async () => {
    await seed([
      event({ id: "a" }),
      event({ id: "b", playedAt: Date.now() - 7_200_000 }),
      event({
        id: "c",
        trackId: "youtube:bbb",
        track: trackBeta,
        playedAt: Date.now() - 10_800_000,
      }),
    ]);
    render(<StatsView />);

    const tracks = await screen.findByTestId("stats-top-tracks");
    expect(within(tracks).getByText("Alpha")).toBeInTheDocument();
    expect(within(tracks).getByText("Beta")).toBeInTheDocument();

    const artists = screen.getByTestId("stats-top-artists");
    // Both plays credit Aurora, so she leads with 2.
    expect(within(artists).getByText("Aurora")).toBeInTheDocument();
  });

  it("breaks down languages only where the recorded metadata has one", async () => {
    await seed([
      event({ id: "a", track: trackAlpha }),
      event({ id: "b", trackId: "youtube:bbb", track: trackBeta }),
      event({ id: "c", trackId: "youtube:ccc", track: trackNoLanguage }),
    ]);
    render(<StatsView />);

    const breakdown = await screen.findByTestId("stats-breakdown");
    expect(within(breakdown).getByText("Languages")).toBeInTheDocument();
    expect(within(breakdown).getByText("English")).toBeInTheDocument();
    // The track with no recorded language is left out, not assigned a value.
    expect(within(breakdown).queryByText("Unknown")).not.toBeInTheDocument();
    const languageRows = within(breakdown).getByText("Languages").closest("div");
    expect(languageRows).not.toBeNull();
  });

  it("reports both streaks", async () => {
    const day = 24 * 60 * 60 * 1000;
    await seed([
      event({ id: "a", playedAt: Date.now() - day * 2 }),
      event({ id: "b", playedAt: Date.now() - day }),
      event({ id: "c", playedAt: Date.now() - 60_000 }),
      event({ id: "d", playedAt: Date.now() - 30_000 }),
    ]);
    render(<StatsView />);

    await waitFor(() => expect(screen.getByTestId("stats-current-streak")).toHaveTextContent("3"));
    expect(screen.getByTestId("stats-longest-streak")).toHaveTextContent("Longest: 3");
  });

  it("labels every statistic as derived from this device's record", async () => {
    await seed([event()]);
    render(<StatsView />);

    await screen.findByTestId("stats-time");
    const labels = screen.getAllByText(/Derived from this device/i);
    expect(labels.length).toBeGreaterThanOrEqual(4);
  });

  it("changes the reported numbers when history is cleared, with no invalidation step", async () => {
    await seed([event({ id: "a" }), event({ id: "b", playedAt: Date.now() - 7_200_000 })]);
    render(<StatsView />);
    await waitFor(() => expect(screen.getByTestId("stats-play-count")).toHaveTextContent("2"));

    // Clearing storage and refreshing the store window is the whole "invalidation"
    // story: there is no stored aggregate to clear, expire, or recompute.
    await (await getLocalData()).listeningHistory.clear();
    await useHistoryStore.getState().hydrate();

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Nothing here yet" })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("stats-play-count")).not.toBeInTheDocument();
  });

  it("reports only what remains after history is deleted", async () => {
    const data = await getLocalData();
    await data.listeningHistory.record(event({ id: "a" }));
    await data.listeningHistory.record(
      event({ id: "b", trackId: "youtube:bbb", track: trackBeta, playedAt: Date.now() - 60_000 }),
    );
    await data.listeningHistory.record(
      event({
        id: "c",
        trackId: "youtube:ccc",
        track: trackNoLanguage,
        playedAt: Date.now() - 120_000,
      }),
    );
    await useHistoryStore.getState().hydrate();
    render(<StatsView />);
    await waitFor(() => expect(screen.getByTestId("stats-play-count")).toHaveTextContent("3"));

    // Only Aurora's plays remain. The statistics must follow the events, not a
    // cached summary of the ones that used to be there.
    await data.listeningHistory.clear();
    await data.listeningHistory.record(event({ id: "d" }));
    await useHistoryStore.getState().hydrate();

    await waitFor(() => expect(screen.getByTestId("stats-play-count")).toHaveTextContent("1"));
    const tracks = screen.getByTestId("stats-top-tracks");
    expect(within(tracks).queryByText("Beta")).not.toBeInTheDocument();
    const artists = screen.getByTestId("stats-top-artists");
    expect(within(artists).queryByText("Beacon")).not.toBeInTheDocument();
  });
});
