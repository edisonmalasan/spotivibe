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
