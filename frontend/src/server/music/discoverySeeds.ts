import { isLanguageCode } from "@/lib/languages";

/**
 * Curated static seed catalog for the discovery feeds (ROADMAP M8; design
 * decisions 1–3).
 *
 * Every discovery shelf is produced by running curated *query text* through the
 * existing provider chain. No tier exposes a browse/chart capability today, and
 * ROADMAP M8 forbids claiming official chart status — so this module is the one
 * server-owned place where discovery query text is decided, and it is plain
 * data: no I/O, no providers, no storage, no user input.
 *
 * Deliberate constraints on every string in here:
 *
 * - **No chart or editorial claim.** A seed describes *what to look for*, never
 *   asserts a ranking: no "official charts", no "best of", no "editor's picks".
 *   A claim in a seed would become a claim on the shelf, and the product does
 *   not make one.
 * - **No third-party playlist ids.** Curated public playlists rot and would
 *   couple a feed to somebody else's curation; every seed is text this
 *   codebase owns and can edit.
 * - **Every catalog language is covered.** {@link TRENDING_SEEDS} carries at
 *   least one entry per code in the shared language catalog, so a user who
 *   selects any language gets a seed written in it rather than a silent
 *   fallback. The longer podcast/collection lists cover fewer languages and
 *   fall back to a documented language-neutral entry.
 */

/** One discovery feed kind (design decision 1: every kind is query-driven). */
export type DiscoveryKind = "trending" | "genre" | "podcast" | "collection" | "for-you" | "mix";

/** Every feed kind the discovery endpoint serves, in documented order. */
export const DISCOVERY_KINDS: readonly DiscoveryKind[] = [
  "trending",
  "genre",
  "podcast",
  "collection",
  "for-you",
  "mix",
];

/**
 * Kinds whose queries are framed by caller-supplied seed terms (a genre name
 * for `genre`, an artist or taste term for `for-you`/`mix`). The remaining
 * kinds are *catalog* kinds: their query text comes from this module and any
 * caller-supplied terms are ignored.
 */
const CALLER_SEEDED_KINDS: ReadonlySet<DiscoveryKind> = new Set<DiscoveryKind>([
  "genre",
  "for-you",
  "mix",
]);

/** Whether `kind` is framed by caller-supplied seed terms rather than the catalog. */
export function requiresCallerSeeds(kind: DiscoveryKind): boolean {
  return CALLER_SEEDED_KINDS.has(kind);
}

/**
 * The key used when a language has no curated list of its own. Neutral text is
 * deliberately *descriptive* rather than English-by-default, so a fallback
 * never imports a language claim the user did not select.
 */
const NEUTRAL = "neutral";

/**
 * Per-language trending query text. Every code in the shared language catalog
 * appears here at least once, so no selection can fall through to neutral text.
 */
const TRENDING_SEEDS: Readonly<Record<string, readonly string[]>> = {
  en: ["trending songs this week", "top hits 2026"],
  es: ["tendencias de la semana", "éxitos del momento"],
  fr: ["tendances de la semaine", "succès du moment"],
  de: ["Trends der Woche", "aktuelle Hits"],
  pt: ["tendências da semana", "sucessos do momento"],
  it: ["tendenze della settimana", "successi del momento"],
  nl: ["populaire nummers deze week", "nummers van nu"],
  sv: ["trender denna vecka", "populäraste låtarna nu"],
  no: ["trender denne uken", "populære sanger nå"],
  da: ["tendenser i denne uge", "populære sange nu"],
  fi: ["viikon trendikappaleet", "suosituimmat kappaleet nyt"],
  pl: ["trendy w tym tygodniu", "popularne piosenki teraz"],
  cs: ["trendy v tomto týdnu", "populární písně teď"],
  sk: ["trendy v tomto týždni", "populárne piesne teraz"],
  hu: ["heti trendek", "népszerű számok most"],
  ro: ["trenduri săptămâna aceasta", "succese populare acum"],
  bg: ["трендове тази седмица", "популярни песни сега"],
  el: ["τάσεις αυτή την εβδομάδα", "δημοφιλά τραγούδια τώρα"],
  tr: ["bu hafta trendler", "popüler şarkılar şimdi"],
  ru: ["тренды этой недели", "популярные песни сейчас"],
  uk: ["тренди цього тижня", "популярні пісні зараз"],
  ar: ["الأغاني الرائجة هذا الأسبوع", "أشهر الأغاني الآن"],
  he: ["הטרנד השבוע", "השירים הפופולריים עכשיו"],
  fa: ["ترندهای این هفته", "آهنگ‌های محبوب الان"],
  hi: ["इस हफ़्ते के ट्रेंडिंग गाने", "लोकप्रिय गाने अभी"],
  bn: ["এই সপ্তাহের ট্রেন্ডিং গান", "জনপ্রিয় গান এখন"],
  ur: ["اس ہفتے کے ٹرینڈنگ گانے", "مقبول گانے ابھی"],
  ta: ["இந்த வாரம் பிரபலமான பாடல்கள்", "இப்போது பிரபல பாடல்கள்"],
  te: ["ఈ వారం ట్రెండింగ్ పాటలు", "ఇప్పుడు ప్రముఖ పాటలు"],
  mr: ["या आठवड्यातील ट्रेंडिंग गाने", "आज लोकप्रिय गाने"],
  th: ["เพลงฮิตประจำสัปดาห์นี้", "เพลงยอดนิยมตอนนี้"],
  vi: ["bài hát thị hành tuần này", "bài hát được yêu thích hiện nay"],
  id: ["lagu populer minggu ini", "lagu paling banyak didengarkan sekarang"],
  ja: ["今週のヒット曲", "人気の曲まとめ"],
  ko: ["이번 주 핫한 노래", "지금 인기 있는 노래"],
  "zh-Hans": ["本周热门歌曲", "现在最流行的歌"],
  "zh-Hant": ["本週熱門歌曲", "現在最熱門的歌曲"],
  fil: ["mga kantang tanyo ngayong linggo", "mga sikat na kanta ngayon"],
};

