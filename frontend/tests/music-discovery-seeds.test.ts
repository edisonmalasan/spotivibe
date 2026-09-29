import { describe, expect, it } from "vitest";
import { LANGUAGES, MAX_SELECTED_LANGUAGES } from "@/lib/languages";
import { DISCOVERY_SEED_CAP, planDiscoverySeeds } from "@/server/music/discovery";
import {
  catalogSeedsFor,
  collectionSeedsFor,
  composeGenreQuery,
  composeTasteQuery,
  DISCOVERY_KINDS,
  podcastSeedsFor,
  requiresCallerSeeds,
  trendingSeedsFor,
  type DiscoveryKind,
} from "@/server/music/discoverySeeds";

/** Every language code in the shared catalog — the coverage target. */
const CATALOG_CODES = LANGUAGES.map((language) => language.code);

/**
 * Chart/editorial vocabulary the product must never claim (ROADMAP M8; the
 * spec's "no official chart status" scenario). Matched case-insensitively
 * against every seed string the server owns.
 */
const CLAIM_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  { label: "chart", pattern: /chart/i },
  { label: "billboard", pattern: /billboard/i },
  { label: "official", pattern: /\bofficial\b/i },
  { label: "top 40", pattern: /\btop\s*40\b/i },
  { label: "number one", pattern: /\b(number\s*(one|1)|n[º°]\s*1)\b/i },
  { label: "best of", pattern: /\bbest\s+of\b/i },
  { label: "editor's pick", pattern: /editor/i },
  { label: "essential", pattern: /\bessential/i },
  { label: "must-hear", pattern: /\bmust[\s-]?hear\b/i },
  { label: "guaranteed hit", pattern: /\bguaranteed\b/i },
];

/** Every query string the catalog owns, with the catalog it came from. */
function allSeedStrings(): Array<{ source: string; text: string }> {
  const entries: Array<{ source: string; text: string }> = [];
  for (const language of CATALOG_CODES) {
    for (const [source, list] of [
      ["trending", trendingSeedsFor(language)],
      ["podcast", podcastSeedsFor(language)],
      ["collection", collectionSeedsFor(language)],
    ] as const) {
      for (const text of list) entries.push({ source: `${source}/${language}`, text });
    }
  }
  return entries;
}

describe("discovery seed catalog — coverage", () => {
  it("exposes the documented feed kinds", () => {
    expect([...DISCOVERY_KINDS]).toEqual([
      "trending",
      "genre",
      "podcast",
      "collection",
      "for-you",
      "mix",
    ]);
  });

  it("exposes at least the 37 languages the spec requires", () => {
    expect(CATALOG_CODES.length).toBeGreaterThanOrEqual(37);
    expect(CATALOG_CODES.length).toBe(LANGUAGES.length);
  });

  it("keeps every language code unique", () => {
    expect(new Set(CATALOG_CODES).size).toBe(CATALOG_CODES.length);
  });

  it("gives every catalog language at least one trending seed (no silent fallback)", () => {
    const missing = CATALOG_CODES.filter((code) => trendingSeedsFor(code).length === 0);
    expect(missing).toEqual([]);
  });

  it("curates trending text per catalog code rather than falling back to neutral text", () => {
    // The trending catalog deliberately has no neutral entry, so a code that
    // resolves to nothing at all proves coverage is per-code and not a blanket
    // fallback: an unknown code gets no trending seed whatsoever.
    const covered = CATALOG_CODES.filter((code) => trendingSeedsFor(code).length > 0);
    expect(new Set(covered)).toEqual(new Set(CATALOG_CODES));
    expect(trendingSeedsFor("xx")).toEqual([]);
  });

  it("writes distinct trending text per language (no copy-paste English fallback)", () => {
    const distinctTexts = new Set(CATALOG_CODES.map((code) => trendingSeedsFor(code).join("|")));
    expect(distinctTexts.size).toBe(CATALOG_CODES.length);
  });

  it("gives every kind at least one seed through the planner", () => {
    for (const kind of DISCOVERY_KINDS) {
      const seeds = planDiscoverySeeds({
        kind,
        languages: ["en"],
        ...(requiresCallerSeeds(kind) ? { seeds: ["example term"] } : {}),
        limit: 20,
      });
      expect(seeds.length, kind).toBeGreaterThan(0);
      for (const seed of seeds) {
        expect(seed.query.trim().length, `${kind}: ${seed.query}`).toBeGreaterThan(0);
        expect(CATALOG_CODES, `${kind}: ${seed.language}`).toContain(seed.language);
      }
    }
  });

  it("leaves catalog kinds without catalog text and caller-seeded kinds without it", () => {
    const catalogKinds: DiscoveryKind[] = ["trending", "podcast", "collection"];
    for (const kind of catalogKinds) {
      expect(catalogSeedsFor(kind, "en").length, kind).toBeGreaterThan(0);
    }
    for (const kind of ["genre", "for-you", "mix"] as const) {
      expect(catalogSeedsFor(kind, "en")).toEqual([]);
      expect(requiresCallerSeeds(kind)).toBe(true);
    }
    expect(requiresCallerSeeds("trending")).toBe(false);
  });

  it("falls back to documented neutral podcast/collection text for uncovered languages", () => {
    // `ja` has curated trending text but no curated podcast/collection list.
    expect(trendingSeedsFor("ja").length).toBeGreaterThan(0);
    expect(podcastSeedsFor("ja")).toEqual(podcastSeedsFor("xx"));
    expect(collectionSeedsFor("ja")).toEqual(collectionSeedsFor("xx"));
  });

  it("keeps seed text short and free of empty entries", () => {
    for (const { source, text } of allSeedStrings()) {
      expect(text.trim(), source).toBe(text);
      expect(text.length, source).toBeGreaterThan(0);
      expect(text.length, source).toBeLessThanOrEqual(80);
    }
  });
});

