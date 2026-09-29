import { beforeEach, describe, expect, it } from "vitest";
import type { RadioSnapshot, Track } from "@/data/repositories";
import {
  DEFAULT_RADIO_ERROR,
  radioIdentity,
  resetRadioStore,
  restoreRadio,
  snapshotRadio,
  useRadioStore,
} from "@/stores/radioStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M10: a radio must survive a reload (the run's evidence found it did not).
 *
 * The queue is persisted by M6, so before this fix a reload brought back a queue
 * still labelled "From radio" while `radioStore` was empty: `planRefill` then
 * returned `null` for the radio policy and every later "refill" was actually
 * *autofill*, seeded by whatever happened to be playing. These tests pin the
 * three things that make the radio survive: the snapshot shape, the restore, and
 * the honest failure when a track radio's seed can no longer be resolved.
 */

const seedTrack = makeTrack({
  id: "youtube:seed",
  providerId: "seed",
  title: "Bohemian Rhapsody",
  artists: [{ name: "Queen" }],
});

function state() {
  return useRadioStore.getState();
}

describe("snapshotRadio: what a reload has to carry", () => {
  beforeEach(() => {
    resetRadioStore();
  });

  it("carries nothing when no radio is running", () => {
    expect(snapshotRadio(state())).toBeNull();
  });

  it("carries the track seed's id rather than a second copy of the track", () => {
    state().startRadio({ kind: "track", track: seedTrack });
    state().advanceVariant();

    expect(snapshotRadio(state())).toEqual({
      seed: { kind: "track", trackId: "youtube:seed", title: "Bohemian Rhapsody", artist: "Queen" },
      variant: 1,
    });
  });

  it("carries an artist seed with its id when the provider gave one", () => {
    state().startRadio({ kind: "artist", artist: { id: "UCaurora", name: "Aurora" } });
    expect(snapshotRadio(state())).toEqual({
      seed: { kind: "artist", id: "UCaurora", name: "Aurora" },
      variant: 0,
    });
  });

  it("never resurrects a radio that ended", () => {
    state().startRadio({ kind: "track", track: seedTrack });
    state().setStatus("ended", DEFAULT_RADIO_ERROR);
    expect(snapshotRadio(state())).toBeNull();
  });
});

describe("restoreRadio: putting it back", () => {
  beforeEach(() => {
    resetRadioStore();
  });

  const resolve = (id: string) => (id === "youtube:seed" ? seedTrack : undefined);

  it("restores a track radio and resumes its rotation", () => {
    const snapshot: RadioSnapshot = {
      seed: { kind: "track", trackId: "youtube:seed", title: "Bohemian Rhapsody" },
      variant: 3,
    };

    expect(restoreRadio(snapshot, resolve)).toBe(true);
    const restored = state();
    expect(restored.status).toBe("active");
    expect(restored.variant).toBe(3);
    // The seed resolves back to the *real* track, not the persisted stub.
    expect(radioIdentity(restored.seed as { kind: "track"; track: Track })).toEqual({
      kind: "track",
      title: "Bohemian Rhapsody",
      artist: "Queen",
    });
  });

  it("restores an artist radio from its name alone", () => {
    expect(restoreRadio({ seed: { kind: "artist", name: "Aurora" }, variant: 0 }, resolve)).toBe(
      true,
    );
    expect(state().seed).toEqual({ kind: "artist", artist: { name: "Aurora" } });
  });

  it("changes nothing when a track radio's seed is no longer in the queue", () => {
    state().startRadio({ kind: "artist", artist: { name: "Aurora" } });

    // The honest outcome: the radio's identity IS its seed track, so without it
    // there is nothing to refill for. The existing radio is left as it was and
    // the caller is told the restore did not happen.
    expect(
      restoreRadio(
        { seed: { kind: "track", trackId: "youtube:gone", title: "Gone" }, variant: 2 },
        () => undefined,
      ),
    ).toBe(false);
    expect(state().seed).toEqual({ kind: "artist", artist: { name: "Aurora" } });
  });

  it("ignores a negative or fractional persisted counter", () => {
    restoreRadio({ seed: { kind: "artist", name: "Aurora" }, variant: -4 }, resolve);
    expect(state().variant).toBe(0);
    restoreRadio({ seed: { kind: "artist", name: "Aurora" }, variant: 2.5 }, resolve);
    expect(state().variant).toBe(0);
  });
});
