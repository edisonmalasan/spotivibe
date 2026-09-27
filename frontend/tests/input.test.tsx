import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavArrowButton } from "@/components/design-system/NavArrowButton";
import { SearchInput } from "@/components/design-system/SearchInput";

describe("SearchInput", () => {
  it("renders a 36px pill field with the accessible name 'Search'", () => {
    const { container } = render(<SearchInput />);

    const input = screen.getByRole("searchbox", { name: "Search" });
    expect(input).toHaveAttribute("placeholder", "What do you want to play?");

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("rounded-inputs"); // 500px radius family
    expect(wrapper.className).toContain("bg-graphite");
    expect(wrapper.className).toContain("h-9"); // 36px tall
    expect(wrapper.className).toContain("px-3"); // 12px horizontal
    expect(wrapper.className).toContain("shadow-subtle"); // input-field elevation
  });

  it("shows a white monoline icon hidden from assistive tech", () => {
    const { container } = render(<SearchInput />);
    const icon = container.querySelector("svg");

    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("class", expect.stringContaining("text-pure-white"));
  });

  it("renders a white placeholder and accepts overrides", () => {
    render(<SearchInput placeholder="Search songs" aria-label="Search Spotivibe" />);

    const input = screen.getByRole("searchbox", { name: "Search Spotivibe" });
    expect(input).toHaveAttribute("placeholder", "Search songs");
    expect(input.className).toContain("placeholder:text-pure-white");
  });

  it("accepts typed input", () => {
    render(<SearchInput />);
    const input = screen.getByRole("searchbox", { name: "Search" });

    fireEvent.change(input, { target: { value: "daft punk" } });
    expect(input).toHaveValue("daft punk");
  });
});

describe("NavArrowButton", () => {
  it("renders the back arrow with an accessible name and chevron", () => {
    const { container } = render(<NavArrowButton direction="back" />);
    const button = screen.getByRole("button", { name: "Go back" });

    expect(button.className).toContain("size-8"); // 32px diameter
    expect(button.className).toContain("rounded-buttons");
    expect(button.className).toContain("bg-void-black");
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders the forward arrow with an accessible name", () => {
    render(<NavArrowButton direction="forward" />);

    expect(screen.getByRole("button", { name: "Go forward" })).toBeInTheDocument();
  });

  it("supports the disabled state", () => {
    render(<NavArrowButton direction="forward" disabled />);

    expect(screen.getByRole("button", { name: "Go forward" })).toBeDisabled();
  });

  it("forwards click handlers", () => {
    let clicks = 0;
    render(<NavArrowButton direction="back" onClick={() => (clicks += 1)} />);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(clicks).toBe(1);
  });
});
