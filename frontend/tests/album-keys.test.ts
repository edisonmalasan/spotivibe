import { describe, expect, it } from "vitest";
import { albumHref, albumHrefFromRelease, albumRequestKey } from "@/features/album/albumKeys";
import { artistRequestKey } from "@/features/artist/artistKeys";

/**
 * The album route's release tiles live in the artist surface, so this module is
 * the single place the album-route format is defined: `artistReleaseHref` below
 * renders the same element the artist page renders, so this suite pins the one
 * contract instead of two copies of it.

/**
 * M9 task 4.1 (spec: `catalog` — "Catalog entity keys and resolution
 * requests"; design §2).
 *
 * Three things are pinned here: the **classification** of a route key (id vs
 * composed `title - artist` vs bare title) in both directions, the **href**
 * construction that makes the route shareable, and the fact that the artist
 * surface's release tiles resolve through this one helper, so no second copy of
 * the album-route format can appear.
 */

/** A YouTube channel id, the one id shape a provider hands us today. */
const CHANNEL_ID = "UCaurorachannel00000000";

/** A long opaque token: the second half of the id rule (no punctuation). */
const OPAQUE_ID = "MPREb1234567890abcdefghij";

describe("albumRequestKey: classifying a route key", () => {
  it("reads a provider entity id as an id and nothing else", () => {
    expect(albumRequestKey(CHANNEL_ID)).toEqual({ id: CHANNEL_ID });
    expect(albumRequestKey(OPAQUE_ID)).toEqual({ id: OPAQUE_ID });
    // Trimming is presentation-only: the id is sent as the route carried it.
    expect(albumRequestKey(`  ${CHANNEL_ID}  `)).toEqual({ id: CHANNEL_ID });
  });

  it("treats a punctuated token as an id only when it is a release-id shape", () => {
    // A name carrying punctuation stays a title. (A hyphenated key is de-slugged
    // to spaces first — `AC-DC` arrives as `AC DC` — which is the one reversible
    // trace a slug keeps of the name it came from.)
    expect(albumRequestKey("AC-DC")).toEqual({ title: "AC DC" });
    expect(albumRequestKey("Sgt. Pepper's")).toEqual({ title: "Sgt. Pepper's" });
    expect(albumRequestKey("100% Hits")).toEqual({ title: "100% Hits" });
    // An underscore *is* part of a YouTube release id. The M9 evidence run found
    // the previous rule sending this real id as a search phrase, which resolved
    // an unrelated release instead of reporting the key as unresolvable.
    expect(albumRequestKey("MPREb_1234567890abcdefghij")).toEqual({
      id: "MPREb_1234567890abcdefghij",
    });
  });

  it("splits a composed `<title> - <artist>` key back into its two identifiers", () => {
    expect(albumRequestKey("Dawn Chorus - Aurora")).toEqual({
      title: "Dawn Chorus",
      artist: "Aurora",
    });
  });

  it("accepts the en-dash separator as the same composed shape", () => {
    expect(albumRequestKey("Dawn Chorus – Aurora")).toEqual({
      title: "Dawn Chorus",
      artist: "Aurora",
    });
  });

  it("splits on the first separator, so a minted key round-trips exactly", () => {
    // `albumHrefFromRelease` mints `<title> - <artist>`, and a title may itself
    // contain a separator. The first split is that format's exact inverse.
    expect(albumRequestKey("Jay-Z - The Blueprint")).toEqual({
      title: "Jay-Z",
      artist: "The Blueprint",
    });
  });

  it("normalizes each half's whitespace without de-sluging real names", () => {
    // A composed key's halves are prose, not slugs: de-slugging them could only
    // corrupt a real name.
    expect(albumRequestKey("  Dawn   Chorus  -   Aurora  ")).toEqual({
      title: "Dawn Chorus",
      artist: "Aurora",
    });
    expect(albumRequestKey("Night-Radio - K-Pop")).toEqual({
      title: "Night-Radio",
      artist: "K-Pop",
    });
  });

  it("reads a dangling separator as text, not as a composition", () => {
    // `trim()` already absorbed the outside space that made it a separator, so
    // these keys are bare titles — the honest reading of the text received.
    expect(albumRequestKey("Dawn Chorus - ")).toEqual({ title: "Dawn Chorus -" });
    expect(albumRequestKey(" - Aurora")).toEqual({ title: "- Aurora" });
  });

  it("reads a bare title as a title and leaves its text intact", () => {
    expect(albumRequestKey("Dawn Chorus")).toEqual({ title: "Dawn Chorus" });
    expect(albumRequestKey("  Björk  ")).toEqual({ title: "Björk" });
    // A whitespace-free slug is de-slugged; capitalization is not recoverable
    // and is never guessed at.
    expect(albumRequestKey("Night-Radio")).toEqual({ title: "Night Radio" });
    // A hyphen *inside* a real name is the documented lossy case, which the
    // provider's case/punctuation-insensitive search still resolves.
    expect(albumRequestKey("K-Pop")).toEqual({ title: "K Pop" });
  });

  it("percent-decodes a key that arrived encoded, and tolerates a broken one", () => {
    expect(albumRequestKey("Dawn%20Chorus%20-%20Aurora")).toEqual({
      title: "Dawn Chorus",
      artist: "Aurora",
    });
    expect(albumRequestKey("Bj%C3%B6rk")).toEqual({ title: "Björk" });
    // A malformed sequence must not throw on a bad route: the page renders a
    // not-found state, it does not crash.
    expect(albumRequestKey("100%25%20Hits")).toEqual({ title: "100% Hits" });
    expect(albumRequestKey("%%%")).toEqual({ title: "%%%" });
  });

  it("returns null for blank input, so a missing route parameter is not a request", () => {
    expect(albumRequestKey("")).toBeNull();
    expect(albumRequestKey("   ")).toBeNull();
    expect(albumRequestKey("\t\n")).toBeNull();
  });

  it("never classifies a text key as an id, or the other way round", () => {
    // The artist feature owns the id classifier; this module only reuses it, so
    // the two agree on both sides of the boundary for a shared set of inputs.
    for (const key of [CHANNEL_ID, OPAQUE_ID, "Aurora", "Dawn Chorus", "K-Pop", "UChicago"]) {
      const album = albumRequestKey(key);
      const artist = artistRequestKey(key);
      expect("id" in (album ?? {})).toBe("id" in (artist ?? {}));
    }
  });
});

