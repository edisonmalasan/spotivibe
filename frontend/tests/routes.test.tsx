import "fake-indexeddb/auto";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import LibraryPage from "@/app/library/page";
import QueuePage from "@/app/queue/page";
import SearchPage from "@/app/search/page";
import { resetLibraryStore } from "@/stores/libraryStore";
import { resetQueueStore } from "@/stores/queueStore";

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

  it("renders library with its surface chrome and an empty state (M7)", async () => {
    resetLibraryStore();
    render(<LibraryPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Your Library" })).toBeInTheDocument();
    // The M7 surface hydrates from IndexedDB before choosing its state.
    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();
    expect(
      screen.getByText("Songs, albums, and playlists you save will appear here."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create playlist" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import playlist" })).toBeInTheDocument();
  });

  it("renders the queue route with its empty state", () => {
    resetQueueStore();

    render(<QueuePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Queue" })).toBeInTheDocument();
    expect(screen.getByText("Nothing queued yet")).toBeInTheDocument();
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });

  // M7 makes `/library` a functional surface (its own coverage lives in
  // library-surface.test.tsx); the remaining placeholder routes stay inert.
  it("introduces no functional search or playback controls on placeholder surfaces", () => {
    render(<HomePage />);
    render(<SearchPage />);

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("list")).toHaveLength(0);
  });
});
