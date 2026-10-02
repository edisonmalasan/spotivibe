import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildDiscoveryQuery } from "@/features/home/discoveryApi";
import {
  bandForHour,
  bandForNow,
  bandSelectsTrack,
  bandTasteProfile,
  isTimeBand,
  localHourOf,
  MAX_BAND_QUERY_SEEDS,
  seedTermsForBand,
  selectBandTracks,
  systemClock,
  TIME_BAND_BOUNDS,
  TIME_BAND_LABELS,
  TIME_BAND_TERMS,
  TIME_BANDS,
  TIME_SHELF_LIMIT,
} from "@/features/home/timeBands";
import { useHistoryStore } from "@/stores/historyStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useMixStore } from "@/stores/mixStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M17 tasks 1.1–1.4 (spec: `home-mixes` — "The local clock selects a time-of-day
 * band", scenarios "Each hour maps to its band", "Band boundaries are half-open and
 * cover every hour", "Band selection is a pure function of the hour", "The band
 * influences only seed selection", "The band is not persisted"; `discovery` — "The
 * time band is not sent and not stored"; design decision 3).
 *
 * The claims under test are deliberately narrow and falsifiable: the band is a
 * function of the hour, the hour arrives through an injectable clock, and the
 * band's *only* effect is the terms it selects and the material those terms
 * select. Everything here runs on a supplied instant — nothing in this file reads
 * the wall clock, which is the point of the clock being injectable at all.
 */

// Keep the literal in a variable — Vite rewrites `new URL("<literal>",
// import.meta.url)`, so an inline form resolves against the wrong base.
const srcRel = "../src";
const srcDir = fileURLToPath(new URL(srcRel, import.meta.url));

/** Every module under `features/home`, read as source. */
function homeModules(): Array<{ file: string; source: string }> {
  const root = join(srcDir, "features", "home");
  return readdirSync(root, { withFileTypes: true, recursive: true }).flatMap((entry) => {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    const full = join(entry.parentPath, entry.name);
    return [{ file: full, source: readFileSync(full, "utf8") }];
  });
}

/** Comments removed, so prose cannot satisfy or fail a source rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * Wall-clock reads in a module.
 *
 * Two shapes count, and only two: a `Date.now()` **call**, and the argument-less
 * `new Date()`. The argument form `new Date(epochMs)` is *not* a wall-clock read —
 * it converts an instant the caller already has, which is the entire point of an
 * injectable clock — so the rule is drawn around the call, not around the word
 * `Date`. Reporting the argument form as a violation would force the one honest
 * conversion out of the feature and leave the clock smuggled in somewhere worse.
 */
function clockReads(source: string): string[] {
  const code = stripComments(source);
  const reads: string[] = [];
  if (/Date\s*\.\s*now\s*\(/.test(code)) reads.push("Date.now() call");
  if (/new\s+Date\s*\(\s*\)/.test(code)) reads.push("new Date() with no argument");
  return reads;
}

/** A taste with three artists, one of them carrying a recognisable mood word. */
function taste() {
  return {
    likedTracks: [
      makeTrack({
        id: "youtube:l1",
        providerId: "l1",
        title: "Liked One",
        artists: [{ name: "Aurora" }],
      }),
      makeTrack({
        id: "youtube:l2",
        providerId: "l2",
        title: "Liked Two",
        artists: [{ name: "Beacon" }],
      }),
      makeTrack({
        id: "youtube:l3",
        providerId: "l3",
        title: "Liked Three",
        artists: [{ name: "Cobalt" }],
      }),
    ],
    events: [],
  };
}

/** A fixed local hour, as an instant on a known day, for `bandForNow` cases. */
function instantAtLocalHour(hour: number): number {
  // 2026-10-02 is a plain local-midnight day in a UTC container; constructing the
  // instant from local components keeps the assertion about the *hour* rather than
  // about the runner's timezone offset.
  return new Date(2026, 9, 2, hour, 0, 0, 0).getTime();
}

/** One representative local hour per band, in the order the bands run. */
const BAND_HOURS: ReadonlyArray<readonly [(typeof TIME_BANDS)[number], number]> = [
  ["morning", 8],
  ["afternoon", 14],
  ["evening", 20],
  ["late-night", 2],
];

/** The profile a band's query is composed from, over this file's fixture taste. */
function profileForBand(band: (typeof TIME_BANDS)[number]) {
  return bandTasteProfile(band, {
    likedTracks: taste().likedTracks,
    events: [],
    languages: ["en", "es"],
    now: instantAtLocalHour(20),
  });
}

describe("timeBands: every hour maps to exactly one band", () => {
  it("answers the spec's four examples", () => {
    expect(bandForHour(8)).toBe("morning");
    expect(bandForHour(14)).toBe("afternoon");
    expect(bandForHour(20)).toBe("evening");
    expect(bandForHour(2)).toBe("late-night");
  });

  it("covers all 24 hours with no hour unclaimed and none claimed twice", () => {
    const byHour = Array.from({ length: 24 }, (_unused, hour) => bandForHour(hour));
    expect(byHour).toHaveLength(24);
    for (const band of byHour) expect(isTimeBand(band)).toBe(true);
    // Every band is reachable, and nothing else is ever returned.
    expect(new Set(byHour)).toEqual(new Set(TIME_BANDS));
  });

  it("gives every boundary hour to the band that starts there", () => {
    // Half-open means `[from, to)`: 05:00 is the first minute of morning, not the
    // last minute of late night. A rule that put boundaries on the earlier band
    // would still cover 24 hours, so only the boundaries themselves can tell.
    expect(bandForHour(5)).toBe("morning");
    expect(bandForHour(12)).toBe("afternoon");
    expect(bandForHour(17)).toBe("evening");
    expect(bandForHour(22)).toBe("late-night");
    // And one hour earlier each is still the band before it.
    expect(bandForHour(4)).toBe("late-night");
    expect(bandForHour(11)).toBe("morning");
    expect(bandForHour(16)).toBe("afternoon");
    expect(bandForHour(21)).toBe("evening");
  });

  it("declares its table as contiguous, half-open, gapless, and overlapping nowhere", () => {
    const sorted = [...TIME_BAND_BOUNDS].sort((a, b) => a.from - b.from);
    expect(sorted[0]?.from).toBe(0);
    expect(sorted[sorted.length - 1]?.to).toBe(24);
    for (const [index, bound] of sorted.entries()) {
      expect(bound.to - bound.from).toBeGreaterThan(0);
      // Contiguity is asserted from the data rather than re-typed, so widening a
      // band cannot quietly open a hole.
      if (index > 0) expect(bound.from).toBe(sorted[index - 1]?.to);
    }
  });

  it("normalizes an out-of-range hour and refuses a non-finite one", () => {
    expect(bandForHour(24)).toBe(bandForHour(0));
    expect(bandForHour(-1)).toBe(bandForHour(23));
    expect(bandForHour(7.9)).toBe(bandForHour(7));
    // A NaN hour is a caller bug; a band would label a shelf with a time nobody
    // reported, which is the failure this whole feature is scoped to avoid.
    expect(() => bandForHour(Number.NaN)).toThrow(/finite/);
  });
});

describe("timeBands: the clock is injected, and classification is pure", () => {
  it("classifies only the supplied hour, not the instant the clock returns", () => {
    // Two different instants whose local hour is the same must agree, and an
    // instant whose hour differs must not. If anything in the path consulted the
    // real clock, the second assertion would be the one that fails.
    const morning = bandForNow(() => instantAtLocalHour(8));
    const evening = bandForNow(() => instantAtLocalHour(20));
    expect(morning).toBe("morning");
    expect(evening).toBe("evening");

    // The same hour twice at two very different instants: one answer.
    const firstDay = bandForNow(() => instantAtLocalHour(14));
    const laterDay = bandForNow(() => instantAtLocalHour(14) + 400 * 24 * 60 * 60 * 1000);
    expect(firstDay).toBe(laterDay);
  });

  it("defaults to the system clock, which is the real Date.now", () => {
    expect(systemClock).toBe(Date.now);
    // The default path answers with a real band for the real instant; the assertion
    // is that it answers at all rather than throwing on a missing clock.
    expect(isTimeBand(bandForNow())).toBe(true);
  });

  it("reads the local hour of a supplied instant", () => {
    expect(localHourOf(instantAtLocalHour(0))).toBe(0);
    expect(localHourOf(instantAtLocalHour(13))).toBe(13);
    expect(localHourOf(instantAtLocalHour(23))).toBe(23);
  });

  it("has exactly one wall-clock read in the whole feature, and it is a reference", () => {
    const modules = homeModules();
    expect(modules.length).toBeGreaterThan(0);

    const offenders = modules
      .map(({ file, source }) => ({
        file: file.slice(srcDir.length + 1),
        reads: clockReads(source),
      }))
      .filter(({ reads }) => reads.length > 0);
    expect(offenders, "no module in features/home may read the wall clock").toEqual([]);

    // One documented exception, and it is a *reference* rather than a call, so the
    // rule above still holds for it. Asserting the exact declaration is what stops
    // `Date.now` from being spread into a second default in a later change.
    const bands = readFileSync(join(srcDir, "features", "home", "timeBands.ts"), "utf8");
    expect(bands).toContain("export const systemClock: Clock = Date.now;");
  });

  it("confirms the wall-clock detector can fail, so it is a check and not a report", () => {
    expect(clockReads("const t = Date.now();")).toEqual(["Date.now() call"]);
    expect(clockReads("const d = new Date();").length).toBeGreaterThan(0);
    // The argument form is not a wall-clock read; the detector must say so.
    expect(
      clockReads("export function localHourOf(ms: number) { return new Date(ms).getHours(); }"),
    ).toEqual([]);
    // And a comment cannot satisfy or break the rule.
    expect(clockReads("// Date.now() is only the default here\nconst x = 1;")).toEqual([]);
    expect(existsSync(join(srcDir, "features", "home", "timeBands.ts"))).toBe(true);
  });
});

describe("timeBands: the band's only effect is the terms it selects", () => {
  it("selects its mood word plus the listener's own terms, bounded and deduped", () => {
    const terms = seedTermsForBand("morning", taste());
    expect(terms[0]).toBe(TIME_BAND_TERMS.morning);
    expect(terms).toContain("Aurora");
    expect(terms.length).toBeLessThanOrEqual(8);
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("keeps the mood word even when the listener already fills the term bound", () => {
    // The listener's taste alone would fill the bound, so a strategy that *appended*
    // the band's word would have it trimmed away and the band would do nothing.
    const many = {
      likedTracks: Array.from({ length: 12 }, (_unused, index) =>
        makeTrack({
          id: `youtube:m${index}`,
          providerId: `m${index}`,
          title: `Liked ${index}`,
          artists: [{ name: `Artist ${index}` }],
        }),
      ),
      events: [],
    };
    const terms = seedTermsForBand("late-night", many);
    expect(terms[0]).toBe(TIME_BAND_TERMS["late-night"]);
    expect(terms.length).toBeLessThanOrEqual(8);
  });

  it("gives two bands over the same taste different terms", () => {
    const morning = seedTermsForBand("morning", taste());
    const night = seedTermsForBand("late-night", taste());
    expect(morning).not.toEqual(night);
    // And every band differs from the plain derivation it wraps.
    for (const band of TIME_BANDS) {
      expect(seedTermsForBand(band, taste())[0]).toBe(TIME_BAND_TERMS[band]);
    }
  });

  it("changes nothing in a request but its seeds", () => {
    const build = (band: (typeof TIME_BANDS)[number]) =>
      new URL(
        buildDiscoveryQuery({
          kind: "for-you",
          languages: ["en", "es"],
          seeds: seedTermsForBand(band, taste()),
          limit: 20,
        }),
        "http://localhost",
      ).searchParams;

    const morning = [...build("morning")].sort();
    const night = [...build("late-night")].sort();

    // Same parameter names, same values, except `seeds` — the band adds, removes,
    // and renames nothing else.
    expect(morning.filter(([key]) => key !== "seeds")).toEqual(
      night.filter(([key]) => key !== "seeds"),
    );
    expect(morning.filter(([key]) => key === "seeds")[0]?.[1]).not.toBe(
      night.filter(([key]) => key === "seeds")[0]?.[1],
    );
  });

  it("sends no band, label, or hour — only the languages and the seed terms", () => {
    for (const band of TIME_BANDS) {
      const url = buildDiscoveryQuery({
        kind: "for-you",
        languages: ["en"],
        seeds: seedTermsForBand(band, taste()),
        limit: 20,
      });
      // Every value in the request is a language code or a seed term; nothing
      // names a part of the day, and nothing carries an hour.
      const values = [...new URL(url, "http://localhost").searchParams.values()];
      expect(values.join(" ")).not.toContain(TIME_BAND_LABELS[band].toLowerCase());
      expect(url).not.toMatch(/band|hour|clock|time|morning|afternoon|evening|night/i);
      expect(url).toContain("languages=en");
      expect(url).toContain("seeds=");
    }
  });

  it("builds the identical request twice for the same band", () => {
    const once = buildDiscoveryQuery({
      kind: "for-you",
      languages: ["en"],
      seeds: seedTermsForBand("evening", taste()),
      limit: 20,
    });
    const twice = buildDiscoveryQuery({
      kind: "for-you",
      languages: ["en"],
      seeds: seedTermsForBand("evening", taste()),
      limit: 20,
    });
    expect(once).toBe(twice);
  });

  it("selects local material by the band's mood and nothing else", () => {
    const funk = makeTrack({
      id: "youtube:f",
      providerId: "f",
      title: "Deep Funk",
      artists: [{ name: "Aurora" }],
    });
    const soul = makeTrack({
      id: "youtube:s",
      providerId: "s",
      title: "Modern Soul",
      artists: [{ name: "Aurora" }],
    });
    const material = [funk, soul];

    expect(bandSelectsTrack("afternoon", funk)).toBe(true);
    expect(bandSelectsTrack("evening", funk)).toBe(false);
    expect(selectBandTracks("afternoon", material).map((track) => track.id)).toEqual(["youtube:f"]);
    expect(selectBandTracks("evening", material).map((track) => track.id)).toEqual(["youtube:s"]);
    // A band with no match selects nothing rather than substituting unrelated
    // tracks — the honest answer, and the shelf's empty state exists for it.
    expect(selectBandTracks("morning", material)).toEqual([]);
  });

  it("dedupes and caps the selected material without mutating it", () => {
    const soul = makeTrack({
      id: "youtube:s",
      providerId: "s",
      title: "Modern Soul",
      artists: [{ name: "Aurora" }],
    });
    const material = [soul, soul];
    const before = [...material];
    expect(selectBandTracks("evening", material)).toHaveLength(1);
    expect(selectBandTracks("evening", material, 0)).toEqual([]);
    expect(material).toEqual(before);
    expect(TIME_SHELF_LIMIT).toBeGreaterThan(0);
  });
});

/**
 * The band's *second* effect: the seed set a real request is composed from.
 *
 * `ROADMAP.md` scopes M17's band to "seed set and query construction only", and the
 * `discovery` scenario "The time band is not sent and not stored" has a WHEN clause
 * of "a time-aware shelf issues a request **or composes a mix**". So the profile a
 * band hands the one shared mix generator is asserted here as a pure derivation, and
 * the request that would result is asserted to carry the band's terms and nothing
 * else — the surface that actually presses the button is
 * `tests/home-time-shelf.test.tsx`.
 */
describe("timeBands: the band's seed set reaches a request and nothing else does", () => {
  it("leads the profile's seeds with the band's mood, bounded to the generator's read", () => {
    for (const [band] of BAND_HOURS) {
      const seeds = profileForBand(band).seedTerms;
      expect(seeds[0], band).toBe(TIME_BAND_TERMS[band]);
      expect(seeds.length, band).toBeGreaterThan(0);
      // `generateMix` reads `seedTerms.slice(0, 4)`, so the bound is stated here
      // rather than left for the generator to discover.
      expect(seeds.length, band).toBeLessThanOrEqual(MAX_BAND_QUERY_SEEDS);
      expect(new Set(seeds).size, band).toBe(seeds.length);
    }
  });

  it("changes the profile's seed terms and nothing else", () => {
    // The same rule the mix cards' seed strategies are held to: a strategy chooses
    // *what to ask for*, never *whether there is anything to build from*. So a band
    // cannot turn a cold device into a composable one, and cannot re-weight the
    // taste a mix's own name is derived from. Each band is compared against a
    // *different* band, since two bands that happen to agree would prove nothing.
    const profile = profileForBand("evening");
    const other = profileForBand("morning");
    const { seedTerms, ...rest } = profile;
    const { seedTerms: otherSeeds, ...otherRest } = other;

    expect(seedTerms.length).toBeGreaterThan(0);
    expect(seedTerms).not.toEqual(otherSeeds);
    expect(rest.hasSignal).toBe(other.hasSignal);
    expect(rest.artists).toEqual(other.artists);
    expect(rest.genres).toEqual(other.genres);
    expect(rest.recentTrackIds).toEqual(other.recentTrackIds);
    // `languages` is the listener's own selection, identical for both by construction.
    expect(rest.languages).toEqual(otherRest.languages);
  });

  it("builds a request carrying the band's terms and no band, clock, or time-of-day", () => {
    for (const [band, hour] of BAND_HOURS) {
      const profile = bandTasteProfile(band, {
        likedTracks: taste().likedTracks,
        events: [],
        languages: ["en"],
        now: instantAtLocalHour(hour),
      });
      const url = buildDiscoveryQuery({
        kind: "mix",
        languages: ["en"],
        seeds: profile.seedTerms,
        limit: 20,
      });
      const params = new URL(url, "http://localhost").searchParams;

      // What leaves the device is the band's mood plus the listener's own terms.
      expect(params.get("seeds")).toBe(profile.seedTerms.join(","));
      expect(url).toContain(`seeds=${encodeURIComponent(TIME_BAND_TERMS[band])}`);
      expect([...params.keys()].sort()).toEqual(["kind", "languages", "limit", "seeds"]);
      // No band value, no clock value, and no time-of-day field of any kind. The
      // seed list is the only free-text carrier, so the hour is looked for there
      // rather than in the whole URL — `limit=20` is a request parameter, not a time.
      expect([...params.values()].join(" ")).not.toMatch(
        /band|hour|clock|time|mood|morning|afternoon|evening|night/i,
      );
      expect(params.get("seeds") ?? "").not.toMatch(new RegExp(`\\b${hour}\\b`));
      expect(url).not.toContain(TIME_BAND_LABELS[band]);
    }
  });

  it("gives every band its own request over the same taste", () => {
    const requests = BAND_HOURS.map(([band]) =>
      buildDiscoveryQuery({
        kind: "mix",
        languages: ["en"],
        seeds: profileForBand(band).seedTerms,
        limit: 20,
      }),
    );
    expect(new Set(requests).size).toBe(requests.length);
    // Same parameter names throughout, so a difference can only ever be the terms.
    const keysOf = (url: string) =>
      [...new URL(url, "http://localhost").searchParams.keys()].sort();
    for (const url of requests)
      expect(keysOf(url)).toEqual(["kind", "languages", "limit", "seeds"]);
  });

  it("keeps the profile a pure function of the taste and the band", () => {
    const input = {
      likedTracks: taste().likedTracks,
      events: [],
      languages: ["en"],
      now: instantAtLocalHour(20),
    };
    const before = JSON.stringify(input);
    expect(bandTasteProfile("evening", input)).toEqual(bandTasteProfile("evening", input));
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("timeBands: the band is neither persisted nor sent", () => {
  it("reaches no store write and no local-data accessor while selecting a band", async () => {
    // `getLocalData` is the single accessor every local read and write goes
    // through, so a spy on it is the honest place to look for "no store write was
    // reached" — asserting instead on the *absence of a visible mutation* would
    // pass just as happily if the write had been swallowed.
    const localData = await import("@/data/localData");
    const getLocalData = vi.spyOn(localData, "getLocalData");

    const before = [
      useHistoryStore.getState().events,
      useLibraryStore.getState().likedTracks,
      useMixStore.getState().mixes,
      usePreferencesStore.getState().languages,
    ];

    for (const band of TIME_BANDS) {
      seedTermsForBand(band, taste());
      selectBandTracks(band, taste().likedTracks);
      // The composition path too: deriving the profile a request would be built from
      // is part of "the band selects a seed set and query construction only", so a
      // write reached from here would be a band reaching the device's storage.
      profileForBand(band);
    }
    bandForNow(() => instantAtLocalHour(3));

    expect(getLocalData).not.toHaveBeenCalled();
    expect([
      useHistoryStore.getState().events,
      useLibraryStore.getState().likedTracks,
      useMixStore.getState().mixes,
      usePreferencesStore.getState().languages,
    ]).toEqual(before);

    getLocalData.mockRestore();
  });

  it("writes no band value into any store's state", () => {
    // Not "no accessor was called" but the positive claim: after selecting every
    // band — and deriving every band's profile — no store holds a band, a label, or
    // an hour anywhere in its own state.
    for (const band of TIME_BANDS) {
      bandForHour(band === "morning" ? 8 : band === "afternoon" ? 14 : band === "evening" ? 20 : 2);
      profileForBand(band);
    }
    const stored = [
      useHistoryStore.getState(),
      useLibraryStore.getState(),
      useMixStore.getState(),
      usePreferencesStore.getState(),
    ].map((state) =>
      JSON.stringify(state, (_key, value) => (typeof value === "function" ? "[fn]" : value)),
    );

    for (const band of TIME_BANDS) {
      expect(stored.join(" ")).not.toContain(band);
      expect(stored.join(" ")).not.toContain(TIME_BAND_LABELS[band]);
    }
  });

  it("names no band field in the profile the generator is handed", () => {
    // The band reaches a request through `seedTerms` and nothing else, so the
    // profile itself must carry no band, clock, or time-of-day key to leak from.
    for (const band of TIME_BANDS) {
      const keys = Object.keys(profileForBand(band));
      for (const key of keys) {
        expect(key, `${band}: ${key}`).not.toMatch(/band|hour|clock|time|mood/i);
      }
      expect(keys).toEqual([
        "artists",
        "genres",
        "languages",
        "recentTrackIds",
        "seedTerms",
        "hasSignal",
      ]);
    }
  });
});
