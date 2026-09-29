import type { DiscoveryKind } from "@/features/home/discoveryApi";

/**
 * The Home feed's ordered section list (ROADMAP M8; spec: `discovery` — "Home
 * discovery feed"; design §7/§9).
 *
 * The feed order is **data**, not a convention: a typed, data-only list of
 * section descriptors, so the geometry rule DESIGN.md's "Geometry Rhythm"
 * describes can be checked by a unit test instead of trusted to review
 * (design risk: "design drift on the rhythm rule").
 *
 * About the rhythm rule: DESIGN.md's literal "never place two circular sections
 * or two square sections adjacent" is unsatisfiable at feed scale — taken
 * literally it caps the feed at two shelves (design §Risks, amended spec). What
 * the rule protects is *unclustered circular contrast*, so the enforced
 * invariants are the two the spec states: no two circular sections are
 * adjacent, and the circular section interrupts the square shelves within the
 * first {@link CIRCULAR_WINDOW} rendered sections instead of trailing the feed.
 */

/** Card geometry for a section's content (DESIGN.md "Geometry Rhythm"). */
export type HomeShelfShape = "square" | "circular";

/** Where a section's content comes from: a discovery feed, or local data. */
export type HomeSectionKind = DiscoveryKind | "local";

/** Stable identifier for each Home section. */
export type HomeSectionId =
  | "recently-played"
  | "trending"
  | "made-for-you"
  | "popular-artists"
  | "smart-mixes"
  | "genres"
  | "podcasts"
  | "collections";

/**
 * The local signals that gate the local-only sections. Derived from the
 * listening-history and liked-track stores; never from a server response.
 */
export interface HomeSectionSignals {
  /** Any listening event exists (Recently Played's gate). */
  hasHistory: boolean;
  /**
   * Whether the device has at least one taste term to seed with — i.e. the
   * *derived seed list* is non-empty, not merely that some artist is known
   * (Made For You's gate).
   *
   * Deliberately the seeds and not the artist count: a local artist with a
   * blank *name* is counted as an artist but produces no term, and a
   * caller-seeded `for-you`/`mix` request with no term is answered with 400.
   * Gating on the terms the request will carry makes "the shelf renders" and
   * "the request is valid" the same condition.
   */
  hasLocalArtists: boolean;
  /** How many distinct local artists exist (Smart Mixes' gate, design §9). */
  localArtistCount: number;
}

/** One Home section: what it shows, what shape it is, and when it appears. */
export interface HomeSection {
  /** Stable id — also the `data-testid` suffix for the rendered shelf. */
  readonly id: HomeSectionId;
  /** Section title (DESIGN.md "Section Header"). */
  readonly title: string;
  /** Secondary line under the header. Never a chart or editorial claim. */
  readonly description: string;
  /** Card geometry, also what the loading skeleton is shaped like. */
  readonly shape: HomeShelfShape;
  /** The discovery feed this section resolves, or `"local"` for local data. */
  readonly kind: HomeSectionKind;
  /** Whether the local signals make this section render at all. */
  readonly enabled: (signals: HomeSectionSignals) => boolean;
}

/** Minimum distinct local artists before a Smart Mixes shelf renders (§9). */
export const MIN_LOCAL_ARTISTS_FOR_MIXES = 3;

/** How many rendered sections may precede the circular one (spec). */
export const CIRCULAR_WINDOW = 4;

const always = (): boolean => true;

/**
 * The Home feed, in order. The circular Popular Artists section sits fourth, so
 * it interrupts the square shelves inside the window and can only be pushed
 * earlier — never later — as local-only sections disappear.
 */
