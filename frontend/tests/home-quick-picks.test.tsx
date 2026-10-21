import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListeningEventRecord, QuickPickPickRecord, Track } from "@/data/repositories";
import {
  deriveQuickPicks,
  isQuickPickKind,
  MAX_QUICK_PICKS,
  quickPickHref,
  QUICK_PICK_KINDS,
  type QuickPick,
} from "@/features/home/quickPicks";
import { QUICK_PICKS_DESCRIPTION, QuickPicksShelf } from "@/features/home/QuickPicksShelf";
import { LANGUAGES } from "@/lib/languages";
import * as localData from "@/data/localData";
import { makeTrack } from "./helpers/music-fixtures";
import { resetHistoryStore, useHistoryStore } from "@/stores/historyStore";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { resetPreferencesStore, usePreferencesStore } from "@/stores/preferencesStore";
import { resetQuickPickPicksStore, useQuickPickPicksStore } from "@/stores/quickPickPicksStore";

/**
 * M23 (spec: `home-mixes` — "Quick Picks are artist surfaces that exist" and "Mix
 * cards present honest preview artwork"; `discovery` — "Home discovery feed").
 *
 * The central claim is that the rail is **artist-only** and that selected languages
 * shape which artists lead rather than becoming cards. That is checked from four
 * directions, because each catches a different way the defect can come back:
 *
 * 1. **Card kind.** Every entry is an artist; no entry is a search or a release, and
 *    no entry is named after a selected language — including at the maximum
 *    selection, which is where M22 produced eight search cards and zero artists.
 * 2. **Candidates.** Changing only the selected languages reorders the artists, which
 *    can only happen if the language metadata on the candidate tracks is being read.
 * 3. **Navigation.** Every entry resolves to the artist route, by provider identity
 *    when there is one and by name otherwise.
 * 4. **Presentation.** Circular geometry, the `Artist` label, real artwork when the
 *    provider supplied it, and the existing placeholder when it did not.
 */

// Quick Pick cards navigate through next/link.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(""),
}));

function track(id: string, artist: string, extra: Partial<Track> = {}): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Song ${id}`,
    artists: [{ name: artist }],
    artwork: [{ url: `https://example.test/${id}.jpg` }],
    ...extra,
  });
}

/** A track with no artwork at all, for the placeholder clauses. */
function bareTrack(id: string, artist: string): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Song ${id}`,
    artists: [{ name: artist }],
    artwork: [],
  });
}

/** A track whose artist carries a provider entity id. */
function providerArtistTrack(id: string, artistId: string, name: string): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Song ${id}`,
    artists: [{ id: artistId, name }],
    artwork: [{ url: `https://example.test/${id}.jpg` }],
  });
}

/**
 * An artist the local data *counts* but cannot *name*: a provider artist whose id is
 * not the entity-id shape and whose display name is blank. The entry is real — the
 * track credits it — but the text key an artist route would be given is blank, so no
 * route resolves it. This is the case the resolvability gate exists for.
 */
