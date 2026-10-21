import { describe, expect, it, vi } from "vitest";
import {
  CURATED_ARTISTS_BY_LANGUAGE,
  CURATED_ARTISTS_FLOOR,
  curatedArtistsForLanguages,
} from "@/features/home/curatedArtists";
import { deriveQuickPicks, MAX_QUICK_PICKS, quickPickHref } from "@/features/home/quickPicks";
import { isLanguageCode, LANGUAGES } from "@/lib/languages";
import type { Track } from "@/data/repositories";
import { makeTrack } from "./helpers/music-fixtures";
import { code, readSource } from "./helpers/motionSource";

/**
 * M35 — the curated popular artists (spec: `home-mixes` — "Quick Picks are artist
 * surfaces that exist"; design decisions D1–D5).
 *
 * The milestone's claim is narrow and checkable: **the rail is never empty, and
 * what fills it is shaped by the listener's languages.**
 *
 * Every assertion here is written against the delta's own wording, because the
 * delta is the contract and a test written in the implementer's words would
 * agree with the implementation by construction. The scenarios covered are:
 *
 * - "The rail is never empty"
 * - "A language with no list of its own is still offered artists"
 * - "The rail is never one card per selected language"
 * - "Curated popular artists are shaped by the selected languages"
 * - "Curated popular artists resolve to a real artist"
 * - "Local evidence is never displaced by curated popular artists"
 * - "Duplicate artists are offered once"
 * - "Completing the rail reads no new request"
 * - "Artist artwork renders when the provider supplied it" — and, for a
 *   curated artist, the artwork of a candidate track by that artist
 *
 * **The catalog is asserted in full, not sampled.** 28 of the 38 catalog
 * languages have no curated list of their own, and every one of them is
 * checked — a sample would leave 27 of them unverified and a reader would have
 * no way of knowing which.
 */

/** The empty device: no likes, no plays, and therefore no local material. */
const NO_TASTE = { likedTracks: [], events: [] } as const;

/** A track credited to `artist`, with a provider artist id when one is given. */
function track(id: string, artist: string, artistId?: string): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Song ${id}`,
    artists: [artistId === undefined ? { name: artist } : { id: artistId, name: artist }],
    artwork: [{ url: `https://example.test/${id}.jpg` }],
  });
}

/** The listener's own material: two likes and one play. */
function material() {
  return {
    likedTracks: [track("l1", "Aurora"), track("l2", "Beacon")],
    events: [
      {
        id: "event-e1",
        trackId: "youtube:e1",
        track: track("e1", "Cobalt"),
        playedAt: 1_000,
        secondsPlayed: 200,
        context: "home" as const,
      },
    ],
  };
}

/** The names the local material contributes, in the order it contributes them. */
const LOCAL_ARTISTS = ["Aurora", "Beacon", "Cobalt"];

