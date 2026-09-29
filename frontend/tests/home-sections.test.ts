import { describe, expect, it } from "vitest";
import {
  assertShelfRhythm,
  CIRCULAR_WINDOW,
  HOME_SECTIONS,
  MIN_LOCAL_ARTISTS_FOR_MIXES,
  selectHomeSections,
  shelfRhythmViolations,
  type HomeSection,
  type HomeSectionSignals,
} from "@/features/home/homeSections";

/**
 * M8 task 6.1 (design §7 + rhythm risk): the Home feed's *order* is data, and
 * the geometry rhythm is a checked invariant rather than a convention.
 *
 * DESIGN.md's literal "never two circular and never two square sections
 * adjacent" is unsatisfiable at feed scale (design Risks, amended spec), so what
 * is enforced is what the spec states: circular sections are never adjacent to
 * one another, and the circular section interrupts the square shelves within the
 * first four rendered sections.
 */

/** A fresh user: no history, no local artists. */
const NO_SIGNAL: HomeSectionSignals = {
  hasHistory: false,
  hasLocalArtists: false,
  localArtistCount: 0,
};

/** A returning user with plenty of local signal. */
const FULL_SIGNAL: HomeSectionSignals = {
  hasHistory: true,
  hasLocalArtists: true,
  localArtistCount: 6,
};

/** Every combination of the three gating signals. */
function allSignalCombinations(): HomeSectionSignals[] {
  const combinations: HomeSectionSignals[] = [];
  for (const hasHistory of [false, true]) {
    for (const localArtistCount of [0, 1, MIN_LOCAL_ARTISTS_FOR_MIXES, 9]) {
      combinations.push({
        hasHistory,
        hasLocalArtists: localArtistCount > 0,
        localArtistCount,
      });
    }
  }
  return combinations;
}

/** A minimal section list, so a rhythm case can be constructed deliberately. */
function section(id: string, shape: "square" | "circular"): HomeSection {
  return {
    id: id as HomeSection["id"],
    title: id,
    description: "",
    shape,
    kind: "local",
    enabled: () => true,
  };
}

describe("homeSections: the ordered feed", () => {
  it("lists the baseline sections in the roadmap's order", () => {
    expect(HOME_SECTIONS.map((entry) => entry.id)).toEqual([
      "recently-played",
      "trending",
      "made-for-you",
      "popular-artists",
      "smart-mixes",
      "genres",
      "podcasts",
      "collections",
    ]);
  });

  it("maps each section onto its discovery kind, with local-only sections marked", () => {
    expect(HOME_SECTIONS.map((entry) => entry.kind)).toEqual([
      "local",
      "trending",
      "for-you",
      "local",
      "mix",
      "local",
      "podcast",
      "collection",
    ]);
  });

  it("keeps the circular section and every other section square", () => {
    expect(HOME_SECTIONS.filter((entry) => entry.shape === "circular").map((e) => e.id)).toEqual([
      "popular-artists",
    ]);
  });

  it("makes no chart or editorial claim in any section title or description", () => {
    for (const entry of HOME_SECTIONS) {
      expect(`${entry.title} ${entry.description}`).not.toMatch(
        /chart|ranking|top of|most listened|editor|spotify|youtube|official/i,
      );
    }
  });

  it("describes the Trending shelf's mechanism, never a popularity ranking", () => {
    const trending = HOME_SECTIONS.find((entry) => entry.id === "trending");
    expect(trending?.description).toBe(
      "A rotating shelf built from provider queries, refreshed each visit.",
    );
    // The shelf runs queries and is recomposed; it makes no claim about what the
    // results mean. Naming a popularity, ranking, or timeliness guarantee would
    // be a claim the feed cannot back.
    expect(trending?.description).not.toMatch(
      /popular|popularity|hot|hottest|biggest|number one|now|top|chart|rank/i,
    );
  });
});

