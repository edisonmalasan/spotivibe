import { describe, expect, it } from "vitest";
import { COLLAGE_SLOTS, deriveMixCollage } from "@/features/home/mixes/collage";
import {
  MAX_LANGUAGE_MIX_CARDS,
  MAX_MIX_CARD_SEEDS,
  mixCardPlans,
  NAMED_MIX_KINDS,
  type MixCardPlan,
} from "@/features/home/mixes/namedMixes";
import { buildTasteProfile, type TasteProfile } from "@/features/personalization/tasteProfile";
import { isHonestMixName, NEUTRAL_MIX_NAME } from "@/features/mixes/mixNaming";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M17 tasks 2.1, 2.3, and 2.6 (spec: `home-mixes` — "Mix cards start playback
 * and name honestly", scenarios "Every card name is honest", "Language mixes are
 * bounded", "An empty mix is explained rather than silently inert"; `mixes` —
 * "A name is never more specific than the evidence", "A card's identity selects
 * seeds without composing", "A card name is a taste claim, not a clock claim";
 * design decisions 1 and 2).
 *
 * Two rules carry this milestone and are asserted here as behaviour rather than
 * as prose:
 *
 * - **An identity is a seed strategy, not a composer.** Every plan's profile
 *   differs from the base profile *only* in `seedTerms`, which is what makes
 *   "the cards use the one generator" structural instead of aspirational.
 * - **A name cannot outrun its evidence.** The names below are derived from the
 *   term each strategy leads with, and the file asserts the shared honest-naming
 *   rule on every one of them — including the assertion that the proposal's own
 *   "Top Mix" label would *not* pass it, which is why the identity is `top` and
 *   the display name is not.
 */

const NOW = 1_700_000_000_000;

/** A track whose title carries a genre the shared lexicon recognises. */
function track(id: string, title: string, artist = "Aurora"): ReturnType<typeof makeTrack> {
  return makeTrack({ id: `youtube:${id}`, providerId: id, title, artists: [{ name: artist }] });
}

/** A profile built from the supplied titles, one like each. */
function profileOf(titles: readonly string[], artists?: readonly string[]): TasteProfile {
  return buildTasteProfile({
    likedTracks: titles.map((title, index) =>
      track(`p${index}`, title, artists?.[index] ?? `Artist ${index}`),
    ),
    events: [],
    languages: ["en"],
    now: NOW,
  });
}

function plansFor(profile: TasteProfile, languages: readonly string[] = ["en"]): MixCardPlan[] {
  return mixCardPlans({ profile, languages });
}

/** Plan ids, for order-sensitive assertions. */
function idsOf(plans: readonly MixCardPlan[]): string[] {
  return plans.map((plan) => plan.identity.id);
}

