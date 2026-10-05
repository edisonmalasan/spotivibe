import { describe, expect, it } from "vitest";
import {
  assertShelfRhythm,
  CIRCULAR_WINDOW,
  HOME_SECTIONS,
  selectHomeSections,
  shelfRhythmViolations,
  type HomeSection,
  type HomeSectionSignals,
} from "@/features/home/homeSections";
import {
  MIX_CARD_SURFACE,
  QUICK_PICK_SURFACE,
  TIME_SHELF_SURFACE,
} from "@/features/home/homeFilter";

/**
 * M8 task 6.1 (design §7 + rhythm risk): the Home feed's *order* is data, and
 * the geometry rhythm is a checked invariant rather than a convention.
 *
 * DESIGN.md's literal "never two circular and never two square sections
 * adjacent" is unsatisfiable at feed scale (design Risks, amended spec), so what
 * is enforced is what the spec states: circular sections are never adjacent to
 * one another, and the circular section interrupts the square shelves within the
 * first four rendered sections.
 *
 * M11 re-gates Smart Mixes: the section lists the mixes the listener actually
 * has (`hasMixes`) instead of previewing a discovery feed once three local
 * artists existed, so a listener with signal but no mix sees no empty shelf.
 *
 * **M23: the rhythm is now checked over the whole rendered feed, not just
 * `HOME_SECTIONS`.** The circular artist rail is Quick Picks, and Quick Picks is
 * not a `HOME_SECTIONS` entry — it renders above the section stack beside the
 * mix-card row and the time-aware shelf. So the rhythm input below is
 * `M17_ROWS + sections`, matching what `HomeView` renders. Checking `sections`
 * alone would have left the rule green over a list with no circular row in it,
 * which is a passing check that guards nothing; {@link renderedRows} is the single
 * helper both the migrated and the new rhythm tests read, so they cannot drift
 * apart from what the component asserts.
 */

/** A fresh user: no history, no local artists, no mixes. */
const NO_SIGNAL: HomeSectionSignals = {
  hasHistory: false,
  hasLocalArtists: false,
  localArtistCount: 0,
  hasMixes: false,
};

/** A returning user with plenty of local signal and a generated mix. */
const FULL_SIGNAL: HomeSectionSignals = {
  hasHistory: true,
  hasLocalArtists: true,
  localArtistCount: 6,
  hasMixes: true,
};

/** Every combination of the gating signals. */
function allSignalCombinations(): HomeSectionSignals[] {
  const combinations: HomeSectionSignals[] = [];
  for (const hasHistory of [false, true]) {
    for (const localArtistCount of [0, 1, 3, 9]) {
      for (const hasMixes of [false, true]) {
        combinations.push({
          hasHistory,
          hasLocalArtists: localArtistCount > 0,
          localArtistCount,
          hasMixes,
        });
      }
    }
  }
  return combinations;
}

/**
 * The three M17 surfaces in the order `HomeView` renders them (M23).
 *
 * Duplicated from the component's own list on purpose. A test that imported
 * `M17_SURFACE_ROWS` would pass by construction if the component's list were wrong,
 * which is the opposite of what a rhythm check is for: the point is to pin the
 * declared order against the rule, so the expectation has to be written down.
 */
const M17_ROWS = [MIX_CARD_SURFACE, TIME_SHELF_SURFACE, QUICK_PICK_SURFACE];

/** The rendered feed rows for a signal combination: the M17 rows, then the sections. */
function renderedRows(
  signals: HomeSectionSignals,
): Array<{ id: string; shape: "square" | "circular" }> {
  return [...M17_ROWS, ...selectHomeSections(signals, HOME_SECTIONS)];
}

/** A minimal section list, so a rhythm case can be constructed deliberately. */
function section(id: string, shape: "square" | "circular"): HomeSection {
  return {
    id: id as HomeSection["id"],
    title: id,
    description: "",
    shape,
    kind: "local",
    filters: ["music"],
    enabled: () => true,
  };
}

