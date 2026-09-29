import { describe, expect, it } from "vitest";
import type { ListeningEventRecord, QueueHistoryEntry } from "@/data/repositories";
import {
  countUpcomingTracks,
  LOW_WATER,
  planRefill,
  radioRequestFor,
  rankCandidates,
  recentWindowIds,
  REFILL_RECENCY_WINDOW_MS,
  REFILL_LIMIT,
  selectAppendable,
  type RefillPlanInput,
} from "@/features/personalization/refillEngine";
import { MAX_RADIO_EXCLUDE } from "@/features/personalization/radioApi";
import type { TasteProfile } from "@/features/personalization/tasteProfile";
import type { RadioSeed } from "@/stores/radioStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M10 tasks 4.2/4.3 (spec `radio` — "Radio refill" / "Played-track dedupe" /
 * "Queue autofill"; design §2/§3/§5): the refill engine's pure policy.
 *
 * Everything here is a function of data the caller hands in, so the cases are
 * about the *rules* rather than about timing: when a request is planned at all,
 * what identity and rotation index it carries, how the exclusion list is bounded,
 * and the two refusals the client's half of the dedupe owns (played, queued).
 */

const NOW = 1_700_000_000_000;

const seedTrack = makeTrack({
  id: "youtube:seed",
  providerId: "seed",
  title: "Get Lucky",
  artists: [{ name: "Daft Punk" }],
});
const currentTrack = makeTrack({
  id: "youtube:current",
  providerId: "current",
  title: "One More Time",
  artists: [{ name: "Daft Punk" }, { name: "Romanthony" }],
});

const trackSeed: RadioSeed = { kind: "track", track: seedTrack };
const artistSeed: RadioSeed = { kind: "artist", artist: { id: "UC1", name: "Daft Punk" } };

/** A cold device: no likes, no plays, no languages — the documented empty input. */
const emptyProfile: TasteProfile = {
  artists: [],
  genres: [],
  languages: [],
  recentTrackIds: [],
  seedTerms: [],
  hasSignal: false,
};

function planInput(overrides: Partial<RefillPlanInput> = {}): RefillPlanInput {
  return {
    policy: "radio",
    radioSeed: trackSeed,
    radioStatus: "active",
    radioVariant: 0,
    playedIds: [],
    currentTrack: null,
    autofillEnabled: true,
    now: NOW,
    ...overrides,
  };
}

/** `count` ids, oldest first — the play order the bound keeps its tail of. */
function playedIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `youtube:p${String(index).padStart(3, "0")}`);
}

function listeningEvent(
  overrides: Partial<ListeningEventRecord> & { id: string; trackId: string },
): ListeningEventRecord {
  return {
    track: makeTrack({ id: overrides.trackId, providerId: overrides.trackId }),
    playedAt: NOW,
    secondsPlayed: 100,
    context: "radio",
    ...overrides,
  } as ListeningEventRecord;
}

describe("planRefill: when a request is worth making", () => {
  it("plans nothing with no active radio and autofill off", () => {
    // Neither policy can produce a request, so the engine stays silent — the
    // queue plays to its end and nothing is spent on the provider.
    expect(planRefill(planInput({ radioStatus: "idle", radioSeed: null }))).toBeNull();
    expect(
      planRefill(
        planInput({
          policy: "autofill",
          radioStatus: "idle",
          radioSeed: null,
          currentTrack,
          autofillEnabled: false,
        }),
      ),
    ).toBeNull();
  });

  it("plans nothing for an active radio with no seed", () => {
    expect(planRefill(planInput({ radioSeed: null }))).toBeNull();
  });

  it.each(["idle", "ended", "error"] as const)(
    "plans nothing for a radio in the %s state",
    (status) => {
      expect(planRefill(planInput({ radioStatus: status }))).toBeNull();
    },
  );

  it("plans nothing for autofill with no current track", () => {
    expect(planRefill(planInput({ policy: "autofill", currentTrack: null }))).toBeNull();
  });

  it("plans nothing for an identity with no usable text", () => {
    // A request that could only be rejected as invalid is never planned.
    const untitled: RadioSeed = {
      kind: "track",
      track: makeTrack({ id: "youtube:blank", title: "   ", artists: [] }),
    };
    expect(planRefill(planInput({ radioSeed: untitled }))).toBeNull();
    expect(
      planRefill(planInput({ policy: "autofill", currentTrack: makeTrack({ title: "" }) })),
    ).toBeNull();
  });
});

