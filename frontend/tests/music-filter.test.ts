import { describe, expect, it } from "vitest";
import {
  filterTracks,
  MUSIC_DURATION_BOUNDS_S,
  PODCAST_DURATION_BOUNDS_S,
} from "@/server/music/filter";
import { candidateToTrack } from "@/server/music/normalize";
import { makeCandidate, makeTrack } from "./helpers/music-fixtures";

describe("filterTracks", () => {
  it("keeps a clean music result", () => {
    expect(filterTracks([makeTrack()])).toHaveLength(1);
  });

  it.each([
    ["reaction", "Song (Reaction Video)"],
    ["vlog", "Daily Vlog 12"],
    ["interview", "Artist Interview 2024"],
    ["unboxing", "Unboxing the Vinyl"],
    ["shorts marker", "Groovy Track #shorts"],
    ["bare shorts", "Shorts Compilation"],
    ["remix", "Get Lucky (Remix)"],
    ["mashup", "Pop Mashup 2024"],
    ["slowed + reverb", "Blinding Lights Slowed + Reverb"],
    ["8d audio", "Starboy 8d Audio"],
    ["bass boosted", "Titanium Bass Boosted"],
    ["nonstop", "Nonstop Party Mix"],
    ["non-stop", "Non-Stop Hits"],
    ["dj mix", "Summer DJ Mix"],
    ["megamix", "Hits Megamix"],
  ])("rejects %s titles", (_label, title) => {
    expect(filterTracks([makeTrack({ title })])).toHaveLength(0);
  });

  it("does not reject ordinary titles that merely look similar", () => {
    expect(filterTracks([makeTrack({ title: "What a Great Song" })])).toHaveLength(1);
    expect(filterTracks([makeTrack({ title: "Heartbeat" })])).toHaveLength(1);
  });

  it("accepts the reference's known false positives (documented trade-off)", () => {
    // Lyrix's `/react/` set matches substrings; keyword refinement is an M5
    // tuning concern, not a contract change (design.md risks).
    expect(filterTracks([makeTrack({ title: "The Reactor" })])).toHaveLength(0);
  });

  it("applies the documented duration bounds only when a duration is present", () => {
    expect(MUSIC_DURATION_BOUNDS_S).toEqual({ min: 60, max: 14400 });
    // M12: the podcast window is sized for long-form (design decision 5). The
    // pre-M12 120–14400s window was a song window with a lower floor: it admitted
    // 2-minute clips and rejected the multi-hour episodes the mode exists for.
    expect(PODCAST_DURATION_BOUNDS_S).toEqual({ min: 600, max: 21600 });

    expect(filterTracks([makeTrack({ durationSeconds: 45 })])).toHaveLength(0); // under music min
    expect(filterTracks([makeTrack({ durationSeconds: 60 })])).toHaveLength(1); // at music min
    expect(filterTracks([makeTrack({ durationSeconds: 14400 })])).toHaveLength(1);
    expect(filterTracks([makeTrack({ durationSeconds: 14401 })])).toHaveLength(0);
    expect(filterTracks([makeTrack({ category: "podcast", durationSeconds: 599 })])).toHaveLength(
      0,
    );
    expect(filterTracks([makeTrack({ category: "podcast", durationSeconds: 600 })])).toHaveLength(
      1,
    );
  });

  it("keeps a podcast longer than a song's maximum and drops one over six hours", () => {
    // The requirement the long-form window exists for: an episode longer than any
    // song must survive, and a compilation must not.
    expect(filterTracks([makeTrack({ category: "podcast", durationSeconds: 18000 })])).toHaveLength(
      1,
    );
    expect(filterTracks([makeTrack({ category: "podcast", durationSeconds: 21601 })])).toHaveLength(
      0,
    );
    // The same duration is a music track's problem, not a podcast's.
    expect(filterTracks([makeTrack({ durationSeconds: 18000 })])).toHaveLength(0);
  });

  it("rejects present-but-invalid durations (0, negative, NaN)", () => {
    expect(filterTracks([makeTrack({ durationSeconds: 0 })])).toHaveLength(0);
    expect(filterTracks([makeTrack({ durationSeconds: -1 })])).toHaveLength(0);
    expect(filterTracks([makeTrack({ durationSeconds: Number.NaN })])).toHaveLength(0);
  });

  /**
   * Task 2.3 — the music-behavior regression table.
   *
   * M12 split the rules by category, which is exactly the kind of refactor that
   * silently widens or narrows a result set nobody re-checks. This table is the
   * guard: the `music` column is the pre-M12 verdict for each representative title
   * (reproduced by hand from the shipped single-pattern rules), and the
   * `podcast` column is what the split now decides. A future edit that changes a
   * `music` verdict breaks this test rather than the search results.
   *
   * Durations are chosen per row so the *title* rule is what is under test: songs
   * sit inside the music window, episodes inside the podcast one.
   */
  it.each([
    // [title, kept as music?, kept as podcast?, music seconds, podcast seconds]
    ["Get Lucky", true, true, 249, 2700],
    ["Heartbeat", true, true, 210, 1800],
    // Shorts are rejected in both categories.
    ["Groovy Track #shorts", false, false, 249, 1800],
    ["Shorts Compilation", false, false, 249, 1800],
    // The music-only non-song markers: ordinary English in a spoken-word title.
    ["Song (Reaction Video)", false, true, 249, 2700],
    ["Daily Vlog 12", false, true, 249, 2700],
    ["Artist Interview 2024", false, true, 249, 2700],
    ["Unboxing the Vinyl", false, true, 249, 2700],
    // The music-only variant markers.
    ["Get Lucky (Remix)", false, true, 249, 2700],
    ["Pop Mashup 2024", false, true, 249, 2700],
    ["Blinding Lights Slowed + Reverb", false, true, 249, 2700],
    ["Starboy 8d Audio", false, true, 249, 2700],
    ["Titanium Bass Boosted", false, true, 249, 2700],
    ["Nonstop Party Mix", false, true, 249, 2700],
    ["Non-Stop Hits", false, true, 249, 2700],
    ["Summer DJ Mix", false, true, 249, 2700],
    ["Hits Megamix", false, true, 249, 2700],
    // Titles music accepts and podcast mode must keep accepting, including the two
    // that carry a marker as a substring: "react" inside "The Reactor" and inside
    // "React Native in Production". Both are music verdicts reproduced from the
    // shipped rules - substring matching, not word matching.
    ["The Reactor", false, true, 249, 2700],
    ["React Native in Production", false, true, 249, 2700],
    ["Interlude in A minor", true, true, 249, 2700],
    ["What a Great Song", true, true, 249, 2700],
    // A podcast-only promo marker: rejected for a podcast, untouched for music.
    ["The Fall of Rome — Season trailer", true, false, 60, 60],
  ])(
    "%s → music %s / podcast %s",
    (title, musicKeeps, podcastKeeps, musicSeconds, podcastSeconds) => {
      expect(filterTracks([makeTrack({ title, durationSeconds: musicSeconds })])).toHaveLength(
        musicKeeps ? 1 : 0,
      );
      expect(
        filterTracks([makeTrack({ title, durationSeconds: podcastSeconds, category: "podcast" })]),
      ).toHaveLength(podcastKeeps ? 1 : 0);
    },
  );

  it("keeps tracks with an absent duration (design decision 9 — no hard-coded values)", () => {
    expect(filterTracks([makeTrack({ durationSeconds: undefined })])).toHaveLength(1);
  });

  it("rejects empty titles and artist-less tracks (reference requires a channel)", () => {
    expect(filterTracks([makeTrack({ title: "   " })])).toHaveLength(0);
    expect(filterTracks([makeTrack({ artists: [] })])).toHaveLength(0);
  });

  it("filters candidates from different tiers with identical rules", () => {
    const junk = "Live Interview Compilation";
    const fromPrimary = candidateToTrack(makeCandidate({ title: junk, tier: "ytmusic" }));
    const fromFallback = candidateToTrack(makeCandidate({ title: junk, tier: "piped" }));
    expect(filterTracks([fromPrimary, fromFallback])).toHaveLength(0);

    const clean = "Get Lucky";
    const primary = candidateToTrack(makeCandidate({ title: clean, tier: "ytmusic" }));
    const fallback = candidateToTrack(makeCandidate({ title: clean, tier: "piped" }));
    expect(filterTracks([primary, fallback])).toHaveLength(2);
  });
});
