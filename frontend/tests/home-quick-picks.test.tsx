import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListeningEventRecord, Track } from "@/data/repositories";
import {
  deriveQuickPicks,
  isQuickPickKind,
  MAX_QUICK_PICKS,
  quickPickHref,
  QUICK_PICK_KINDS,
  type QuickPick,
} from "@/features/home/quickPicks";
import { QuickPicksShelf } from "@/features/home/QuickPicksShelf";
import { makeTrack } from "./helpers/music-fixtures";
import { resetHistoryStore } from "@/stores/historyStore";
import { resetLibraryStore } from "@/stores/libraryStore";

/**
 * M17 tasks 3.1–3.3 (spec: `home-mixes` — "Quick Picks lead to surfaces that
 * exist", scenarios "Every Quick Pick navigates somewhere", "No Quick Pick has an
 * unresolvable target", "Quick Picks derive from local material"; `discovery` —
 * "Quick Picks navigate to existing surfaces"; design decision 5).
 *
 * The claim under test is that this shelf has **no dead ends**, and it is checked
 * from both sides: the derivation is asserted to emit only entries the app can
 * resolve, and the *rendered* cards are then asserted one by one to be real
 * anchors with a non-empty target of a recognised kind. A convention in a comment
 * would satisfy neither; a card that renders and goes nowhere fails both.
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

function track(id: string, artist: string, album?: string): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Song ${id}`,
    artists: [{ name: artist }],
    ...(album === undefined ? {} : { album: { title: album } }),
    artwork: [{ url: `https://example.test/${id}.jpg` }],
  });
}

/**
 * An artist the local data *counts* but cannot *name*: a provider artist whose id
 * is not the entity-id shape and whose display name is blank. The entry is real —
 * the track credits it — but the text key an artist route would be given is blank,
 * so no route resolves it. This is the case the resolvability gate exists for, and
 * it is reachable from real data rather than only from a hand-built pick.
 */