describe("planRefill: the radio policy", () => {
  it("asks for the radio's own identity — a track seed's title and first artist", () => {
    expect(planRefill(planInput())).toEqual({
      policy: "radio",
      kind: "track",
      title: "Get Lucky",
      artist: "Daft Punk",
      variant: 0,
      exclude: [],
      limit: REFILL_LIMIT,
    });
  });

  it("asks for an artist seed's public name and carries no title", () => {
    const plan = planRefill(planInput({ radioSeed: artistSeed }));

    expect(plan).toEqual({
      policy: "radio",
      kind: "artist",
      artist: "Daft Punk",
      variant: 0,
      exclude: [],
      limit: REFILL_LIMIT,
    });
    expect(plan).not.toHaveProperty("title");
  });

  it("omits the artist for a seed with no credit", () => {
    const uncredited: RadioSeed = {
      kind: "track",
      track: makeTrack({ id: "youtube:zzz", title: "Untitled", artists: [] }),
    };

    const plan = planRefill(planInput({ radioSeed: uncredited }));

    expect(plan).toEqual({
      policy: "radio",
      kind: "track",
      title: "Untitled",
      variant: 0,
      exclude: [],
      limit: REFILL_LIMIT,
    });
    expect(plan).not.toHaveProperty("artist");
  });

  it("carries the radio's own refill counter, so each cycle rotates the seeds", () => {
    expect(planRefill(planInput({ radioVariant: 3 }))?.variant).toBe(3);
  });

  it("sends the played set as the exclusion, trimmed and deduped", () => {
    const plan = planRefill(
      planInput({ playedIds: [" youtube:a ", "youtube:b", "", "youtube:a"] }),
    );

    expect(plan?.exclude).toEqual(["youtube:a", "youtube:b"]);
  });

  it("bounds the exclusion and keeps the most recent ids, most recent last", () => {
    const ids = playedIds(MAX_RADIO_EXCLUDE + 40);
    const plan = planRefill(planInput({ playedIds: ids }));

    // Bounded, never longer than the contract allows…
    expect(plan?.exclude).toHaveLength(MAX_RADIO_EXCLUDE);
    // …taken from the tail, so the ids kept are the most recently played ones and
    // the most recent of them is last.
    expect(plan?.exclude).toEqual(ids.slice(ids.length - MAX_RADIO_EXCLUDE));
    expect(plan?.exclude.at(-1)).toBe(ids.at(-1));
  });
});

describe("planRefill: the autofill policy", () => {
  it("asks for the current track and uses rotation index 0", () => {
    const plan = planRefill(planInput({ policy: "autofill", currentTrack, radioStatus: "idle" }));

    expect(plan).toEqual({
      policy: "autofill",
      kind: "track",
      title: "One More Time",
      artist: "Daft Punk",
      // Documented choice: autofill has no refill counter to rotate, and a
      // stable index is what lets the route's request-keyed cache dedupe a
      // repeat ask.
      variant: 0,
      exclude: [],
      limit: REFILL_LIMIT,
    });
  });

  it("ignores the radio's counter and seed entirely", () => {
    const plan = planRefill(
      planInput({
        policy: "autofill",
        currentTrack,
        radioSeed: artistSeed,
        radioVariant: 7,
        radioStatus: "idle",
      }),
    );

    expect(plan?.title).toBe("One More Time");
    expect(plan?.variant).toBe(0);
  });

  it("omits the artist for a current track with no credit", () => {
    const uncredited = makeTrack({ id: "youtube:q", title: "Solo", artists: [] });
    const plan = planRefill(planInput({ policy: "autofill", currentTrack: uncredited }));

    expect(plan).not.toHaveProperty("artist");
  });

  it("bounds the caller's history window and keeps the most recent ids last", () => {
    const ids = playedIds(MAX_RADIO_EXCLUDE + 5);
    const plan = planRefill(planInput({ policy: "autofill", currentTrack, playedIds: ids }));

    expect(plan?.exclude).toEqual(ids.slice(ids.length - MAX_RADIO_EXCLUDE));
  });
});

describe("radioRequestFor: the whole of what crosses the network", () => {
  it("carries the identity, the counter, the limit, and the exclusions — nothing else", () => {
    const plan = planRefill(planInput({ radioVariant: 2, playedIds: ["youtube:a"] }));
    const request = radioRequestFor(plan!);

    expect(Object.keys(request).sort()).toEqual([
      "artist",
      "exclude",
      "kind",
      "limit",
      "title",
      "variant",
    ]);
    expect(request).toMatchObject({
      kind: "track",
      title: "Get Lucky",
      artist: "Daft Punk",
      variant: 2,
      limit: REFILL_LIMIT,
      exclude: ["youtube:a"],
    });
  });

  it("omits an identity field the plan does not carry", () => {
    const request = radioRequestFor(
      planRefill(
        planInput({
          radioSeed: { kind: "track", track: makeTrack({ title: "Solo", artists: [] }) },
        }),
      )!,
    );

    expect(Object.keys(request).sort()).toEqual(["exclude", "kind", "limit", "title", "variant"]);
    expect(request).not.toHaveProperty("artist");
  });
});

