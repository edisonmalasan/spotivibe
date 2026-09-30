import type { Track } from "@/data/repositories";

/**
 * Centralized filtering (spec: centralized filtering and quality scoring; M12
 * decision 4 makes the rules category-aware).
 *
 * One shared stage for every tier — identical rules regardless of which
 * provider produced a track. The keyword sets and duration bounds are
 * Lyrix-verified (reference: `innertubeService.ts` music-mode extraction,
 * `filterService.ts` scoring signals) and owned here as Spotivibe constants.
 *
 * M12 splits the title rules in two, because one list cannot do both jobs the
 * roadmap asks for: music results must lose vlogs/reactions/Shorts, and podcast
 * results must *not* lose an episode whose title happens to contain "interview",
 * "react", or "remix". The music-only markers are therefore scoped to
 * `category: "music"`, while Shorts and promo fragments are rejected in every
 * category because they are not podcast content either.
 */

/**
 * Markers rejected for **every** category: Shorts.
 *
 * This is the one marker music already rejected and podcasts now reject too, so
 * the split adds nothing to music results — it only stops the word from being a
 * *music* rule that podcasts are exempt from (decision 4).
 */
const ANY_CATEGORY_TITLE_PATTERN = /shorts|#shorts/;

/**
 * Music-only non-song markers: reactions, vlogs, unboxings, interviews.
 *
 * **Byte-identical to the pre-M12 music rule** — substring matching, same words,
 * same order — because these words describe music results that are not songs.
 * In a spoken-word title they are ordinary English ("React Native in
 * Production", "Interview with a historian"), so applying this list to podcasts
 * would delete the content M12 exists to surface. Widening it (word boundaries,
 * extra words) would change music results too, which decision 4 explicitly
 * promises not to do, so it is left exactly as it was.
 */
const MUSIC_ONLY_NON_SONG_PATTERN = /vlog|react|unboxing|interview/;

/**
 * Podcast-only: promotional fragments. A 30-second "trailer"/"teaser"/"preview"
 * is a promo, not an episode, and accepting one would put it in the same list as
 * the 90-minute episodes beside it. Podcast-only on purpose: the pre-M12 music
 * rules never rejected these, and a music result titled "Preview" is not
 * something this change gets to decide.
 */
const PODCAST_ONLY_PROMO_PATTERN = /\btrailers?\b|\bteasers?\b|\bpreviews?\b/;

/** Music-only production variants: remix/mashup/slowed/reverb/8D/bass-boost/DJ mixes. */
const MUSIC_ONLY_VARIANT_PATTERN =
  /remix|mashup|slowed\s*\+?\s*reverb|8d\s*audio|bass\s*boosted|nonstop|non[- ]?stop|dj\s*mix|megamix/;

/** Valid duration window for music (reference bounds: 60–14400s). */
export const MUSIC_DURATION_BOUNDS_S = { min: 60, max: 14400 } as const;

/**
 * Valid duration window for podcasts: 10 minutes to 6 hours (M12 decision 5).
 *
 * The pre-M12 window was `{ min: 120, max: 14400 }` — a song window with a lower
 * floor, which admitted 2-minute clips and rejected the 4.5-hour episodes the
 * mode exists to serve. 600s is the honest line between an episode and a clip;
 * 6 hours keeps a compilation or a livestream archive from posing as an episode.
 * The floor is a real cost — short-form podcast content becomes unreachable — and
 * the empty state says so rather than padding results.
 */
export const PODCAST_DURATION_BOUNDS_S = { min: 600, max: 21600 } as const;

/** The duration window a category is filtered against. */
export function durationBoundsFor(track: Track): { min: number; max: number } {
  return track.category === "podcast" ? PODCAST_DURATION_BOUNDS_S : MUSIC_DURATION_BOUNDS_S;
}

/**
 * Keep only tracks that survive the centralized rules:
 *
 * - non-empty title and at least one artist (reference requires a channel);
 * - no Shorts markers in any category; no music-only non-song or variant markers
 *   in a music result; no promotional fragments in a podcast result;
 * - a *present* duration within its category's bounds (implausible or
 *   unparsable present durations — `0`, negative, `NaN` — are rejected);
 * - an *absent* duration survives with a quality-score penalty
 *   (design decision 9: the primary YTMusic tier often has no duration
 *   column, and unlike the reference we do not hard-code one).
 */
export function filterTracks(tracks: Track[]): Track[] {
  return tracks.filter((track) => {
    if (track.title.trim().length === 0) return false;
    if (track.artists.length === 0) return false;

    const lowerTitle = track.title.toLowerCase();
    if (ANY_CATEGORY_TITLE_PATTERN.test(lowerTitle)) return false;
    // Each category-scoped rule sits behind an *explicit* `category === "..."`
    // guard rather than an `else`, so the mapping between a rule and the category
    // it belongs to is readable here and checkable by the M12 architecture rule
    // (task 8.1) instead of being inferred from the branch order.
    if (track.category === "music") {
      if (MUSIC_ONLY_NON_SONG_PATTERN.test(lowerTitle)) return false;
      if (MUSIC_ONLY_VARIANT_PATTERN.test(lowerTitle)) return false;
    }
    if (track.category === "podcast" && PODCAST_ONLY_PROMO_PATTERN.test(lowerTitle)) {
      return false;
    }

    if (track.durationSeconds === undefined) return true;
    const duration = track.durationSeconds;
    if (!Number.isFinite(duration)) return false;

    const bounds = durationBoundsFor(track);
    return duration >= bounds.min && duration <= bounds.max;
  });
}
