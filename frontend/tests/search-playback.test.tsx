import "fake-indexeddb/auto";
import type { Track } from "@/data/repositories";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "@/app/search/page";
import { PlayerBar } from "@/components/layout/PlayerBar";
import { SEARCH_DEBOUNCE_MS } from "@/features/search/useSearchController";
import { resetPlayerStore, setPlaybackBridge, usePlayerStore } from "@/stores/playerStore";
import { resetSearchStore, useSearchStore } from "@/stores/searchStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Playback affordance coverage (tasks 4.1/4.2, spec "Playback from search
 * results"): explicit activation starts playback with the result set as
 * queue context and the player region reflects it, while rendering results
 * never starts playback on its own.
 */

const nav = vi.hoisted(() => ({
  q: "",
  back: vi.fn(),
  forward: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(nav.q === "" ? {} : { q: nav.q }),
}));

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

const FAKED_TIMERS = ["setTimeout", "clearTimeout"] as const;

const trackA = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Karma Police",
  artists: [{ name: "Radiohead" }],
  album: { title: "OK Computer" },
});
const trackB = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Weird Fishes",
  artists: [{ name: "Radiohead" }],
  album: { title: "In Rainbows" },
});

function okResponse(tracks: Track[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ tracks, diagnostics: {} }),
  } as unknown as Response;
}

function stubSuccessfulFetch(tracks: Track[]) {
  const mock = vi.fn(async () => okResponse(tracks));
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function passDebounce(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
  await flush();
}

beforeEach(() => {
  resetSearchStore();
  resetPlayerStore();
  nav.q = "";
  vi.useFakeTimers({ toFake: [...FAKED_TIMERS] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountSearchWithPlayer() {
  return render(
    <>
      <SearchPage />
      <PlayerBar />
    </>,
  );
}

describe("playback from search results (task 4.1)", () => {
  it("activates a clicked result with the full result set as queue context", async () => {
    stubSuccessfulFetch([trackA, trackB]);
    nav.q = "radio";
    mountSearchWithPlayer();
    await passDebounce();

    const bar = screen.getByTestId("player-bar");
    expect(bar).toHaveTextContent("Nothing playing"); // no activation yet

    fireEvent.click(screen.getByRole("button", { name: "Play Weird Fishes" }));

    let state = usePlayerStore.getState();
    expect(state.currentTrack?.id).toBe(trackB.id);
    expect(state.status).toBe("loading");
    expect(state.loadRequest).toMatchObject({ videoId: "bbb", mode: "load" });
    // Full result set is the queue context, clicked track is current.
    expect(state.queue.map((track) => track.id)).toEqual([trackA.id, trackB.id]);
    expect(state.queueIndex).toBe(1);

    // The player region reflects the activated track.
    expect(bar).toHaveTextContent("Weird Fishes");
    expect(bar).toHaveTextContent("Radiohead");

    // Activating another result retargets the same queue.
    fireEvent.click(screen.getByRole("button", { name: "Play Karma Police" }));
    state = usePlayerStore.getState();
    expect(state.currentTrack?.id).toBe(trackA.id);
    expect(state.queueIndex).toBe(0);
    expect(state.queue.map((track) => track.id)).toEqual([trackA.id, trackB.id]);
  });
});

describe("search never autoplays (task 4.2)", () => {
  it("keeps playback idle through render, resolution, and query changes", async () => {
    const bridge = {
      play: vi.fn(),
      pause: vi.fn(),
      seekTo: vi.fn(),
      setVolume: vi.fn(),
      setMuted: vi.fn(),
    };
    setPlaybackBridge(bridge);
    stubSuccessfulFetch([trackA, trackB]);
    nav.q = "radio";
    mountSearchWithPlayer();

    await passDebounce();
    expect(screen.getByTestId("search-results")).toBeInTheDocument();

    let state = usePlayerStore.getState();
    expect(state.status).toBe("idle");
    expect(state.currentTrack).toBeNull();
    expect(state.loadRequest).toBeNull(); // no load request emitted
    expect(bridge.play).not.toHaveBeenCalled();

    // A follow-up search completing changes nothing either.
    act(() => useSearchStore.getState().setQuery("radiohead"));
    await passDebounce();
    expect(screen.getByTestId("search-results")).toBeInTheDocument();

    state = usePlayerStore.getState();
    expect(state.status).toBe("idle");
    expect(state.currentTrack).toBeNull();
    expect(state.loadRequest).toBeNull();
    expect(bridge.play).not.toHaveBeenCalled();
  });
});
