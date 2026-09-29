import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AlbumCard } from "@/components/design-system/AlbumCard";
import { ArtistCard } from "@/components/design-system/ArtistCard";
import { Shelf } from "@/components/recommendations/Shelf";

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

/**
 * M8 task 5.1: the shelf primitive's per-state contract (spec: `discovery` —
 * "Home discovery feed"). One shelf resolves its own state, so these cases pin
 * that a shelf owns its skeletons, its empty copy, and its retryable error
 * without ever rendering a blank region.
 */

function twoCards() {
  return [
    <AlbumCard key="a" title="Midnight Drive" artist="Neon Waves" />,
    <ArtistCard key="b" name="Aurora Sky" />,
  ];
}

describe("Shelf: structure and accessible name", () => {
  it("renders a named region with one section header", () => {
    render(
      <Shelf title="Trending Now" shape="square" state="ready" data-testid="home-shelf-trending" />,
    );

    const section = screen.getByRole("region", { name: "Trending Now" });
    expect(section.tagName).toBe("SECTION");
    expect(section).toHaveAttribute("data-testid", "home-shelf-trending");
    expect(screen.getByRole("heading", { level: 2, name: "Trending Now" })).toBeInTheDocument();
  });

  it("forwards the optional action to the section header", () => {
    render(
      <Shelf
        title="Popular artists"
        shape="circular"
        state="ready"
        action={{ label: "Show all", href: "/search?q=artist" }}
      />,
    );

    const link = screen.getByRole("link", { name: "Show all" });
    expect(link).toHaveAttribute("href", "/search?q=artist");
  });

  it("renders the optional secondary description", () => {
    const { rerender } = render(
      <Shelf title="Trending Now" shape="square" state="empty" description="Updated hourly." />,
    );
    expect(screen.getByText("Updated hourly.").className).toContain("text-mist");

    rerender(<Shelf title="Trending Now" shape="square" state="empty" />);
    expect(screen.queryByText("Updated hourly.")).not.toBeInTheDocument();
  });

  it("merges a caller class name onto the section", () => {
    render(<Shelf title="Trending Now" shape="square" state="empty" className="mt-4" />);

    expect(screen.getByRole("region", { name: "Trending Now" }).className).toContain("mt-4");
  });
});

describe("Shelf: rail geometry", () => {
  it("scrolls one row of 5 / 3 / 2 cards per viewport", () => {
    render(
      <Shelf title="Trending Now" shape="square" state="ready">
        {twoCards()}
      </Shelf>,
    );
    const rail = screen.getByTestId("shelf-rail");

    // DESIGN.md "Layout": horizontal carousel, not a wrapped grid.
    expect(rail.className).toContain("overflow-x-auto");
    expect(rail.className).toContain("grid-flow-col");
    expect(rail.className).toContain("grid-rows-1");
    // 2 below 640px, 3 at tablet (>=640px), 5 at desktop (>=1024px).
    expect(rail.className).toContain("auto-cols-[46%]");
    expect(rail.className).toContain("sm:auto-cols-[30%]");
    expect(rail.className).toContain("lg:auto-cols-[18%]");
  });

  it("is keyboard scrollable and names its scroll region", () => {
    render(
      <Shelf title="Popular artists" shape="circular" state="ready">
        {twoCards()}
      </Shelf>,
    );
    const rail = screen.getByRole("group", { name: "Popular artists shelf" });

    expect(rail).toHaveAttribute("tabindex", "0");
  });
});

describe("Shelf: loading", () => {
  it("shows six placeholders shaped for the cards they replace", () => {
    const { container, rerender } = render(
      <Shelf title="Trending Now" shape="square" state="loading" />,
    );

    expect(screen.getAllByTestId("shelf-skeleton")).toHaveLength(6);
    const square = container.querySelector(
      '[data-testid="shelf-skeleton"] [data-testid="skeleton"]',
    );
    expect(square!.className).toContain("aspect-square");
    expect(square!.className).toContain("rounded-cards");
    expect(square).toHaveAttribute("aria-hidden", "true");

    rerender(<Shelf title="Popular artists" shape="circular" state="loading" />);
    const circle = container.querySelector(
      '[data-testid="shelf-skeleton"] [data-testid="skeleton"]',
    );
    expect(circle!.className).toContain("aspect-square");
    expect(circle!.className).toContain("rounded-avatars");
  });

  it("places every placeholder in the same rail", () => {
    render(<Shelf title="Trending Now" shape="square" state="loading" skeletonCount={3} />);

    const rail = screen.getByTestId("shelf-rail");
    expect(rail.querySelectorAll('[data-testid="shelf-skeleton"]')).toHaveLength(3);
    expect(rail.className).toContain("overflow-x-auto");
  });
});

describe("Shelf: ready", () => {
  it("renders its children inside the rail", () => {
    const { container } = render(
      <Shelf title="Trending Now" shape="square" state="ready">
        {twoCards()}
      </Shelf>,
    );

    const rail = screen.getByTestId("shelf-rail");
    expect(rail.children).toHaveLength(2);
    expect(container.querySelectorAll("article")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Midnight Drive" })).toBeInTheDocument();
  });

  it("falls back to the empty state when a ready shelf has no children", () => {
    render(<Shelf title="Made For You" shape="square" state="ready" />);

    expect(screen.queryByTestId("shelf-rail")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nothing here yet" })).toBeInTheDocument();
  });
});

describe("Shelf: empty", () => {
  it("explains the empty shelf with the given copy", () => {
    render(
      <Shelf
        title="Made For You"
        shape="square"
        state="empty"
        empty={{ title: "Nothing personalized yet", description: "Like a few songs first." }}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Nothing personalized yet" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Like a few songs first.")).toBeInTheDocument();
    expect(screen.queryByTestId("shelf-rail")).not.toBeInTheDocument();
  });
});

describe("Shelf: error", () => {
  it("isolates the failure to a retryable alert on this shelf", () => {
    const onRetry = vi.fn();
    render(
      <Shelf
        title="Trending Now"
        shape="square"
        state="error"
        onRetry={onRetry}
        error={{ title: "Could not load this shelf", description: "Check your connection." }}
      />,
    );

    expect(screen.getByRole("region", { name: "Trending Now" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Could not load this shelf" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Check your connection.")).toBeInTheDocument();
    expect(screen.queryByTestId("shelf-rail")).not.toBeInTheDocument();
  });

  it("retries only this shelf through onRetry", () => {
    const onRetry = vi.fn();
    render(<Shelf title="Trending Now" shape="square" state="error" onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("omits the retry control when no handler is given", () => {
    render(<Shelf title="Trending Now" shape="square" state="error" />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