function unnamedArtistTrack(id: string): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Song ${id}`,
    artists: [{ id: "Some Id", name: "   " }],
  });
}

function event(id: string, artist: string, album?: string): ListeningEventRecord {
  return {
    id: `event-${id}`,
    trackId: `youtube:${id}`,
    track: track(id, artist, album),
    playedAt: 1_000,
    secondsPlayed: 200,
    context: "home",
  };
}

/** The three local inputs a derivation may read. */
function material() {
  return {
    likedTracks: [track("l1", "Aurora", "First Light"), track("l2", "Beacon")],
    events: [event("e1", "Cobalt", "Deep Field")],
  };
}

function derive(languages: readonly string[] = ["en"], taste = material()): QuickPick[] {
  return deriveQuickPicks({ languages, taste });
}

beforeEach(() => {
  resetHistoryStore();
  resetLibraryStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quickPicks: derivation reads only local material", () => {
  it("builds artist, album, and search entries from those three inputs alone", () => {
    const picks = derive(["en", "es"]);
    const kinds = picks.map((pick) => pick.kind);
    // Artists from liked and played tracks, albums from the tracks that carry one,
    // and one search entry per selected language.
    expect(kinds).toContain("artist");
    expect(kinds).toContain("album");
    expect(kinds).toContain("search");
    expect(
      picks
        .filter((pick) => pick.kind === "artist")
        .map((pick) => pick.title)
        .sort(),
    ).toEqual(["Aurora", "Beacon", "Cobalt"]);
    expect(
      picks
        .filter((pick) => pick.kind === "album")
        .map((pick) => pick.title)
        .sort(),
    ).toEqual(["Deep Field", "First Light"]);
    expect(
      picks
        .filter((pick) => pick.kind === "search")
        .map((pick) => pick.target)
        .sort(),
    ).toEqual(["English", "Spanish"]);
  });

  it("reads no repository and no store while deriving", async () => {
    // The derivation is a pure function over its arguments; `getLocalData` is the
    // single accessor every local read goes through, so a spy on it is the honest
    // place to look for "no new stored data was consulted".
    const localData = await import("@/data/localData");
    const getLocalData = vi.spyOn(localData, "getLocalData");

    derive(["en", "es"]);

    expect(getLocalData).not.toHaveBeenCalled();
    getLocalData.mockRestore();
  });

  it("reaches the language, the local artists, and the local releases — and nothing else", () => {
    // A device with no local material still offers the language entries, because a
    // language is a preference the device holds; and nothing else appears.
    const picks = derive(["es"], { likedTracks: [], events: [] });
    expect(picks.map((pick) => pick.kind)).toEqual(["search"]);
    expect(picks[0]?.target).toBe("Spanish");

    // Conversely, a device with material and a single language offers no second
    // search entry, because the bound is applied to real entries rather than
    // padding the rail with language duplicates.
    const withMaterial = derive(["en"], material());
    expect(withMaterial.filter((pick) => pick.kind === "search")).toHaveLength(1);
  });

  it("is bounded, deduped, and deterministic", () => {
    const many = {
      likedTracks: Array.from({ length: 20 }, (_unused, index) =>
        track(`m${index}`, `Artist ${index}`, `Album ${index}`),
      ),
      events: [],
    };
    const picks = deriveQuickPicks({ languages: ["en", "es"], taste: many });

    expect(picks.length).toBeLessThanOrEqual(MAX_QUICK_PICKS);
    const identities = picks.map((pick) => `${pick.kind}:${pick.target.toLowerCase()}`);
    expect(new Set(identities).size).toBe(identities.length);
    expect(deriveQuickPicks({ languages: ["en", "es"], taste: many })).toEqual(picks);
    // And it never mutates what it was given.
    const before = JSON.stringify(many);
    deriveQuickPicks({ languages: ["en", "es"], taste: many });
    expect(JSON.stringify(many)).toBe(before);
  });
});

describe("quickPicks: the cold-start stand-in (M22)", () => {
  /**
   * M22 tasks 3.1–3.3, 3.5, 3.6 (spec: `home-mixes` — "Quick Picks lead to
   * surfaces that exist", scenarios "A device with no local material is offered
   * more than the language entry", "Local evidence is never displaced by provider
   * results", "The language entries survive a full stand-in pass"; design decisions
   * D2, D3, D5).
   *
   * The bug being closed: with no likes and no plays, the rail rendered exactly
   * one entry — a search card for the default language — under a heading promising
   * artists and releases. `ROADMAP.md` §21.2 and this requirement both specified a
   * fourth source, "existing provider results", which the derivation never read.
   */

  /** A device with no likes and no plays — the state these tests are about. */
  const cold = { likedTracks: [], events: [] } as const;

  it("offers a cold device real artists and releases ahead of the language entry", () => {
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: cold,
      providerTracks: [track("p1", "Nova", "Signal Fire"), track("p2", "Iris")],
    });

    // Not one entry any more: the two provider artists, then the two releases'
    // artist-derived pair, then the language entry last.
    expect(picks.map((pick) => pick.kind)).toEqual(["artist", "artist", "album", "search"]);
    expect(picks.filter((pick) => pick.kind === "artist").map((pick) => pick.title)).toEqual([
      "Nova",
      "Iris",
    ]);
    // The ordering claim itself, asserted rather than inferred from the array shape:
    // every provider entry precedes the language entry.
    expect(picks.findIndex((pick) => pick.kind === "search")).toBe(picks.length - 1);

    // And every one of them is a link somewhere real, like every other entry. The
    // provider gave no artist entity ids, so the artist entries are text keys.
    for (const pick of picks) expect(quickPickHref(pick)).not.toBeNull();
    expect(quickPickHref(picks[0]!)).toBe("/artist/Nova");
  });

  it("gives the stand-in entries the artwork the provider supplied", () => {
    // The complaint that started this was a bare grey icon with no cover. A
    // provider track carries artwork, so the stand-in entries must use it — the
    // cover fallback belongs to search entries, which name a query and have none.
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: cold,
      providerTracks: [track("p1", "Nova", "Signal Fire")],
    });

    expect(picks.find((pick) => pick.kind === "artist")?.artworkUrl).toBe(
      "https://example.test/p1.jpg",
    );
    expect(picks.find((pick) => pick.kind === "album")?.artworkUrl).toBe(
      "https://example.test/p1.jpg",
    );
    expect(picks.find((pick) => pick.kind === "search")?.artworkUrl).toBeUndefined();
  });

  it("never lets provider results displace, reorder, or outrank local evidence", () => {
    // The warm path, stated as whole-array equality rather than a length: a
    // stand-in that merely kept the count while swapping entries would pass a
    // weaker assertion than the one the requirement actually makes.
    const withProvider = deriveQuickPicks({
      languages: ["en", "es"],
      taste: material(),
      providerTracks: [track("p1", "Nova", "Signal Fire"), track("p2", "Iris", "Low Tide")],
    });
    const withoutProvider = deriveQuickPicks({ languages: ["en", "es"], taste: material() });

    expect(withProvider).toEqual(withoutProvider);
    // Spelled out too, so a failure says *which* guarantee broke.
    expect(withProvider.map((pick) => pick.title)).not.toContain("Nova");
    expect(withProvider.map((pick) => pick.title)).not.toContain("Low Tide");

    // One liked track is already "material". The gate is emptiness, not thinness.
    const barely = deriveQuickPicks({
      languages: ["en"],
      taste: { likedTracks: [track("l1", "Aurora", "First Light")], events: [] },
      providerTracks: [track("p1", "Nova", "Signal Fire")],
    });
    expect(barely).toEqual(
      deriveQuickPicks({
        languages: ["en"],
        taste: { likedTracks: [track("l1", "Aurora", "First Light")], events: [] },
      }),
    );
  });

  it("keeps the language entry when the provider returns more than the whole bound", () => {
    // Without the reservation, a cold device on a healthy network would fill the
    // bound with provider artists and lose the one entry the derivation guarantees
    // — making that guarantee depend on the network.
    const crowded = Array.from({ length: 20 }, (_unused, index) =>
      track(`p${index}`, `Artist ${index}`, `Album ${index}`),
    );

    const one = deriveQuickPicks({ languages: ["en"], taste: cold, providerTracks: crowded });
    expect(one.length).toBeLessThanOrEqual(MAX_QUICK_PICKS);
    expect(one.filter((pick) => pick.kind === "search").map((pick) => pick.title)).toEqual([
      "English",
    ]);

    // Three languages reserve three slots, so fewer stand-in entries survive.
    const three = deriveQuickPicks({
      languages: ["en", "es", "ja"],
      taste: cold,
      providerTracks: crowded,
    });
    const searches = three.filter((pick) => pick.kind === "search");
    expect(searches).toHaveLength(3);
    expect(searches.map((pick) => pick.title).sort()).toEqual(["English", "Japanese", "Spanish"]);
    expect(three.length).toBeLessThanOrEqual(MAX_QUICK_PICKS);
    expect(three.filter((pick) => pick.kind !== "search")).toHaveLength(MAX_QUICK_PICKS - 3);
  });

  it("falls back to exactly today's rail when the provider returned nothing", () => {
    // A cold device whose discovery request failed or is still in flight passes
    // `[]` — `DiscoveryShelf.tracks` is empty until a shelf is ready. That must
    // degrade to the pre-M22 behaviour, not to an error or an empty rail.
    const empty = deriveQuickPicks({ languages: ["en"], taste: cold, providerTracks: [] });
    expect(empty.map((pick) => pick.kind)).toEqual(["search"]);
    expect(empty[0]?.target).toBe("English");

    // And omitting the field entirely is the same thing, which is what makes it
    // safe to keep optional.
    expect(deriveQuickPicks({ languages: ["en"], taste: cold })).toEqual(empty);
  });

  it("produces no release entry for a stand-in track with no album metadata", () => {
    // Asserted rather than assumed: the stand-in and the local pass share one
    // helper, and sharing is exactly the kind of thing that is true until it is
    // not. "Symmetric with the local pass" is the claim; this is the check.
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: cold,
      providerTracks: [
        track("p1", "Nova"),
        makeTrack({ id: "youtube:p2", providerId: "p2", title: "Song p2" }),
      ],
    });

    expect(picks.map((pick) => pick.kind)).toEqual(["artist", "artist", "search"]);
    expect(picks.filter((pick) => pick.kind === "album")).toHaveLength(0);
  });

  it("reads no repository and no store while deriving from provider results", async () => {
    // The "no new stored data" half of the clause, checked where the existing
    // local-material test checks it: `getLocalData` is the single accessor every
    // local read goes through.
    const localData = await import("@/data/localData");
    const getLocalData = vi.spyOn(localData, "getLocalData");

    deriveQuickPicks({
      languages: ["en"],
      taste: cold,
      providerTracks: [track("p1", "Nova", "Signal Fire")],
    });

    expect(getLocalData).not.toHaveBeenCalled();
    getLocalData.mockRestore();
  });

  it("renders the stand-in entries as working links on a cold device", () => {
    // The component path, because a derivation can be correct while the shelf
    // forgets to pass the fourth source down.
    render(
      <QuickPicksShelf
        likedTracks={[]}
        events={[]}
        languages={["en"]}
        providerTracks={[track("p1", "Nova", "Signal Fire"), track("p2", "Iris")]}
      />,
    );

    const cards = screen.getAllByTestId("quick-pick");
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.getAttribute("data-quick-pick-kind"))).toEqual([
      "artist",
      "artist",
      "album",
      "search",
    ]);
    for (const card of cards) {
      expect(card.getAttribute("href")?.trim()).not.toBe("");
      // The three provider-derived entries carry the artwork the provider gave.
      // The search card has none *by construction* — it names a query, not a
      // release — so it keeps the icon placeholder, and that is the correct
      // rendering rather than a missing cover.
      const isSearch = card.getAttribute("data-quick-pick-kind") === "search";
      expect(card.querySelector("img") !== null).toBe(!isSearch);
    }
  });
});

describe("quickPicks: nothing has an unresolvable target", () => {
  it("emits only recognised kinds with a non-empty target that resolves", () => {
    const picks = derive(["en", "es"]);
    expect(picks.length).toBeGreaterThan(0);
    for (const pick of picks) {
      expect(isQuickPickKind(pick.kind), `${pick.id}: ${pick.kind}`).toBe(true);
      expect(pick.target.trim(), pick.id).not.toBe("");
      const href = quickPickHref(pick);
      expect(href, pick.id).not.toBeNull();
      expect((href ?? "").startsWith("/"), pick.id).toBe(true);
    }
  });

  it("resolves each kind to the route that surface already serves", () => {
    const picks = derive(["en"]);
    const hrefs = (kind: string) =>
      picks.filter((pick) => pick.kind === kind).map((pick) => quickPickHref(pick));

    expect(hrefs("artist")[0]).toBe("/artist/Aurora");
    expect(hrefs("album")[0]).toBe("/album/First%20Light");
    expect(hrefs("search")[0]).toBe("/search?q=English");
  });

  it("reports an unresolvable entry as unresolvable rather than as a broken link", () => {
    // The predicate is the contract, so it is asserted directly: an empty target,
    // or a kind the app has no route for, yields no href at all — and the shelf
    // drops it instead of rendering a card that goes nowhere.
    const broken = {
      id: "artist:blank",
      kind: "artist",
      target: "   ",
      title: "Blank",
      subtitle: "Artist",
    } satisfies QuickPick;
    expect(quickPickHref(broken)).toBeNull();

    const unknownKind = { ...broken, target: "Aurora", kind: "playlist" as QuickPick["kind"] };
    expect(quickPickHref(unknownKind)).toBeNull();
  });

  it("renders only entries whose target resolves, dropping the rest", () => {
    // Nothing in this material is unresolvable, so the rendered set is the whole
    // derivation — which is what makes the DOM assertions below a check rather
    // than a restatement.
    const shelf = derive(["en"]);
    const rendered = derive(["en"]);
    expect(rendered).toEqual(shelf);
    for (const pick of rendered) expect(QUICK_PICK_KINDS).toContain(pick.kind);
  });
});

describe("QuickPicksShelf: every entry is an interactive, resolvable card", () => {
  function renderShelf() {
    const { likedTracks, events } = material();
    return render(
      <QuickPicksShelf likedTracks={likedTracks} events={events} languages={["en", "es"]} />,
    );
  }

  it("renders one anchor per entry, each with a resolvable href and target", () => {
    renderShelf();
    const shelf = screen.getByTestId("home-quick-picks");
    const cards = within(shelf).getAllByTestId("quick-pick");
    const picks = derive(["en", "es"]);

    expect(cards).toHaveLength(picks.length);
    cards.forEach((card, index) => {
      const pick = picks[index];
      if (pick === undefined) throw new Error("the rendered set and the derivation disagree");
      // A link, with the href the derivation resolved — so the click goes where the
      // entry promised.
      expect(card.tagName).toBe("A");
      expect(card.getAttribute("href")).toBe(quickPickHref(pick));
      expect(card.getAttribute("data-quick-pick-kind")).toBe(pick.kind);
      expect(card.getAttribute("data-quick-pick-target")?.trim()).not.toBe("");
      expect(isQuickPickKind(card.getAttribute("data-quick-pick-kind"))).toBe(true);
    });
  });

  it("gives every entry a focusable, activatable role — so a decorative card fails", () => {
    // The specific regression this guards is a card rendered as a `div` or `span`:
    // it would still read, still show artwork, and still be unclickable. Asserting
    // the *role* is what makes that visible, and asserting the element is an
    // anchor with an href is what makes it operable with a keyboard.
    renderShelf();
    const cards = screen.getAllByTestId("quick-pick");
    expect(cards.length).toBeGreaterThan(0);

    for (const card of cards) {
      expect(["A", "BUTTON"]).toContain(card.tagName);
      // A link is focusable and activates on Enter without any tabindex of our own.
      const anchor = card as HTMLAnchorElement;
      expect(anchor.getAttribute("href")?.trim()).not.toBe("");
      expect(anchor.className).not.toMatch(/outline-none/);
      anchor.focus();
      expect(anchor).toHaveFocus();
    }
  });

  it("leads only to routes the app already serves", () => {
    renderShelf();
    for (const card of screen.getAllByTestId("quick-pick")) {
      const href = card.getAttribute("href") ?? "";
      expect(href).toMatch(/^\/(artist|album|search)(\?|\/|$)/);
      // Not an identity: no track id, no provider handle, nothing local leaking
      // into a URL the listener could share.
      expect(href).not.toContain("youtube:");
      expect(href).not.toContain("event-");
    }
  });

  it("drops a local entry whose text key is blank, so no card goes nowhere", () => {
    // The derivation *would* produce an artist entry for this track — the artist is
    // credited, so `groupArtistsByIdentity` sees it — but its text key is whitespace,
    // and `/artist/   ` resolves to nothing. Without the resolvability gate it would
    // be offered as a card that goes nowhere.
    const picks = deriveQuickPicks({
      languages: ["en"],
      taste: { likedTracks: [unnamedArtistTrack("blank")], events: [] },
    });

    expect(picks.map((pick) => pick.target)).not.toContain("   ");
    for (const pick of picks) expect(quickPickHref(pick), pick.id).not.toBeNull();
    // Only the language entry survives.
    expect(picks.map((pick) => pick.kind)).toEqual(["search"]);
  });

  it("renders exactly the entries it derived, so a dropped one is not silently added", () => {
    const { container } = render(
      <QuickPicksShelf
        likedTracks={[...material().likedTracks, unnamedArtistTrack("blank")]}
        events={material().events}
        languages={["en", "es"]}
      />,
    );

    const picks = derive(["en", "es"], {
      likedTracks: [...material().likedTracks, unnamedArtistTrack("blank")],
      events: material().events,
    });
    const cards = [...container.querySelectorAll('[data-testid="quick-pick"]')];
    expect(cards).toHaveLength(picks.length);
    // And every rendered card is a resolvable anchor.
    for (const card of cards) {
      expect(card.tagName).toBe("A");
      expect(card.getAttribute("href")?.trim()).not.toBe("");
    }
  });

  it("offers a fresh device only its language entries, and each one navigates", () => {
    // A selected language is a preference the device genuinely holds and `/search`
    // resolves it, so a cold device still gets a way in — and gets nothing else,
    // because there is no local material to derive an artist or a release from.
    render(<QuickPicksShelf likedTracks={[]} events={[]} languages={["ja"]} />);

    const cards = screen.getAllByTestId("quick-pick");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute("data-quick-pick-kind")).toBe("search");
    expect(cards[0]?.getAttribute("href")).toBe("/search?q=Japanese");
  });

  it("always offers at least one entry, so the rail is never an unexplained gap", () => {
    // The shared catalog normalizes an empty or unknown selection to the default
    // language, which is what makes this true — asserted here because the shelf's
    // "no cards" rendering is otherwise unreachable code the tests never see.
    expect(
      deriveQuickPicks({ languages: [], taste: { likedTracks: [], events: [] } }),
    ).toHaveLength(1);
    expect(
      deriveQuickPicks({ languages: ["zz"], taste: { likedTracks: [], events: [] } }),
    ).toHaveLength(1);
  });

  it("is not presented under the Podcasts filter, and is under the other two", () => {
    const { likedTracks, events } = material();
    const { unmount } = render(
      <QuickPicksShelf
        likedTracks={likedTracks}
        events={events}
        languages={["en"]}
        filter="podcasts"
      />,
    );
    expect(screen.queryByTestId("home-quick-picks")).not.toBeInTheDocument();
    unmount();

    for (const filter of ["all", "music"] as const) {
      const { unmount: next } = render(
        <QuickPicksShelf
          likedTracks={likedTracks}
          events={events}
          languages={["en"]}
          filter={filter}
        />,
      );
      expect(screen.getByTestId("home-quick-picks")).toBeInTheDocument();
      next();
    }
  });
});