describe("curated artists: the ported set is the one the mapping says", () => {
  it("holds 10 languages and 33 artists", () => {
    // The number is the mapping's, not an accident of the port: Lyrix's eleven
    // lists lose Punjabi (no `pa` in the catalog) and the other ten carry 33
    // names between them — Lyrix's 34 less `Anime OST`, which is a category
    // rather than an artist. A typo in either number is a failing test rather
    // than a silently different curation.
    const keys = Object.keys(CURATED_ARTISTS_BY_LANGUAGE);
    expect(keys).toHaveLength(10);

    const artists = keys.flatMap((key) => CURATED_ARTISTS_BY_LANGUAGE[key] ?? []);
    expect(artists).toHaveLength(33);
  });

  it("does not offer a category as an artist", () => {
    // Lyrix's Japanese list held `Anime OST`, which is a category rather than an
    // artist. It is not ported: *every Quick Pick SHALL be a resolvable artist*
    // and *a Quick Pick SHALL NOT be a search, a release, or any other kind of
    // entry*. A card labelled "Anime OST" with the label `Artist` mislabels a
    // category, and `/artist/Anime%20OST` is a provider search for a phrase.
    const artists = Object.keys(CURATED_ARTISTS_BY_LANGUAGE).flatMap(
      (key) => CURATED_ARTISTS_BY_LANGUAGE[key] ?? [],
    );
    expect(artists).not.toContain("Anime OST");
    expect(CURATED_ARTISTS_BY_LANGUAGE.ja).toEqual(["YOASOBI", "Kenshi Yonezu"]);
  });

  it("is keyed by codes the catalog actually contains", () => {
    // A language code that does not exist is a lookup that silently never
    // matches, so a typo here would be a language that quietly stops working.
    for (const key of Object.keys(CURATED_ARTISTS_BY_LANGUAGE)) {
      expect(isLanguageCode(key), `${key} must be a catalog language code`).toBe(true);
    }
  });

  it("does not port Punjabi, because the catalog has no `pa`", () => {
    // Lyrix's Punjabi list is not carried under an invented code: a code the
    // catalog does not have would never match anything.
    expect(isLanguageCode("pa")).toBe(false);
    expect(Object.keys(CURATED_ARTISTS_BY_LANGUAGE)).not.toContain("pa");
  });

  it("imports nothing at all, so it cannot reach a provider or a store", () => {
    // The module is pure data plus one pure function. Comments are stripped
    // first, so the prose about having no imports cannot satisfy the check.
    const source = code(readSource("features/home/curatedArtists.ts"));
    const imports = [...source.matchAll(/(?:^|\n)\s*import\s[^\n]*/g)].map((match) =>
      match[0].trim(),
    );
    expect(imports).toEqual([]);
  });
});

describe("curated artists: the rail is never empty", () => {
  it("offers curated popular artists for a device with no picks, no material and no results", () => {
    // The delta's own scenario: a rail with no artist in it is a dead end
    // rather than a first run.
    const picks = deriveQuickPicks({ languages: ["en"], taste: NO_TASTE });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.map((pick) => pick.title)).toEqual([
      "Taylor Swift",
      "The Weeknd",
      "Dua Lipa",
      "Ed Sheeran",
      "Drake",
      "Billie Eilish",
    ]);
  });

  it("is never empty for any of the 38 catalog languages", () => {
    // Every code, not a sample: the rail's emptiness is a dead end, and a
    // sample of 38 languages would leave the other 37 unverified.
    expect(LANGUAGES).toHaveLength(38);
    for (const language of LANGUAGES) {
      const picks = deriveQuickPicks({ languages: [language.code], taste: NO_TASTE });
      expect(picks.length, `${language.code} must not produce an empty rail`).toBeGreaterThan(0);
    }
  });

  it("is never one card per selected language, for any of the 38 catalog languages", () => {
    // The shape the delta forbids: a rail holding exactly one card per
    // selected language. One language selected, and the rail must not hold
    // one card.
    for (const language of LANGUAGES) {
      const picks = deriveQuickPicks({ languages: [language.code], taste: NO_TASTE });
      expect(picks.length, `${language.code} must not produce a one-card rail`).not.toBe(1);
    }
  });

  it("is never empty when the selected languages are the maximum selection", () => {
    const picks = deriveQuickPicks({
      languages: ["en", "ja", "ko", "es", "fr", "de", "pt", "it"],
      taste: NO_TASTE,
    });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.length).toBeLessThanOrEqual(MAX_QUICK_PICKS);
  });
});

describe("curated artists: a Marathi-only selection yields more than one card", () => {
  it("tops up Lyrix's single-artist Marathi list from the floor", () => {
    // Lyrix's Marathi list holds exactly one artist, so a Marathi-only
    // selection would be a one-card rail — the exact shape the delta forbids.
    expect(CURATED_ARTISTS_BY_LANGUAGE.mr).toEqual(["Ajay-Atul"]);

    const picks = deriveQuickPicks({ languages: ["mr"], taste: NO_TASTE });
    expect(picks.length).toBeGreaterThanOrEqual(2);
    expect(picks.map((pick) => pick.title)).toEqual(["Ajay-Atul", "Arijit Singh"]);
  });

  it("offers at least two curated artists for every single-language selection", () => {
    for (const language of LANGUAGES) {
      const curated = curatedArtistsForLanguages([language.code]);
      expect(curated.length, `${language.code} must offer at least two`).toBeGreaterThanOrEqual(2);
    }
  });

  it("still offers at least two Japanese artists, whose list lost a category", () => {
    // `Anime OST` was dropped from the Japanese list, so it now holds two
    // artists — and the one-card rule still holds for it.
    expect(CURATED_ARTISTS_BY_LANGUAGE.ja).toHaveLength(2);

    const picks = deriveQuickPicks({ languages: ["ja"], taste: NO_TASTE });
    expect(picks.length).toBeGreaterThanOrEqual(2);
    expect(picks.map((pick) => pick.title)).toEqual(["YOASOBI", "Kenshi Yonezu"]);
  });
});

