import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListeningEventRecord, MixRecord, Track } from "@/data/repositories";
import { getLocalData } from "@/data/localData";
import { MixList } from "@/features/mixes/MixList";
import { resetMixStore, useMixStore } from "@/stores/mixStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";
import { resetPreferencesStore, usePreferencesStore } from "@/stores/preferencesStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M11 task 4.3: the Smart Mix surface.
 *
 * What is pinned: mixes listed by name with their track counts, a play action and
 * a refresh action, the "nothing to build from yet" state when the profile has no
 * signal, and — the requirement the surface is most easily tempted to break —
 * that opening it plays nothing.
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

const FEED_TRACKS: Track[] = Array.from({ length: 6 }, (_unused, index) =>
  makeTrack({
    id: `youtube:feed${index}`,
    providerId: `feed${index}`,
    title: `Feed Song ${index}`,
    artists: [{ name: "Aurora" }],
  }),
);

function mix(overrides: Partial<MixRecord> = {}): MixRecord {
  return {
    id: "mix:2026-09-30:aurora",
    name: "Aurora",
    generatedAt: 1_700_000_000_000,
    period: "2026-09-30",
    seeds: ["Aurora"],
    tracks: FEED_TRACKS,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** Give the device a taste signal: one liked track is enough. */
async function seedSignal(): Promise<void> {
  const data = await getLocalData();
  await data.likedTracks.like(
    makeTrack({ id: "youtube:liked1", providerId: "liked1", title: "Liked" }),
    Date.now(),
  );
  await useMixStore.getState().hydrate();
}

/** The rendered mix rows; each row's own testid also carries its mix id. */
function mixRows(): HTMLElement[] {
  return screen.getAllByTestId(/^mix-row-/);
}

/** Stub the discovery endpoint the mix feed is composed from. */
function stubFeed(tracks: Track[] = FEED_TRACKS): () => string[] {
  const kinds: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      kinds.push(url.searchParams.get("kind") ?? "");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ tracks, diagnostics: {} }),
      } as unknown as Response);
    }),
  );
  return () => kinds;
}