describe("discovery seed catalog — no chart claims, no third-party ids", () => {
  it("uses no chart or editorial vocabulary in any seed", () => {
    const offenders: string[] = [];
    for (const { source, text } of allSeedStrings()) {
      for (const { label, pattern } of CLAIM_PATTERNS) {
        if (pattern.test(text)) offenders.push(`${label} in ${source}: ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("references no playlist id, video id, or third-party URL", () => {
    const offenders: string[] = [];
    for (const { source, text } of allSeedStrings()) {
      if (/(?:^|\b)PL[A-Za-z0-9_-]{10,}/.test(text)) offenders.push(`playlist id in ${source}`);
      if (/(?:youtube\.com|youtu\.be|open\.spotify|music\.apple)/i.test(text)) {
        offenders.push(`third-party URL in ${source}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("composeGenreQuery — localized framing of a caller term", () => {
  it("localizes the framing noun per language", () => {
    expect(composeGenreQuery("jazz", "en")).toBe("jazz songs");
    expect(composeGenreQuery("jazz", "es")).toBe("jazz canciones");
    expect(composeGenreQuery("jazz", "pt")).toBe("jazz músicas");
    expect(composeGenreQuery("jazz", "fr")).toBe("jazz chansons");
    expect(composeGenreQuery("jazz", "de")).toBe("jazz Songs");
  });

  it("falls back to the neutral noun for languages without a curated one", () => {
    expect(composeGenreQuery("jazz", "ja")).toBe("jazz music");
    expect(composeGenreQuery("jazz", "xx")).toBe("jazz music");
  });

  it("passes the caller's own term through verbatim", () => {
    expect(composeGenreQuery("  post-punk  ", "en")).toBe("  post-punk   songs");
  });
});

describe("composeTasteQuery — caller term framing per kind", () => {
  it("asks for a mix of songs for `for-you`", () => {
    expect(composeTasteQuery("Radiohead", "en", "for-you")).toBe("Radiohead mix");
    expect(composeTasteQuery("Radiohead", "ja", "for-you")).toBe("Radiohead mix");
  });

  it("asks for continuous programming for `mix`, localized where a noun exists", () => {
    expect(composeTasteQuery("Radiohead", "en", "mix")).toBe("Radiohead radio");
    expect(composeTasteQuery("Radiohead", "pt", "mix")).toBe("Radiohead rádio");
    expect(composeTasteQuery("Radiohead", "ja", "mix")).toBe("Radiohead radio");
  });

  it("never rewrites the caller's term", () => {
    expect(composeTasteQuery("Boa Noite", "pt", "mix")).toBe("Boa Noite rádio");
  });
});

describe("planDiscoverySeeds — bounded, language-fair planning", () => {
  it("plans every selected language before any language contributes a second seed", () => {
    const seeds = planDiscoverySeeds({
      kind: "trending",
      languages: ["en", "es", "de"],
      limit: 20,
    });
    expect(seeds.map((seed) => seed.language)).toEqual(["en", "es", "de", "en", "es", "de"]);
    expect(new Set(seeds.map((seed) => seed.language))).toEqual(new Set(["en", "es", "de"]));
  });

  it("never exceeds the seed cap, and never drops a selected language while doing so", () => {
    const languages = [...CATALOG_CODES].slice(0, MAX_SELECTED_LANGUAGES);
    const seeds = planDiscoverySeeds({ kind: "trending", languages, limit: 20 });
    expect(seeds.length).toBeLessThanOrEqual(DISCOVERY_SEED_CAP);
    // The cap is a fan-out bound, never a language bound.
    expect(new Set(seeds.map((seed) => seed.language))).toEqual(new Set(languages));
  });

  it("plans a caller term per language, terms outer and languages inner", () => {
    const seeds = planDiscoverySeeds({
      kind: "genre",
      languages: ["en", "es"],
      seeds: ["jazz", "shoegaze"],
      limit: 20,
    });
    expect(seeds.map((seed) => `${seed.language}:${seed.query}`)).toEqual([
      "en:jazz songs",
      "es:jazz canciones",
      "en:shoegaze songs",
      "es:shoegaze canciones",
    ]);
  });

  it("drops blank and duplicate caller terms", () => {
    const seeds = planDiscoverySeeds({
      kind: "for-you",
      languages: ["en"],
      seeds: ["  Radiohead  ", "", "   ", "Radiohead"],
      limit: 20,
    });
    expect(seeds.map((seed) => seed.query)).toEqual(["Radiohead mix"]);
  });

  it("ignores caller terms for catalog kinds (design decision 1)", () => {
    const withSeeds = planDiscoverySeeds({
      kind: "trending",
      languages: ["en"],
      seeds: ["injected term"],
      limit: 20,
    });
    const withoutSeeds = planDiscoverySeeds({ kind: "trending", languages: ["en"], limit: 20 });
    expect(withSeeds).toEqual(withoutSeeds);
  });

  it("falls back to the default language when a selection is entirely unknown", () => {
    const seeds = planDiscoverySeeds({ kind: "trending", languages: ["xx", "yy"], limit: 20 });
    expect(seeds.every((seed) => seed.language === "en")).toBe(true);
  });
});
