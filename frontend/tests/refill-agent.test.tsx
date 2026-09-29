import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueSource, Track } from "@/data/repositories";
import {
  LOW_WATER,
  RefillAgent,
  RefillFailureNotice,
  resetRefillChannel,
  useRefillAgent,
} from "@/features/personalization/RefillAgent";
import { resetHistoryStore, useHistoryStore } from "@/stores/historyStore";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetPreferencesStore, usePreferencesStore } from "@/stores/preferencesStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";
import { resetRadioStore, useRadioStore, type RadioSeed } from "@/stores/radioStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M10 tasks 4.2/4.3/4.4 (spec `radio` — "Radio refill" / "Queue autofill"; design
 * §5/§7): the mounted agent.
 *
 * The engine's decisions are unit-tested in `refill-engine.test.ts`; this file is
 * about the things only the *agent* can be wrong about: when it decides to ask,
 * that it asks once per low-water crossing, that it aborts when it goes away,
 * that the rotation advances only after a real append, and that a failure is
 * survivable — a non-blocking retry, no loop, and a graceful end when the
 * provider has nothing left.
 *
 * `fetch` is stubbed rather than the API module mocked, so every case also proves
 * the real request contract: the six documented query keys, the played set as the
 * bounded exclusion, and the abort signal the agent passes through.
 */

const current = makeTrack({ id: "youtube:cur", providerId: "cur", title: "One More Time" });
const upcomingA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const upcomingB = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Bravo" });
const upcomingC = makeTrack({ id: "youtube:ccc", providerId: "ccc", title: "Charlie" });
const radioSeedTrack = makeTrack({
  id: "youtube:seed",
  providerId: "seed",
  title: "Get Lucky",
  artists: [{ name: "Daft Punk" }],
});

const trackSeed: RadioSeed = { kind: "track", track: radioSeedTrack };