describe("selectAppendable: the client half of the dedupe (design §3)", () => {
  const queued = makeTrack({ id: "youtube:q1", providerId: "q1", title: "Queued" });

  it("keeps provider order and drops nothing when there is nothing to drop", () => {
    const tracks = [
      makeTrack({ id: "youtube:a", providerId: "a" }),
      makeTrack({ id: "youtube:b", providerId: "b" }),
    ];

    expect(selectAppendable(tracks, [queued], []).map((track) => track.id)).toEqual([
      "youtube:a",
      "youtube:b",
    ]);
  });

  it("refuses a played id even when the provider returned it", () => {
    const played = makeTrack({ id: "youtube:p", providerId: "p" });
    const fresh = makeTrack({ id: "youtube:f", providerId: "f" });

    expect(selectAppendable([played, fresh], [queued], ["youtube:p"]).map((t) => t.id)).toEqual([
      "youtube:f",
    ]);
  });

  it("refuses a queued id, matched by id and by source+providerId", () => {
    const sameId = makeTrack({ id: "youtube:q1", providerId: "other" });
    const sameProvider = makeTrack({ id: "youtube:elsewhere", providerId: "q1" });
    const fresh = makeTrack({ id: "youtube:f", providerId: "f" });

    const result = selectAppendable([sameId, sameProvider, fresh], [queued], []);

    expect(result.map((track) => track.id)).toEqual(["youtube:f"]);
  });

  it("refuses a track the response repeats, and keeps the first occurrence's place", () => {
    const repeated = makeTrack({ id: "youtube:r", providerId: "r" });
    const other = makeTrack({ id: "youtube:o", providerId: "o" });

    expect(
      selectAppendable([repeated, other, repeated], [queued], []).map((track) => track.id),
    ).toEqual(["youtube:r", "youtube:o"]);
  });

  it("is a filter, not a ranker: a lower-quality candidate is still kept", () => {
    const weak = makeTrack({ id: "youtube:weak", providerId: "weak", qualityScore: 1 });
    const strong = makeTrack({ id: "youtube:strong", providerId: "strong", qualityScore: 99 });

    expect(selectAppendable([weak, strong], [], []).map((track) => track.id)).toEqual([
      "youtube:weak",
      "youtube:strong",
    ]);
  });
});

describe("rankCandidates: the local, deterministic ordering", () => {
  const context = {
    profile: emptyProfile,
    now: NOW,
    playedIds: [] as readonly string[],
    playedRecently: new Map<string, { playedAt: number; completed?: boolean }>(),
    recencyWindowMs: REFILL_RECENCY_WINDOW_MS,
  };

  it("orders by the provider's own quality when the device has no taste yet", () => {
    const weak = makeTrack({ id: "youtube:weak", providerId: "weak", qualityScore: 10 });
    const strong = makeTrack({ id: "youtube:strong", providerId: "strong", qualityScore: 90 });

    expect(rankCandidates([weak, strong], { ...context, limit: 5 })).toEqual([strong, weak]);
  });

  it("keeps at most `limit` tracks", () => {
    const tracks = [
      makeTrack({ id: "youtube:a", providerId: "a", qualityScore: 10 }),
      makeTrack({ id: "youtube:b", providerId: "b", qualityScore: 30 }),
      makeTrack({ id: "youtube:c", providerId: "c", qualityScore: 20 }),
    ];

    expect(rankCandidates(tracks, { ...context, limit: 2 }).map((track) => track.id)).toEqual([
      "youtube:b",
      "youtube:c",
    ]);
    expect(rankCandidates(tracks, { ...context, limit: 0 })).toEqual([]);
  });

  it("ranks a played id last, and a recently played one below a fresh equal candidate", () => {
    const played = makeTrack({ id: "youtube:played", providerId: "played", qualityScore: 50 });
    const recent = makeTrack({ id: "youtube:recent", providerId: "recent", qualityScore: 50 });
    const fresh = makeTrack({ id: "youtube:fresh", providerId: "fresh", qualityScore: 50 });

    const ranked = rankCandidates([played, recent, fresh], {
      ...context,
      playedIds: ["youtube:played"],
      playedRecently: new Map([["youtube:recent", { playedAt: NOW - 1_000, completed: false }]]),
      limit: 5,
    });

    expect(ranked.map((track) => track.id)).toEqual([
      "youtube:fresh",
      "youtube:recent",
      "youtube:played",
    ]);
  });

  it("penalizes a completed recent play less than a skipped one", () => {
    const completed = makeTrack({ id: "youtube:done", providerId: "done", qualityScore: 50 });
    const skipped = makeTrack({ id: "youtube:skip", providerId: "skip", qualityScore: 50 });

    const ranked = rankCandidates([skipped, completed], {
      ...context,
      playedRecently: new Map([
        ["youtube:done", { playedAt: NOW - 1_000, completed: true }],
        ["youtube:skip", { playedAt: NOW - 1_000, completed: false }],
      ]),
      limit: 5,
    });

    expect(ranked.map((track) => track.id)).toEqual(["youtube:done", "youtube:skip"]);
  });

  it("is deterministic across runs for the same candidates", () => {
    const tracks = [
      makeTrack({ id: "youtube:b", providerId: "b", qualityScore: 50 }),
      makeTrack({ id: "youtube:a", providerId: "a", qualityScore: 50 }),
    ];

    const first = rankCandidates(tracks, { ...context, limit: 5 });
    const second = rankCandidates([...tracks].reverse(), { ...context, limit: 5 });

    expect(first.map((track) => track.id)).toEqual(["youtube:a", "youtube:b"]);
    expect(second.map((track) => track.id)).toEqual(["youtube:a", "youtube:b"]);
  });
});

