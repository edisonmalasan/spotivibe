// The Now Playing route hydrates the library store on mount, which reaches
// IndexedDB — so this file needs the fake implementation the other route tests
// import, or the hydration rejects as an unhandled error.
import "fake-indexeddb/auto";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopRadio } from "@/features/personalization/startRadio";
import { resetRefillChannel } from "@/features/personalization/RefillAgent";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetRadioStore, useRadioStore } from "@/stores/radioStore";
import { resetPreferencesStore, usePreferencesStore } from "@/stores/preferencesStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M10: a radio is a **mode of the one queue** (design §1), and the surfaces that
 * show playback must therefore agree with each other while one is playing — and
 * must let go of it when the queue moves on.
 *
 * The first half of this suite is the structural claim made behavioral: a track
 * change while a radio plays is visible identically in the player bar, the queue
 * view, and Now Playing. The second half is the lifecycle the M10 evidence run
 * forced: a radio that is not ended when ordinary playback takes over keeps
 * refilling somebody else's queue and keeps claiming the indicator.
 */

// The Now Playing page is a route component: it reads the router, so the app
// router has to be mounted for it to render at all (same stub as routes.test.tsx).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), forward: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const seed = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Alpha",
  artists: [{ name: "Aurora" }],
  artwork: [{ url: "https://example.test/a.jpg" }],
  durationSeconds: 200,
});
const second = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Bravo",
  artists: [{ name: "Aurora" }],
  artwork: [{ url: "https://example.test/b.jpg" }],
  durationSeconds: 200,
});
const elsewhere = makeTrack({
  id: "youtube:zzz",
  providerId: "zzz",
  title: "Somewhere Else",
  artists: [{ name: "Other" }],
  durationSeconds: 200,
});

function stubRadioFeed(tracks: Track[] = [second]) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          tracks,
          variant: 1,
          diagnostics: {
            seedsTried: 1,
            seedsFailed: [],
            seedsSkipped: [],
            resultCount: tracks.length,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  );
}

type Track = (typeof seed)[][number];

beforeEach(() => {
  resetPlayerStore();
  resetRadioStore();
  resetQueueStore();
  resetPreferencesStore();
  resetRefillChannel();
  vi.stubGlobal("fetch", stubRadioFeed());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a radio shares the one player state across every surface", () => {
  it("shows the same current track in the player region, the queue, and Now Playing", async () => {
    usePlayerStore.getState().playTrack(seed, [seed, second], "radio");
    useRadioStore.getState().startRadio({ kind: "track", track: seed });

    const { PlayerBar } = await import("@/components/layout/PlayerBar");
    const { QueueView } = await import("@/features/queue/QueueView");
    const { default: NowPlaying } = await import("@/app/now-playing/page");

    const barRoot = render(<PlayerBar />);
    const queueRoot = render(<QueueView />);
    const nowPlayingRoot = render(<NowPlaying />);
    // RTL's render result queries `document.body`, so all three surfaces would be
    // searched together and every assertion below would pass for the wrong
    // reason. Each query is therefore scoped to its own render root.
    const bar = within(barRoot.container);
    const queue = within(queueRoot.container);
    const nowPlaying = within(nowPlayingRoot.container);

    // Every surface agrees on the track before anything changes.
    expect(bar.getByText("Alpha")).toBeInTheDocument();
    expect(queue.getByText("Alpha")).toBeInTheDocument();
    expect(await nowPlaying.findByTestId("now-playing-title")).toHaveTextContent("Alpha");

    // Advancing playback — the same transport the Next control uses — moves all
    // three surfaces, because they all read the one player/queue pair.
    act(() => {
      usePlayerStore.getState().next();
    });

    await waitFor(() => {
      expect(bar.getByText("Bravo")).toBeInTheDocument();
    });
    expect(queue.getByText("Bravo")).toBeInTheDocument();
    expect(await nowPlaying.findByTestId("now-playing-title")).toHaveTextContent("Bravo");
    // And the track that stopped playing is gone from the player region.
    expect(bar.queryByText("Alpha")).toBeNull();

    // The radio itself is untouched by an ordinary advance: it is still the
    // radio's queue, still radio-sourced, still refilling.
    expect(useQueueStore.getState().source).toBe("radio");
    expect(useRadioStore.getState().status).toBe("active");
  });
});