function radioTrack(id: string, qualityScore: number): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Radio ${id}`,
    artists: [{ name: "Daft Punk" }],
    qualityScore,
  });
}

interface Recorded {
  url: URL;
  signal: AbortSignal | undefined;
}

/** A body the client parser accepts. */
function okBody(tracks: Track[]): unknown {
  return { tracks, variant: 0 };
}

/** A structured error body the client maps onto a designed code. */
function errorBody(code: string): unknown {
  return { error: { code, message: `${code} happened` } };
}

/**
 * A fetch stub with two modes: a fixed reply per call, or a call that stays open
 * until the test settles it. The open mode is what makes "one request in flight"
 * and "one request per crossing" observable rather than a timing guess.
 */
function stubFetch(
  reply: (index: number) => { status: number; body: unknown } | { pending: true },
): {
  calls: Recorded[];
  settle: (index: number, outcome: { status: number; body: unknown }) => void;
} {
  const calls: Recorded[] = [];
  const open: Array<(outcome: { status: number; body: unknown }) => void> = [];
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const index = calls.length;
    calls.push({
      url: new URL(String(input), "http://localhost"),
      signal: init?.signal ?? undefined,
    });
    const outcome = reply(index);
    const answer = (settled: { status: number; body: unknown }): Promise<Response> =>
      Promise.resolve({
        ok: settled.status >= 200 && settled.status < 300,
        status: settled.status,
        json: async () => settled.body,
      } as unknown as Response);
    if ("pending" in outcome) {
      return new Promise<Response>((resolve, reject) => {
        open[index] = (settled) => resolve(answer(settled));
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }
    return answer(outcome);
  });
  vi.stubGlobal("fetch", mock);
  return {
    calls,
    settle: (index, outcome) => open[index]?.(outcome),
  };
}

/** Params of the nth recorded request. */
function paramsOf(call: Recorded): URLSearchParams {
  return call.url.searchParams;
}

function queueIds(): string[] {
  return useQueueStore.getState().queue.map((track) => track.id);
}

/** The upcoming sequence the queue view would display. */
function upcomingIds(): string[] {
  const { queue, queueIndex, playOrder } = useQueueStore.getState();
  const position = playOrder.indexOf(queueIndex);
  return playOrder.slice(position + 1).map((at) => queue[at].id);
}

/**
 * A radio queue with `upcoming` tracks behind the current one, playing. Three or
 * fewer is the low-water mark itself, so the default of 2 is already low.
 */
function seedRadioQueue({
  upcoming = 2,
  source = "radio",
}: { upcoming?: number; source?: QueueSource } = {}): void {
  const tail = [upcomingA, upcomingB, upcomingC, radioTrack("d", 50), radioTrack("e", 50)];
  const queue = [current, ...tail.slice(0, upcoming)];
  useQueueStore.setState({
    queue,
    queueIndex: 0,
    playOrder: queue.map((_, index) => index),
    history: [],
    source,
  });
  usePlayerStore.setState({ currentTrack: current, status: "playing" });
  useRadioStore.getState().startRadio(trackSeed);
  usePreferencesStore.setState({ autofillQueue: false });
}

/**
 * Let every pending effect and promise chain settle inside `act`. The cycle is
 * several awaits deep (fetch → json → parse → rank → append), so this drains the
 * microtask queue and crosses a macrotask turn rather than assuming one tick is
 * enough.
 */
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the agent: deciding when to ask", () => {
  it("asks for nothing while the queue is above the low-water mark", async () => {
    const { calls } = stubFetch(() => ({ status: 200, body: okBody([radioTrack("r1", 50)]) }));
    seedRadioQueue({ upcoming: LOW_WATER + 1 });

    render(<RefillAgent />);
    await settle();

    expect(calls).toHaveLength(0);
    expect(useRadioStore.getState().variant).toBe(0);
  });

  it("refills at the mark, appends the ranked order, and advances the rotation once", async () => {
    // Deliberately weakest-first: the appended order must be the *scored* order.
    const weak = radioTrack("weak", 10);
    const strong = radioTrack("strong", 90);
    const { calls } = stubFetch(() => ({ status: 200, body: okBody([weak, strong]) }));
    seedRadioQueue();

    render(<RefillAgent />);
    await settle();

    expect(calls).toHaveLength(1);
    // The growth plays next, strongest first, ahead of the queued entries.
    expect(upcomingIds()).toEqual([strong.id, weak.id, upcomingA.id, upcomingB.id]);
    // Nothing the user had was reordered or removed, and playback is untouched.
    expect(queueIds()[0]).toBe(current.id);
    expect(usePlayerStore.getState().currentTrack).toBe(current);
    expect(usePlayerStore.getState().status).toBe("playing");
    // Only a successful refill advances the counter.
    expect(useRadioStore.getState().variant).toBe(1);
    expect(useRadioStore.getState().status).toBe("active");
  });

  it("sends the radio's identity, its played set, and nothing else", async () => {
    const { calls } = stubFetch(() => ({ status: 200, body: okBody([radioTrack("r1", 50)]) }));
    seedRadioQueue();
    useRadioStore.setState({ playedIds: ["youtube:seed", "youtube:aaa"], variant: 2 });

    render(<RefillAgent />);
    await settle();

    const params = paramsOf(calls[0]);
    expect(params.get("kind")).toBe("track");
    expect(params.get("title")).toBe("Get Lucky");
    expect(params.get("artist")).toBe("Daft Punk");
    expect(params.get("variant")).toBe("2");
    expect(params.get("exclude")).toBe("youtube:seed,youtube:aaa");
    // The accepted surface is exactly the six documented keys — no liked track,
    // playlist, history, language, or profile parameter can be sent.
    expect([...params.keys()].sort()).toEqual([
      "artist",
      "exclude",
      "kind",
      "limit",
      "title",
      "variant",
    ]);
  });

  it("refuses a played or already-queued id even when the response carries it", async () => {
    const replayed = makeTrack({ id: "youtube:seed", providerId: "seed", title: "Get Lucky" });
    const alreadyQueued = makeTrack({ id: upcomingA.id, providerId: upcomingA.providerId });
    const sameProviderAsQueued = makeTrack({
      id: "youtube:other",
      providerId: upcomingA.providerId,
    });
    const { calls } = stubFetch(() => ({
      status: 200,
      body: okBody([replayed, alreadyQueued, sameProviderAsQueued, radioTrack("fresh", 50)]),
    }));
    seedRadioQueue();
    useRadioStore.setState({ playedIds: ["youtube:seed"] });

    render(<RefillAgent />);
    await settle();

    expect(calls).toHaveLength(1);
    // Design §3: the invariant is enforced client-side too.
    expect(queueIds()).toEqual([
      current.id,
      radioTrack("fresh", 50).id,
      upcomingA.id,
      upcomingB.id,
    ]);
    // The existing entry is untouched, not replaced.
    expect(useQueueStore.getState().queue[2]).toEqual(upcomingA);
  });

  it("ends a radio gracefully when the response is only duplicates", async () => {
    const duplicate = makeTrack({ id: upcomingA.id, providerId: upcomingA.providerId });
    const { calls } = stubFetch(() => ({ status: 200, body: okBody([duplicate]) }));
    seedRadioQueue();

    render(<RefillAgent />);
    await settle();

    expect(calls).toHaveLength(1);
    expect(queueIds()).toEqual([current.id, upcomingA.id, upcomingB.id]);
    expect(useRadioStore.getState().status).toBe("ended");
    expect(useRadioStore.getState().variant).toBe(0);
    expect(screen.queryByTestId("refill-failure")).toBeNull();
  });
});

describe("the agent: the latch", () => {
  it("issues no second request while one is in flight", async () => {
    const { calls } = stubFetch(() => ({ pending: true }));
    seedRadioQueue();

    const view = render(<RefillAgent />);
    await settle();
    expect(calls).toHaveLength(1);

    // Store churn that would otherwise re-enter the effect: a re-render, a mode
    // toggle, and a radio bookkeeping write — none of them may add a request.
    await act(async () => {
      view.rerender(<RefillAgent />);
      useQueueStore.getState().cycleRepeat();
      useRadioStore.getState().markPlayed(current.id);
    });
    await settle();

    expect(calls).toHaveLength(1);
  });

  it("issues one request per low-water crossing, not one per render", async () => {
    // A refusal still leaves the queue low, and must not loop.
    const { calls } = stubFetch(() => ({ status: 503, body: errorBody("upstream_unavailable") }));
    seedRadioQueue();

    render(<RefillAgent />);
    await settle();
    expect(calls).toHaveLength(1);

    await act(async () => {
      useQueueStore.getState().toggleShuffle();
      useRadioStore.getState().markPlayed(current.id);
    });
    await settle();

    expect(calls).toHaveLength(1);
  });

  it("re-arms once the queue has grown back, and asks from the advanced counter", async () => {
    // A distinct track per cycle, so the second cycle is not answered with a
    // duplicate of the first one.
    const { calls } = stubFetch((index) => ({
      status: 200,
      body: okBody([radioTrack(`r${index + 1}`, 50)]),
    }));
    seedRadioQueue();

    render(<RefillAgent />);
    await settle();
    expect(calls).toHaveLength(1);
    expect(useRadioStore.getState().variant).toBe(1);
    // The refill pushed the queue back up to the mark, which re-arms the latch:
    // a one-track refill must not wedge a radio that is still short of material.
    expect(upcomingIds()).toHaveLength(3);

    // The listener works through the growth and the queue runs low again.
    await act(async () => {
      useQueueStore.setState({
        queue: [current, radioTrack("r1", 50), upcomingA],
        queueIndex: 0,
        playOrder: [0, 1, 2],
      });
    });
    await settle();

    expect(calls).toHaveLength(2);
    // The second cycle is planned from the advanced counter, so it asks for
    // different curated seeds rather than repeating the first cycle.
    expect(paramsOf(calls[1]).get("variant")).toBe("1");
    expect(useRadioStore.getState().variant).toBe(2);
  });
});

describe("the agent: failure is survivable", () => {
  it("offers a non-blocking retry and starts no loop", async () => {
    const { calls } = stubFetch((index) =>
      index === 0
        ? { status: 503, body: errorBody("upstream_unavailable") }
        : { status: 503, body: errorBody("upstream_unavailable") },
    );
    seedRadioQueue();

    render(<RefillAgent />);
    await settle();

    // The existing queue keeps playing, untouched.
    expect(queueIds()).toEqual([current.id, upcomingA.id, upcomingB.id]);
    expect(usePlayerStore.getState().currentTrack).toBe(current);
    expect(usePlayerStore.getState().status).toBe("playing");
    // The affordance is a polite live region, not a modal, and names the failure.
    const notice = await screen.findByTestId("refill-failure");
    expect(notice).toHaveAttribute("role", "status");
    expect(notice).toHaveTextContent("upstream_unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    // Exactly one attempt so far, and the radio is not wedged on a silent retry.
    expect(calls).toHaveLength(1);
    expect(useRadioStore.getState().status).toBe("error");
    expect(useRadioStore.getState().variant).toBe(0);
  });

  it("recovers when the listener retries, advancing the rotation only then", async () => {
    const { calls } = stubFetch((index) =>
      index === 0
        ? { status: 503, body: errorBody("upstream_unavailable") }
        : { status: 200, body: okBody([radioTrack("late", 70)]) },
    );
    seedRadioQueue();

    render(<RefillAgent />);
    await settle();
    expect(useRadioStore.getState().status).toBe("error");

    await act(async () => {
      screen.getByRole("button", { name: "Try again" }).click();
    });
    await settle();

    expect(calls).toHaveLength(2);
    // A failed cycle keeps the counter, so the retry asks the same seeds again.
    expect(paramsOf(calls[1]).get("variant")).toBe("0");
    expect(useRadioStore.getState().status).toBe("active");
    expect(useRadioStore.getState().variant).toBe(1);
    expect(queueIds()).toEqual([current.id, radioTrack("late", 70).id, upcomingA.id, upcomingB.id]);
    // The notice is gone once the cycle worked.
    expect(screen.queryByTestId("refill-failure")).toBeNull();
  });

  it("keeps one attempt per retry, never a retry loop", async () => {
    const { calls } = stubFetch(() => ({ status: 503, body: errorBody("upstream_unavailable") }));
    seedRadioQueue();

    render(<RefillAgent />);
    await settle();
    expect(calls).toHaveLength(1);

    for (const attempt of [2, 3]) {
      await act(async () => {
        screen.getByRole("button", { name: "Try again" }).click();
      });
      await settle();
      expect(calls).toHaveLength(attempt);
    }
  });

  it("dismisses the notice without retrying and without touching the queue", async () => {
    const { calls } = stubFetch(() => ({ status: 503, body: errorBody("upstream_unavailable") }));
    seedRadioQueue();

    render(<RefillAgent />);
    await settle();

    await act(async () => {
      screen.getByRole("button", { name: "Dismiss refill message" }).click();
    });
    await settle();

    expect(screen.queryByTestId("refill-failure")).toBeNull();
    expect(calls).toHaveLength(1);
    expect(queueIds()).toEqual([current.id, upcomingA.id, upcomingB.id]);
  });

  it("ends the radio gracefully on an unresolvable answer and never retries it", async () => {
    const { calls } = stubFetch(() => ({ status: 404, body: errorBody("unresolvable") }));
    seedRadioQueue();

    render(<RefillAgent />);
    await settle();

    expect(calls).toHaveLength(1);
    // "No material left" is an answer, not a failure: no notice, no retry.
    expect(useRadioStore.getState().status).toBe("ended");
    expect(screen.queryByTestId("refill-failure")).toBeNull();

    await act(async () => {
      useQueueStore.getState().toggleShuffle();
    });
    await settle();
    expect(calls).toHaveLength(1);
  });
});

describe("the agent: lifecycle", () => {
  it("aborts an in-flight refill on unmount and reports no failure", async () => {
    const { calls } = stubFetch(() => ({ pending: true }));
    seedRadioQueue();

    const view = render(<RefillAgent />);
    await settle();
    expect(calls).toHaveLength(1);
    const signal = calls[0].signal;
    expect(signal?.aborted).toBe(false);

    await act(async () => {
      view.unmount();
    });
    await settle();

    expect(signal?.aborted).toBe(true);
    // A cancelled refill is not an error to show the user.
    expect(useRadioStore.getState().status).toBe("active");
    expect(useRadioStore.getState().lastError).toBeNull();
  });

  it("renders nothing but the agent when there is no failure to offer", async () => {
    stubFetch(() => ({ status: 200, body: okBody([radioTrack("r1", 50)]) }));
    seedRadioQueue();

    const { container } = render(<RefillAgent />);
    await settle();

    expect(container).toBeEmptyDOMElement();
  });

  it("surfaces a failure to a queue surface that renders only the notice", async () => {
    // The affordance is independent of the engine's mount point: the hook is
    // mounted with the player, the notice on the queue, and a failure reported by
    // one is seen by the other.
    const { calls } = stubFetch(() => ({ status: 503, body: errorBody("upstream_unavailable") }));
    seedRadioQueue();

    render(<RefillFailureNotice />);
    renderHook(() => useRefillAgent());
    await settle();

    expect(calls).toHaveLength(1);
    expect(await screen.findByTestId("refill-failure")).toHaveTextContent("upstream_unavailable");
  });
});

describe("the agent: the autofill policy", () => {
  it("does nothing when no radio is running and the setting is off", async () => {
    const { calls } = stubFetch(() => ({ status: 200, body: okBody([radioTrack("r1", 50)]) }));
    useQueueStore.setState({
      queue: [current, upcomingA],
      queueIndex: 0,
      playOrder: [0, 1],
      history: [],
      source: "search",
    });
    usePlayerStore.setState({ currentTrack: current, status: "playing" });
    usePreferencesStore.setState({ autofillQueue: false });

    render(<RefillAgent />);
    await settle();

    expect(calls).toHaveLength(0);
    expect(queueIds()).toEqual([current.id, upcomingA.id]);
  });

  it("grows an ordinary queue from the current track when the setting is on", async () => {
    const fill = radioTrack("fill", 60);
    const { calls } = stubFetch(() => ({ status: 200, body: okBody([fill]) }));
    useQueueStore.setState({
      queue: [current, upcomingA],
      queueIndex: 0,
      playOrder: [0, 1],
      history: [],
      source: "search",
    });
    usePlayerStore.setState({ currentTrack: current, status: "playing" });
    usePreferencesStore.setState({ autofillQueue: true });

    render(<RefillAgent />);
    await settle();

    const params = paramsOf(calls[0]);
    expect(params.get("kind")).toBe("track");
    expect(params.get("title")).toBe("One More Time");
    expect(params.get("artist")).toBe("Daft Punk");
    // Documented choice: autofill has no refill counter.
    expect(params.get("variant")).toBe("0");
    // Autofill is not a radio: the queue keeps the source it was started with,
    // and no radio bookkeeping moves.
    expect(queueIds()).toEqual([current.id, fill.id, upcomingA.id]);
    expect(useQueueStore.getState().source).toBe("search");
    expect(useRadioStore.getState().status).toBe("idle");
    expect(useRadioStore.getState().variant).toBe(0);
  });

  it("excludes only the recent window for autofill, not a session played set", async () => {
    const { calls } = stubFetch(() => ({ status: 200, body: okBody([radioTrack("fill", 60)]) }));
    useQueueStore.setState({
      queue: [current, upcomingA],
      queueIndex: 0,
      playOrder: [0, 1],
      history: [],
      source: "search",
    });
    usePlayerStore.setState({ currentTrack: current, status: "playing" });
    usePreferencesStore.setState({ autofillQueue: true });
    const now = Date.now();
    useHistoryStore.setState({
      events: [
        {
          id: "e2",
          trackId: "youtube:recent",
          track: upcomingB,
          playedAt: now - 1_000,
          secondsPlayed: 10,
          context: "search",
        },
        {
          id: "e1",
          trackId: "youtube:ancient",
          track: upcomingC,
          playedAt: now - 30 * 86_400_000,
          secondsPlayed: 10,
          context: "search",
        },
      ],
      hydrated: true,
    });

    render(<RefillAgent />);
    await settle();

    // The recent play is kept out; the month-old one is outside the window and is
    // free to come back.
    expect(paramsOf(calls[0]).get("exclude")).toBe("youtube:recent");
  });

  it("stops autofilling when the setting is switched off", async () => {
    const { calls } = stubFetch(() => ({ status: 200, body: okBody([radioTrack("fill", 60)]) }));
    // A queue with room to spare and autofill on: nothing is asked for.
    useQueueStore.setState({
      queue: [current, upcomingA, upcomingB, upcomingC, radioTrack("d", 50)],
      queueIndex: 0,
      playOrder: [0, 1, 2, 3, 4],
      history: [],
      source: "search",
    });
    usePlayerStore.setState({ currentTrack: current, status: "playing" });
    usePreferencesStore.setState({ autofillQueue: true });

    render(<RefillAgent />);
    await settle();
    expect(calls).toHaveLength(0);

    // The setting goes off before the queue runs low, so the mark is reached with
    // autofill off: the engine stays silent.
    await act(async () => {
      usePreferencesStore.setState({ autofillQueue: false });
      useQueueStore.setState({ queue: [current, upcomingA], queueIndex: 0, playOrder: [0, 1] });
    });
    await settle();

    expect(calls).toHaveLength(0);
    expect(queueIds()).toEqual([current.id, upcomingA.id]);
  });

  it("lets a radio take over from autofill", async () => {
    const { calls } = stubFetch(() => ({ status: 200, body: okBody([radioTrack("r1", 50)]) }));
    useQueueStore.setState({
      queue: [current, upcomingA],
      queueIndex: 0,
      playOrder: [0, 1],
      history: [],
      source: "search",
    });
    usePlayerStore.setState({ currentTrack: current, status: "playing" });
    usePreferencesStore.setState({ autofillQueue: true });

    // The radio starts and takes over the low queue: the request is a radio one.
    await act(async () => {
      useRadioStore.getState().startRadio(trackSeed);
      useQueueStore.getState().setContext(current, [current, upcomingA], "radio");
    });

    render(<RefillAgent />);
    await settle();

    expect(calls).toHaveLength(1);
    expect(paramsOf(calls[0]).get("title")).toBe("Get Lucky");
    expect(useQueueStore.getState().source).toBe("radio");
  });
});

describe("the agent: the local taste profile steers the order, not the request", () => {
  it("ranks by what this device likes, and keeps the request free of it", async () => {
    const liked = makeTrack({
      id: "youtube:liked",
      providerId: "liked",
      title: "Liked",
      artists: [{ name: "Portishead", id: "UC-portishead" }],
    });
    const other = makeTrack({
      id: "youtube:other",
      providerId: "other",
      title: "Other",
      artists: [{ name: "Someone Else", id: "UC-someone" }],
    });
    const { calls } = stubFetch(() => ({ status: 200, body: okBody([other, liked]) }));
    seedRadioQueue();
    useLibraryStore.setState({ likedIds: new Set([liked.id]), likedTracks: [liked] });

    render(<RefillAgent />);
    await settle();

    // The like decides the order…
    expect(upcomingIds().slice(0, 2)).toEqual([liked.id, other.id]);
    // …and no id, artist name, or weight crossed the network. An empty exclusion
    // is not sent at all, so the request is the identity, the counter, and the
    // limit — the same surface a cold device sends.
    const params = paramsOf(calls[0]);
    expect(params.get("exclude")).toBeNull();
    expect([...params.keys()].sort()).toEqual(["artist", "kind", "limit", "title", "variant"]);
  });
});
