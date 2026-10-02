/**
 * Home's `All` / `Music` / `Podcasts` filter (M17; spec: `discovery` — "Home
 * discovery feed", scenarios "The filter presents a subset of the one section
 * model" and "An unrecognised filter presents everything"; design decision 4).
 *
 * One model, three presentations. The filter is a **selection** over the single
 * `HOME_SECTIONS` list and over the M17 surfaces that declare themselves beside
 * it — it can only ever remove something, so it cannot introduce a shelf the one
 * model does not contain. That is the property worth having: three divergent
 * copies of the section list would drift, and the drift would be invisible until
 * a shelf appeared under the wrong filter.
 *
 * This module deliberately does **not** import `features/home/homeSections`. It
 * selects over anything structural — a `filters` declaration — which keeps the
 * dependency one-directional (`homeSections` names the vocabulary here, this
 * module never reaches back for the list) and lets the same selection serve the
 * mix, quick-pick, and time-aware surfaces without a second vocabulary.
 *
 * `all` is **implicit**: every surface belongs to it, so no declaration has to
 * repeat it and no section can forget it. That also collapses two cases onto one
 * line of code — the `all` value and any unrecognised value present everything,
 * because a filter that renders an empty Home because of a bad value is a worse
 * failure than one that ignores the value.
 */

/** The filter vocabulary, in presentation order. */
export const HOME_FILTERS = ["all", "music", "podcasts"] as const;

export type HomeFilter = (typeof HOME_FILTERS)[number];

/**
 * A filter value as it arrives from the surface.
 *
 * Deliberately the wide `string` rather than `HomeFilter`: the spec *requires* an
 * unrecognised value to be handled rather than rejected, and typing a parameter
 * as the closed union would push that handling into every caller as a cast and
 * out of reach of the tests that have to prove it.
 */
export type HomeFilterValue = string;

/** Whether `value` names one of the three filters. */
export function isHomeFilter(value: unknown): value is HomeFilter {
  return typeof value === "string" && (HOME_FILTERS as readonly string[]).includes(value);
}

/**
 * Display label per filter. Spelled out here so the control, its accessible
 * name, and its tests cannot disagree about what a filter is called.
 */
export const HOME_FILTER_LABELS: Record<HomeFilter, string> = {
  all: "All",
  music: "Music",
  podcasts: "Podcasts",
};

/**
 * Whether a `filters` declaration is presented under `filter`.
 *
 * `all` and every unrecognised value answer `true`, which is the "present
 * everything" fallback the spec asks for — an empty Home is never a valid
 * rendering of a filter value this surface did not recognise.
 */
export function presentsFilter(filters: readonly HomeFilter[], filter: HomeFilterValue): boolean {
  if (filter === "all") return true;
  if (!isHomeFilter(filter)) return true;
  return filters.includes(filter);
}

/**
 * The subset of `sections` presented under `filter`, in the order they were
 * given.
 *
 * Generic over the section type so this module stays free of a `homeSections`
 * import; the returned array holds the caller's own entries, never a copy of the
 * model, so a filter cannot manufacture an id the list does not contain.
 */
export function sectionsForFilter<T extends { filters: readonly HomeFilter[] }>(
  sections: readonly T[],
  filter: HomeFilterValue,
): T[] {
  return sections.filter((section) => presentsFilter(section.filters, filter));
}

/**
 * A Home surface that is not a `HOME_SECTIONS` entry but is still filtered —
 * the M17 mix-card row, the Quick Picks shelf, and the time-aware shelf.
 *
 * Declaring them here rather than in a second filter list is what keeps the
 * promise that one filter covers everything Home presents: the M17 surfaces go
 * through the same {@link presentsFilter} predicate the sections do.
 */
export interface HomeFilterSurface {
  /** Stable id, also the rendered region's `data-testid` suffix. */
  readonly id: string;
  /** The filters this surface belongs to. `all` is implicit for every surface. */
  readonly filters: readonly HomeFilter[];
}

/** The named mix-card row: music, because a mix is music. */
export const MIX_CARD_SURFACE: HomeFilterSurface = {
  id: "home-mix-cards",
  filters: ["music"],
};

/** Quick Picks: artists, albums, and searches over the listener's languages. */
export const QUICK_PICK_SURFACE: HomeFilterSurface = {
  id: "home-quick-picks",
  filters: ["music"],
};

/** The time-aware shelf: a music selection seeded by the current band. */
export const TIME_SHELF_SURFACE: HomeFilterSurface = {
  id: "home-time-shelf",
  filters: ["music"],
};

/** Whether one declared surface is presented under `filter`. */
export function presentsSurface(surface: HomeFilterSurface, filter: HomeFilterValue): boolean {
  return presentsFilter(surface.filters, filter);
}
