import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetNetworkStore, useNetworkStore } from "@/stores/networkStore";
import {
  OFFLINE_PARKED_MESSAGE,
  clearPlaybackBridge,
  initNetworkRecovery,
  isNetworkRecoveryActive,
  resetPlayerStore,
  usePlayerStore,
} from "@/stores/playerStore";
import { useQueueStore } from "@/stores/queueStore";
import { makeTrack } from "../helpers/music-fixtures";

/**
 * Offline failure suppression (M6 task 8.3) and reconnect recovery (task 8.4),
 * design §9: while offline the failed set never grows and playback never
 * advances — the player parks on the offline copy; on reconnect exactly one
 * `loadRequest` resumes at the stored position for retryable states, and
 * paused/idle/playing never auto-resume.
 */

const alpha = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const beta = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Beta" });
const gamma = makeTrack({ id: "youtube:ccc", providerId: "ccc", title: "Gamma" });

function state() {
  return usePlayerStore.getState();
}

function setOnLine(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

/** Tokens of every `loadRequest` issued after this point (recovery evidence). */
function trackLoadRequests(): { tokens: number[] } {
  const record = { tokens: [] as number[] };
  let last = state().loadRequest?.token ?? 0;
  const unsubscribe = usePlayerStore.subscribe((player) => {
    const token = player.loadRequest?.token;
    if (token !== undefined && token !== last) {
      last = token;
      record.tokens.push(token);
    }
  });
  recordTokens.push(unsubscribe);
  return record;
}

let stopRecovery: (() => void) | null = null;
const recordTokens: Array<() => void> = [];

beforeEach(() => {
  resetPlayerStore();
  resetNetworkStore();
  localStorage.clear();
  clearPlaybackBridge();
  stopRecovery = null;
});

afterEach(() => {
  stopRecovery?.();
  stopRecovery = null;
  while (recordTokens.length > 0) recordTokens.pop()?.();
  setOnLine(true);
});

describe("offline failure suppression (task 8.3)", () => {
  it("parks a failure on the offline copy without growing the failed set", () => {
    useNetworkStore.getState().setConnection("offline");
    state().playTrack(alpha, [alpha, beta]);

    state()._markFailed("Playback failed: 150");

    const player = state();
    expect(player.status).toBe("error");
    expect(player.errorMessage).toBe(OFFLINE_PARKED_MESSAGE);
    expect(player.failedTrackIds).toEqual([]);
    expect(useQueueStore.getState().queueIndex).toBe(0); // no advance scheduled
  });

  it("settles an offline advance attempt without consuming the track", () => {
    useNetworkStore.getState().setConnection("offline");
    state().playTrack(alpha, [alpha, beta, gamma]);

    state()._markFailed("Playback failed: 150");
    const outcome = state()._advanceAfterFailure();

    expect(outcome).toBe("settled");
    const player = state();
    expect(player.status).toBe("error");
    expect(player.errorMessage).toBe(OFFLINE_PARKED_MESSAGE);
    expect(player.failedTrackIds).toEqual([]); // reconnect can't inherit a burned queue
    expect(player.currentTrack).toEqual(alpha);
    expect(useQueueStore.getState().queueIndex).toBe(0);
    expect(useQueueStore.getState().history).toEqual([]);
  });

  it("falls back to navigator.onLine when the monitor has not run", () => {
    setOnLine(false);
    state().playTrack(alpha, [alpha, beta]);

    state()._markFailed("Playback failed: 150");
    state()._advanceAfterFailure();

    expect(state().errorMessage).toBe(OFFLINE_PARKED_MESSAGE);
    expect(state().failedTrackIds).toEqual([]);
    expect(useQueueStore.getState().queueIndex).toBe(0);
  });

  it("keeps consuming failures while online (unchanged behavior)", () => {
    state().playTrack(alpha, [alpha, beta, gamma]);

    state()._markFailed("Playback failed: 150");
    expect(state().failedTrackIds).toEqual([alpha.id]);
    expect(state().errorMessage).toBe("Playback failed: 150");

    expect(state()._advanceAfterFailure()).toBe("advanced");
    expect(state().failedTrackIds).toEqual([alpha.id]);
    expect(state().currentTrack).toEqual(beta);
    expect(useQueueStore.getState().queueIndex).toBe(1);
  });
});

describe("reconnect recovery (task 8.4)", () => {
  it.each(["error", "loading", "buffering"] as const)(
    "issues one reload at the stored position from the %s state",
    (status) => {
      state().playTrack(alpha, [alpha, beta]);
      usePlayerStore.setState({ status, positionSeconds: 42 });
      const before = state().loadRequest?.token ?? 0;
      stopRecovery = initNetworkRecovery();

      useNetworkStore.getState().setConnection("offline");
      useNetworkStore.getState().setConnection("online");

      const player = state();
      expect(player.loadRequest).toMatchObject({
        videoId: "aaa",
        startSeconds: 42,
        mode: "load",
      });
      expect(player.loadRequest!.token).toBeGreaterThan(before);
      expect(player.status).toBe("loading");
      expect(player.errorMessage).toBeNull();
      expect(player.currentTrack).toEqual(alpha); // same track — no advance
    },
  );

  it("takes no action for paused, playing, or idle transports", () => {
    state().playTrack(alpha, [alpha, beta]);
    usePlayerStore.setState({ status: "paused", positionSeconds: 42 });
    stopRecovery = initNetworkRecovery();

    const pausedToken = state().loadRequest?.token ?? 0;
    useNetworkStore.getState().setConnection("offline");
    useNetworkStore.getState().setConnection("online");
    expect(state().loadRequest?.token).toBe(pausedToken); // paused never resumes

    usePlayerStore.setState({ status: "playing" });
    useNetworkStore.getState().setConnection("offline");
    useNetworkStore.getState().setConnection("online");
    expect(state().loadRequest?.token).toBe(pausedToken); // playing unaffected

    resetPlayerStore(); // idle: nothing cued
    useNetworkStore.getState().setConnection("offline");
    useNetworkStore.getState().setConnection("online");
    expect(state().loadRequest).toBeNull(); // idle stays idle
  });

  it("issues exactly one retry per transition, never a loop", () => {
    state().playTrack(alpha, [alpha, beta]);
    usePlayerStore.setState({ status: "error", errorMessage: "Playback failed: 150" });
    stopRecovery = initNetworkRecovery();
    const record = trackLoadRequests();

    useNetworkStore.getState().setConnection("offline");
    useNetworkStore.getState().setConnection("online");
    expect(record.tokens).toHaveLength(1);

    // Re-writing the same state is not a transition → no extra request.
    useNetworkStore.getState().setConnection("online");
    expect(record.tokens).toHaveLength(1);
    expect(isNetworkRecoveryActive()).toBe(true);
  });

  it("keeps a single subscription on double init", () => {
    state().playTrack(alpha, [alpha, beta]);
    usePlayerStore.setState({ status: "error", positionSeconds: 7 });
    stopRecovery = initNetworkRecovery();
    const second = initNetworkRecovery();
    second(); // no-op: must not detach the first subscription
    const record = trackLoadRequests();

    useNetworkStore.getState().setConnection("offline");
    useNetworkStore.getState().setConnection("online");

    expect(isNetworkRecoveryActive()).toBe(true);
    expect(record.tokens).toHaveLength(1); // one subscription → one retry
    expect(state().loadRequest).toMatchObject({ startSeconds: 7, mode: "load" });
  });

  it("surfaces a failed retry through the normal error path", () => {
    state().playTrack(alpha, [alpha, beta, gamma]);
    usePlayerStore.setState({ status: "error", errorMessage: OFFLINE_PARKED_MESSAGE });
    stopRecovery = initNetworkRecovery();

    useNetworkStore.getState().setConnection("offline");
    useNetworkStore.getState().setConnection("online");
    expect(state().status).toBe("loading");

    // The retry fails while online: the ordinary failure funnel applies.
    state()._markFailed("Playback failed: 150");
    expect(state().status).toBe("error");
    expect(state().errorMessage).toBe("Playback failed: 150");
    expect(state().failedTrackIds).toEqual([alpha.id]);

    expect(state()._advanceAfterFailure()).toBe("advanced");
    expect(state().currentTrack).toEqual(beta);
    expect(useQueueStore.getState().queueIndex).toBe(1);
  });
});
