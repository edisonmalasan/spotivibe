/**
 * The motion vocabulary as a machine-readable contract (M19; spec `motion` —
 * "One motion vocabulary, declared once"; "Motion is scoped to named surfaces"; task
 * 1.1 and task 3.6).
 *
 * The vocabulary itself is CSS — {@link file://./motion.css} declares every duration,
 * easing, and travel distance once, as custom properties, so it costs no JavaScript
 * (design decision 2). This module is the **contract around** that stylesheet: which
 * steps exist, what each is for, which properties each may animate, which named
 * surface each is allowed to move, and — the part that keeps the milestone honest —
 * which modules are allowed to declare motion at all.
 *
 * It exists so that "one vocabulary" is *checkable* rather than aspirational. Every
 * rule in this file is asserted by `tests/motion-vocabulary.test.ts` and
 * `tests/motion-scope.test.ts`, and each assertion names the file that broke it.
 */

/** What the vocabulary is allowed to interpolate. Neither triggers layout. */
export const MOTION_PROPERTIES = ["opacity", "transform"] as const;

export type MotionProperty = (typeof MOTION_PROPERTIES)[number];

/**
 * The one property the vocabulary transitions that is **not** interpolable.
 *
 * `display` is discrete: there is nothing to interpolate between `flex` and `none`, so
 * transitioning it cannot animate a layout — it exists only so that
 * `transition-behavior: allow-discrete` keeps a leaving element painted while its
 * `display` flips, which is what makes an exit expressible in CSS at all (design
 * decision 3).
 *
 * It is listed separately, and asserted separately, rather than folded into
 * {@link MOTION_PROPERTIES}. The spec's claim is that *no transition in the
 * application triggers layout*, and a discrete property is not a partial exception to
 * that — it is a property with no interpolation at all. The test asserts that every
 * declaration naming it also says `allow-discrete`, so it can never become a real
 * animation of `display`.
 */
export const MOTION_DISCRETE_PROPERTIES = ["display"] as const;

/** What kind of value a declared step is. */
export type MotionStepKind = "duration" | "easing" | "travel" | "floor";

export interface MotionStep {
  /** Which vocabulary family the step belongs to. */
  readonly kind: MotionStepKind;
  /** What the step is *for*. Never how long it is — that is the value's job. */
  readonly purpose: string;
  /**
   * The properties a step may be written into a `transition` for.
   *
   * Only a duration is ever written into a `transition`, so an easing and a distance
   * name no property: they are values *inside* a duration's declaration. They are
   * given an empty list rather than being left off, so that one assertion — every
   * step's permitted set is a subset of {@link MOTION_PROPERTIES} — covers all seven.
   */
  readonly permitted: readonly MotionProperty[];
}

/**
 * The vocabulary. Nine steps, in four families.
 *
 * **Small on purpose.** A vocabulary is what makes a motion recognisable as belonging
 * to the system rather than to a component; a catalogue of one duration per component
 * is the same as no vocabulary at all. `tests/motion-vocabulary.test.ts` asserts the
 * count against {@link MAX_MOTION_STEPS}, so growing this set is a deliberate,
 * reviewable act rather than something that happens while someone is in a hurry.
 */
export const MOTION_STEPS: Readonly<Record<string, MotionStep>> = {
  "--motion-feedback": {
    kind: "duration",
    purpose: "a control, row, or card answering a pointer",
    permitted: ["transform", "opacity"],
  },
  "--motion-reveal": {
    kind: "duration",
    purpose: "a shelf, card, or surface arriving",
    permitted: ["transform", "opacity"],
  },
  "--motion-surface": {
    kind: "duration",
    purpose: "a dialog, sheet, or swapped content entering and leaving",
    permitted: ["transform", "opacity"],
  },
  "--motion-marquee": {
    kind: "duration",
    purpose: "Now Playing's long-title scroll, applied only when the title is measured to overflow",
    permitted: ["transform"],
  },
  "--motion-ease-in": {
    kind: "easing",
    purpose: "leaving: accelerating away from rest",
    permitted: [],
  },
  "--motion-ease-out": {
    kind: "easing",
    purpose: "arriving: decelerating into rest",
    permitted: [],
  },
  "--motion-travel-press": {
    kind: "travel",
    purpose: "how far a control, row, or card lifts under a pointer",
    permitted: [],
  },
  "--motion-travel-surface": {
    kind: "travel",
    purpose: "how far a dialog, sheet, or swapped content rises",
    permitted: [],
  },
  "--motion-floor": {
    kind: "floor",
    purpose: "what every duration above collapses to under prefers-reduced-motion",
    permitted: [],
  },
};

