import { describe, expect, it } from "vitest";
import {
  HOME_FILTERS,
  HOME_FILTER_LABELS,
  isHomeFilter,
  MIX_CARD_SURFACE,
  presentsFilter,
  presentsSurface,
  QUICK_PICK_SURFACE,
  sectionsForFilter,
  TIME_SHELF_SURFACE,
  type HomeFilter,
  type HomeFilterSurface,
} from "@/features/home/homeFilter";
import {
  HOME_SECTIONS,
  selectHomeSections,
  type HomeSectionSignals,
} from "@/features/home/homeSections";

/**
 * M17 tasks 4.1–4.3 (spec: `discovery` — "Home discovery feed", scenarios "The
 * filter presents a subset of the one section model" and "An unrecognised filter
 * presents everything"; design decision 4).
 *
 * The load-bearing property is the **subset** one, and it is asserted as a
 * relationship rather than as a list: for every filter value the presented set is
 * exactly `HOME_SECTIONS` filtered by that value, and no value can put an id back
 * that the list never had. A test that hard-coded the expected ids would pass
 * happily after somebody added a ninth section, which is precisely the drift the
 * decision exists to prevent.
 */

/** A returning user with plenty of local signal, so nothing is gated out. */
const FULL_SIGNAL: HomeSectionSignals = {
  hasHistory: true,
  hasLocalArtists: true,
  localArtistCount: 6,
  hasMixes: true,
};

const ALL_IDS = HOME_SECTIONS.map((section) => section.id);

/** A stand-in for the one list, so a subset claim can be checked against it. */
function everythingEnabled(): HomeSectionSignals {
  return FULL_SIGNAL;
}

describe("homeFilter: the vocabulary is three values", () => {
  it("is exactly All, Music, and Podcasts, in presentation order", () => {
    expect([...HOME_FILTERS]).toEqual(["all", "music", "podcasts"]);
    expect(HOME_FILTER_LABELS.all).toBe("All");
    expect(HOME_FILTER_LABELS.music).toBe("Music");
    expect(HOME_FILTER_LABELS.podcasts).toBe("Podcasts");
    for (const filter of HOME_FILTERS) expect(isHomeFilter(filter)).toBe(true);
  });

  it("does not recognise a value it does not define", () => {
    expect(isHomeFilter("all")).toBe(true);
    expect(isHomeFilter("videos")).toBe(false);
    expect(isHomeFilter("")).toBe(false);
    expect(isHomeFilter(undefined)).toBe(false);
    expect(isHomeFilter(null)).toBe(false);
    expect(isHomeFilter(3)).toBe(false);
  });
});

describe("homeFilter: a filter is a selection over the one section model", () => {
  it("presents every section under All, in feed order", () => {
    const sections = sectionsForFilter(HOME_SECTIONS, "all");
    expect(sections.map((section) => section.id)).toEqual(ALL_IDS);
  });

  it("presents exactly the list filtered by each recognised value", () => {
    // The expected set is *derived* from the list rather than written out, so
    // adding a section cannot make this test disagree with the model. `all` is the
    // one value no section declares — it is implicit for every one of them.
    const byDeclaredFilter = (filter: HomeFilter) =>
      filter === "all"
        ? ALL_IDS
        : HOME_SECTIONS.filter((section) => section.filters.includes(filter)).map(
            (section) => section.id,
          );

    for (const filter of HOME_FILTERS) {
      const presented = sectionsForFilter(HOME_SECTIONS, filter);
      expect(presented.map((section) => section.id)).toEqual(byDeclaredFilter(filter));
      if (filter === "all") expect(presented).toHaveLength(HOME_SECTIONS.length);
    }

    // And each of the other two is a strict, non-empty subset.
    for (const filter of ["music", "podcasts"] as const) {
      const presented = sectionsForFilter(HOME_SECTIONS, filter).map((section) => section.id);
      expect(presented.length).toBeGreaterThan(0);
      expect(presented.length).toBeLessThan(HOME_SECTIONS.length);
      expect(presented.every((id) => ALL_IDS.includes(id))).toBe(true);
    }
  });

  it("presents the podcast shelf alone under Podcasts", () => {
    const presented = sectionsForFilter(HOME_SECTIONS, "podcasts").map((section) => section.id);
    expect(presented).toEqual(["podcasts"]);
    const podcasts = HOME_SECTIONS.find((section) => section.id === "podcasts");
    expect(podcasts?.kind).toBe("podcast");
  });

  it("composes with the local-signal gate rather than replacing it", () => {
    // Two selections over one list: the gate the feed has always applied, and the
    // filter. Neither can add anything, so their intersection is a subset of both.
    const enabled = selectHomeSections(everythingEnabled(), HOME_SECTIONS);
    for (const filter of HOME_FILTERS) {
      const presented = sectionsForFilter(enabled, filter).map((section) => section.id);
      expect(presented.every((id) => enabled.some((section) => section.id === id))).toBe(true);
    }
  });

  it("never exceeds the list under any filter value, recognised or not", () => {
    const values = [...HOME_FILTERS, "videos", "", "MUSIC", "all ", "gaming"];
    for (const value of values) {
      const presented = sectionsForFilter(HOME_SECTIONS, value).map((section) => section.id);
      expect(presented.length, value).toBeLessThanOrEqual(HOME_SECTIONS.length);
      for (const id of presented) expect(ALL_IDS, value).toContain(id);
    }
  });

  it("presents an id the list does not contain under no filter value", () => {
    // An id that exists only in this test. No filter value may put it on screen,
    // because nothing but the one section model decides what Home presents.
    const ROGUE_ID = "made-up-shelf";
    for (const value of [...HOME_FILTERS, "videos", "", "MUSIC", "gaming"]) {
      const presented = sectionsForFilter(HOME_SECTIONS, value).map((section) => section.id);
      expect(presented, value).not.toContain(ROGUE_ID);
      // Membership is the model's, not the filter's: what comes back is always a
      // subset of what was handed in, so a filter cannot manufacture an entry.
      for (const id of presented) expect(ALL_IDS, value).toContain(id);
    }
  });

  it("selects rather than extends, which is what makes the subset claim true", () => {
    // A two-entry input, one per filter: the filter moves between the entries it
    // was given and invents nothing. An implementation that hard-coded a third
    // shelf, or that read a list of its own, fails both halves of this.
    const input = HOME_SECTIONS.filter(
      (section) => section.id === "trending" || section.id === "podcasts",
    );
    expect(input.map((section) => section.id)).toEqual(["trending", "podcasts"]);

    expect(sectionsForFilter(input, "music").map((section) => section.id)).toEqual(["trending"]);
    expect(sectionsForFilter(input, "podcasts").map((section) => section.id)).toEqual(["podcasts"]);
    expect(sectionsForFilter(input, "all").map((section) => section.id)).toEqual([
      "trending",
      "podcasts",
    ]);
    // An input with a section the model lacks is presented when it *declares* the
    // filter — membership belongs to the list, which is why the list is the gate.
    const rogue = { ...input[0], id: "made-up-shelf" as (typeof input)[number]["id"] };
    if (input[0] === undefined) throw new Error("the section model is empty");
    expect(sectionsForFilter([rogue], "music").map((section) => section.id)).toEqual([
      "made-up-shelf",
    ]);
  });

  it("returns the caller's own entries, so a filter cannot substitute a section", () => {
    const first = HOME_SECTIONS[0];
    if (first === undefined) throw new Error("the section model is empty");
    const presented = sectionsForFilter([first], "all");
    expect(presented[0]).toBe(first);
    expect(presented).not.toBe(HOME_SECTIONS);
  });
});

