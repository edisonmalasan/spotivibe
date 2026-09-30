/**
 * The key used when a language has no curated queries of its own.
 *
 * The same literal the server's discovery seed lists use
 * (`server/music/discoverySeeds.ts`), so a catalog entry means the same thing in
 * both halves of the app. It is declared here rather than imported because that
 * constant is module-private there and a server module must never be imported by
 * client code.
 */
const NEUTRAL_LANGUAGE_KEY = "neutral";

/**
 * Curated podcast categories (M12; spec `podcasts` — "Curated podcast
 * categories", design decision 6).
 *
 * A category is a **query seed**, not a feed and not a ranking: activating one
 * runs a podcast-mode search for its query text. That is deliberate, and it is
 * what keeps this catalog honest — the product cannot compute "the best true
 * crime podcast", so it never claims to. What it can offer is a well-chosen
 * starting point per language, which is the same shape M8's genre catalog and
 * discovery seed lists already use.
 *
 * The catalog is small on purpose: a long list of "top" categories would be a
 * ranking by another name, and each entry costs a language translation.
 */

/** One category: an id for the UI and per-language query text. */
export interface PodcastCategory {
  /** Stable id, also the `data-testid` suffix. Never user-visible. */
  readonly id: string;
  /** English label, used as the fallback label for any other language. */
  readonly label: string;
  /** Query text per language code; the neutral entry covers the rest. */
  readonly queries: Readonly<Record<string, readonly string[]>>;
}

/** The neutral entry every category carries; see {@link NEUTRAL_LANGUAGE_KEY}. */
const NEUTRAL = NEUTRAL_LANGUAGE_KEY;

/**
 * The curated categories.
 *
 * Queries are written as a listener would say them ("history podcasts",
 * "true crime podcasts") rather than as catalog syntax, because the provider sees
 * them as a search query. Each language carries at most two.
 */
export const PODCAST_CATEGORIES: readonly PodcastCategory[] = [
  {
    id: "news",
    label: "News",
    queries: {
      en: ["news podcasts", "daily news podcast"],
      es: ["podcasts de noticias"],
      pt: ["podcasts de notícias"],
      de: ["nachrichten podcasts", "nachrichten podcast"],
      fr: ["podcasts d'actualité"],
      ja: ["ニュース ポッドキャスト"],
      [NEUTRAL]: ["news podcast", "current affairs podcast"],
    },
  },
  {
    id: "true-crime",
    label: "True Crime",
    queries: {
      en: ["true crime podcasts", "crime storytelling podcast"],
      es: ["podcasts de crímenes reales"],
      de: ["true crime podcasts"],
      fr: ["podcasts true crime"],
      [NEUTRAL]: ["true crime podcast", "investigative crime podcast"],
    },
  },
  {
    id: "comedy",
    label: "Comedy",
    queries: {
      en: ["comedy podcasts"],
      es: ["podcasts de comedia"],
      de: ["comedy podcasts"],
      fr: ["podcasts comédie"],
      [NEUTRAL]: ["comedy podcast", "humour podcast"],
    },
  },
  {
    id: "technology",
    label: "Technology",
    queries: {
      en: ["technology podcasts", "tech news podcast"],
      es: ["podcasts de tecnología"],
      de: ["technologie podcasts"],
      fr: ["podcasts technologie"],
      [NEUTRAL]: ["technology podcast", "tech podcast"],
    },
  },
  {
    id: "history",
    label: "History",
    queries: {
      en: ["history podcasts"],
      es: ["podcasts de historia"],
      pt: ["podcasts de história"],
      de: ["geschichte podcasts"],
      fr: ["podcasts histoire"],
      [NEUTRAL]: ["history podcast", "historical podcast"],
    },
  },
  {
    id: "business",
    label: "Business",
    queries: {
      en: ["business podcasts", "startup podcast"],
      es: ["podcasts de negocios"],
      de: ["business podcasts", "unternehmen podcast"],
      fr: ["podcasts business"],
      [NEUTRAL]: ["business podcast", "career podcast"],
    },
  },
  {
    id: "science",
    label: "Science",
    queries: {
      en: ["science podcasts"],
      es: ["podcasts de ciencia"],
      de: ["wissenschaft podcasts"],
      fr: ["podcasts science"],
      [NEUTRAL]: ["science podcast", "research podcast"],
    },
  },
  {
    id: "health",
    label: "Health & Wellness",
    queries: {
      en: ["health podcasts", "wellness podcast"],
      es: ["podcasts de salud y bienestar"],
      de: ["gesundheit podcasts", "wellness podcast"],
      fr: ["podcasts santé et bien-être"],
      [NEUTRAL]: ["health podcast", "mental health podcast"],
    },
  },
];

/**
 * The query text a category should search for, given the listener's selected
 * languages.
 *
 * Resolution order mirrors the discovery seed lists exactly: the first selected
 * language that has entries wins, then the neutral entry. A language with no
 * entry therefore falls back rather than returning nothing — a listener in a
 * language the catalog does not cover still gets a usable query.
 */
export function podcastCategoryQueries(
  category: PodcastCategory,
  languages: readonly string[],
): readonly string[] {
  for (const language of languages) {
    const entry = category.queries[language];
    if (entry !== undefined && entry.length > 0) return entry;
  }
  return category.queries[NEUTRAL] ?? [category.label];
}

/** The catalog as a lookup by id, for a caller that holds one id. */
export function podcastCategoryById(id: string): PodcastCategory | undefined {
  return PODCAST_CATEGORIES.find((category) => category.id === id);
}