/**
 * How many steps the vocabulary may hold.
 *
 * A bound rather than an exact count: the point of the bound is that adding a step
 * has to be argued for. Nine today; the ceiling leaves room for the two families the
 * milestone deliberately left out — a spring duration and a gesture distance — without
 * letting the set become a per-component catalogue.
 */
export const MAX_MOTION_STEPS = 12;

/** Every step, in the order the stylesheet declares them. */
export const MOTION_STEP_ORDER: readonly string[] = Object.keys(MOTION_STEPS);

/**
 * The three named motions, as the class names that carry them.
 *
 * A component applies one of these rather than composing a `transition` itself, so a
 * duration can only reach the DOM through a class the vocabulary owns.
 */
export const MOTION_CLASS = {
  /** Hover and tap response. */
  feedback: "motion-feedback",
  /** An arrival. */
  reveal: "motion-reveal",
  /** An entry and an exit, via `@starting-style` and `allow-discrete`. */
  surface: "motion-surface",
} as const;

export type MotionClass = (typeof MOTION_CLASS)[keyof typeof MOTION_CLASS];

/** Every class the vocabulary owns, sorted. */
export const MOTION_CLASSES: readonly string[] = Object.values(MOTION_CLASS).sort();

/** The surfaces the milestone is allowed to animate. */
export type MotionSurface =
  /** A shelf or a card arriving. */
  | "entrance"
  /** A control, row, or card answering a pointer. */
  | "feedback"
  /** A dialog or a sheet entering and leaving. */
  | "surface"
  /** The player, and the expanded Now Playing surface. */
  | "player"
  /** Home's presented content changing. */
  | "content";

/**
 * What one module is allowed to declare, and why it is allowed to.
 *
 * `markers` is the **exact** set the module may carry — no more and no fewer. That is
 * what makes the list self-limiting in both directions, and it is why there is no
 * open-ended allowlist anywhere in this milestone:
 *
 * - a module not named here may declare no motion at all (spec `motion` — "Nothing
 *   else is animated"), so adding a clean module cannot quietly widen the scope;
 * - a module named here must carry exactly its markers, so deleting the motion a
 *   milestone added fails (task 4.2 — the inverted default), and adding a *different*
 *   motion to it fails too.
 */
export interface MotionAllowance {
  /** Which named surface this module is. */
  readonly surface: MotionSurface;
  /** Exactly the motion markers the module may declare. */
  readonly markers: readonly string[];
  /** Why this module is in scope. Recorded so an entry cannot be added silently. */
  readonly why: string;
  /**
   * A shared shell whose motion this module's markers are satisfied by.
   *
   * M20 lifted the context-menu shell out of `ResultMenu` into
   * `components/player/OverflowMenu`, so the search result menu no longer declares its rows'
   * hover and tap feedback itself — it renders rows the shell styles. Removing its entry would have
   * quietly dropped a named surface out of the scope rule, and declaring a motion class it does not
   * apply would be motion with no behaviour, which is the thing this whole list exists to prevent.
   *
   * So the marker may be satisfied by the shell, under two conditions the tests assert rather than
   * assume: the target must itself be on this allowance, and it must carry the marker itself. A
   * `delegatesTo` pointing at a module that does not animate the row would fail both.
   */
  readonly delegatesTo?: string;
}

/** A marker the milestone did **not** introduce and deliberately did not normalise. */
export const INHERITED_MOTION = {
  /** `Skeleton`'s loading placeholder. */
  placeholder: "animate-pulse",
  /** A control's busy spinner, and `MixList`'s regenerate spinner. */
  busy: "animate-spin",
  /** The lyrics panel's synced active-line highlight. */
  lyricActiveLine: "transition-colors",
} as const;

/**
 * Every module allowed to declare motion.
 *
 * Two families of entry, and the distinction matters:
 *
 * - **In scope.** The milestone's own five named surfaces. Motion here is drawn from
 *   the vocabulary and every class is one the stylesheet owns.
 * - **Inherited.** Four modules already carried a transition or an animation before
 *   M19, on a surface the milestone does not name, and the milestone left them alone
 *   rather than rewriting another capability's presentation. Each is named with the
 *   exact marker it carries and the reason it was left, so the exception is a
 *   recorded decision rather than a hole in a rule — see
 *   {@link INHERITED_MOTION} and the "inherited" note on each entry.
 */