export const HOME_SECTIONS: readonly HomeSection[] = [
  {
    id: "recently-played",
    title: "Recently Played",
    description: "What you played on this device, newest first.",
    shape: "square",
    kind: "local",
    // Omitted entirely with no history — never an empty "recently played".
    enabled: (signals) => signals.hasHistory,
  },
  {
    id: "trending",
    title: "Trending Now",
    // Describes the mechanism, not a ranking: the shelf runs a rotating set of
    // provider queries and is recomposed on each visit, so no claim is made
    // about what those results mean (no chart, no "popular right now").
    description: "A rotating shelf built from provider queries, refreshed each visit.",
    shape: "square",
    kind: "trending",
    enabled: always,
  },
  {
    id: "made-for-you",
    title: "Made For You",
    description: "Seeded by the artists you like and play on this device.",
    shape: "square",
    kind: "for-you",
    // No local signal means no seeds, and the `for-you` feed requires seeds.
    enabled: (signals) => signals.hasLocalArtists,
  },
  {
    id: "popular-artists",
    title: "Popular Artists",
    description: "Artists appearing across the trending shelf. Open one to search their music.",
    shape: "circular",
    // Derived from the Trending result — no extra request of its own.
    kind: "local",
    enabled: always,
  },
  {
    id: "smart-mixes",
    title: "Smart Mixes",
    description: "A preview of continuous mixes seeded by artists you already know.",
    shape: "square",
    kind: "mix",
    // `mix` is a caller-seeded kind, so the three-artist threshold is necessary
    // but not sufficient: the seed terms themselves must exist too.
    enabled: (signals) =>
      signals.hasLocalArtists && signals.localArtistCount >= MIN_LOCAL_ARTISTS_FOR_MIXES,
  },
  {
    id: "genres",
    title: "Genres",
    description: "Jump into a genre and browse it in your languages.",
    shape: "square",
    // Pure navigation to the Discover surface — no request of its own.
    kind: "local",
    enabled: always,
  },
  {
    id: "podcasts",
    title: "Podcasts",
    description: "Long-form listening in your languages.",
    shape: "square",
    kind: "podcast",
    enabled: always,
  },
  {
    id: "collections",
    title: "Collections",
    description: "Shelves built from search themes in your languages.",
    shape: "square",
    kind: "collection",
    enabled: always,
  },
];

/** The enabled subset of `sections`, in feed order. */
export function selectHomeSections(
  signals: HomeSectionSignals,
  sections: readonly HomeSection[] = HOME_SECTIONS,
): HomeSection[] {
  return sections.filter((section) => section.enabled(signals));
}

/** One reason a rendered section list breaks the geometry rhythm. */
export interface ShelfRhythmViolation {
  /** Index into the rendered section list the violation was found at. */
  readonly index: number;
  /** The section id at that index. */
  readonly id: HomeSectionId;
  /** What is wrong, in human-readable form. */
  readonly reason: string;
}

/**
 * Check the geometry rhythm of a *rendered* section list (spec: "Geometry
 * rhythm keeps circular contrast unclustered").
 *
 * Two rules, both stated by the amended spec:
 * 1. no two circular sections are adjacent, and
 * 2. the circular section appears within the first {@link CIRCULAR_WINDOW}
 *    rendered sections rather than trailing the feed.
 *
 * Returns one entry per violation (empty when the list is valid), so a caller
 * can report every problem rather than only the first.
 */
export function shelfRhythmViolations(
  sections: readonly HomeSection[],
  window: number = CIRCULAR_WINDOW,
): ShelfRhythmViolation[] {
  const violations: ShelfRhythmViolation[] = [];

  sections.forEach((section, index) => {
    if (section.shape !== "circular") return;
    const previous = sections[index - 1];
    if (previous !== undefined && previous.shape === "circular") {
      violations.push({
        index,
        id: section.id,
        reason: `circular section "${section.id}" is adjacent to circular section "${previous.id}"`,
      });
    }
    if (index >= window) {
      violations.push({
        index,
        id: section.id,
        reason: `circular section "${section.id}" renders at position ${index + 1}, past the first ${window} sections`,
      });
    }
  });

  return violations;
}

/**
 * Throwing form of {@link shelfRhythmViolations}: a developer assertion that
 * the authored feed order still satisfies the rhythm contract. It is called on
 * the rendered list, so a `Shelf` order that is right in isolation but wrong
 * once local-only sections drop out still fails loudly.
 */
export function assertShelfRhythm(
  sections: readonly HomeSection[],
  window: number = CIRCULAR_WINDOW,
): void {
  const violations = shelfRhythmViolations(sections, window);
  if (violations.length === 0) return;
  throw new Error(
    `Home shelf rhythm violated: ${violations.map((entry) => entry.reason).join("; ")}`,
  );
}
