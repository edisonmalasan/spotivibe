import "fake-indexeddb/auto";
import { act, configure, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NowPlayingPage from "@/app/now-playing/page";
import type { Track } from "@/data/repositories";
import {
  RadioStartedTracker,
  useRadioPlayedTracker,
} from "@/features/personalization/RadioStartedTracker";
import { resetRefillChannel } from "@/features/personalization/RefillAgent";
import { resetHistoryStore } from "@/stores/historyStore";
import { resetLibraryStore } from "@/stores/libraryStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetPreferencesStore } from "@/stores/preferencesStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";
import { resetRadioStore, useRadioStore } from "@/stores/radioStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M10 task 5.3 plus the radio's played-set observer (spec `radio` — "Radio entry
 * points" / "Played-track dedupe"; design §3/§6).
 *
 * Two things only a mounted surface can be wrong about:
 *
 * - **The played tracker.** It is the single writer of the radio's played set,
 *   so "records what this radio played and nothing else" has to be observed
 *   across radio starts, stops, and track changes — not inferred from the
 *   store's own dedupe.
 * - **The Now Playing radio action and indicator.** The spec's negative case is
 *   that the action must be *absent* without a seed rather than rendered
 *   disabled, which is a DOM question; and the indicator has to track the real
 *   radio store rather than a local flag.
 *
 * The search-menu and artist-page entry points live in `search-menu.test.tsx`
 * and `artist-view.test.tsx`, beside the behaviour each one already covers.
 */

// Cold fake-indexeddb hydration plus a request round trip can exceed 1s.
configure({ asyncUtilTimeout: 5000 });

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), forward: vi.fn(), push, replace: vi.fn() }),
}));

const current = makeTrack({ id: "youtube:cur", providerId: "cur", title: "Midnight" });
const other = makeTrack({ id: "youtube:oth", providerId: "oth", title: "Daylight" });

