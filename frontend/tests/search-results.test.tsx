import "fake-indexeddb/auto";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SearchResults } from "@/features/search/SearchResults";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Rendering coverage for the derived result surface (design §1/§10, spec
 * "Result sections from canonical metadata"): sections gate on entries,
 * desktop keeps Top Result + Songs left and Artists + Albums right, and the
 * Top Result card still refines the query. The derived artist/album tiles are
 * links to the M9 catalog routes (task 6.1), not refine-the-query buttons.
 */

// The derived tiles navigate through next/link; the per-result menu navigates
// through the router (M9 task 6.1).
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

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

const getLucky = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Get Lucky",
  artists: [{ name: "Daft Punk" }],
  album: { title: "Discovery" },
});
const instantCrush = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Instant Crush",
  artists: [{ name: "Daft Punk" }],
  album: { title: "Random Access Memories" },
});
const oneMoreTime = makeTrack({
  id: "youtube:ccc",
  providerId: "ccc",
  title: "One More Time",
  artists: [{ name: "Daft Punk" }],
  album: { title: "Discovery" },
});
const untitled = makeTrack({
  id: "youtube:ddd",
  providerId: "ddd",
  title: "Untitled Demo",
  artists: [{ name: "Bedroom Artist" }],
  album: undefined,
});

function renderResults(tracks: ReturnType<typeof makeTrack>[], query: string) {
  const onRefine = vi.fn();
  const onPlay = vi.fn();
  render(<SearchResults tracks={tracks} query={query} onRefine={onRefine} onPlay={onPlay} />);
  return { onRefine, onPlay };
}

function section(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2, name });
  const host = heading.closest("section");
  if (!host) throw new Error(`section for "${name}" not found`);
  return host;
}

describe("search result sections (tasks 3.1 and 3.3)", () => {
  it("renders Songs with canonical track information and no Top Result without an exact match", () => {
    renderResults([getLucky], "radiohead");

    expect(screen.getByRole("heading", { level: 2, name: "Songs" })).toBeInTheDocument();
    expect(screen.queryByTestId("top-result")).not.toBeInTheDocument();

    const songs = screen.getByTestId("search-results");
    expect(songs).toHaveTextContent("Get Lucky");
    expect(songs).toHaveTextContent("Daft Punk");
    expect(songs).toHaveTextContent("Discovery");
    expect(songs).toHaveTextContent("4:09");
  });

  it("keeps Songs in API relevance order", () => {
    renderResults([oneMoreTime, getLucky, instantCrush], "x");

    const rows = within(screen.getByTestId("search-results")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("One More Time"),
      expect.stringContaining("Get Lucky"),
      expect.stringContaining("Instant Crush"),
    ]);
  });

  it("lists each distinct artist and album once, and each track's metadata only where it resolves", () => {
    renderResults([getLucky, oneMoreTime, instantCrush], "x");

    // Artist identity: one entry despite three credits; albums: two identities.
    expect(screen.getAllByRole("heading", { level: 3, name: "Daft Punk" })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 3, name: "Discovery" })).toHaveLength(1);
    expect(
      screen.getAllByRole("heading", { level: 3, name: "Random Access Memories" }),
    ).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Artists" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Albums" })).toBeInTheDocument();
  });

  it("omits the Albums section when no track resolves album metadata", () => {
    renderResults([untitled], "x");

    expect(screen.queryByRole("heading", { level: 2, name: "Albums" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Artists" })).toBeInTheDocument();
    expect(screen.getByTestId("search-results")).toHaveTextContent("Untitled Demo");
  });
});

describe("Top Result (task 3.2)", () => {
  it("renders an exact artist match prominently and refines the query from it", () => {
    // Top Result presents "the best match for this query", so it keeps
    // refining; the entity tiles and the menu are what navigate (M9 task 6.1).
    const { onRefine } = renderResults([getLucky, instantCrush], " daft punk ");

    expect(screen.getByRole("heading", { level: 2, name: "Top Result" })).toBeInTheDocument();
    const top = screen.getByTestId("top-result");
    expect(top).toHaveAttribute("type", "button"); // selection is the card itself

    fireEvent.click(top);
    expect(onRefine).toHaveBeenCalledTimes(1);
    expect(onRefine).toHaveBeenCalledWith("Daft Punk");
  });

  it("renders an exact album match when no artist matches", () => {
    const { onRefine } = renderResults([getLucky, instantCrush], "Discovery");

    const top = screen.getByTestId("top-result");
    expect(top).toHaveAttribute("type", "button");
    expect(top).toHaveTextContent("Discovery");

    fireEvent.click(top);
    expect(onRefine).toHaveBeenCalledWith("Discovery");
  });

  it("renders the #1 track as Top Result without removing it from Songs", () => {
    renderResults([getLucky, instantCrush], "get lucky");

    const top = screen.getByTestId("top-result");
    expect(top).toHaveTextContent("Get Lucky");
    expect(within(top).getByText("Daft Punk")).toBeInTheDocument();

    const songs = screen.getByTestId("search-results");
    expect(within(songs).getAllByText("Get Lucky")).toHaveLength(1);
  });
});

describe("artist and album tiles (task 3.3)", () => {
  it("links the derived artist tile to the artist route", () => {
    renderResults([getLucky, instantCrush], "x");

    const tile = within(section("Artists")).getByRole("link");
    expect(tile).toHaveTextContent("Daft Punk");
    expect(tile).toHaveAttribute("href", "/artist/Daft%20Punk");
    // The entry navigates; no refine-the-query control is left behind.
    expect(within(section("Artists")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("links the derived album tile to the album route", () => {
    renderResults([instantCrush], "x");

    const tile = within(section("Albums")).getByRole("link");
    expect(tile).toHaveTextContent("Random Access Memories");
    expect(tile).toHaveAttribute("href", "/album/Random%20Access%20Memories%20-%20Daft%20Punk");
    expect(within(section("Albums")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("prefers a provider artist or release id when the result carries one", () => {
    // The id is the entity's own identity; the text key is the fallback for the
    // results whose tier supplied no id.
    renderResults(
      [
        makeTrack({
          id: "youtube:ddd",
          providerId: "ddd",
          title: "Identified",
          artists: [{ id: "UCaurorachannel00000000", name: "Aurora" }],
          album: { id: "MPREb1234567890abcdefghij", title: "Dawn Chorus" },
        }),
      ],
      "x",
    );

    expect(within(section("Artists")).getByRole("link")).toHaveAttribute(
      "href",
      "/artist/UCaurorachannel00000000",
    );
    expect(within(section("Albums")).getByRole("link")).toHaveAttribute(
      "href",
      "/album/MPREb1234567890abcdefghij",
    );
  });
});

describe("duplicate videos collapse in the DOM (task 3.2)", () => {
  it("renders one row for a video the response listed twice", () => {
    // SearchView feeds raw API tracks into SearchResults, which derives
    // internally — so a response carrying the same video twice (same id) or
    // the same providerId under a re-encoded id reaches this surface verbatim.
    const reencoded = { ...instantCrush, id: "youtube:reencoded-bbb" };
    renderResults([getLucky, getLucky, reencoded, instantCrush], "x");

    const songs = screen.getByTestId("search-results");
    // Four response entries → two rows: the same video never appears twice.
    expect(within(songs).getAllByRole("listitem")).toHaveLength(2);
    expect(within(songs).getAllByRole("button", { name: "Play Get Lucky" })).toHaveLength(1);
    expect(within(songs).getAllByText("Get Lucky")).toHaveLength(1);
    expect(within(songs).getAllByText("Instant Crush")).toHaveLength(1);
  });
});