beforeEach(async () => {
  resetMixStore();
  resetPlayerStore();
  resetQueueStore();
  resetPreferencesStore();
  usePreferencesStore.setState({
    languages: ["en"],
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
  const data = await getLocalData();
  await data.mixes.clear();
  await data.likedTracks.clear();
  await data.listeningHistory.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MixList", () => {
  it("lists mixes by name with their track counts", async () => {
    const data = await getLocalData();
    await data.mixes.create(mix());
    await data.mixes.create(
      mix({
        id: "mix:other",
        name: "Beacon",
        updatedAt: 1_700_000_100_000,
        tracks: FEED_TRACKS.slice(0, 2),
      }),
    );
    render(<MixList />);

    await waitFor(() => expect(mixRows()).toHaveLength(2));
    const rows = mixRows();
    // Newest generation first, as the repository lists them.
    expect(within(rows[0]).getByText("Beacon")).toBeInTheDocument();
    expect(within(rows[0]).getByText("2 songs")).toBeInTheDocument();
    expect(within(rows[1]).getByText("6 songs")).toBeInTheDocument();
  });

  it("plays nothing when it opens", async () => {
    const data = await getLocalData();
    await data.mixes.create(mix());
    render(<MixList />);

    await waitFor(() => expect(mixRows()).toHaveLength(1));
    expect(usePlayerStore.getState().currentTrack).toBeNull();
  });

  it("generates no mix and explains why when the profile has no signal", async () => {
    const kinds = stubFeed();
    render(<MixList />);
    await screen.findByTestId("mix-generate");

    fireEvent.click(screen.getByTestId("mix-generate"));

    await waitFor(() => expect(screen.getByTestId("mix-no-signal")).toBeInTheDocument());
    expect(screen.getByTestId("mix-no-signal")).toHaveTextContent(/after some listening/i);
    // No provider spend, and nothing invented to show.
    expect(kinds()).toEqual([]);
    expect(await (await getLocalData()).mixes.list()).toEqual([]);
  });

  it("generates a mix from the local profile and lists it by name", async () => {
    await seedSignal();
    const kinds = stubFeed();
    render(<MixList />);
    await screen.findByTestId("mix-generate");

    fireEvent.click(screen.getByTestId("mix-generate"));

    await waitFor(() => expect(mixRows()).toHaveLength(1));
    // Every track came from the one feed kind the product already had.
    expect(kinds()).toContain("mix");
    expect(kinds().every((kind) => kind === "mix")).toBe(true);
    expect(screen.getByText("Aurora")).toBeInTheDocument();
    expect(await (await getLocalData()).mixes.list()).toHaveLength(1);
  });

  it("plays a mix when asked, as the queue's library collection", async () => {
    const data = await getLocalData();
    await data.mixes.create(mix());
    render(<MixList />);

    const play = await screen.findByRole("button", { name: "Play Aurora" });
    fireEvent.click(play);

    await waitFor(() => expect(usePlayerStore.getState().currentTrack?.id).toBe("youtube:feed0"));
    // The whole mix is the traversal context, so the next track continues it.
    expect(useQueueStore.getState().queue.map((track) => track.id)).toEqual(
      FEED_TRACKS.map((track) => track.id),
    );
    // Recorded as a local collection, not as a radio: a mix is a named list.
    expect(useQueueStore.getState().source).toBe("library");
  });

  it("refreshes a mix, keeping its identity and name", async () => {
    const data = await getLocalData();
    await data.mixes.create(mix());
    // A refresh re-derives from the *current* profile, so the device needs the
    // taste signal the original generation had.
    await seedSignal();
    const replacement = FEED_TRACKS.map((track) => ({
      ...track,
      id: track.id.replace("feed", "new"),
      providerId: track.providerId.replace("feed", "new"),
    }));
    stubFeed(replacement);
    render(<MixList />);

    const refresh = await screen.findByTestId(`mix-refresh-${mix().id}`);
    fireEvent.click(refresh);

    await waitFor(() => expect(screen.getByText("Refreshed")).toBeInTheDocument());
    const stored = await data.mixes.get(mix().id);
    expect(stored).toBeDefined();
    expect(stored?.name).toBe("Aurora");
    expect(stored?.tracks[0]?.providerId).toBe("new0");
    // One record, still named the same: a refresh is not a new mix.
    expect(await data.mixes.list()).toHaveLength(1);
  });

  it("says so when a refresh cannot find anything new, leaving the mix openable", async () => {
    const data = await getLocalData();
    await data.mixes.create(mix());
    await seedSignal();
    // The same tracks the mix already holds, so nothing new can be added.
    stubFeed(FEED_TRACKS);
    render(<MixList />);

    const refresh = await screen.findByTestId(`mix-refresh-${mix().id}`);
    fireEvent.click(refresh);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/No new tracks/i));
    expect(await screen.findByRole("button", { name: "Play Aurora" })).toBeInTheDocument();
    expect((await data.mixes.get(mix().id))?.tracks).toHaveLength(FEED_TRACKS.length);
  });

  it("reports a provider failure as a failure rather than as missing signal", async () => {
    await seedSignal();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({ error: { code: "upstream_unavailable" } }),
        } as unknown as Response),
      ),
    );
    render(<MixList />);
    await screen.findByTestId("mix-generate");

    fireEvent.click(screen.getByTestId("mix-generate"));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // The two states are different: one means "you have not listened", the other
    // means "the request failed".
    expect(screen.queryByTestId("mix-no-signal")).not.toBeInTheDocument();
  });

  it("explains an empty mix list instead of rendering nothing", async () => {
    render(<MixList />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "No mixes yet" })).toBeInTheDocument(),
    );
    expect(screen.queryAllByTestId(/^mix-row-/)).toHaveLength(0);
  });

  it("hides the generate action where the section is list-only", async () => {
    const data = await getLocalData();
    await data.mixes.create(mix());
    render(<MixList title="Smart Mixes" showGenerate={false} />);

    await waitFor(() => expect(mixRows()).toHaveLength(1));
    expect(screen.queryByTestId("mix-generate")).not.toBeInTheDocument();
  });

  it("does not autoplay after a recorded play either", async () => {
    const data = await getLocalData();
    const event: ListeningEventRecord = {
      id: "e1",
      trackId: "youtube:feed0",
      track: FEED_TRACKS[0],
      playedAt: Date.now(),
      secondsPlayed: 120,
      completed: true,
      context: "home",
    };
    await data.listeningHistory.record(event);
    render(<MixList />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "No mixes yet" })).toBeInTheDocument(),
    );
    expect(usePlayerStore.getState().currentTrack).toBeNull();
  });
});