function radioTrack(id: string): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Radio ${id}`,
    artists: [{ name: "Daft Punk" }],
    qualityScore: 50,
  });
}

/** A 200 radio answer with the given tracks. */
function stubFeed(tracks: Track[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ tracks, variant: 0 }),
        }) as unknown as Response,
    ),
  );
}

/** Let the mount effects and their synchronous store writes settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  resetPlayerStore();
  resetQueueStore();
  resetRadioStore();
  resetHistoryStore();
  resetLibraryStore();
  resetPreferencesStore();
  resetRefillChannel();
  push.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the played tracker", () => {
  it("records what the active radio played and nothing outside a radio", async () => {
    renderHook(() => useRadioPlayedTracker());
    usePlayerStore.getState().playTrack(current, [current]);

    // No radio: the track plays, but there is no session to scope a played set
    // to, so nothing is recorded — the next radio has never played it.
    await settle();
    expect(useRadioStore.getState().playedIds).toEqual([]);

    // A radio starts; the track it is already playing is part of its life.
    act(() => useRadioStore.getState().startRadio({ kind: "track", track: current }));
    await settle();
    expect(useRadioStore.getState().playedIds).toEqual([current.id]);

    // The next step is recorded too, in play order.
    act(() => usePlayerStore.getState().next());
    await act(async () => {
      usePlayerStore.setState({ currentTrack: other });
    });
    await settle();
    expect(useRadioStore.getState().playedIds).toEqual([current.id, other.id]);

    // The radio ends: the set is scoped to its life and goes with it.
    act(() => useRadioStore.getState().stopRadio());
    act(() => usePlayerStore.setState({ currentTrack: current }));
    await settle();
    expect(useRadioStore.getState().playedIds).toEqual([]);
  });

  it("is idempotent: re-renders, a repeated track, and a restart never grow the set", async () => {
    renderHook(() => useRadioPlayedTracker());
    act(() => useRadioStore.getState().startRadio({ kind: "track", track: current }));
    act(() => usePlayerStore.setState({ currentTrack: current }));
    await settle();
    expect(useRadioStore.getState().playedIds).toEqual([current.id]);

    // Position ticks re-render the observer constantly during playback; none of
    // them may add a second copy of the same track.
    for (const seconds of [1, 2, 3]) {
      act(() => usePlayerStore.getState()._setPosition(seconds));
      await settle();
    }
    expect(useRadioStore.getState().playedIds).toEqual([current.id]);

    // A restart on the same track (the user hit play again) is still one play.
    act(() => usePlayerStore.getState().playTrack(current, [current]));
    await settle();
    expect(useRadioStore.getState().playedIds).toEqual([current.id]);
  });

  it("starts nothing: mounting the tracker issues no request and moves no pointer", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    useRadioStore.getState().startRadio({ kind: "track", track: current });
    usePlayerStore.getState().playTrack(current, [current, other]);

    render(<RadioStartedTracker />);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentTrack?.id).toBe(current.id);
    expect(useQueueStore.getState().queueIndex).toBe(0);
    expect(usePlayerStore.getState().loadRequest?.mode).toBe("load");
  });
});

describe("Now Playing: the radio action", () => {
  it("is not offered at all when there is no current track", () => {
    render(<NowPlayingPage />);

    // Omitted rather than disabled: a radio needs a seed, and an action the
    // surface cannot perform is an affordance the user should not be given.
    expect(screen.queryByRole("button", { name: "Start track radio" })).toBeNull();
    expect(screen.queryByTestId("now-playing-radio")).toBeNull();
    expect(screen.queryByTestId("now-playing-radio-indicator")).toBeNull();
  });

  it("appears with a current track and starts one radio for it", async () => {
    stubFeed([radioTrack("r1"), radioTrack("r2")]);
    usePlayerStore.getState().playTrack(current, [current]);
    render(<NowPlayingPage />);

    const action = screen.getByRole("button", { name: "Start track radio" });
    expect(action).toBeEnabled();
    act(() => {
      action.click();
    });
    await settle();

    expect(useRadioStore.getState().seed).toEqual({ kind: "track", track: current });
    expect(useQueueStore.getState().source).toBe("radio");
    expect(useQueueStore.getState().queue.map((track) => track.id)).toEqual([
      "youtube:r1",
      "youtube:r2",
    ]);
    expect(usePlayerStore.getState().currentTrack?.id).toBe("youtube:r1");
  });

  it("shows no indicator while an ordinary queue plays, and one once a radio starts", async () => {
    stubFeed([radioTrack("r1")]);
    usePlayerStore.getState().playTrack(current, [current]);
    render(<NowPlayingPage />);

    expect(screen.queryByTestId("now-playing-radio-indicator")).toBeNull();

    act(() => {
      screen.getByRole("button", { name: "Start track radio" }).click();
    });
    await settle();

    const indicator = await screen.findByTestId("now-playing-radio-indicator");
    expect(indicator).toHaveTextContent("Radio");
  });

  it("tracks the radio ending: the indicator follows the store, not a local flag", async () => {
    stubFeed([radioTrack("r1")]);
    act(() => useRadioStore.getState().startRadio({ kind: "track", track: current }));
    usePlayerStore.getState().playTrack(current, [current]);
    render(<NowPlayingPage />);

    expect(await screen.findByTestId("now-playing-radio-indicator")).toBeInTheDocument();

    // An ended radio has no material left and is no longer refilled: the label
    // has to go with it.
    act(() => useRadioStore.getState().setStatus("ended"));
    await settle();
    expect(screen.queryByTestId("now-playing-radio-indicator")).toBeNull();
  });

  it("offers a non-blocking retry when a start could not be completed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    usePlayerStore.getState().playTrack(current, [current]);
    render(<NowPlayingPage />);

    act(() => {
      screen.getByRole("button", { name: "Start track radio" }).click();
    });
    await settle();

    // The refusal is reported in a polite region beside the transport: the
    // queue and the playing track are untouched, and nothing modal appeared.
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/radio request failed/i);
    expect(useQueueStore.getState().source).toBe("unknown");
    expect(usePlayerStore.getState().currentTrack?.id).toBe(current.id);

    // The retry is the same action, offered again — and it recovers.
    stubFeed([radioTrack("r1")]);
    act(() => {
      screen.getByRole("button", { name: "Try again" }).click();
    });
    await settle();

    expect(useQueueStore.getState().source).toBe("radio");
    await act(async () => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
