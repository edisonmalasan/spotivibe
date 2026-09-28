import "fake-indexeddb/auto";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchResults } from "@/features/search/SearchResults";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Rendering coverage for the derived result surface (design §1/§10, spec
 * "Result sections from canonical metadata"): sections gate on entries,
 * desktop keeps Top Result + Songs left and Artists + Albums right, and
 * artist/album selection refines the query.
 */

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
  it("refines the query from the derived artist tile", () => {
    const { onRefine } = renderResults([getLucky, instantCrush], "x");

    const tile = within(section("Artists")).getByRole("button");
    expect(tile).toHaveTextContent("Daft Punk");

    fireEvent.click(tile);
    expect(onRefine).toHaveBeenCalledWith("Daft Punk");
  });

  it("refines the query from the derived album tile", () => {
    const { onRefine } = renderResults([instantCrush], "x");

    const tile = within(section("Albums")).getByRole("button");
    expect(tile).toHaveTextContent("Random Access Memories");

    fireEvent.click(tile);
    expect(onRefine).toHaveBeenCalledWith("Random Access Memories");
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
