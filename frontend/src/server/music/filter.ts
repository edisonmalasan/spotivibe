import type { Track } from "@/data/repositories";

/**
 * Centralized filtering (spec: centralized filtering and quality scoring).
 *
 * One shared stage for every tier — identical rules regardless of which
 * provider produced a track. The keyword sets and duration bounds are
 * Lyrix-verified (reference: `innertubeService.ts` music-mode extraction,
 * `filterService.ts` scoring signals) and owned here as Spotivibe constants.
 */

/** Non-music content markers (music mode always applies in M3; podcasts are M12). */
const NON_MUSIC_TITLE_PATTERN = /vlog|react|unboxing|shorts|#shorts|interview/;

/** Unwanted variant markers: remix/mashup/slowed+reverb/8D/bass-boost/DJ mixes. */
const UNWANTED_VARIANT_TITLE_PATTERN =
  /remix|mashup|slowed\s*\+?\s*reverb|8d\s*audio|bass\s*boosted|nonstop|non[- ]?stop|dj\s*mix|megamix/;

/** Valid duration window for music (reference bounds: 60–14400s). */
export const MUSIC_DURATION_BOUNDS_S = { min: 60, max: 14400 } as const;

/** Valid duration window for podcasts (reference bounds: 120–14400s). */
export const PODCAST_DURATION_BOUNDS_S = { min: 120, max: 14400 } as const;

/**
 * Keep only tracks that survive the centralized rules:
 *
 * - non-empty title and at least one artist (reference requires a channel);
 * - no non-music markers and no unwanted-variant markers in the title;
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
    if (NON_MUSIC_TITLE_PATTERN.test(lowerTitle)) return false;
    if (UNWANTED_VARIANT_TITLE_PATTERN.test(lowerTitle)) return false;

    if (track.durationSeconds === undefined) return true;
    const duration = track.durationSeconds;
    if (!Number.isFinite(duration)) return false;

    const bounds =
      track.category === "podcast" ? PODCAST_DURATION_BOUNDS_S : MUSIC_DURATION_BOUNDS_S;
    return duration >= bounds.min && duration <= bounds.max;
  });
}