describe("a radio ends when the queue moves to an ordinary context", () => {
  it("stops the radio when ordinary playback replaces the queue's context", async () => {
    // Autofill is switched off for this case so the assertion is about the *radio*
    // only: with it on, the one-track ordinary queue is legitimately below the
    // low-water mark and autofill (a different policy) grows it.
    usePreferencesStore.setState({ autofillQueue: false });
    const { RefillAgent } = await import("@/features/personalization/RefillAgent");
    usePlayerStore.getState().playTrack(seed, [seed, second], "radio");
    useRadioStore.getState().startRadio({ kind: "track", track: seed });
    render(<RefillAgent />);

    // The user then plays something of their own choosing: the queue's source
    // leaves the radio, and the radio must not survive it.
    act(() => {
      usePlayerStore.getState().playTrack(elsewhere, [elsewhere], "search");
    });

    await waitFor(() => {
      expect(useRadioStore.getState().seed).toBeNull();
    });
    expect(useRadioStore.getState().status).toBe("idle");
    // The queue is the user's own again — the radio neither refilled it nor kept
    // any of its identity.
    expect(useQueueStore.getState().queue.map((track) => track.id)).toEqual([elsewhere.id]);
    expect(useQueueStore.getState().source).toBe("search");
  });

  it("leaves an already-ended radio alone", async () => {
    const { RefillAgent } = await import("@/features/personalization/RefillAgent");
    usePlayerStore.getState().playTrack(seed, [seed, second], "radio");
    useRadioStore.getState().startRadio({ kind: "track", track: seed });
    useRadioStore.getState().setStatus("ended", "no material left");
    render(<RefillAgent />);

    act(() => {
      usePlayerStore.getState().playTrack(elsewhere, [elsewhere], "search");
    });

    // An ended radio is already over; stopping it is a no-op rather than an error.
    expect(useQueueStore.getState().source).toBe("search");
  });
});

describe("the radio is cancelable by a user", () => {
  it("ends the radio and leaves the queue playing", () => {
    usePlayerStore.getState().playTrack(seed, [seed, second], "radio");
    useRadioStore.getState().startRadio({ kind: "track", track: seed });

    act(() => {
      stopRadio();
    });

    expect(useRadioStore.getState().seed).toBeNull();
    expect(usePlayerStore.getState().currentTrack?.id).toBe(seed.id);
    expect(useQueueStore.getState().queue).toHaveLength(2);
  });

  it("offers the same control to end a radio it started", async () => {
    const { default: NowPlaying } = await import("@/app/now-playing/page");
    usePlayerStore.getState().playTrack(seed, [seed, second], "radio");
    useRadioStore.getState().startRadio({ kind: "track", track: seed });
    vi.stubGlobal("fetch", stubRadioFeed([second]));

    const view = render(<NowPlaying />);
    const control = await view.findByTestId("now-playing-radio");

    // One control, two meanings, and the label says which one it is right now.
    expect(control.getAttribute("aria-label")).toBe("End radio");
    fireEvent.click(control);
    await waitFor(() => {
      expect(useRadioStore.getState().seed).toBeNull();
    });
    // The queue is untouched: ending a radio is not a playback action, and the
    // queue keeps the source it was built with.
    expect(usePlayerStore.getState().currentTrack?.id).toBe(seed.id);
    expect(useQueueStore.getState().source).toBe("radio");
    // The control flips back to offering a radio again.
    expect(control.getAttribute("aria-label")).toBe("Start track radio");
  });
});