describe("homeSections: local-only sections are gated", () => {
  it("omits every local-only section for a fresh user", () => {
    const rendered = selectHomeSections(NO_SIGNAL, HOME_SECTIONS);

    expect(rendered.map((entry) => entry.id)).toEqual([
      "trending",
      "popular-artists",
      "genres",
      "podcasts",
      "collections",
    ]);
  });

  it("omits Recently Played when there is no history, even with local artists", () => {
    const rendered = selectHomeSections(
      { hasHistory: false, hasLocalArtists: true, localArtistCount: 8 },
      HOME_SECTIONS,
    );

    expect(rendered.map((entry) => entry.id)).not.toContain("recently-played");
  });

  it("adds Recently Played as soon as one listening event exists", () => {
    const rendered = selectHomeSections(
      { hasHistory: true, hasLocalArtists: false, localArtistCount: 0 },
      HOME_SECTIONS,
    );

    expect(rendered[0]?.id).toBe("recently-played");
  });

  it("gates Made For You on any local artist and Smart Mixes on three", () => {
    const one = selectHomeSections(
      { hasHistory: true, hasLocalArtists: true, localArtistCount: 1 },
      HOME_SECTIONS,
    );
    expect(one.map((entry) => entry.id)).toContain("made-for-you");
    expect(one.map((entry) => entry.id)).not.toContain("smart-mixes");

    const three = selectHomeSections(
      { hasHistory: true, hasLocalArtists: true, localArtistCount: MIN_LOCAL_ARTISTS_FOR_MIXES },
      HOME_SECTIONS,
    );
    expect(three.map((entry) => entry.id)).toContain("smart-mixes");
  });

  it("opens the seeded shelves on usable seed terms, not on the artist count alone", () => {
    // `for-you` and `mix` are caller-seeded kinds: the endpoint answers a request
    // with an empty seed list with 400. So a signal set that says "there are
    // artists" while the seed derivation produces no term must not be able to
    // open either shelf — the count is necessary, never sufficient.
    const countedButUnseeded: HomeSectionSignals = {
      hasHistory: true,
      hasLocalArtists: false,
      localArtistCount: MIN_LOCAL_ARTISTS_FOR_MIXES + 2,
    };

    const rendered = selectHomeSections(countedButUnseeded, HOME_SECTIONS).map((entry) => entry.id);
    expect(rendered).not.toContain("made-for-you");
    expect(rendered).not.toContain("smart-mixes");
  });

  it("never renders the local-only sections without their signal", () => {
    for (const signals of allSignalCombinations()) {
      const rendered = selectHomeSections(signals, HOME_SECTIONS);
      const ids = rendered.map((entry) => entry.id);
      if (!signals.hasHistory) expect(ids).not.toContain("recently-played");
      if (!signals.hasLocalArtists) expect(ids).not.toContain("made-for-you");
      if (signals.localArtistCount < MIN_LOCAL_ARTISTS_FOR_MIXES) {
        expect(ids).not.toContain("smart-mixes");
      }
    }
  });
});

describe("homeSections: the geometry rhythm rule", () => {
  it("passes for the authored feed under every combination of local signals", () => {
    for (const signals of allSignalCombinations()) {
      const rendered = selectHomeSections(signals, HOME_SECTIONS);
      expect(shelfRhythmViolations(rendered), JSON.stringify(signals)).toEqual([]);
      expect(() => {
        assertShelfRhythm(rendered);
      }).not.toThrow();
    }
  });

  it("keeps the circular section within the first four rendered sections", () => {
    expect(CIRCULAR_WINDOW).toBe(4);

    for (const signals of allSignalCombinations()) {
      const rendered = selectHomeSections(signals, HOME_SECTIONS);
      const circularIndex = rendered.findIndex((entry) => entry.shape === "circular");
      expect(circularIndex).toBeGreaterThanOrEqual(0);
      expect(circularIndex, JSON.stringify(signals)).toBeLessThan(CIRCULAR_WINDOW);
    }
  });

  it("lets local-only sections only move the circular section earlier", () => {
    const fresh = selectHomeSections(NO_SIGNAL, HOME_SECTIONS);
    const returning = selectHomeSections(FULL_SIGNAL, HOME_SECTIONS);
    const indexOf = (list: HomeSection[]) => list.findIndex((entry) => entry.shape === "circular");

    expect(indexOf(fresh)).toBeLessThan(indexOf(returning));
    expect(indexOf(returning)).toBe(3); // fourth, behind the three square shelves
  });

  it("flags two adjacent circular sections", () => {
    const violations = shelfRhythmViolations([
      section("a", "square"),
      section("b", "circular"),
      section("c", "circular"),
    ]);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ index: 2, id: "c" });
    expect(violations[0]?.reason).toMatch(/adjacent/);
  });

  it("flags a circular section that trails the feed", () => {
    const trailing = [
      section("a", "square"),
      section("b", "square"),
      section("c", "square"),
      section("d", "square"),
      section("e", "circular"),
    ];

    const violations = shelfRhythmViolations(trailing);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ index: 4, id: "e" });
    expect(violations[0]?.reason).toMatch(/past the first 4 sections/);
  });

  it("reports every violation of a list rather than only the first", () => {
    const violations = shelfRhythmViolations([
      section("a", "circular"),
      section("b", "circular"),
      section("c", "square"),
      section("d", "square"),
      section("e", "circular"),
    ]);

    expect(violations.map((entry) => entry.id)).toEqual(["b", "e"]);
  });

  it("accepts a single circular section in the window and rejects a bad order loudly", () => {
    expect(shelfRhythmViolations([section("a", "circular"), section("b", "square")])).toEqual([]);
    expect(() => {
      assertShelfRhythm([section("a", "square"), section("b", "circular")]);
    }).not.toThrow();

    expect(() => {
      assertShelfRhythm([
        section("a", "square"),
        section("b", "circular"),
        section("c", "circular"),
      ]);
    }).toThrow(/Home shelf rhythm violated/);
  });

  it("never mutates the authored section list while selecting", () => {
    const before = HOME_SECTIONS.map((entry) => entry.id);
    selectHomeSections(FULL_SIGNAL, HOME_SECTIONS);
    expect(HOME_SECTIONS.map((entry) => entry.id)).toEqual(before);
  });
});