describe("curated artists: a language with no list of its own is offered the floor", () => {
  it("offers the language-agnostic floor for a language the application has no list for", () => {
    // The delta's own scenario: the rail must not depend on the catalog's
    // coverage.
    const uncovered = LANGUAGES.filter(
      (language) => CURATED_ARTISTS_BY_LANGUAGE[language.code] === undefined,
    );
    expect(uncovered.length, "28 of the 38 catalog languages have no list").toBe(28);

    for (const language of uncovered) {
      expect(curatedArtistsForLanguages([language.code])).toEqual([...CURATED_ARTISTS_FLOOR]);
    }
  });

  it("offers the floor's artists on the rail for such a language", () => {
    // The floor is ten names — Lyrix's own default — and the rail holds eight,
    // so the rail carries the first eight of them.
    const picks = deriveQuickPicks({ languages: ["fr"], taste: NO_TASTE });
    expect(picks.map((pick) => pick.title)).toEqual(
      [...CURATED_ARTISTS_FLOOR].slice(0, MAX_QUICK_PICKS),
    );
  });

  it("offers a language's own list when it has one, rather than the floor", () => {
    const picks = deriveQuickPicks({ languages: ["ko"], taste: NO_TASTE });
    expect(picks.map((pick) => pick.title)).toEqual(["BTS", "BLACKPINK", "NewJeans", "Stray Kids"]);
  });
});

describe("curated artists: they are shaped by the selected languages", () => {
  it("offers different artists for different languages", () => {
    // The delta's own scenario: the curated artists offered change with the
    // selected languages, because their membership of the rail is determined by
    // the languages rather than by the provider's results.
    const english = curatedArtistsForLanguages(["en"]);
    const hindi = curatedArtistsForLanguages(["hi"]);
    expect(english).not.toEqual(hindi);
    expect(english).toEqual([...(CURATED_ARTISTS_BY_LANGUAGE.en ?? [])]);
    expect(hindi).toEqual([...(CURATED_ARTISTS_BY_LANGUAGE.hi ?? [])]);
  });

  it("changes the rail's contents when the selected languages change", () => {
    const english = deriveQuickPicks({ languages: ["en"], taste: NO_TASTE });
    const hindi = deriveQuickPicks({ languages: ["hi"], taste: NO_TASTE });
    expect(english.map((pick) => pick.title)).not.toEqual(hindi.map((pick) => pick.title));
  });

  it("offers the same artists for the same languages, every time", () => {
    // Determinism, which the delta requires of the whole shelf.
    const once = deriveQuickPicks({ languages: ["en", "ja"], taste: NO_TASTE });
    const twice = deriveQuickPicks({ languages: ["en", "ja"], taste: NO_TASTE });
    expect(once.map((pick) => pick.target)).toEqual(twice.map((pick) => pick.target));
  });

  it("does not offer the same artist twice when two languages' lists overlap", () => {
    // The floor overlaps the English list, so `en` plus an uncovered language
    // would offer `Taylor Swift` twice without a dedupe.
    const names = curatedArtistsForLanguages(["en", "fr"]);
    const normalized = names.map((name) => name.trim().toLowerCase());
    expect(new Set(normalized).size).toBe(names.length);
  });
});

