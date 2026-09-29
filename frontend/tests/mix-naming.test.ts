import { describe, expect, it } from "vitest";
import { buildTasteProfile } from "@/features/personalization/tasteProfile";
import { deriveMixName, isHonestMixName, NEUTRAL_MIX_NAME } from "@/features/mixes/mixNaming";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M11 task 3.3: the name a mix gets.
 *
 * A mix name is a **label**, not a claim: it states the strongest local signal the
 * mix actually contains and must never imply a ranking or an editorial
 * selection (spec `mixes` — "Mix identity and naming"; M9 set the same rule for
 * discovery copy). The name must also be stable, because the listener learns it.
 */

const NOW = 1_700_000_000_000;

function track(id: string, artist: string, overrides = {}) {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Song ${id}`,
    artists: [{ name: artist }],
    ...overrides,
  });
}

function profileWithSignals(artists: string[]) {
  return buildTasteProfile({
    likedTracks: artists.map((artist, index) => track(`liked-${index}`, artist)),
    events: [],
    languages: ["en"],
    now: NOW,
  });
}

describe("deriveMixName: the strongest local signal names the mix", () => {
  it("names the artist the mix contains most, once that artist clearly leads", () => {
    const name = deriveMixName({
      tracks: [
        track("a", "Aurora"),
        track("b", "Aurora"),
        track("c", "Aurora"),
        track("d", "Beacon"),
      ],
      profile: profileWithSignals(["Aurora"]),
    });
    expect(name).toBe("Aurora");
  });

  it("falls back to the leading genre when no artist leads", () => {
    // Four different artists means no artist reaches the share threshold, so the
    // name has to come from the genre the listener actually likes. Genres are
    // *inferred* from a track's own text against the shared lexicon (`Track` has
    // no genre field), so the title is what carries the signal here.
    const name = deriveMixName({
      tracks: [
        track("a", "One"),
        track("b", "Two"),
        track("c", "Three"),
        track("d", "Four", { title: "Late Jazz" }),
      ],
      profile: profileWithSignals(["Aurora"]),
    });
    expect(name).toBe("Jazz mix");
  });

  it("keeps a hyphenated genre readable instead of mangling it", () => {
    const name = deriveMixName({
      tracks: [
        track("a", "One"),
        track("b", "Two"),
        track("c", "Three"),
        track("d", "Four", { title: "Neon K-Pop" }),
      ],
      profile: profileWithSignals(["Aurora"]),
    });
    expect(name).toBe("K-Pop mix");
  });

  it("uses the neutral local label when there is nothing to name it by", () => {
    expect(deriveMixName({ tracks: [], profile: profileWithSignals(["Aurora"]) })).toBe(
      NEUTRAL_MIX_NAME,
    );
    const uncredited = makeTrack({ id: "youtube:x", providerId: "x", title: "Solo", artists: [] });
    expect(
      deriveMixName({ tracks: [uncredited, uncredited], profile: profileWithSignals([]) }),
    ).toBe(NEUTRAL_MIX_NAME);
  });

  it("counts only the first credit, so a supporting artist cannot out-vote the lead", () => {
    const name = deriveMixName({
      tracks: [
        makeTrack({
          id: "youtube:1",
          providerId: "1",
          title: "A",
          artists: [{ name: "Lead" }, { name: "Support" }],
        }),
        makeTrack({ id: "youtube:2", providerId: "2", title: "B", artists: [{ name: "Support" }] }),
        makeTrack({ id: "youtube:3", providerId: "3", title: "C", artists: [{ name: "Support" }] }),
        makeTrack({ id: "youtube:4", providerId: "4", title: "D", artists: [{ name: "Support" }] }),
      ],
      profile: profileWithSignals(["Lead"]),
    });
    expect(name).toBe("Support");
  });

  it("breaks a tie on the artist name, so an even mix always names the same", () => {
    const tracks = [track("a", "Zen"), track("b", "Arc"), track("c", "Zen"), track("d", "Arc")];
    const first = deriveMixName({ tracks, profile: profileWithSignals(["Zen"]) });
    const reversed = deriveMixName({
      tracks: [...tracks].reverse(),
      profile: profileWithSignals(["Zen"]),
    });
    expect(first).toBe(reversed);
    expect(first).toBe("Arc");
  });

  it("never names a mix with a ranking or editorial claim", () => {
    // An artist whose own name is a claim word must not be passed through as a
    // mix name: the label would then read as a ranking this device never computed.
    const claimed = deriveMixName({
      tracks: [track("a", "The Best Of"), track("b", "The Best Of"), track("c", "The Best Of")],
      profile: profileWithSignals(["The Best Of"]),
    });
    expect(claimed).toBe(NEUTRAL_MIX_NAME);
    for (const name of [NEUTRAL_MIX_NAME, "Aurora", "Chill mix"]) {
      expect(isHonestMixName(name), name).toBe(true);
    }
    for (const name of ["Top 40", "Essential picks", "Editor's mix", "", "   "]) {
      expect(isHonestMixName(name), name).toBe(false);
    }
  });

  it("is deterministic: the same mix always yields the same name", () => {
    const tracks = [track("a", "Aurora"), track("b", "Aurora"), track("c", "Aurora")];
    const profile = profileWithSignals(["Aurora"]);
    expect(deriveMixName({ tracks, profile })).toBe(
      deriveMixName({ tracks: [...tracks], profile }),
    );
  });
});