describe("namedMixes: each identity is a bounded seed strategy", () => {
  it("resolves every identity that has support to a non-empty bounded seed set", () => {
    // Mood words in the titles give the genre strategies something to select, so
    // all four named identities can appear here.
    const plans = plansFor(
      profileOf(["Deep Funk", "Modern Soul", "Ambient Drift", "Ambient Nights"]),
    );

    for (const kind of NAMED_MIX_KINDS) {
      const plan = plans.find((entry) => entry.identity.kind === kind);
      expect(plan, `the ${kind} identity must resolve`).toBeDefined();
      expect(plan?.profile.seedTerms.length).toBeGreaterThan(0);
      expect(plan?.profile.seedTerms.length).toBeLessThanOrEqual(MAX_MIX_CARD_SEEDS);
      // Every term is trimmed, non-empty public text — never an id or a timestamp.
      for (const term of plan?.profile.seedTerms ?? []) {
        expect(term.trim()).toBe(term);
        expect(term).not.toMatch(/youtube:|20\d\d-\d\d-\d\d/);
      }
    }
  });

  it("changes the profile's seed terms and nothing else", () => {
    // This is what makes the cards compose through the one generator: `generateMix`
    // reads `hasSignal` and `seedTerms` off a profile, so a strategy that touched
    // anything else would change the mix's *identity* rather than its seeds.
    const profile = profileOf(["Deep Funk", "Modern Soul"]);
    for (const plan of plansFor(profile)) {
      const base = { ...profile };
      const { seedTerms, ...rest } = plan.profile;
      const { seedTerms: baseSeeds, ...baseRest } = base;
      expect(rest).toEqual(baseRest);
      expect(seedTerms).not.toBe(baseSeeds);
      // The plan's leading term is the one the name is derived from, so a card can
      // never be named for a term it will not ask for.
      expect(plan.identity.term).toBe(seedTerms[0] ?? "");
    }
  });

  it("gives the named identities different strategies over the same profile", () => {
    const plans = plansFor(
      profileOf(["Deep Funk", "Modern Soul", "Ambient Drift"], ["Aurora", "Beacon", "Cobalt"]),
    );
    const seedsOf = (kind: string) =>
      plans.find((plan) => plan.identity.kind === kind)?.profile.seedTerms.join(",");

    // `top` asks for what the listener leads with — their artists first, and the
    // strongest genre word the shared profile derivation appends after them;
    // `discovery` asks for the genres they play alone. Two cards, two slices of one
    // profile, so they cannot collapse into one another or into the Smart Mixes
    // shelf's own seeds.
    expect(seedsOf("top")).toBe("Aurora,Beacon,Cobalt,funk");
    expect(seedsOf("discovery")).toBe("funk,soul,ambient");
    expect(seedsOf("chill")).toBe("soul,ambient");
    expect(seedsOf("night")).toBe("ambient");
  });

  it("offers no card for a strategy the local material cannot support", () => {
    // Only a hip-hop title: nothing calm and nothing dark, so `chill` and `night`
    // have no honest material. A card that appeared here could only ever answer
    // "no signal", which is the failure the spec's empty-explanation scenario is
    // about — so it is not offered at all.
    const plans = plansFor(profileOf(["Straight Hip-Hop Lines"]));
    const kinds = plans.map((plan) => plan.identity.kind);
    expect(kinds).toContain("top");
    expect(kinds).toContain("discovery");
    expect(kinds).not.toContain("chill");
    expect(kinds).not.toContain("night");
  });

  it("bounds the language cards however many languages are selected", () => {
    // A profile that supports all four named identities, so the bound can be shown
    // not to displace any of them.
    const profile = profileOf(["Deep Funk", "Modern Soul", "Ambient Drift"]);
    // Every catalog language, far past the bound.
    const many = ["en", "es", "fr", "de", "pt", "it", "ja", "ko"];
    const plans = plansFor(profile, many);
    const languageCards = plans.filter((plan) => plan.identity.kind === "language");

    expect(languageCards.length).toBeLessThanOrEqual(MAX_LANGUAGE_MIX_CARDS);
    // The bound never displaces the named cards: the row is the same four named
    // cards plus at most the documented number of language ones.
    const named = plans.filter((plan) => plan.identity.kind !== "language");
    expect(named).toHaveLength(NAMED_MIX_KINDS.length);
    // And the first selected languages are the ones offered, in the user's order.
    expect(languageCards.map((plan) => plan.identity.language)).toEqual(
      many.slice(0, MAX_LANGUAGE_MIX_CARDS),
    );
  });

  it("scopes a language card to one language and names it after that language", () => {
    const languageCards = plansFor(profileOf(["Deep Funk"]), ["en", "es"]).filter(
      (plan) => plan.identity.kind === "language",
    );
    expect(languageCards).toHaveLength(2);

    const [english, spanish] = languageCards;
    expect(english?.identity.language).toBe("en");
    expect(english?.identity.name).toBe("English mix");
    expect(english?.profile.seedTerms).toEqual(["English"]);
    expect(spanish?.identity.name).toBe("Spanish mix");
    expect(spanish?.profile.seedTerms).toEqual(["Spanish"]);
  });

  it("offers nothing for a cold device", () => {
    const cold = buildTasteProfile({ likedTracks: [], events: [], languages: ["en"], now: NOW });
    // Languages alone are a preference, not taste: with no liked track and no play
    // there is nothing any strategy could honestly build from. `hasSignal` decides
    // it in `mixCardPlans` rather than in each surface, so a card that could only
    // answer "no signal" is never derived — which is also why the row itself is not
    // rendered (M11's rule, honoured on Home too).
    expect(plansFor(cold)).toEqual([]);
    expect(plansFor(cold, ["en", "es", "fr"])).toEqual([]);
  });
});

describe("namedMixes: every card name is honest", () => {
  it("passes the shared honest-naming rule for every card it produces", () => {
    const plans = plansFor(
      profileOf(
        ["Deep Funk", "Modern Soul", "Ambient Drift", "Ambient Nights"],
        ["Aurora", "Beacon", "Cobalt", "Delta"],
      ),
      ["en", "es"],
    );

    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(plan.identity.name, plan.identity.id).not.toBe("");
      expect(
        isHonestMixName(plan.identity.name),
        `${plan.identity.id}: ${plan.identity.name}`,
      ).toBe(true);
    }
  });

  it("falls back to the neutral name when the leading term would claim a ranking", () => {
    // The identity is still `top`; only the *display name* cannot say "Top".
    const plans = plansFor(profileOf(["Anything At All"], ["Topshelf"]));
    const top = plans.find((plan) => plan.identity.kind === "top");
    expect(top?.identity.term).toBe("Topshelf");
    expect(top?.identity.name).toBe(NEUTRAL_MIX_NAME);
    expect(isHonestMixName(top?.identity.name ?? "")).toBe(true);
  });

  it("names the cards after a taste or a mood, never after the hour", () => {
    const plans = plansFor(profileOf(["Modern Soul", "Deep Funk"]), ["en"]);
    for (const plan of plans) {
      // No clock vocabulary: a card built at 02:00 must not read differently from
      // the same card built at 20:00, because the strategy never saw a clock.
      expect(plan.identity.name).not.toMatch(
        /\b(am|pm|morning|afternoon|evening|night|\d{1,2}:\d{2})\b/i,
      );
    }
    expect(plansFor(profileOf(["Modern Soul", "Deep Funk"]), ["en"])).toEqual(plans);
  });

  it("cannot name a card 'Top Mix', because the shared rule forbids it", () => {
    // Recorded deliberately: the proposal lists "Top Mix" as a card, and the
    // honest-naming requirement says the name must pass `isHonestMixName` — which
    // it does not, because "top" is a ranking word. The identity survives; the
    // label does not. Without this assertion the tension is invisible, and the next
    // reader would "fix" the name and break the rule.
    expect(isHonestMixName("Top Mix")).toBe(false);
    expect(isHonestMixName("Chill Mix")).toBe(true);
    expect(isHonestMixName("Discovery Mix")).toBe(true);
    const plans = plansFor(profileOf(["Deep Funk"], ["Aurora"]));
    expect(plans.map((plan) => plan.identity.name)).not.toContain("Top Mix");
  });

  it("names a genre card with the genre's own key, capitalized readably", () => {
    const plans = plansFor(profileOf(["Neon Soul Groove"]));
    const discovery = plans.find((plan) => plan.identity.kind === "discovery");
    expect(discovery?.identity.name).toBe("Neon Soul mix");
    expect(discovery?.identity.term).toBe("neon soul");
  });
});