export const MOTION_ALLOWED: ReadonlyMap<string, MotionAllowance> = new Map<
  string,
  MotionAllowance
>([
  // ---------------------------------------------------------------- entrances ---
  [
    "components/design-system/AlbumCard.tsx",
    {
      surface: "entrance",
      markers: [MOTION_CLASS.reveal, MOTION_CLASS.feedback],
      why: "A card is one of the two things the roadmap names as entering.",
    },
  ],
  [
    "components/design-system/ArtistCard.tsx",
    {
      surface: "entrance",
      markers: [MOTION_CLASS.reveal, MOTION_CLASS.feedback],
      why: "A card is one of the two things the roadmap names as entering.",
    },
  ],
  [
    "components/recommendations/Shelf.tsx",
    {
      surface: "entrance",
      markers: [MOTION_CLASS.reveal],
      why: "The shelf rail is the other half of 'shelf and card entrances'.",
    },
  ],
  [
    "features/home/ShelfTrackCard.tsx",
    {
      surface: "entrance",
      markers: [MOTION_CLASS.reveal, MOTION_CLASS.feedback],
      why: "The Home feed's own card primitive — the card half of 'shelf and card entrances', and the row a listener hovers.",
    },
  ],
  [
    "features/search/TopResultCard.tsx",
    {
      surface: "entrance",
      markers: [MOTION_CLASS.reveal, MOTION_CLASS.feedback],
      why: "The search result's card, and its play control.",
    },
  ],
  [
    "features/library/LibraryView.tsx",
    {
      surface: "entrance",
      markers: [MOTION_CLASS.reveal, MOTION_CLASS.feedback],
      why: "The Liked Songs card and each playlist card in the library grid: cards that arrive and answer a pointer.",
    },
  ],
  [
    "features/library/LikedSongsView.tsx",
    {
      surface: "entrance",
      markers: [MOTION_CLASS.reveal, MOTION_CLASS.feedback],
      why: "The Liked Songs card: it arrives like any other card and answers a pointer.",
    },
  ],
  [
    "features/queue/QueueRow.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "A row's answer to a pointer, and the fade of its action group.",
    },
  ],
  [
    "features/playlists/PlaylistTrackRow.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "A row's answer to a pointer, and the fade of its action group.",
    },
  ],
  [
    "components/track/SongRow.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "The shared track row's answer to a pointer. A row, not a card, so it does not get an entrance — a list of forty rows fading in one at a time is noise, not polish.",
    },
  ],
  [
    "features/search/PodcastCategoryList.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "A podcast category row's answer to a pointer — the same affordance every other row in the application gives.",
    },
  ],
  [
    "features/artist/ArtistView.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "A related-track card and the section's 'show all' link.",
    },
  ],
  [
    "features/album/AlbumView.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "The section's 'show all' link answers a pointer, like every other section header link in the application.",
    },
  ],
  [
    "features/discover/DiscoverView.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "The Discover page's 'see all' link answers a pointer, like every other section header link in the application.",
    },
  ],
  [
    "features/home/HomeView.tsx",
    {
      surface: "content",
      markers: [MOTION_CLASS.reveal, MOTION_CLASS.feedback],
      why: "The genre tile is a card; the filter is hover feedback; the presented sections are the content that changes, and the stack is keyed on the filter so the arrival animates.",
    },
  ],

  // ---------------------------------------------------------------- feedback ---
  [
    "components/design-system/Button.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback, INHERITED_MOTION.busy],
      why: "A control answering a pointer. `animate-spin` is M1's busy indicator, left as it is: see the note below.",
    },
  ],
  [
    "components/design-system/IconButton.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "The square icon control shared by the transport, the dialogs, and the rows: a control answering a pointer.",
    },
  ],
  [
    "components/design-system/SectionHeader.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "The 'show all' link is a control answering a pointer.",
    },
  ],
  [
    "components/layout/Sidebar.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "The sidebar's playlist row and its two navigation rows, each answering a pointer.",
    },
  ],
  [
    "components/layout/TopBar.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "The top bar's back control, which answers a pointer like any other control.",
    },
  ],
  [
    "components/layout/BottomNav.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "A compact-shell bottom-navigation item, which answers a pointer the same way the desktop navigation does.",
    },
  ],
  [
    "features/search/SearchView.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "A search filter chip answering a pointer, the same affordance Home's filter bar gives its own chips.",
    },
  ],
  [
    "features/search/ResultMenu.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "A per-result context-menu row answering a pointer; the menu itself does not animate, because it is not a named surface.",
      delegatesTo: "components/player/OverflowMenu.tsx",
    },
  ],
  [
    "features/search/PlaylistPicker.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "A playlist-picker option answering a pointer. The picker's own popup does not animate: animating its height is the layout-cost case the design rules out.",
    },
  ],
  [
    "features/search/RecentSearches.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "A recent-search chip answering a pointer, like every other chip in the application.",
    },
  ],

  // ------------------------------------------------------------ M20 shells ---
  [
    "components/player/OverflowMenu.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback],
      why: "M20: the overflow menu shell, lifted out of ResultMenu because the two player bars needed the same behaviour (ROADMAP §21.5). Its rows answer a pointer, which is the feedback the search result menu already had and no longer declares itself.",
    },
  ],
  [
    "features/download/DownloadControl.tsx",
    {
      surface: "feedback",
      markers: [MOTION_CLASS.feedback, INHERITED_MOTION.busy],
      why: "M20: the download affordance's icon button and its overflow row answer a pointer, and the busy state spins so the listener can tell a download is running. The spinner is the inherited busy indicator every other control in the application already uses, not a new kind of motion.",
    },
  ],

  // ----------------------------------------------------------------- surface ---
  [
    "components/design-system/Dialog.tsx",
    {
      surface: "surface",
      markers: [MOTION_CLASS.surface],
      why: "The dialog primitive, for the enter **and** the exit (task 3.3). The five hand-rolled dialogs are explicitly out of scope (design non-goals).",
    },
  ],

  // ------------------------------------------------------------------ player ---
  [
    "components/layout/PlayerBar.tsx",
    {
      surface: "player",
      markers: [MOTION_CLASS.reveal],
      why: "The artwork cluster is re-keyed per track, so a new track's artwork arrives with the vocabulary's entrance.",
    },
  ],
  [
    "components/layout/MiniPlayer.tsx",
    {
      surface: "player",
      markers: [MOTION_CLASS.reveal],
      why: "The compact player's artwork cluster, for the same reason.",
    },
  ],
  [
    "app/now-playing/page.tsx",
    {
      surface: "player",
      markers: [MOTION_CLASS.reveal, MOTION_CLASS.feedback],
      why: "Now Playing: the artwork arrives per track, and its controls answer a pointer.",
    },
  ],

  // ------------------------------------------------- inherited, out of scope ---
  [
    "components/design-system/Skeleton.tsx",
    {
      surface: "content",
      markers: [INHERITED_MOTION.placeholder],
      why: "M1's loading placeholder, inherited unchanged. It reports that a load is in flight rather than decorating anything, it is pinned by `tests/feedback.test.tsx`, and rewriting M1's placeholder is not this milestone's work. It is already reduced-motion-safe: the global floor collapses `animation-duration` and sets `animation-iteration-count: 1`.",
    },
  ],
  [
    "features/mixes/MixList.tsx",
    {
      surface: "content",
      markers: [MOTION_CLASS.feedback, INHERITED_MOTION.busy],
      why: "A row answering a pointer is in scope. `animate-spin` on the regenerate control is M6's busy indicator, inherited unchanged for the same reason as `Skeleton`.",
    },
  ],
  [
    "features/lyrics/LyricsPanel.tsx",
    {
      surface: "content",
      markers: [INHERITED_MOTION.lyricActiveLine],
      why: "M16's synced-lyrics active-line highlight, inherited unchanged. It is not one of this milestone's named surfaces, and it is a *colour* transition: expressing it on the vocabulary would mean re-presenting the lyrics panel as an opacity ramp, which is a change to M16's presentation that no M19 requirement asks for. Already reduced-motion-safe by the global floor.",
    },
  ],
]);

/**
 * The two state-bound loops this milestone did not introduce, named so the
 * "motion never loops" rule can distinguish them from decoration.
 *
 * Both report that something is in flight — they are the only way a listener learns
 * a load is happening — and both are unconditional only while that is true. The one
 * *decorative* indefinite animation in the application, the Now Playing marquee, is
 * conditional on the component having measured that the title overflows and is
 * cancelled outright under `prefers-reduced-motion`.
 */
export const MOTION_STATE_LOOPS: readonly string[] = [
  INHERITED_MOTION.placeholder,
  INHERITED_MOTION.busy,
];