describe("recentWindowIds: autofill's weaker exclusion", () => {
  it("returns the in-window ids oldest first, one per track", () => {
    const events = [
      listeningEvent({ id: "e3", trackId: "youtube:c", playedAt: NOW - 1_000 }),
      listeningEvent({ id: "e2", trackId: "youtube:b", playedAt: NOW - 2_000 }),
      listeningEvent({
        id: "e1",
        trackId: "youtube:b",
        playedAt: NOW - 3_000,
        completed: true,
      }),
    ];

    expect(recentWindowIds(events, NOW)).toEqual(["youtube:b", "youtube:c"]);
  });

  it("drops plays outside the window and future-dated events", () => {
    const events = [
      listeningEvent({ id: "e3", trackId: "youtube:new", playedAt: NOW - 1_000 }),
      listeningEvent({ id: "e2", trackId: "youtube:old", playedAt: NOW - 2 * 86_400_000 }),
      listeningEvent({ id: "e1", trackId: "youtube:future", playedAt: NOW + 10_000 }),
    ];

    expect(recentWindowIds(events, NOW)).toEqual(["youtube:new"]);
  });

  it("reads a custom window", () => {
    const events = [
      listeningEvent({ id: "e2", trackId: "youtube:b", playedAt: NOW - 2_000 }),
      listeningEvent({ id: "e1", trackId: "youtube:a", playedAt: NOW - 20_000 }),
    ];

    expect(recentWindowIds(events, NOW, 5_000)).toEqual(["youtube:b"]);
  });
});

describe("countUpcomingTracks: the low-water measure", () => {
  const history = (...ids: string[]): QueueHistoryEntry[] =>
    ids.map((id, index) => ({ track: makeTrack({ id, providerId: id }), playedAt: index }));

  it("counts the traversal entries after the current one, in traversal order", () => {
    const queue = [
      makeTrack({ id: "youtube:a", providerId: "a" }),
      makeTrack({ id: "youtube:b", providerId: "b" }),
      makeTrack({ id: "youtube:c", providerId: "c" }),
    ];

    expect(countUpcomingTracks({ queue, playOrder: [0, 1, 2], queueIndex: 0, history: [] })).toBe(
      2,
    );
    // A shuffled traversal counts the same region, not the array tail.
    expect(countUpcomingTracks({ queue, playOrder: [2, 0, 1], queueIndex: 2, history: [] })).toBe(
      2,
    );
  });

  it("does not count an upcoming entry the queue has already played", () => {
    const queue = [
      makeTrack({ id: "youtube:a", providerId: "a" }),
      makeTrack({ id: "youtube:b", providerId: "b" }),
      makeTrack({ id: "youtube:c", providerId: "c" }),
    ];

    expect(
      countUpcomingTracks({
        queue,
        playOrder: [0, 1, 2],
        queueIndex: 0,
        history: history("youtube:b"),
      }),
    ).toBe(1);
  });

  it("counts the whole traversal when nothing is playing", () => {
    const queue = [
      makeTrack({ id: "youtube:a", providerId: "a" }),
      makeTrack({ id: "youtube:b", providerId: "b" }),
    ];

    expect(countUpcomingTracks({ queue, playOrder: [0, 1], queueIndex: -1, history: [] })).toBe(2);
    expect(countUpcomingTracks({ queue: [], playOrder: [], queueIndex: -1, history: [] })).toBe(0);
  });

  it("is a plain count, so the documented mark decides the trigger", () => {
    const queue = Array.from({ length: LOW_WATER + 1 }, (_, index) =>
      makeTrack({ id: `youtube:t${index}`, providerId: `t${index}` }),
    );

    expect(
      countUpcomingTracks({
        queue,
        playOrder: queue.map((_, index) => index),
        queueIndex: 0,
        history: [],
      }),
    ).toBe(LOW_WATER);
  });
});
