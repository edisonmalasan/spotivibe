import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  MAX_SELECTED_LANGUAGES,
  findLanguage,
  isLanguageCode,
  languageName,
  normalizeLanguageCodes,
} from "@/lib/languages";

/**
 * M8 task 1.1/3.1: the shared language catalog contract both the server seed
 * catalog and the client onboarding UI depend on — breadth (≥ 37 selectable
 * languages with unique stable codes and readable names) and the normalization
 * rule that bounds a user selection.
 */

describe("language catalog breadth", () => {
  it("offers at least 37 selectable languages", () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(37);
  });

  it("gives every entry a unique, non-blank code and a readable English name", () => {
    const codes = new Set<string>();
    for (const language of LANGUAGES) {
      expect(language.code.trim()).not.toBe("");
      expect(codes.has(language.code)).toBe(false);
      codes.add(language.code);
      expect(language.name.trim()).not.toBe("");
      expect(language.nativeName.trim()).not.toBe("");
    }
    expect(codes.size).toBe(LANGUAGES.length);
  });

  it("includes the default language", () => {
    expect(isLanguageCode(DEFAULT_LANGUAGE)).toBe(true);
    expect(findLanguage(DEFAULT_LANGUAGE)?.name).toBe("English");
  });
});

describe("language lookup", () => {
  it("resolves catalog codes case-sensitively and rejects unknown ones", () => {
    expect(isLanguageCode("es")).toBe(true);
    expect(isLanguageCode("zh-Hans")).toBe(true);
    expect(isLanguageCode("EN")).toBe(false);
    expect(isLanguageCode("klingon")).toBe(false);
    expect(findLanguage("klingon")).toBeUndefined();
  });

  it("names a known code and falls back to the code itself", () => {
    expect(languageName("ja")).toBe("Japanese");
    expect(languageName("klingon")).toBe("klingon");
  });
});

describe("normalizeLanguageCodes", () => {
  it("keeps the user's order and drops unknown and blank codes", () => {
    expect(normalizeLanguageCodes(["ja", "klingon", "en", "", "  "])).toEqual(["ja", "en"]);
  });

  it("drops duplicates while preserving the first occurrence", () => {
    expect(normalizeLanguageCodes(["es", "en", "es", "en"])).toEqual(["es", "en"]);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeLanguageCodes(["  fr  "])).toEqual(["fr"]);
  });

  it("caps the selection at MAX_SELECTED_LANGUAGES in the user's order", () => {
    const every = LANGUAGES.map((language) => language.code);
    const capped = normalizeLanguageCodes(every);
    expect(capped).toHaveLength(MAX_SELECTED_LANGUAGES);
    expect(capped).toEqual(every.slice(0, MAX_SELECTED_LANGUAGES));
  });

  it("counts toward the cap only accepted codes", () => {
    const padded = [...LANGUAGES.map((l) => l.code).slice(0, MAX_SELECTED_LANGUAGES), "klingon"];
    expect(normalizeLanguageCodes(padded)).toHaveLength(MAX_SELECTED_LANGUAGES);
  });

  it("falls back to the default language when nothing valid is supplied", () => {
    expect(normalizeLanguageCodes([])).toEqual([DEFAULT_LANGUAGE]);
    expect(normalizeLanguageCodes(["klingon", "   "])).toEqual([DEFAULT_LANGUAGE]);
  });
});