function unnamedArtistTrack(id: string): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Song ${id}`,
    artists: [{ id: "Some Id", name: "   " }],
  });
}

function event(id: string, artist: string, extra: Partial<Track> = {}): ListeningEventRecord {
  return {
    id: `event-${id}`,
    trackId: `youtube:${id}`,
    track: track(id, artist, extra),
    playedAt: 1_000,
    secondsPlayed: 200,
    context: "home",
  };
}

/** The local inputs a derivation may read. */
function material() {
  return {
    likedTracks: [track("l1", "Aurora"), track("l2", "Beacon")],
    events: [event("e1", "Cobalt")],
  };
}

/** The empty device: no likes, no plays. */
const NO_TASTE = { likedTracks: [], events: [] } as const;

function derive(languages: readonly string[] = ["en"], taste = material()): QuickPick[] {
  return deriveQuickPicks({ languages, taste });
}

/** Eight distinct catalog codes — the maximum selection. */
const EIGHT_LANGUAGES = ["en", "ja", "ko", "es", "fr", "de", "pt", "it"];

/**
 * Seed the stores the rail reads.
 *
 * The rail no longer takes the local material as props: it reads the stores
 * through the shared `useQuickPickArtists` hook, so the rail, the first-run
 * surface, and the Settings re-entry are guaranteed to be looking at the same
 * artists. Seeding the stores is therefore how a test sets up the rail.
 *
 * `hydrated: true` matters as much as the contents: the rail is not settled
 * until the stores have hydrated, and an unsettled rail renders a loading
 * state rather than its cards.
 */
function seedRailStores({
  likedTracks = [] as Track[],
  events = [] as ListeningEventRecord[],
  languages = ["en"] as string[],
  picks = [] as QuickPickPickRecord[],
}: {
  likedTracks?: Track[];
  events?: ListeningEventRecord[];
  languages?: string[];
  picks?: QuickPickPickRecord[];
} = {}): void {
  useLibraryStore.setState({
    likedTracks,
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
  useHistoryStore.setState({
    events,
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
  usePreferencesStore.setState({
    languages,
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
  useQuickPickPicksStore.setState({
    picks,
    hydrated: true,
    load: () => Promise.resolve(),
  });
}

beforeEach(() => {
  resetHistoryStore();
  resetLibraryStore();
  resetPreferencesStore();
  resetQuickPickPicksStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quickPicks: the rail is artist-only", () => {
  it("recognises exactly one kind, and it is the artist kind", () => {
    // The type-level statement of the whole milestone. M22 permitted three kinds;
    // narrowing the tuple is what stops a search or release card from being
    // constructed at all, rather than merely not being emitted today.
    expect([...QUICK_PICK_KINDS]).toEqual(["artist"]);
    expect(isQuickPickKind("artist")).toBe(true);
    expect(isQuickPickKind("search")).toBe(false);
    expect(isQuickPickKind("album")).toBe(false);
  });

  it("emits only artist entries from the local material alone", () => {
    for (const pick of derive()) {
      expect(pick.kind).toBe("artist");
      expect(pick.subtitle).toBe("Artist");
    }
  });

  it("emits no release entry for a track that names an album", () => {
    // M22 derived album entries here. An album tile in an artist rail is the filler
    // the milestone forbids, so the album metadata is present and unused on purpose.
    //
    // M35 added the curated source, so the rail is no longer exactly one entry long.
    // The claim is the one the milestone was about — no entry stands for the
    // release — and it is now stated as the absence of the release rather than as
    // the length of the rail.
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: {
        likedTracks: [track("l1", "Aurora", { album: { title: "First Light" } })],
        events: [],
      },
    });
    expect(picks.map((p) => p.title)).not.toContain("First Light");
    expect(picks[0]?.title).toBe("Aurora");
    expect(picks.every((p) => p.kind === "artist")).toBe(true);
  });

  it("never emits an entry named after a selected language", () => {
    const picks = derive(["ja", "ko"]);
    for (const pick of picks) {
      expect(pick.title).not.toBe("Japanese");
      expect(pick.title).not.toBe("Korean");
    }
  });

  it("offers no entry of any other kind, at any language count", () => {
    for (const languages of [["en"], ["ja", "ko"], EIGHT_LANGUAGES]) {
      const picks = deriveQuickPicks({ languages, taste: NO_TASTE, providerTracks: undefined });
      // Widened to `string` on purpose. The compiler already guarantees every entry is
      // an artist, so a `kind === "search"` comparison would be rejected as
      // impossible — which is the type-level guarantee doing its job. This test
      // still earns its place at runtime: it holds against a derivation whose kind
      // widened back, which is exactly the regression that would reintroduce M22's
      // search and release cards.
      const kinds = picks.map((p) => p.kind as string);
      expect(kinds.filter((k) => k !== "artist")).toEqual([]);
    }
  });
});

describe("quickPicks: a full set of selected languages still permits artists (M23 regression)", () => {
  it("offers artists, not eight search cards, at the maximum selection", () => {
    // The exact defect M22 recorded as deliberate: `MAX_SELECTED_LANGUAGES` equals
    // `MAX_QUICK_PICKS`, and M22's reservation made the maximum selection render one
    // `Search` card per language with zero artists. This is the regression clause.
    //
    // M35 changed *which* artists the eight cards are — the curated artists of the
    // selected languages now lead the rail, and the provider's results follow them
    // — but the clause is unchanged: eight **artist** cards, not eight searches.
    const providerTracks = Array.from({ length: 8 }, (_, i) => track(`p${i}`, `Artist ${i}`));
    const picks = deriveQuickPicks({
      languages: EIGHT_LANGUAGES,
      taste: NO_TASTE,
      providerTracks,
    });

    expect(picks).toHaveLength(8);
    expect(picks.every((pick) => pick.kind === "artist")).toBe(true);
    expect(picks.map((pick) => pick.title)).toEqual([
      "Taylor Swift",
      "The Weeknd",
      "Dua Lipa",
      "Ed Sheeran",
      "Drake",
      "Billie Eilish",
      "YOASOBI",
      "Kenshi Yonezu",
    ]);
    // The strongest form of the clause: not one card stands for a language.
    for (const code of EIGHT_LANGUAGES) {
      expect(picks.some((pick) => pick.target.toLowerCase() === code.toLowerCase())).toBe(false);
    }
    for (const language of LANGUAGES) {
      expect(picks.some((pick) => pick.title === language.name)).toBe(false);
    }
  });

  it("offers artist cards — and no search card — at one language as at eight", () => {
    // M23's version of this test asserted that the *same* artists were offered at
    // one language as at eight, because before M35 the selected languages only
    // reordered the provider's candidates. M35's delta requires the opposite —
    // "the curated popular artists offered change with the selected languages" —
    // so that assertion was retired by the approved requirement rather than
    // weakened here.
    //
    // What survives — and is still M23's clause — is that the *kind* of card does
    // not change with the number of languages: artist cards at one, artist cards
    // at eight, and a search card at neither.
    const providerTracks = Array.from({ length: 8 }, (_, i) => track(`p${i}`, `Artist ${i}`));
    const one = deriveQuickPicks({ languages: ["en"], taste: NO_TASTE, providerTracks });
    const eight = deriveQuickPicks({
      languages: EIGHT_LANGUAGES,
      taste: NO_TASTE,
      providerTracks,
    });
    for (const picks of [one, eight]) {
      expect(picks.length).toBeGreaterThan(0);
      expect(picks.every((pick) => pick.kind === "artist")).toBe(true);
    }
    // And the curated artists themselves do change with the selection.
    expect(one.map((pick) => pick.title)).not.toEqual(eight.map((pick) => pick.title));
  });

  it("uses the whole bound for artists when the device has no local material", () => {
    // M22 held one slot back per language, which is why the fresh profile rendered
    // seven artists plus a card named after the default language.
    const providerTracks = Array.from({ length: 12 }, (_, i) => track(`p${i}`, `Artist ${i}`));
    const picks = deriveQuickPicks({ languages: ["en"], taste: NO_TASTE, providerTracks });
    expect(picks).toHaveLength(MAX_QUICK_PICKS);
  });
});

describe("quickPicks: selected languages shape candidates, not card type", () => {
  const jaTrack = track("ja1", "Aimer", { language: "ja" });
  const koTrack = track("ko1", "IU", { language: "ko" });
  const enTrack = track("en1", "Aurora", { language: "en" });
  const providerTracks = [enTrack, jaTrack, koTrack];

  it("prefers artists whose tracks carry a selected language", () => {
    // Only the language selection differs between these two derivations; the tracks
    // are identical. That is what makes this a test of the language link rather than
    // of the input data.
    //
    // M35: the curated artists of the selected language lead the rail, and the
    // provider's candidates follow them. The language preference decides the
    // order of those candidates, which is what this asserts.
    const japanese = deriveQuickPicks({ languages: ["ja"], taste: NO_TASTE, providerTracks });
    expect(japanese.map((pick) => pick.title)).toEqual([
      "YOASOBI",
      "Kenshi Yonezu",
      "Aimer",
      "Aurora",
      "IU",
    ]);
  });

  it("reorders rather than filters, so a selection can never empty the rail", () => {
    // Selecting a language nobody's tracks carry must not remove those artists: a
    // filter here would produce the empty rail that ROADMAP §21.7 already withdrew.
    //
    // `es` is a catalog code that none of these three tracks carry. `sw` was used
    // before M35 and is not a catalog code at all, so it normalized away to the
    // default language and the test was not reading the clause it claimed to.
    const unmatched = deriveQuickPicks({ languages: ["es"], taste: NO_TASTE, providerTracks });
    expect(unmatched.map((pick) => pick.title)).toEqual([
      "Bad Bunny",
      "Shakira",
      "Rauw Alejandro",
      "Aurora",
      "Aimer",
      "IU",
    ]);
    // And a code the catalog does not hold is dropped rather than emptying the rail.
    const unknown = deriveQuickPicks({ languages: ["sw"], taste: NO_TASTE, providerTracks });
    expect(unknown.length).toBeGreaterThan(0);
  });

  it("keeps first-appearance order within each half of the partition", () => {
    // The preferred artist leads the provider's candidates and the rest keep the
    // order they first appeared in.
    //
    // M35 changed what is visible here, not what the rule is: the curated artists
    // of the selected language lead the rail and the provider's candidates follow.
    // `ko` is the selection used because the curated source of `ko` and `ja`
    // together is seven names, and seven of the rail's eight cards would leave the
    // partition unobservable.
    const picks = deriveQuickPicks({ languages: ["ko"], taste: NO_TASTE, providerTracks });
    expect(picks.map((pick) => pick.title)).toEqual([
      "BTS",
      "BLACKPINK",
      "NewJeans",
      "Stray Kids",
      "IU",
      "Aurora",
      "Aimer",
    ]);
    // The provider's candidates, read from the rail itself: the one whose tracks
    // carry the selected language leads them, and the rest follow in the order
    // they first appeared.
    expect(picks.filter((pick) => pick.artworkUrl !== undefined).map((pick) => pick.title)).toEqual(
      ["IU", "Aurora", "Aimer"],
    );
  });

  it("is deterministic across repeated derivations", () => {
    const once = deriveQuickPicks({ languages: ["ja"], taste: NO_TASTE, providerTracks });
    const twice = deriveQuickPicks({ languages: ["ja"], taste: NO_TASTE, providerTracks });
    expect(once.map((p) => p.target)).toEqual(twice.map((p) => p.target));
  });

  it("still derives from a device whose results carry no language metadata", () => {
    // The documented degradation: no stamp means no preference, not an empty rail.
    const unstamped = [track("u1", "Aurora"), track("u2", "Beacon")];
    const picks = deriveQuickPicks({
      languages: ["ja"],
      taste: NO_TASTE,
      providerTracks: unstamped,
    });
    expect(picks.map((pick) => pick.title)).toEqual([
      "YOASOBI",
      "Kenshi Yonezu",
      "Aurora",
      "Beacon",
    ]);
  });
});

describe("quickPicks: first-run picks lead the rail", () => {
  /** A stored pick, in the shape the repository hands back. */
  const storedPick = (artistId: string, name: string, pickedAt = 1_000): QuickPickPickRecord => ({
    artistId,
    name,
    pickedAt,
  });

  it("offers a picked artist on a device with no other material", () => {
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: NO_TASTE,
      picks: [storedPick("UC_picked", "Aurora Vale")],
    });

    // The pick leads the rail, and the curated artists of the selected language
    // complete it behind — M35 made the rail longer, not the pick optional.
    expect(picks[0]?.title).toBe("Aurora Vale");
    expect(picks[0]?.kind).toBe("artist");
    expect(picks[0]?.target).toBe("UC_picked");
    expect(picks.filter((entry) => entry.title === "Aurora Vale")).toHaveLength(1);
    expect(picks.length).toBeGreaterThan(1);
  });

  it("ranks a pick above a liked artist", () => {
    const picks = deriveQuickPicks({
      languages: ["en"],
      // `material()` likes Aurora; the pick is somebody else entirely.
      taste: material(),
      picks: [storedPick("UC_picked", "Aurora Vale")],
    });

    expect(picks[0]?.title).toBe("Aurora Vale");
    // And the liked material still follows — picks lead, they do not replace.
    expect(picks.map((entry) => entry.title)).toContain("Aurora");
  });

  it("keeps the picks when the listener likes something afterwards", () => {
    /*
     * The case that decides whether picks are a source or a cold-start
     * stand-in. A device with any local material skips provider results entirely;
     * if picks were gated the same way, liking one track would silently drop the
     * listener's own stated choices.
     */
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: { likedTracks: [track("l1", "Aurora")], events: [] },
      picks: [storedPick("UC_picked", "Aurora Vale")],
    });

    expect(picks.map((entry) => entry.title)).toEqual(
      expect.arrayContaining(["Aurora Vale", "Aurora"]),
    );
    expect(picks[0]?.title).toBe("Aurora Vale");
  });

  it("offers one entry for an artist who is both picked and liked", () => {
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: material(), // likes Aurora
      picks: [storedPick("Aurora", "Aurora")],
    });

    expect(picks.filter((entry) => entry.title === "Aurora")).toHaveLength(1);
  });

  it("keeps every pick an artist with a resolvable target", () => {
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: NO_TASTE,
      picks: [storedPick("UC_a", "Alpha"), storedPick("UC_b", "Beta")],
    });

    // Both picks are on the rail, exactly once each, ahead of the curated
    // artists that complete it behind them.
    expect(picks.filter((entry) => entry.title === "Alpha")).toHaveLength(1);
    expect(picks.filter((entry) => entry.title === "Beta")).toHaveLength(1);
    expect(picks.slice(0, 2).map((entry) => entry.title)).toEqual(["Alpha", "Beta"]);
    for (const entry of picks) {
      expect(entry.kind).toBe("artist");
      expect(quickPickHref(entry)).not.toBeNull();
    }
  });

  it("behaves exactly as before when no picks are supplied", () => {
    // A caller that has not loaded picks gets the pre-change rail, not an error
    // and not an empty one.
    expect(deriveQuickPicks({ languages: ["en"], taste: material() })).toEqual(
      deriveQuickPicks({ languages: ["en"], taste: material(), picks: [] }),
    );
  });

  it("does not let picks exceed the rail bound", () => {
    const many = Array.from({ length: 12 }, (_, i) => storedPick(`UC_${i}`, `Artist ${i}`));
    const picks = deriveQuickPicks({ languages: ["en"], taste: NO_TASTE, picks: many });

    expect(picks).toHaveLength(MAX_QUICK_PICKS);
  });
});

describe("quickPicks: every entry is a resolvable artist target", () => {
  it("emits only recognised kinds with a non-empty target that resolves", () => {
    for (const pick of derive()) {
      expect(isQuickPickKind(pick.kind)).toBe(true);
      expect(pick.target.trim()).not.toBe("");
      expect(quickPickHref(pick)).not.toBeNull();
    }
  });

  it("resolves an artist to the artist route, by name for a text key", () => {
    const picks = derive();
    expect(picks.map((pick) => quickPickHref(pick))).toEqual(
      picks.map((pick) => `/artist/${encodeURIComponent(pick.target)}`),
    );
  });

  it("uses the provider identity when the candidate carried one", () => {
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: { likedTracks: [providerArtistTrack("v1", "UCabc123", "Aurora")], events: [] },
    });
    expect(picks[0]?.target).toBe("UCabc123");
    expect(quickPickHref(picks[0]!)).toBe("/artist/UCabc123");
  });

  it("drops an artist whose text key is blank, so no card goes nowhere", () => {
    // The rail is no longer empty — the curated source fills it — but the unnamed
    // artist must not be *on* it: an entry with a blank text key would be a card
    // that goes nowhere.
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: { likedTracks: [unnamedArtistTrack("v1")], events: [] },
    });
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.filter((entry) => entry.title.trim() === "")).toHaveLength(0);
    for (const entry of picks) {
      expect(entry.target.trim()).not.toBe("");
      expect(quickPickHref(entry)).not.toBeNull();
    }
  });

  it("reports an unresolvable entry as unresolvable rather than as a broken link", () => {
    expect(
      quickPickHref({ id: "x", kind: "artist", target: "   ", title: "x", subtitle: "Artist" }),
    ).toBeNull();
  });

  it("deduplicates an artist reached by two different names", () => {
    // Canonical identity, not spelling: the same artist credited two ways is one card.
    const byName = deriveQuickPicks({
      languages: ["en"],
      taste: { likedTracks: [track("v1", "Aurora")], events: [] },
    });
    const bySpelling = deriveQuickPicks({
      languages: ["en"],
      taste: {
        likedTracks: [track("v1", "Aurora"), track("v2", "  aurora  ")],
        events: [],
      },
    });
    expect(byName.filter((entry) => entry.title === "Aurora")).toHaveLength(1);
    expect(bySpelling.filter((entry) => entry.title === "Aurora")).toHaveLength(1);
  });
});

describe("quickPicks: local evidence still outranks provider results", () => {
  it("reads provider results only when the device holds no local material", () => {
    const providerTracks = [track("p1", "Trending Someone")];
    const warm = deriveQuickPicks({ languages: ["en"], taste: material(), providerTracks });
    // The local material leads the rail, and the provider's result is not on it at
    // all: M35's curated source sits between them and does not reopen the gate.
    expect(warm.slice(0, 3).map((pick) => pick.title)).toEqual(["Aurora", "Beacon", "Cobalt"]);
    expect(warm.some((pick) => pick.title === "Trending Someone")).toBe(false);
  });

  it("reads liked tracks before plays", () => {
    const picks = derive();
    expect(picks.slice(0, 3).map((pick) => pick.title)).toEqual(["Aurora", "Beacon", "Cobalt"]);
  });

  it("reads no repository and no store while deriving", async () => {
    const spy = vi.spyOn(localData, "getLocalData");
    deriveQuickPicks({
      languages: ["en"],
      taste: NO_TASTE,
      providerTracks: [track("p1", "Someone")],
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("quickPicks: artist artwork", () => {
  it("gives the artist the artwork the provider supplied", () => {
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: { likedTracks: [track("v1", "Aurora")], events: [] },
    });
    expect(picks[0]?.artworkUrl).toBe("https://example.test/v1.jpg");
  });

  it("leaves artwork undefined when the artist's tracks carry none", () => {
    // Undefined, not an empty string: `ArtistCard` decides placeholder-vs-image on
    // `undefined`, and an empty string would render a broken image instead.
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: { likedTracks: [bareTrack("v1", "Aurora")], events: [] },
    });
    expect(picks[0]?.artworkUrl).toBeUndefined();
  });

  it("issues no request to obtain artwork", () => {
    // The whole reason no Lyrix-style thumbnail endpoint was built: the artwork is
    // already on the candidate tracks the caller supplied.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    deriveQuickPicks({
      languages: ["en"],
      taste: NO_TASTE,
      providerTracks: [track("p1", "Someone")],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("QuickPicksShelf: circular artist cards that navigate", () => {
  const likedTracks = [track("l1", "Aurora"), track("l2", "Beacon")];

  beforeEach(() => {
    seedRailStores({ likedTracks });
  });

  it("renders one anchor per entry, each with a resolvable href", () => {
    render(<QuickPicksShelf />);
    const cards = screen.getAllByTestId("quick-pick");
    // M35: the rail is completed from the curated artists of the selected
    // language, so it now holds the whole bound rather than only the two
    // liked tracks.
    expect(cards).toHaveLength(MAX_QUICK_PICKS);
    for (const card of cards) {
      expect(card.tagName).toBe("A");
      expect(card.getAttribute("href")).toMatch(/^\/artist\//);
      expect(card.getAttribute("data-quick-pick-kind")).toBe("artist");
    }
  });

  it("keeps the consolidated circular artist card test id", () => {
    // The Popular Artists section was consolidated into this rail; assertions written
    // against `home-artist-card` must still find the circular artist card.
    render(<QuickPicksShelf />);
    expect(screen.getAllByTestId("home-artist-card")).toHaveLength(MAX_QUICK_PICKS);
  });

  it("renders circular geometry and the Artist label", () => {
    const { container } = render(<QuickPicksShelf />);
    expect(container.querySelectorAll(".rounded-avatars").length).toBeGreaterThan(0);
    for (const card of screen.getAllByTestId("home-artist-card")) {
      expect(within(card).getByText("Artist")).toBeTruthy();
    }
  });

  it("renders the artist's own image when the provider supplied one", () => {
    const { container } = render(<QuickPicksShelf />);
    const image = container.querySelector<HTMLImageElement>(
      'img[src="https://example.test/l1.jpg"]',
    );
    expect(image).not.toBeNull();
  });

  it("falls back to the existing artist placeholder when there is no artwork", () => {
    seedRailStores({ likedTracks: [bareTrack("b1", "Aurora")] });
    const { container } = render(<QuickPicksShelf />);
    expect(container.querySelector("img")).toBeNull();
    // `ArtistCard`'s placeholder is the `User` glyph, not a broken image.
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders a link for every entry and no decorative card", () => {
    render(<QuickPicksShelf />);
    for (const card of screen.getAllByTestId("quick-pick")) {
      expect(card.getAttribute("href")).toBeTruthy();
      expect(card.getAttribute("tabindex")).toBeNull();
    }
  });

  it("does not claim to offer releases or searches", () => {
    render(<QuickPicksShelf />);
    expect(screen.getByText(QUICK_PICKS_DESCRIPTION)).toBeTruthy();
    expect(QUICK_PICKS_DESCRIPTION).not.toMatch(/release|search/i);
  });

  it("is not presented under the Podcasts filter, and is under the other two", () => {
    const { rerender } = render(<QuickPicksShelf filter="podcasts" />);
    expect(screen.queryByTestId("home-quick-picks")).toBeNull();
    for (const filter of ["all", "music"] as const) {
      rerender(<QuickPicksShelf filter={filter} />);
      expect(screen.getByTestId("home-quick-picks")).toBeTruthy();
    }
  });
});
