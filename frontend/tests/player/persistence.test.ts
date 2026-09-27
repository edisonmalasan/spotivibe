import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachSessionPersistence } from "@/player/persistence";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { getLocalData } from "@/data/localData";
import { makeTrack } from "../helpers/music-fixtures";

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const trackB = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Bravo",
  durationSeconds: 180,
});

const DEBOUNCE = 5;

function state() {
  return usePlayerStore.getState();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sessionRecord() {
  const data = await getLocalData();
  return data.session.get();
}

// jsdom defines `visibilityState` on the prototype; tests that need `hidden`
// shadow it with an own property, removed afterwards.
function clearVisibilityOverride(): void {
  delete (document as unknown as Record<string, unknown>)["visibilityState"];
}
function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
}

let detach: (() => void) | null = null;

beforeEach(async () => {
  resetPlayerStore();
  localStorage.clear();
  clearVisibilityOverride();
  const data = await getLocalData();
  await data.session.clear();
});

afterEach(() => {
  detach?.();
  detach = null;
  clearVisibilityOverride();
});

describe("session persistence", () => {
  it("debounced writes persist the playback session snapshot", async () => {
    detach = attachSessionPersistence({ debounceMs: DEBOUNCE });

    state().playTrack(trackA, [trackA, trackB]);
    state().cycleRepeat(); // off -> context
    state()._setPosition(33);
    state().setVolume(55);

    await sleep(DEBOUNCE + 30);
    const record = await sessionRecord();
    expect(record).not.toBeNull();
    expect(record!.queueIndex).toBe(0);
    expect(record!.positionSeconds).toBe(33);
    expect(record!.repeatMode).toBe("context");
    expect(record!.shuffle).toBe(false);
    expect(record!.volume).toBeCloseTo(0.55); // store 0..100 → snapshot 0..1
    expect(record!.queue.map((track) => track.id)).toEqual([trackA.id, trackB.id]);
  });

  it("coalesces rapid changes into one write after the debounce window", async () => {
    detach = attachSessionPersistence({ debounceMs: 40 });

    state().playTrack(trackA, [trackA, trackB]);
    for (let i = 1; i <= 5; i++) state()._setPosition(i);
    expect(await sessionRecord()).toBeNull(); // nothing yet

    await sleep(80);
    const record = await sessionRecord();
    expect(record).not.toBeNull();
    expect(record!.positionSeconds).toBe(5); // last value wins
  });

  it("flushes immediately on pagehide", async () => {
    detach = attachSessionPersistence({ debounceMs: 60_000 }); // never fires

    state().playTrack(trackB, [trackA, trackB]);
    state()._setPosition(12);
    window.dispatchEvent(new Event("pagehide"));

    await sleep(30);
    const record = await sessionRecord();
    expect(record).not.toBeNull();
    expect(record!.queueIndex).toBe(1);
    expect(record!.positionSeconds).toBe(12);
  });

  it("flushes when the document becomes hidden", async () => {
    detach = attachSessionPersistence({ debounceMs: 60_000 });

    state().playTrack(trackA, [trackA, trackB]);
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    await sleep(30);
    expect(await sessionRecord()).not.toBeNull();
  });

  it("writes nothing while no track is active and nothing after detaching", async () => {
    detach = attachSessionPersistence({ debounceMs: DEBOUNCE });
    state().setVolume(70); // state change without a track

    await sleep(DEBOUNCE + 30);
    expect(await sessionRecord()).toBeNull();

    state().playTrack(trackA, [trackA, trackB]);
    detach();
    detach = null;
    state()._setPosition(50);

    await sleep(DEBOUNCE + 30);
    expect(await sessionRecord()).toBeNull(); // detacher stopped all writes
  });
});
