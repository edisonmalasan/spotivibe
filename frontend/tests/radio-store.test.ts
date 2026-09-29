import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RADIO_ERROR,
  initialRadioState,
  radioIdentity,
  resetRadioStore,
  useRadioStore,
  type RadioSeed,
} from "@/stores/radioStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M10 task 4.1 (spec: `radio` — "Radio modes" / "Played-track dedupe"; design
 * §1/§3): the radio store's whole contract.
 *
 * The store is deliberately small, so most of this file is about what it does
 * **not** hold (design §1: a radio is a queue mode, not a second player — the
 * tracks live in `queueStore`) and about the bookkeeping the refill engine
 * depends on: the played set scoped to one radio's life, and a refill counter
 * that only a *successful* refill moves.
 */

const seedTrack = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Get Lucky",
  artists: [{ name: "Daft Punk" }, { name: "Pharrell Williams" }],
});

const trackSeed: RadioSeed = { kind: "track", track: seedTrack };
const artistSeed: RadioSeed = { kind: "artist", artist: { id: "UC1", name: "Daft Punk" } };

/** The current state, read fresh after every action. */
function state() {
  return useRadioStore.getState();
}

beforeEach(() => {
  resetRadioStore();
});

describe("radioStore: the radio's identity and lifecycle", () => {
  it("starts idle with nothing played", () => {
    expect(state().seed).toBeNull();
    expect(state().status).toBe("idle");
    expect(state().playedIds).toEqual([]);
    expect(state().variant).toBe(0);
    expect(state().lastError).toBeNull();
    expect(initialRadioState.seed).toBeNull();
  });

  it("starts a radio from a track seed with an empty played set", () => {
    state().startRadio(trackSeed);

    expect(state().seed).toEqual(trackSeed);
    expect(state().status).toBe("active");
    expect(state().playedIds).toEqual([]);
    expect(state().variant).toBe(0);
    expect(state().lastError).toBeNull();
  });

  it("starts a radio from an artist seed", () => {
    state().startRadio(artistSeed);

    expect(state().seed).toEqual(artistSeed);
    expect(state().status).toBe("active");
  });

  it("clears every trace of the radio when it stops", () => {
    state().startRadio(trackSeed);
    state().markPlayed(seedTrack.id);
    state().advanceVariant();
    state().setStatus("error", "Upstream unavailable");

    state().stopRadio();

    expect(state().seed).toBeNull();
    expect(state().status).toBe("idle");
    expect(state().playedIds).toEqual([]);
    expect(state().variant).toBe(0);
    expect(state().lastError).toBeNull();
  });

  it("starts a second radio clean, so the first radio's played set does not leak", () => {
    state().startRadio(trackSeed);
    state().markPlayed(seedTrack.id);
    state().advanceVariant();

    state().startRadio(artistSeed);

    expect(state().seed).toEqual(artistSeed);
    expect(state().playedIds).toEqual([]);
    expect(state().variant).toBe(0);
  });
});

describe("radioStore: the played set", () => {
  beforeEach(() => {
    state().startRadio(trackSeed);
  });

  it("accumulates played ids in play order, deduped", () => {
    state().markPlayed("youtube:aaa");
    state().markPlayed("youtube:bbb");
    state().markPlayed("youtube:aaa"); // a repeat is not a second entry

    expect(state().playedIds).toEqual(["youtube:aaa", "youtube:bbb"]);
  });

  it("ignores a blank id and leaves the set untouched", () => {
    state().markPlayed("youtube:aaa");
    state().markPlayed("   ");

    expect(state().playedIds).toEqual(["youtube:aaa"]);
  });

  it("records nothing while no radio is running", () => {
    resetRadioStore();
    state().markPlayed("youtube:aaa");

    // The set is scoped to one radio's life: an id recorded with no radio would
    // exclude the track from the *next* radio's refills.
    expect(state().playedIds).toEqual([]);
  });
});