describe("collage: a mix's cover is derived from its own tracks", () => {
  it("draws a full grid when the mix has enough distinct covers", () => {
    const tracks = Array.from({ length: 6 }, (_unused, index) =>
      makeTrack({
        id: `youtube:c${index}`,
        providerId: `c${index}`,
        title: `Cover ${index}`,
        artists: [{ name: "Aurora" }],
        artwork: [{ url: `https://example.test/${index}.jpg` }],
      }),
    );

    const collage = deriveMixCollage(tracks);
    expect(collage.kind).toBe("collage");
    if (collage.kind !== "collage") return;
    expect(collage.urls).toHaveLength(COLLAGE_SLOTS);
    // First appearance order, so the cover the listener recognises leads.
    expect(collage.urls[0]).toBe("https://example.test/0.jpg");
  });

  it("falls back to the single cover when a grid cannot be filled", () => {
    // Documented fallback: two or three covers is not a collage, it is a layout
    // accident, so the best cover is drawn alone — which is also the one-track case.
    const two = [
      makeTrack({
        id: "youtube:a",
        providerId: "a",
        artwork: [{ url: "https://example.test/a.jpg" }],
      }),
      makeTrack({
        id: "youtube:b",
        providerId: "b",
        artwork: [{ url: "https://example.test/b.jpg" }],
      }),
    ];
    expect(deriveMixCollage([two[0] as (typeof two)[0]])).toEqual({
      kind: "single",
      url: "https://example.test/a.jpg",
    });
    expect(deriveMixCollage(two).kind).toBe("single");
  });

  it("treats one repeated cover as one cover, not four", () => {
    const same = Array.from({ length: 5 }, (_unused, index) =>
      makeTrack({
        id: `youtube:d${index}`,
        providerId: `d${index}`,
        title: `Same ${index}`,
        artists: [{ name: "Aurora" }],
        artwork: [{ url: "https://example.test/same.jpg" }],
      }),
    );
    expect(deriveMixCollage(same)).toEqual({
      kind: "single",
      url: "https://example.test/same.jpg",
    });
  });

  it("asks for the placeholder for an empty mix and for artwork-free tracks", () => {
    expect(deriveMixCollage([])).toEqual({ kind: "placeholder" });
    const bare = [makeTrack({ id: "youtube:e", providerId: "e", artwork: [] })];
    expect(deriveMixCollage(bare)).toEqual({ kind: "placeholder" });
  });

  it("never mutates the tracks it reads", () => {
    const tracks = [
      makeTrack({
        id: "youtube:f",
        providerId: "f",
        artwork: [{ url: "https://example.test/f.jpg" }],
      }),
    ];
    const before = JSON.stringify(tracks);
    deriveMixCollage(tracks);
    expect(JSON.stringify(tracks)).toBe(before);
  });
});

describe("namedMixes: the identities cannot drift into a second generator", () => {
  it("keeps the plan shape the shared generator's input expects", () => {
    // `generateMix` reads `hasSignal` and `seedTerms` off its profile; a plan that
    // set `hasSignal` to false for a device with signal would silently disable the
    // mix path, so the flag is asserted to survive every strategy untouched.
    const profile = profileOf(["Deep Funk", "Modern Soul"]);
    expect(profile.hasSignal).toBe(true);
    for (const plan of plansFor(profile)) {
      expect(plan.profile.hasSignal).toBe(profile.hasSignal);
      expect(plan.profile.genres).toEqual(profile.genres);
      expect(plan.profile.recentTrackIds).toEqual(profile.recentTrackIds);
      expect(plan.profile.languages).toEqual(profile.languages);
    }
    expect(idsOf(plansFor(profileOf(["Deep Funk"]), ["en"]))[0]).toBe("top");
  });
});
