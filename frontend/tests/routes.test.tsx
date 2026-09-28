import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import LibraryPage from "@/app/library/page";
import SearchPage from "@/app/search/page";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The search route mounts the client SearchView, which reads the router.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: vi.fn(),
    forward: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(""),
}));

describe("route shells", () => {
  it("renders home with section chrome, cover skeletons, and an empty state", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Trending songs" })).toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton")).toHaveLength(6);
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    expect(
      screen.getByText("Recommendations will appear here as you explore Spotivibe."),
    ).toBeInTheDocument();
  });

  it("renders search in its browse state with no result surface", () => {
    render(<SearchPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Search" })).toBeInTheDocument();
    expect(screen.getByText("Search for music")).toBeInTheDocument();
    expect(screen.getByText("Find songs, artists, albums, and more to play.")).toBeInTheDocument();
    expect(screen.queryAllByTestId("skeleton")).toHaveLength(0);
    expect(screen.queryAllByRole("list")).toHaveLength(0);
  });

  it("renders library with only an empty state", () => {
    render(<LibraryPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Your Library" })).toBeInTheDocument();
    expect(screen.getByText("Your library is empty")).toBeInTheDocument();
    expect(
      screen.getByText("Songs, albums, and playlists you save will appear here."),
    ).toBeInTheDocument();
  });

  it("introduces no functional search, library, or playback controls", () => {
    render(<HomePage />);
    render(<SearchPage />);
    render(<LibraryPage />);

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("list")).toHaveLength(0);
  });
});