describe("curated artists: a curated entry resolves to a real artist", () => {
  it("resolves to the artist route for its name", () => {
    // The delta's own scenario: the target resolves to the artist route for
    // that artist's name.
    const picks = deriveQuickPicks({ languages: ["en"], taste: NO_TASTE });
    expect(picks.length).toBeGreaterThan(0);
    for (const pick of picks) {
      expect(pick.kind).toBe("artist");
      expect(pick.subtitle).toBe("Artist");
      expect(quickPickHref(pick)).toBe(`/artist/${encodeURIComponent(pick.target)}`);
    }
  });

  it("carries no artwork when no candidate track is by that artist", () => {
    // The delta's other half: where there is no candidate track by the artist,
    // the card renders the application's existing artist placeholder.
    const picks = deriveQuickPicks({ languages: ["en"], taste: NO_TASTE });
    for (const pick of picks) {
      expect(pick.artworkUrl).toBeUndefined();
    }
  });

  it("names the artist in the target, so the route can resolve it", () => {
    const picks = deriveQuickPicks({ languages: ["ko"], taste: NO_TASTE });
    expect(picks[0]?.target).toBe("BTS");
    expect(quickPickHref(picks[0]!)).toBe("/artist/BTS");
  });
});

describe("curated artists: they carry the artwork of a candidate track by that artist", () => {
  it("carries the artwork of a candidate track by the same artist", () => {
    // The requirement's sentence: a curated popular artist whose name matches an
    // artist in the candidate tracks SHALL carry that artist's artwork, because
    // the artwork is already carried by the tracks the caller supplied.
    //
    // This is the cold-start rail, and it is where the rule earns its keep: the
    // curated entry is offered *before* the provider's own entry for the same
    // artist, so without this the card would be a placeholder where a real image
    // was already in hand.
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: NO_TASTE,
      providerTracks: [track("p1", "Drake")],
    });

    const drake = picks.filter((pick) => pick.title === "Drake");
    expect(drake).toHaveLength(1);
    expect(drake[0]?.artworkUrl).toBe("https://example.test/p1.jpg");
  });

  it("carries the artwork of a provider track even when the local material is present", () => {
    // The provider results' gate is about *entries* — a provider artist must not
    // compete with a liked one — and the artwork of a track the caller supplied
    // is not an entry. So a warm device's curated artists still carry a picture
    // the feed already had, even though the feed's own artist is not on the
    // rail.
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: { likedTracks: [track("l1", "Aurora")], events: [] },
      providerTracks: [track("p1", "Drake")],
    });

    const drake = picks.filter((pick) => pick.title === "Drake");
    expect(drake).toHaveLength(1);
    expect(drake[0]?.artworkUrl).toBe("https://example.test/p1.jpg");
    // Seven cards: the local artist and the six curated ones. The provider's own
    // artist did not reach the rail — the gate is unchanged — only its artwork
    // did.
    expect(picks).toHaveLength(7);
  });

  it("carries no artwork for a curated artist no candidate track is by", () => {
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: NO_TASTE,
      providerTracks: [track("p1", "Someone Else")],
    });

    const curated = picks.filter((pick) =>
      (CURATED_ARTISTS_BY_LANGUAGE.en ?? []).includes(pick.title),
    );
    expect(curated.length).toBeGreaterThan(0);
    for (const pick of curated) {
      expect(pick.artworkUrl).toBeUndefined();
      // And it keeps its name as its target: nothing supplied an identity for
      // it, so there is no more precise one to carry.
      expect(pick.target).toBe(pick.title);
      expect(pick.id).toBe(`artist:${pick.title.trim().toLowerCase()}`);
    }
  });

  it("carries the provider identity a candidate track supplied for it", () => {
    // The requirement says a Quick Pick navigates "using the provider artist
    // identity when the entry has one and the artist's name otherwise" — and
    // this artist *does* have one, on the candidate track. The curated entry is
    // the one that survives the name-dedupe, so it is the one that has to
    // carry it.
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: NO_TASTE,
      providerTracks: [track("p1", "Drake", "UCdrakechannel000000000")],
    });

    const drake = picks.filter((pick) => pick.title === "Drake");
    expect(drake).toHaveLength(1);
    expect(drake[0]?.target).toBe("UCdrakechannel000000000");
    // The entry id is the provider's own, so the two cannot collide and the
    // card's identity matches the artist it names.
    expect(drake[0]?.id).toBe("artist:UCdrakechannel000000000");
    expect(quickPickHref(drake[0]!)).toBe("/artist/UCdrakechannel000000000");
    // And the artwork comes with it.
    expect(drake[0]?.artworkUrl).toBe("https://example.test/p1.jpg");
  });

  it("offers that artist once, and the surviving card links by the provider id", () => {
    // The provider's own material names the artist twice, once **without** a
    // provider id and once **with** one — which is what a feed really looks
    // like, because `splitArtists` attaches an id only when the tier supplied
    // one, and the two are then two entries in `groupArtistsByIdentity` under
    // one name.
    //
    // The artist is offered once, and the card that survives links by the
    // provider id rather than by a bare name — even though the id-less track
    // came first, because an id beats no id and the identity a card carries
    // must not depend on the order the tracks arrived in.
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: NO_TASTE,
      providerTracks: [track("p1", "Drake"), track("p2", "Drake", "UCdrakechannel000000000")],
    });

    const drake = picks.filter((pick) => pick.title === "Drake");
    expect(drake).toHaveLength(1);
    expect(drake[0]?.target).toBe("UCdrakechannel000000000");
    expect(drake[0]?.id).toBe("artist:UCdrakechannel000000000");
  });

  it("does not match an approximate name — the safety property", () => {
    // A curated entry is a *name*, and a name that approximately matched a
    // different artist would put the wrong face on the card, and give it the
    // wrong identity. The match is on the exact normalized name, so "Anirudh"
    // does not pick up a track by "Anirudh Ravichander" — and takes neither
    // its artwork nor its id.
    const picks = deriveQuickPicks({
      languages: ["ta"],
      taste: NO_TASTE,
      providerTracks: [track("p1", "Anirudh Ravichander", "UCanirudhchannel00000000")],
    });

    const curated = picks.filter((pick) => pick.title === "Anirudh");
    expect(curated).toHaveLength(1);
    expect(curated[0]?.artworkUrl).toBeUndefined();
    expect(curated[0]?.target).toBe("Anirudh");
    expect(curated[0]?.id).toBe("artist:anirudh");
    // And the two are two cards, not one: they are different names.
    expect(picks.filter((pick) => pick.title === "Anirudh Ravichander")).toHaveLength(1);
  });

  it("does not match a language-decorated name against the bare one", () => {
    // "A.R. Rahman Tamil" is a curated name of its own, and it is not
    // "A.R. Rahman" — so it takes neither that artist's artwork nor that
    // artist's id.
    const picks = deriveQuickPicks({
      languages: ["ta"],
      taste: NO_TASTE,
      providerTracks: [track("p1", "A.R. Rahman", "UCrahmanchannel000000000")],
    });

    const tamil = picks.filter((pick) => pick.title === "A.R. Rahman Tamil");
    expect(tamil).toHaveLength(1);
    expect(tamil[0]?.artworkUrl).toBeUndefined();
    expect(tamil[0]?.target).toBe("A.R. Rahman Tamil");
    expect(tamil[0]?.id).toBe("artist:a.r. rahman tamil");
  });

  it("issues no request to resolve the artwork", () => {
    // The artwork is read from the tracks the caller already supplied, so
    // resolving it costs nothing and reaches nothing.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: NO_TASTE,
      providerTracks: [track("p1", "Drake")],
    });
    expect(picks.some((pick) => pick.artworkUrl !== undefined)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("issues no request to resolve the identity", () => {
    // The provider id comes from the tracks the caller already supplied, on the
    // same terms as the artwork.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: NO_TASTE,
      providerTracks: [track("p1", "Drake", "UCdrakechannel000000000")],
    });
    expect(picks.some((pick) => pick.target === "UCdrakechannel000000000")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("curated artists: local evidence is never displaced by them", () => {
  it("leads the rail with the listener's own material, in its own order", () => {
    // The delta's own scenario: no entry derived from local material is
    // displaced, outranked or reordered by the curated source, and the entries
    // derived from it are the entries the shelf leads with.
    const picks = deriveQuickPicks({ languages: ["en"], taste: material() });
    expect(picks.slice(0, 3).map((pick) => pick.title)).toEqual(LOCAL_ARTISTS);
    expect(
      picks.map((pick) => pick.title).filter((title) => LOCAL_ARTISTS.includes(title)),
    ).toEqual(LOCAL_ARTISTS);
  });

  it("leads the rail with the listener's own picks", () => {
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: material(),
      picks: [{ artistId: "UC_picked", name: "Aurora Vale", pickedAt: 1_000 }],
    });
    expect(picks[0]?.title).toBe("Aurora Vale");
    expect(picks[0]?.target).toBe("UC_picked");
  });

  it("keeps the local material's own order, and its artwork", () => {
    const picks = deriveQuickPicks({ languages: ["en"], taste: material() });
    const local = picks.filter((pick) => LOCAL_ARTISTS.includes(pick.title));
    expect(local.map((pick) => pick.title)).toEqual(LOCAL_ARTISTS);
    for (const pick of local) {
      expect(pick.artworkUrl).toMatch(/^https:\/\/example\.test\//);
    }
  });
});

describe("curated artists: the same artist is offered once", () => {
  it("offers a curated artist once when the local material names it by a provider id", () => {
    // The delta's own clause: "an artist offered once under a provider identity
    // and again under a name is offered once". The local material credits Drake
    // with a provider channel id and the curated list names him — two different
    // identities for one artist.
    //
    // The surviving card is the one that carries the provider identity, so the
    // identity dedupe catches this as well as the name dedupe: one card either
    // way.
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: { likedTracks: [track("l1", "Drake", "UCdrakechannel000000000")], events: [] },
    });
    expect(picks.filter((pick) => pick.title.toLowerCase() === "drake")).toHaveLength(1);
  });

  it("offers a curated artist once when the local material names it plainly", () => {
    // The same artist, credited without a provider id: one card, and the card is
    // the local one.
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: { likedTracks: [track("l1", "Drake")], events: [] },
    });
    expect(picks.filter((pick) => pick.title.toLowerCase() === "drake")).toHaveLength(1);
    expect(picks[0]?.title).toBe("Drake");
  });

  it("offers a curated artist once when the provider material names it differently", () => {
    // The curated list's target is a *name* while the provider material's is a
    // provider id, so without a dedupe the same artist would be offered twice
    // under two identities.
    const picks = deriveQuickPicks({
      languages: ["mr"],
      taste: NO_TASTE,
      providerTracks: [track("p1", "ajay-atul", "UCabc123456789012345")],
    });
    const matches = picks.filter((pick) => pick.title.toLowerCase() === "ajay-atul");
    expect(matches).toHaveLength(1);
  });

  it("offers an artist once when the candidate tracks credit it under two provider ids", () => {
    // The delta's other half: artist entries are deduplicated by canonical
    // identity **and by the artist's name**. Two channel ids under one name are
    // two identities but one artist, and the rail offers one card for them.
    //
    // This is the case only the **name** dedupe can catch: the two identities
    // differ, so the identity dedupe sees two different artists, and the name
    // dedupe is what collapses them.
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: NO_TASTE,
      providerTracks: [
        track("p1", "Drake", "UCdrakechannel000000000"),
        track("p2", "Drake", "UCdrakeotherchannel000000"),
      ],
    });

    expect(picks.filter((pick) => pick.title.toLowerCase() === "drake")).toHaveLength(1);
  });
});

describe("curated artists: completing the rail reads no new request", () => {
  it("issues no request while offering curated artists", () => {
    // The whole reason no Lyrix-style batch-thumbnail endpoint was built: a
    // curated entry is a name, not a track, so there is nothing to read an
    // image from and the derivation may not fetch one.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const picks = deriveQuickPicks({ languages: ["en"], taste: NO_TASTE });
    expect(picks.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("issues no request while offering a mix of curated and provider artists", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    deriveQuickPicks({
      languages: ["mr"],
      taste: NO_TASTE,
      providerTracks: [track("p1", "Someone")],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
