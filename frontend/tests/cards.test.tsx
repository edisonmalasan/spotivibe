import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AlbumCard } from "@/components/design-system/AlbumCard";
import { ArtistCard } from "@/components/design-system/ArtistCard";
import { SectionHeader } from "@/components/design-system/SectionHeader";

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

describe("AlbumCard", () => {
  it("renders title and artist with the DESIGN.md text roles", () => {
    render(<AlbumCard title="Midnight Drive" artist="Neon Waves" />);

    const title = screen.getByRole("heading", { name: "Midnight Drive" });
    expect(title.className).toContain("text-body-lg");
    expect(title.className).toContain("font-semibold");
    expect(title.className).toContain("text-pure-white");

    const artist = screen.getByText("Neon Waves");
    expect(artist.className).toContain("text-body-lg");
    expect(artist.className).toContain("font-regular");
    expect(artist.className).toContain("text-mist");
  });

  it("uses the carbon card surface that lifts to graphite on hover", () => {
    const { container } = render(<AlbumCard title="Midnight Drive" artist="Neon Waves" />);
    const card = container.querySelector("article");

    expect(card).not.toBeNull();
    expect(card!.className).toContain("bg-carbon");
    expect(card!.className).toContain("hover:bg-graphite");
    expect(card!.className).toContain("rounded-cards");
    expect(card!.className).toContain("p-3"); // 12px card padding
  });

  it("renders a square 1:1 cover area at the 6px image radius", () => {
    const { container } = render(<AlbumCard title="Midnight Drive" artist="Neon Waves" />);
    const cover = container.querySelector("article > div");

    expect(cover).not.toBeNull();
    expect(cover!.className).toContain("aspect-square");
    expect(cover!.className).toContain("rounded-images");
    expect(cover!.querySelector("svg")).not.toBeNull();
  });
});

describe("ArtistCard", () => {
  it("renders a circular avatar with name and 'Artist' label", () => {
    const { container } = render(<ArtistCard name="Aurora Sky" />);

    const name = screen.getByRole("heading", { name: "Aurora Sky" });
    expect(name.className).toContain("font-semibold");
    expect(name.className).toContain("text-pure-white");

    expect(screen.getByText("Artist")).toBeInTheDocument();
    expect(screen.getByText("Artist").className).toContain("text-[12px]");
    expect(screen.getByText("Artist").className).toContain("text-mist");

    const avatar = container.querySelector("article > div");
    expect(avatar!.className).toContain("rounded-avatars");
    expect(avatar!.className).toContain("aspect-square");
  });

  it("has no rest-state fill but lifts to graphite on hover", () => {
    const { container } = render(<ArtistCard name="Aurora Sky" />);
    const card = container.querySelector("article");

    expect(card!.className).not.toContain("bg-carbon");
    expect(card!.className).toContain("hover:bg-graphite");
    expect(card!.className).toContain("gap-3"); // 12px gap circle → text
  });
});

describe("SectionHeader", () => {
  it("renders a 24px/700 heading with the 24px row gap", () => {
    render(<SectionHeader title="Trending songs" />);
    const heading = screen.getByRole("heading", { level: 2, name: "Trending songs" });

    expect(heading.className).toContain("text-heading");
    expect(heading.className).toContain("font-bold");
    expect(heading.className).toContain("text-pure-white");
    expect(screen.getByRole("heading").parentElement!.className).toContain("mb-6");
  });

  it("renders the optional mist action link", () => {
    render(
      <SectionHeader title="Trending songs" action={{ label: "Show all", href: "/search" }} />,
    );
    const link = screen.getByRole("link", { name: "Show all" });

    expect(link).toHaveAttribute("href", "/search");
    expect(link.className).toContain("text-mist");
    expect(link.className).toContain("text-[12px]");
    expect(link.className).toContain("hover:text-pure-white");
  });

  it("omits the action link when no action is given", () => {
    render(<SectionHeader title="Popular artists" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