/**
 * Per-language podcast query text. Fewer languages are covered than for
 * trending — long-form discovery is catalog work (M12 owns category-accurate
 * podcast filtering), so the neutral entry carries the rest.
 */
const PODCAST_SEEDS: Readonly<Record<string, readonly string[]>> = {
  en: ["podcasts to listen to this week", "podcasts for the commute"],
  es: ["podcasts populares", "podcasts para el trayecto"],
  pt: ["podcasts populares", "podcasts para o trajeto"],
  de: ["podcasts zum Autofahren", "aktuelle Podcast-Folgen"],
  fr: ["podcasts populaires", "podcasts pour le trajet"],
  [NEUTRAL]: ["popular podcast episodes", "new podcast episodes"],
};

/**
 * Curated, query-driven collections. Mood/descriptive text rather than
 * genres, deliberately without a claim: these read as "a shelf of this kind of
 * music", never "the best of X".
 */
const COLLECTION_SEEDS: Readonly<Record<string, readonly string[]>> = {
  en: [
    "chill evening music",
    "workout energy songs",
    "focus beats for studying",
    "late night drive songs",
  ],
  es: [
    "música relajante para la noche",
    "canciones para entrenar",
    "beats para concentrarse",
    "canciones para el trayecto",
  ],
  pt: [
    "músicas relaxantes para a noite",
    "músicas para treinar",
    "beats para estudar",
    "músicas para o trajeto",
  ],
  de: [
    "entspannte Musik für den Abend",
    "Songs zum Training",
    "Beats zum Konzentrieren",
    "Songs für die Autofahrt",
  ],
  fr: [
    "musique relaxante pour la soirée",
    "chansons pour s'entraîner",
    "beats pour se concentrer",
    "musique pour le trajet",
  ],
  [NEUTRAL]: ["chill evening mix", "workout energy songs", "focus beats", "late night drive songs"],
};

function seedsFor(
  catalog: Readonly<Record<string, readonly string[]>>,
  language: string,
): readonly string[] {
  return catalog[language] ?? catalog[NEUTRAL] ?? [];
}

/** Curated trending query text for `language` (never empty). */
export function trendingSeedsFor(language: string): readonly string[] {
  return seedsFor(TRENDING_SEEDS, language);
}

/** Curated podcast query text for `language`, or the neutral entry. */
export function podcastSeedsFor(language: string): readonly string[] {
  return seedsFor(PODCAST_SEEDS, language);
}

/** Curated collection query text for `language`, or the neutral entry. */
export function collectionSeedsFor(language: string): readonly string[] {
  return seedsFor(COLLECTION_SEEDS, language);
}

/**
 * Curated query text for a catalog kind, by kind and language. Caller-seeded
 * kinds have no catalog entry and return an empty list by design.
 */
export function catalogSeedsFor(kind: DiscoveryKind, language: string): readonly string[] {
  if (kind === "trending") return trendingSeedsFor(language);
  if (kind === "podcast") return podcastSeedsFor(language);
  if (kind === "collection") return collectionSeedsFor(language);
  return [];
}

/**
 * Localized "songs" noun used to frame a caller-supplied genre term. Query
 * text is cross-language, so this is a short hint, not a translation engine;
 * every catalog language outside this map uses the neutral noun.
 */
const GENRE_SUFFIXES: Readonly<Record<string, string>> = {
  en: "songs",
  es: "canciones",
  pt: "músicas",
  fr: "chansons",
  de: "Songs",
};

/** Neutral genre suffix for languages without a curated noun. */
const DEFAULT_GENRE_SUFFIX = "music";

/** Localized "radio" noun used to frame a `mix` seed term. */
const RADIO_SUFFIXES: Readonly<Record<string, string>> = {
  en: "radio",
  es: "radio",
  pt: "rádio",
  fr: "radio",
  de: "radio",
};

/** Neutral radio suffix for languages without a curated noun. */
const DEFAULT_RADIO_SUFFIX = "radio";

/**
 * Compose a genre query for `language`:
 * `composeGenreQuery("lo-fi", "es")` → `"lo-fi canciones"`.
 *
 * The genre term is the caller's own words and is passed through verbatim —
 * rewriting it would search for something the caller never asked for. Only the
 * framing noun is localized.
 */
export function composeGenreQuery(genreTerm: string, language: string): string {
  const suffix = isLanguageCode(language) ? GENRE_SUFFIXES[language] : undefined;
  return `${genreTerm} ${suffix ?? DEFAULT_GENRE_SUFFIX}`;
}

/**
 * Compose a taste query from a caller-supplied term:
 *
 * - `for-you` → `"<term> mix"` — the caller asked for the seed artist's mix of
 *   songs (a query hint, not a chart claim);
 * - `mix` → `"<term> <radio noun>"` — the same term framed as continuous
 *   programming, localized where a natural noun exists.
 *
 * `language` only selects the suffix bucket: provider query text is
 * cross-language and the term itself is never rewritten.
 */
export function composeTasteQuery(seedTerm: string, language: string, kind: DiscoveryKind): string {
  if (kind === "for-you") return `${seedTerm} mix`;
  const suffix = isLanguageCode(language) ? RADIO_SUFFIXES[language] : undefined;
  return `${seedTerm} ${suffix ?? DEFAULT_RADIO_SUFFIX}`;
}