describe("homeFilter: an unrecognised value presents everything", () => {
  it("answers with the whole list, never with nothing", () => {
    for (const value of ["videos", "", "  ", "Music", "all-music", "0", "MUSIC"]) {
      const presented = sectionsForFilter(HOME_SECTIONS, value).map((section) => section.id);
      expect(presented, `filter "${value}" must present everything`).toEqual(ALL_IDS);
    }
  });

  it("never presents an empty Home because of a bad value", () => {
    // The failure this rule exists to prevent, stated as its own assertion: an
    // empty presentation is worse than ignoring the value.
    for (const value of ["videos", "", "nope"]) {
      expect(sectionsForFilter(HOME_SECTIONS, value).length).toBeGreaterThan(0);
    }
  });

  it("falls back for the M17 surfaces too", () => {
    for (const value of ["videos", "", "nope"]) {
      expect(presentsSurface(MIX_CARD_SURFACE, value)).toBe(true);
      expect(presentsSurface(QUICK_PICK_SURFACE, value)).toBe(true);
      expect(presentsSurface(TIME_SHELF_SURFACE, value)).toBe(true);
    }
  });
});

describe("homeFilter: the M17 surfaces declare their own filters", () => {
  it("presents every declared surface under All and under Music, none under Podcasts", () => {
    const surfaces: HomeFilterSurface[] = [
      MIX_CARD_SURFACE,
      QUICK_PICK_SURFACE,
      TIME_SHELF_SURFACE,
    ];
    for (const surface of surfaces) {
      expect(presentsSurface(surface, "all"), surface.id).toBe(true);
      expect(presentsSurface(surface, "music"), surface.id).toBe(true);
      // A mix, an artist entry, and a band-seeded music shelf are none of them
      // long-form, so the Podcasts filter presents none of them.
      expect(presentsSurface(surface, "podcasts"), surface.id).toBe(false);
      expect(surface.id).not.toBe("");
    }
  });

  it("agrees with the section model on which shelves are music", () => {
    // One vocabulary, two declarations: a surface and a section are presented by
    // the same predicate, so the two cannot drift apart into different rules.
    const musicSection = HOME_SECTIONS.filter((section) =>
      presentsFilter(section.filters, "music"),
    );
    expect(presentsFilter(MIX_CARD_SURFACE.filters, "music")).toBe(true);
    expect(presentsFilter(QUICK_PICK_SURFACE.filters, "music")).toBe(true);
    expect(presentsFilter(TIME_SHELF_SURFACE.filters, "music")).toBe(true);
    // `all` is implicit everywhere, so no declaration repeats it.
    for (const section of HOME_SECTIONS) expect(section.filters).not.toContain("all");
    expect(musicSection.length).toBeGreaterThan(0);
  });
});
