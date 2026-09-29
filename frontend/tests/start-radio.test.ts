import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadRequest } from "@/stores/playerStore";
import type { Track } from "@/data/repositories";
import { RADIO_ENDPOINT } from "@/features/personalization/radioApi";
import {
  startArtistRadio,
  startTrackRadio,
  type StartRadioOutcome,
} from "@/features/personalization/startRadio";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";
import { resetRadioStore, useRadioStore } from "@/stores/radioStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * The radio **start path** (M10 tasks 5.2–5.4; spec `radio` — "Radio modes" /
 * "Radio entry points"; design §1/§6).
 *
 * This file is about the four orderings the spec and the design make
 * load-bearing, because each one is a way a radio can go wrong:
 *
 * 1. A successful start replaces the queue, labels it `radio`, and plays
 *    **exactly once**.
 * 2. An identity with no material resolves to `empty` and leaves **nothing**
 *    half-started — no seed without a queue, no lost queue.
 * 3. A provider/transport failure resolves to `unavailable` and leaves the
 *    queue, the pointer, and the transport exactly as they were, while
 *    recording the retry the surface needs.
 * 4. An artist radio carries the artist identity, not a track's.
 *
 * `fetch` is stubbed rather than the API module mocked, so the request contract
 * is part of every case: the six documented query keys, `variant=0`, no
 * exclusions, and nothing derived from the listener.
 */

const seed = makeTrack({
  id: "youtube:seed",
  providerId: "seed",
  title: "Get Lucky",
  artists: [{ name: "Daft Punk" }],
});

const playing = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Already playing" });