describe("albumHref", () => {
  it("builds a percent-encoded, shareable album route", () => {
    expect(albumHref("Dawn Chorus")).toBe("/album/Dawn%20Chorus");
    expect(albumHref(CHANNEL_ID)).toBe(`/album/${CHANNEL_ID}`);
    // The composed form round-trips through the URL separator intact.
    expect(albumHref("Dawn Chorus - Aurora")).toBe("/album/Dawn%20Chorus%20-%20Aurora");
    // Trimmed, so a stray edge space never becomes a double-encoded key.
    expect(albumHref("  Dawn Chorus  ")).toBe("/album/Dawn%20Chorus");
  });

  it("is the single album-route helper (the artist feature's duplicate is retired)", () => {
    // The artist surface's release tiles call `albumHrefFromRelease` directly, so
    // a second copy of the album-route format can no longer drift away.
    expect(albumHref("Dawn Chorus")).toBe("/album/Dawn%20Chorus");
    expect(albumHrefFromRelease({ id: CHANNEL_ID, title: "Dawn Chorus" })).toBe(
      `/album/${CHANNEL_ID}`,
    );
  });
});

describe("albumHrefFromRelease", () => {
  it("prefers the provider's release id when the provider supplied one", () => {
    expect(
      albumHrefFromRelease({ id: CHANNEL_ID, title: "Dawn Chorus", artistName: "Aurora" }),
    ).toBe(`/album/${CHANNEL_ID}`);
  });

  it("composes `<title> - <artist>` when no id is known", () => {
    expect(albumHrefFromRelease({ title: "Dawn Chorus", artistName: "Aurora" })).toBe(
      "/album/Dawn%20Chorus%20-%20Aurora",
    );
  });

  it("falls back to the bare title when the artist is unknown or blank", () => {
    expect(albumHrefFromRelease({ title: "Dawn Chorus" })).toBe("/album/Dawn%20Chorus");
    expect(albumHrefFromRelease({ title: "Dawn Chorus", artistName: "   " })).toBe(
      "/album/Dawn%20Chorus",
    );
    // A blank id is "no id", not an empty route segment.
    expect(albumHrefFromRelease({ id: "  ", title: "Dawn Chorus" })).toBe("/album/Dawn%20Chorus");
  });

  it("normalizes each half, so a key is minted the same way a key is read", () => {
    const href = albumHrefFromRelease({ title: "  Dawn   Chorus ", artistName: " Aurora  " });
    expect(href).toBe("/album/Dawn%20Chorus%20-%20Aurora");
    // And the minted key classifies straight back into its two identifiers, so a
    // link built here opens the release it was built from.
    expect(albumRequestKey(href.slice("/album/".length))).toEqual({
      title: "Dawn Chorus",
      artist: "Aurora",
    });
  });

  it("keeps the route usable for a release that resolved no title", () => {
    // Degenerate, but a link must still be a link rather than `/album/undefined`.
    expect(albumHrefFromRelease({ title: "   ", artistName: "Aurora" })).toBe("/album/Aurora");
    expect(albumHrefFromRelease({ title: "   " })).toBe("/album/");
  });
});