describe("radioStore: the refill counter", () => {
  it("advances and reports the new value", () => {
    state().startRadio(trackSeed);

    expect(state().advanceVariant()).toBe(1);
    expect(state().variant).toBe(1);
    expect(state().advanceVariant()).toBe(2);
    expect(state().variant).toBe(2);
  });

  it("does not advance for a failed refill", () => {
    state().startRadio(trackSeed);
    state().markPlayed("youtube:aaa");

    // A failure surfaces and keeps the queue; only a successful refill asks for
    // different material, so the counter must not move.
    state().setStatus("error", "Radio request failed (upstream_unavailable).");
    expect(state().variant).toBe(0);

    // Recovery is an explicit advance, after the retry succeeds.
    state().setStatus("active");
    expect(state().variant).toBe(0);
    expect(state().advanceVariant()).toBe(1);
    // The played set survives the failed cycle: the radio did not restart.
    expect(state().playedIds).toEqual(["youtube:aaa"]);
  });
});

describe("radioStore: status and the retry message", () => {
  it("records the failure message and clears it on recovery", () => {
    state().startRadio(trackSeed);
    state().setStatus("error", "Radio request failed (network).");

    expect(state().status).toBe("error");
    expect(state().lastError).toBe("Radio request failed (network).");

    state().setStatus("active");

    expect(state().status).toBe("active");
    expect(state().lastError).toBeNull();
  });

  it("falls back to a readable message when a failure carries no text", () => {
    state().startRadio(trackSeed);
    state().setStatus("error");

    expect(state().lastError).toBe(DEFAULT_RADIO_ERROR);
  });

  it("records the graceful end of a radio with no material left", () => {
    state().startRadio(trackSeed);
    state().markPlayed("youtube:aaa");
    state().setStatus("ended");

    expect(state().status).toBe("ended");
    expect(state().lastError).toBeNull();
    // An ended radio keeps what it played until it is stopped, so the queue can
    // still label what was radio material.
    expect(state().playedIds).toEqual(["youtube:aaa"]);
  });
});

describe("radioIdentity: the request identity of a seed", () => {
  it("reads a track seed's title and first artist", () => {
    expect(radioIdentity(trackSeed)).toEqual({
      kind: "track",
      title: "Get Lucky",
      artist: "Daft Punk",
    });
  });

  it("omits the artist for a track with no credit", () => {
    const uncredited: RadioSeed = {
      kind: "track",
      track: makeTrack({ id: "youtube:zzz", title: "Untitled", artists: [] }),
    };

    expect(radioIdentity(uncredited)).toEqual({ kind: "track", title: "Untitled" });
    expect(radioIdentity(uncredited)).not.toHaveProperty("artist");
  });

  it("reads an artist seed's public name", () => {
    expect(radioIdentity(artistSeed)).toEqual({ kind: "artist", artist: "Daft Punk" });
  });

  it("carries nothing but the identity — no id, no profile, no played set", () => {
    expect(Object.keys(radioIdentity(trackSeed)).sort()).toEqual(["artist", "kind", "title"]);
    expect(Object.keys(radioIdentity(artistSeed)).sort()).toEqual(["artist", "kind"]);
  });
});

describe("the radio store holds only the radio's bookkeeping (design §1)", () => {
  it("exposes exactly the seed, played set, counter, status, and five actions", () => {
    expect(Object.keys(state()).sort()).toEqual([
      "advanceVariant",
      "lastError",
      "markPlayed",
      "playedIds",
      "seed",
      "setStatus",
      "startRadio",
      "status",
      "stopRadio",
      "variant",
    ]);
  });

  it("holds no queue-membership, track-list, or transport field", () => {
    const keys = Object.keys(state());
    // Design §1: the tracks live in `queueStore` with `source: "radio"`; the
    // transport lives in `playerStore`. A field from either would be a second
    // source of truth.
    for (const forbidden of [
      "queue",
      "queueIndex",
      "playOrder",
      "history",
      "shuffle",
      "repeatMode",
      "tracks",
      "currentTrack",
      "isPlaying",
      "positionSeconds",
      "volume",
      "source",
    ]) {
      expect(keys).not.toContain(forbidden);
    }

    // The only array on the state is the played-id list, and it is all strings.
    state().startRadio(trackSeed);
    state().markPlayed("youtube:aaa");
    for (const [key, value] of Object.entries(state())) {
      if (!Array.isArray(value)) continue;
      expect(key).toBe("playedIds");
      expect(value.every((entry) => typeof entry === "string")).toBe(true);
    }
  });
});
