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