describe("homeSections: the ordered feed", () => {
  it("lists the baseline sections in the roadmap's order", () => {
    // M23: `popular-artists` is gone. It was measured on production to render a
    // strict prefix of the Quick Picks rail — same artists, same order, same image
    // URLs — and this spec permits one circular artist section, so the two could not
    // both ship. Its content is reachable through Quick Picks.
    expect(HOME_SECTIONS.map((entry) => entry.id)).toEqual([
      "recently-played",
      "trending",
      "made-for-you",
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
      // M11: Smart Mixes is local data now — the section lists generated mixes
      // rather than resolving a discovery feed of its own.
      "local",
      "local",
      "podcast",
      "collection",
    ]);
  });

  it("holds no circular section of its own, because Quick Picks is that section", () => {
    // M23. Every `HOME_SECTIONS` row is square now; the feed's one circular artist
    // rail is the Quick Picks shelf, which renders above this list. The next test
    // asserts the circular section still exists — in the rendered feed.
    expect(HOME_SECTIONS.filter((entry) => entry.shape === "circular")).toEqual([]);
    expect(HOME_SECTIONS.every((entry) => entry.shape === "square")).toBe(true);
  });

  it("declares Quick Picks as the circular artist surface", () => {
    // The declaration the rhythm guard and the filter both read, pinned here because
    // both other behaviours depend on it and neither would fail loudly if it drifted.
    expect(QUICK_PICK_SURFACE.shape).toBe("circular");
    expect(MIX_CARD_SURFACE.shape).toBe("square");
    expect(TIME_SHELF_SURFACE.shape).toBe("square");
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

/**
 * M17 design decision 4: the `All`/`Music`/`Podcasts` filter is a selection over
 * this one list, and the only way it can stay a selection is if membership is
 * declared here rather than in a second list somewhere else.
 */
describe("homeSections: every section declares the filters it belongs to", () => {
  it("declares at least one filter for every section", () => {
    for (const section of HOME_SECTIONS) {
      expect(section.filters.length, section.id).toBeGreaterThan(0);
    }
  });

  it("never declares 'all', which is implicit for every section", () => {
    // `all` is structural rather than declared, so no section can forget it — which
    // is what makes the `All` presentation and the unrecognised-value fallback the
    // same two lines of code.
    for (const section of HOME_SECTIONS) {
      expect(section.filters, section.id).not.toContain("all");
    }
  });

  it("puts the long-form shelf under Podcasts and every music shelf under Music", () => {
    const podcasts = HOME_SECTIONS.find((section) => section.id === "podcasts");
    expect(podcasts?.filters).toEqual(["podcasts"]);

    for (const section of HOME_SECTIONS) {
      if (section.id === "podcasts") continue;
      expect(section.filters, section.id).toEqual(["music"]);
    }
  });

  it("keeps the podcast filter's presentation to exactly the long-form shelf", () => {
    // The strongest form of the subset claim available at the model level: the
    // Podcasts filter can present one shelf, because exactly one section declares
    // it.
    const presented = HOME_SECTIONS.filter((section) => section.filters.includes("podcasts"));
    expect(presented.map((section) => section.id)).toEqual(["podcasts"]);
  });
});

describe("homeSections: local-only sections are gated", () => {
  it("omits every local-only section for a fresh user", () => {
    const rendered = selectHomeSections(NO_SIGNAL, HOME_SECTIONS);

    expect(rendered.map((entry) => entry.id)).toEqual([
      "trending",
      "genres",
      "podcasts",
      "collections",
    ]);
  });

  it("omits Recently Played when there is no history, even with local artists", () => {
    const rendered = selectHomeSections(
      { hasHistory: false, hasLocalArtists: true, localArtistCount: 8, hasMixes: true },
      HOME_SECTIONS,
    );

    expect(rendered.map((entry) => entry.id)).not.toContain("recently-played");
  });

  it("adds Recently Played as soon as one listening event exists", () => {
    const rendered = selectHomeSections(
      { hasHistory: true, hasLocalArtists: false, localArtistCount: 0, hasMixes: false },
      HOME_SECTIONS,
    );

    expect(rendered[0]?.id).toBe("recently-played");
  });

  it("gates Made For You on any local artist and Smart Mixes on a generated mix", () => {
    const one = selectHomeSections(
      { hasHistory: true, hasLocalArtists: true, localArtistCount: 1, hasMixes: false },
      HOME_SECTIONS,
    );
    expect(one.map((entry) => entry.id)).toContain("made-for-you");
    // Signal without a mix: the section would have nothing to list, so it does
    // not render — the opposite of the M8 preview gate.
    expect(one.map((entry) => entry.id)).not.toContain("smart-mixes");

    const withMix = selectHomeSections(
      { hasHistory: true, hasLocalArtists: true, localArtistCount: 1, hasMixes: true },
      HOME_SECTIONS,
    );
    expect(withMix.map((entry) => entry.id)).toContain("smart-mixes");
  });

  it("shows Smart Mixes for a listener with a mix but no local artist seed", () => {
    // A mix persists after the likes that produced it are cleared, and the
    // listener can still open it — the section is gated on the mix, not on the
    // signal behind it.
    const rendered = selectHomeSections(
      { hasHistory: false, hasLocalArtists: false, localArtistCount: 0, hasMixes: true },
      HOME_SECTIONS,
    ).map((entry) => entry.id);
    expect(rendered).toContain("smart-mixes");
  });

  it("opens the seeded shelves on usable seed terms, not on the artist count alone", () => {
    // `for-you` is a caller-seeded kind: the endpoint answers a request with an
    // empty seed list with 400. So a signal set that says "there are artists"
    // while the seed derivation produces no term must not be able to open the
    // shelf — the count is necessary, never sufficient.
    const countedButUnseeded: HomeSectionSignals = {
      hasHistory: true,
      hasLocalArtists: false,
      localArtistCount: 8,
      hasMixes: false,
    };

    const rendered = selectHomeSections(countedButUnseeded, HOME_SECTIONS).map((entry) => entry.id);
    expect(rendered).not.toContain("made-for-you");
  });

  it("never renders the local-only sections without their signal", () => {
    for (const signals of allSignalCombinations()) {
      const rendered = selectHomeSections(signals, HOME_SECTIONS);
      const ids = rendered.map((entry) => entry.id);
      if (!signals.hasHistory) expect(ids).not.toContain("recently-played");
      if (!signals.hasLocalArtists) expect(ids).not.toContain("made-for-you");
      if (!signals.hasMixes) expect(ids).not.toContain("smart-mixes");
    }
  });
});

describe("homeSections: the geometry rhythm rule", () => {
  it("passes for the authored feed under every combination of local signals", () => {
    for (const signals of allSignalCombinations()) {
      const rendered = renderedRows(signals);
      expect(shelfRhythmViolations(rendered), JSON.stringify(signals)).toEqual([]);
      expect(() => {
        assertShelfRhythm(rendered);
      }).not.toThrow();
    }
  });

  it("keeps the circular section within the first four rendered sections", () => {
    expect(CIRCULAR_WINDOW).toBe(4);

    for (const signals of allSignalCombinations()) {
      const rendered = renderedRows(signals);
      const circularIndex = rendered.findIndex((entry) => entry.shape === "circular");
      expect(circularIndex, JSON.stringify(signals)).toBeGreaterThanOrEqual(0);
      expect(circularIndex, JSON.stringify(signals)).toBeLessThan(CIRCULAR_WINDOW);
    }
  });

  it("renders exactly one circular row, for every combination of local signals", () => {
    // The "exactly one circular artist section" clause (M23). Asserted on the
    // *rendered* rows, because a check over `HOME_SECTIONS` alone would find zero
    // circular rows and pass — the vacuous-pass failure mode this milestone had to
    // avoid introducing.
    for (const signals of allSignalCombinations()) {
      const circular = renderedRows(signals).filter((entry) => entry.shape === "circular");
      expect(
        circular.map((entry) => entry.id),
        JSON.stringify(signals),
      ).toEqual(["home-quick-picks"]);
    }
  });

  it("lets local-only sections only move the circular section earlier", () => {
    const fresh = renderedRows(NO_SIGNAL);
    const returning = renderedRows(FULL_SIGNAL);
    const indexOf = (list: readonly { shape: string }[]) =>
      list.findIndex((entry) => entry.shape === "circular");

    // M23: the circular rail is the third rendered row (mix cards, time shelf, then
    // Quick Picks), and the local-only sections all render *below* it — so its
    // position is now fixed at 2 whether the device is fresh or returning. The
    // assertion is kept as "never later than before", which is what the spec's
    // rhythm rule actually protects.
    expect(indexOf(fresh)).toBeLessThanOrEqual(indexOf(returning));
    expect(indexOf(returning)).toBe(2);
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