function radioTrack(id: string): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Radio ${id}`,
    artists: [{ name: "Daft Punk" }],
    qualityScore: 50,
  });
}

/** A body the client parser accepts. */
function okBody(tracks: Track[]): unknown {
  return { tracks, variant: 0 };
}

/** A structured error body the client maps onto a designed code. */
function errorBody(code: string): unknown {
  return { error: { code, message: "The provider could not answer." } };
}

interface Recorded {
  url: URL;
  signal: AbortSignal | undefined;
}

/** Stub the radio endpoint, answering every call the same way. */
function stubFeed(outcome: { status: number; body: unknown } | { network: true }): {
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: new URL(String(input), "http://localhost"),
      signal: init?.signal ?? undefined,
    });
    if ("network" in outcome) return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve({
      ok: outcome.status >= 200 && outcome.status < 300,
      status: outcome.status,
      json: async () => outcome.body,
    } as unknown as Response);
  });
  vi.stubGlobal("fetch", mock);
  return { calls };
}

/**
 * Collect every distinct `loadRequest` the transport store ever issued.
 *
 * "SHALL NOT autoplay a second stream" is not observable from the final state
 * (a second load would leave the same values behind), so it is measured by
 * counting the requests themselves — including a start that would re-load the
 * first track over itself.
 */
function recordLoads(): { loads: LoadRequest[]; stop: () => void } {
  const loads: LoadRequest[] = [];
  let seen: LoadRequest | null = null;
  const stop = usePlayerStore.subscribe((state) => {
    if (state.loadRequest !== null && state.loadRequest !== seen) {
      seen = state.loadRequest;
      loads.push(state.loadRequest);
    }
  });
  return { loads, stop };
}

function queueIds(): string[] {
  return useQueueStore.getState().queue.map((track) => track.id);
}

/** An ordinary queue already playing `track`, mid-position. */
function seedOrdinaryQueue(track: Track): void {
  usePlayerStore.getState().playTrack(track, [track, radioTrack("next")], "search");
  usePlayerStore.setState({ positionSeconds: 42, status: "playing" });
}

beforeEach(() => {
  resetPlayerStore();
  resetQueueStore();
  resetRadioStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("starting a track radio", () => {
  it("fills the queue with the radio's tracks, labels it radio, and plays once", async () => {
    const batch = [radioTrack("r1"), radioTrack("r2"), radioTrack("r3")];
    stubFeed({ status: 200, body: okBody(batch) });
    const { loads, stop } = recordLoads();

    const outcome = await startTrackRadio(seed);
    stop();

    expect(outcome).toEqual({ status: "started", track: batch[0], queue: batch });
    expect(queueIds()).toEqual(batch.map((track) => track.id));
    expect(useQueueStore.getState().source).toBe("radio");
    expect(useQueueStore.getState().queueIndex).toBe(0);
    expect(usePlayerStore.getState().currentTrack?.id).toBe(batch[0].id);
    expect(usePlayerStore.getState().status).toBe("loading");
    // One stream, from the radio's own first track.
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({ mode: "load", videoId: batch[0].providerId, startSeconds: 0 });
  });

  it("registers the radio before it puts a track on, so no pass sees an ordinary queue", async () => {
    // The invariant is observable in the state a subscriber sees: by the time a
    // current track exists, the radio that owns it must already be recorded.
    stubFeed({ status: 200, body: okBody([radioTrack("r1")]) });
    const observations: Array<{ hasRadio: boolean; currentId: string | null }> = [];
    const stop = usePlayerStore.subscribe((state) => {
      if (state.currentTrack !== null) {
        observations.push({
          hasRadio: useRadioStore.getState().seed !== null,
          currentId: state.currentTrack.id,
        });
      }
    });

    await startTrackRadio(seed);
    stop();

    expect(observations.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(observation.hasRadio).toBe(true);
    }
  });

  it("asks for variant 0 with no exclusions and nothing derived from the listener", async () => {
    const { calls } = stubFeed({ status: 200, body: okBody([radioTrack("r1")]) });

    await startTrackRadio(seed);

    expect(calls).toHaveLength(1);
    const params = calls[0].url.searchParams;
    expect(calls[0].url.pathname).toBe(RADIO_ENDPOINT);
    expect(params.get("kind")).toBe("track");
    expect(params.get("title")).toBe("Get Lucky");
    expect(params.get("artist")).toBe("Daft Punk");
    expect(params.get("variant")).toBe("0");
    expect(params.has("exclude")).toBe(false);
    // Exactly the six documented keys: no liked track, playlist, history,
    // language, or taste-profile parameter can be sent.
    expect([...params.keys()].sort()).toEqual(["artist", "kind", "limit", "title", "variant"]);
  });

  it("carries the caller's abort signal through to the request", async () => {
    const { calls } = stubFeed({ status: 200, body: okBody([radioTrack("r1")]) });
    const controller = new AbortController();

    await startTrackRadio(seed, { signal: controller.signal });

    expect(calls[0].signal).toBe(controller.signal);
  });
});

describe("starting a radio that resolves nothing", () => {
  it("reports empty, leaves the previous queue and playback untouched, and starts no radio", async () => {
    seedOrdinaryQueue(playing);
    const before = usePlayerStore.getState();
    stubFeed({ status: 200, body: okBody([]) });
    const { loads, stop } = recordLoads();

    const outcome = await startTrackRadio(seed);
    stop();

    expect(outcome).toEqual({ status: "empty" });
    // The previous queue, pointer, transport, and position are all intact…
    expect(queueIds()).toEqual([playing.id, "youtube:next"]);
    expect(useQueueStore.getState().source).toBe("search");
    expect(useQueueStore.getState().queueIndex).toBe(0);
    expect(usePlayerStore.getState().currentTrack?.id).toBe(playing.id);
    expect(usePlayerStore.getState().status).toBe(before.status);
    expect(usePlayerStore.getState().positionSeconds).toBe(42);
    expect(loads).toHaveLength(0);
    // …and no radio is left half-started for the refill agent to keep alive.
    expect(useRadioStore.getState().seed).toBeNull();
    expect(useRadioStore.getState().status).toBe("idle");
  });

  it("treats an unresolvable answer as the same graceful end, with no error shown", async () => {
    stubFeed({ status: 404, body: errorBody("unresolvable") });

    const outcome = await startTrackRadio(seed);

    expect(outcome).toEqual({ status: "empty" });
    expect(useRadioStore.getState().lastError).toBeNull();
  });
});

describe("starting a radio that cannot be completed", () => {
  it("reports unavailable without touching the queue and records a retryable failure", async () => {
    seedOrdinaryQueue(playing);
    const before = usePlayerStore.getState();
    stubFeed({ network: true });
    const { loads, stop } = recordLoads();

    const outcome = await startTrackRadio(seed);
    stop();

    expect(outcome).toEqual({ status: "unavailable" });
    expect(queueIds()).toEqual([playing.id, "youtube:next"]);
    expect(useQueueStore.getState().source).toBe("search");
    expect(usePlayerStore.getState().currentTrack?.id).toBe(playing.id);
    expect(usePlayerStore.getState().status).toBe(before.status);
    expect(usePlayerStore.getState().positionSeconds).toBe(42);
    expect(loads).toHaveLength(0);
    expect(useRadioStore.getState().seed).toBeNull();

    // The failure is recorded on the store the surfaces read, so a non-blocking
    // retry can be offered without a dialog and without a second notice system.
    expect(useRadioStore.getState().lastError).toBeTruthy();
    expect(useRadioStore.getState().status).toBe("error");
  });

  it("reports unavailable for a 503 upstream answer too", async () => {
    stubFeed({ status: 503, body: errorBody("upstream_unavailable") });

    const outcome: StartRadioOutcome = await startTrackRadio(seed);

    expect(outcome).toEqual({ status: "unavailable" });
    expect(useRadioStore.getState().lastError).toBeTruthy();
  });

  it("recovers on an explicit retry, which clears the recorded failure", async () => {
    // The retry is the affordance the surface offers; here it is the second
    // call, and it must both succeed and leave no stale message behind.
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new TypeError("Failed to fetch"))
          : Promise.resolve({
              ok: true,
              status: 200,
              json: async () => okBody([radioTrack("r1")]),
            } as unknown as Response);
      }),
    );

    expect(await startTrackRadio(seed)).toEqual({ status: "unavailable" });
    expect(useRadioStore.getState().lastError).toBeTruthy();

    const outcome = await startTrackRadio(seed);

    expect(outcome.status).toBe("started");
    expect(useRadioStore.getState().lastError).toBeNull();
    expect(useRadioStore.getState().status).toBe("active");
    expect(useQueueStore.getState().source).toBe("radio");
  });

  it("leaves an already-running radio alone when a new start is refused", async () => {
    useRadioStore.getState().startRadio({ kind: "track", track: seed });
    useRadioStore.setState({ playedIds: [seed.id], variant: 2 });
    stubFeed({ network: true });

    const outcome = await startTrackRadio(seed);

    expect(outcome).toEqual({ status: "unavailable" });
    // The seed, the played set, and the rotation counter all belong to the radio
    // that is still running; a refused *replacement* is not their business.
    expect(useRadioStore.getState().seed).not.toBeNull();
    expect(useRadioStore.getState().playedIds).toEqual([seed.id]);
    expect(useRadioStore.getState().variant).toBe(2);
  });

  it("rethrows a cancelled request instead of reporting a failure nobody is left to read", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new DOMException("The operation was aborted.", "AbortError"))),
    );

    await expect(startTrackRadio(seed, { signal: controller.signal })).rejects.toThrow();
    expect(useRadioStore.getState().lastError).toBeNull();
  });
});

describe("starting an artist radio", () => {
  it("seeds from the artist identity and enters radio mode", async () => {
    const batch = [radioTrack("a1"), radioTrack("a2")];
    const { calls } = stubFeed({ status: 200, body: okBody(batch) });

    const outcome = await startArtistRadio({ id: "UCaurorachannel00000000", name: "Aurora" });

    expect(outcome).toEqual({ status: "started", track: batch[0], queue: batch });
    expect(calls[0].url.searchParams.get("kind")).toBe("artist");
    expect(calls[0].url.searchParams.get("artist")).toBe("Aurora");
    // No track identity leaks into an artist request, and no exclusions either.
    expect(calls[0].url.searchParams.has("title")).toBe(false);
    expect(calls[0].url.searchParams.has("exclude")).toBe(false);
    expect(useQueueStore.getState().source).toBe("radio");
    expect(usePlayerStore.getState().currentTrack?.id).toBe(batch[0].id);
    expect(useRadioStore.getState().seed).toEqual({
      kind: "artist",
      artist: { id: "UCaurorachannel00000000", name: "Aurora" },
    });
  });

  it("works for an artist resolved by name alone", async () => {
    const { calls } = stubFeed({ status: 200, body: okBody([radioTrack("a1")]) });

    const outcome = await startArtistRadio({ name: "Aurora" });

    expect(outcome.status).toBe("started");
    expect(calls[0].url.searchParams.get("artist")).toBe("Aurora");
    expect(useRadioStore.getState().seed).toEqual({ kind: "artist", artist: { name: "Aurora" } });
  });

  it("reports empty for an artist the provider resolves nothing for", async () => {
    stubFeed({ status: 200, body: okBody([]) });

    const outcome = await startArtistRadio({ name: "Nobody At All" });

    expect(outcome).toEqual({ status: "empty" });
    expect(useRadioStore.getState().seed).toBeNull();
    expect(useQueueStore.getState().queue).toHaveLength(0);
  });

  it("reports unavailable for an unreachable provider without starting anything", async () => {
    stubFeed({ network: true });

    const outcome = await startArtistRadio({ name: "Aurora" });

    expect(outcome).toEqual({ status: "unavailable" });
    expect(useQueueStore.getState().queue).toHaveLength(0);
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(useRadioStore.getState().lastError).toBeTruthy();
  });
});
