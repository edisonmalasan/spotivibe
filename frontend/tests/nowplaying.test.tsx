import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NowPlayingPage from "@/app/now-playing/page";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("Now Playing surface", () => {
  it("renders the expanded view with artwork, placeholders, and controls", () => {
    const { container } = render(<NowPlayingPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Now Playing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Close Now Playing" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Nothing playing")).toBeInTheDocument();
    expect(screen.getByText("Choose something to start")).toBeInTheDocument();
    expect(container.querySelector('[class*="rounded-images"] svg')).not.toBeNull();
  });

  it("exposes disabled transport, like, and queue control placeholders", () => {
    render(<NowPlayingPage />);

    const play = screen.getByRole("button", { name: "Play" });
    expect(play).toBeDisabled();
    expect(play.className).toContain("bg-spotify-green");

    expect(screen.getByRole("button", { name: "Previous track" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save to Liked Songs" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Queue" })).toBeDisabled();
  });

  it("renders a zeroed progress track", () => {
    render(<NowPlayingPage />);

    expect(screen.getByRole("progressbar", { name: "Track progress" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
});
