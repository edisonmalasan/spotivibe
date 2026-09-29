/**
 * Shared language catalog for discovery feeds (spec: `discovery` — language
 * catalog and first-run onboarding / language mixing).
 *
 * The catalog is the single source of truth for selectable language codes and
 * is imported by BOTH the server discovery seed catalog
 * (`server/music/discoverySeeds.ts`) and the client onboarding UI
 * (`features/preferences/**`), so the two can never drift. It is pure data and
 * pure functions: no repository, no storage, no network.
 *
 * Local-first constraint: a selected language is a *preference*, never a
 * profile. It is persisted in the local preferences dataset and sent to the
 * discovery endpoint only as a request parameter.
 */

/** A selectable language. `code` is the stable identifier used on the wire. */
export interface LanguageOption {
  /** Stable language code, e.g. `en`, `es`, `zh-Hans`. */
  readonly code: string;
  /** English name, used for compact labels. */
  readonly name: string;
  /** Endonym shown next to the English name in the picker. */
  readonly nativeName: string;
}

/** Used when a user has not chosen any language yet. */
export const DEFAULT_LANGUAGE = "en";

/** Upper bound on how many languages one user may select at a time. */
export const MAX_SELECTED_LANGUAGES = 8;

/**
 * The broad language catalog (ROADMAP M8: keep Lyrix's broad catalog unless
 * later intentionally reduced). 38 entries — at least the 37 the spec requires.
 */
export const LANGUAGES: readonly LanguageOption[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "sv", name: "Swedish", nativeName: "Svenska" },
  { code: "no", name: "Norwegian", nativeName: "Norsk" },
  { code: "da", name: "Danish", nativeName: "Dansk" },
  { code: "fi", name: "Finnish", nativeName: "Suomi" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "cs", name: "Czech", nativeName: "Čeština" },
  { code: "sk", name: "Slovak", nativeName: "Slovenčina" },
  { code: "hu", name: "Hungarian", nativeName: "Magyar" },
  { code: "ro", name: "Romanian", nativeName: "Română" },
  { code: "bg", name: "Bulgarian", nativeName: "Български" },
  { code: "el", name: "Greek", nativeName: "Ελληνικά" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "uk", name: "Ukrainian", nativeName: "Україннська" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "he", name: "Hebrew", nativeName: "עברית" },
  { code: "fa", name: "Persian", nativeName: "فارسی" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা" },
  { code: "ur", name: "Urdu", nativeName: "اردو" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்" },
  { code: "te", name: "Telugu", nativeName: "తెలుగు" },
  { code: "mr", name: "Marathi", nativeName: "मराठी" },
  { code: "th", name: "Thai", nativeName: "ไทย" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "zh-Hans", name: "Chinese (Simplified)", nativeName: "简体中文" },
  { code: "zh-Hant", name: "Chinese (Traditional)", nativeName: "繁體中文" },
  { code: "fil", name: "Filipino", nativeName: "Filipino" },
];

/** Fast lookup by code. */
const LANGUAGE_BY_CODE: ReadonlyMap<string, LanguageOption> = new Map(
  LANGUAGES.map((language) => [language.code, language]),
);

/** Whether `code` is a known catalog language (case-insensitive on the `Hant`/`Hans` suffix is not applied). */
export function isLanguageCode(code: string): boolean {
  return LANGUAGE_BY_CODE.has(code);
}

/** Look up a catalog entry, or `undefined` for an unknown code. */
export function findLanguage(code: string): LanguageOption | undefined {
  return LANGUAGE_BY_CODE.get(code);
}

/** Human-readable name for a code, falling back to the code itself. */
export function languageName(code: string): string {
  return LANGUAGE_BY_CODE.get(code)?.name ?? code;
}

/**
 * Normalize a user-selected language list: drop unknown codes, drop duplicates
 * while preserving the user's order, and cap the result. An empty or fully
 * invalid list falls back to `[DEFAULT_LANGUAGE]` so a feed always has an
 * attribution language.
 */
export function normalizeLanguageCodes(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of codes) {
    const code = raw.trim();
    if (code === "" || seen.has(code) || !isLanguageCode(code)) continue;
    seen.add(code);
    result.push(code);
    if (result.length === MAX_SELECTED_LANGUAGES) break;
  }
  return result.length > 0 ? result : [DEFAULT_LANGUAGE];
}
