import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/design-system/Button";
import { IconButton } from "@/components/design-system/IconButton";

describe("Button", () => {
  it("renders the filled white pill with the DESIGN.md contract", () => {
    render(<Button>Create playlist</Button>);
    const button = screen.getByRole("button", { name: "Create playlist" });

    expect(button).toHaveAttribute("type", "button");
    // 9999px radius family, white fill, black 14px/700 label, 12px × 8px padding.
    expect(button.className).toContain("rounded-buttons");
    expect(button.className).toContain("bg-pure-white");
    expect(button.className).toContain("text-void-black");
    expect(button.className).toContain("text-body-lg");
    expect(button.className).toContain("font-bold");
    expect(button.className).toContain("px-3");
    expect(button.className).toContain("py-2");
  });

  it("renders the ghost variant with mist text that hovers to pure white", () => {
    render(<Button variant="ghost">Log in</Button>);
    const button = screen.getByRole("button", { name: "Log in" });

    expect(button.className).toContain("text-mist");
    expect(button.className).toContain("hover:text-pure-white");
    expect(button.className).not.toContain("bg-pure-white");
  });

  it("is non-interactive and muted when disabled", () => {
    render(<Button disabled>Play</Button>);
    const button = screen.getByRole("button", { name: "Play" });

    expect(button).toBeDisabled();
    expect(button.className).toContain("disabled:pointer-events-none");
    expect(button.className).toContain("disabled:text-iron");
  });

  it("exposes a busy state while loading", () => {
    render(<Button loading>Play</Button>);
    const button = screen.getByRole("button", { name: "Play" });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button.querySelector(".animate-spin")).not.toBeNull();
    expect(button.querySelector(".animate-spin")).toHaveAttribute("aria-hidden", "true");
  });

  it("is a native button reachable with the keyboard", () => {
    render(<Button>Play</Button>);
    const button = screen.getByRole("button", { name: "Play" });

    expect(button.tagName).toBe("BUTTON");
    button.focus();
    expect(button).toHaveFocus();
    // Focus visibility comes from the global :focus-visible rule (base-styles.test.ts).
  });

  it("forwards click handlers", () => {
    let clicked = 0;
    render(<Button onClick={() => (clicked += 1)}>Play</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    expect(clicked).toBe(1);
  });
});

describe("IconButton", () => {
  it("always exposes an accessible name for icon-only controls", () => {
    render(
      <IconButton label="Add to library">
        <svg aria-hidden="true" />
      </IconButton>,
    );

    expect(screen.getByRole("button", { name: "Add to library" })).toBeInTheDocument();
  });

  it("uses a 32px circular hit area", () => {
    render(
      <IconButton label="Play">
        <svg aria-hidden="true" />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Play" });

    expect(button.className).toContain("size-8");
    expect(button.className).toContain("rounded-buttons");
    expect(button.className).toContain("hover:bg-smoke");
  });

  it("supports the disabled state", () => {
    render(
      <IconButton label="Play" disabled>
        <svg aria-hidden="true" />
      </IconButton>,
    );

    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
  });

  it("keeps the disabled accent play icon legible against the iron fill", () => {
    render(
      <IconButton label="Play" tone="accent" disabled>
        <svg aria-hidden="true" />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Play" });

    expect(button).toBeDisabled();
    expect(button.className).toContain("disabled:bg-iron");
    expect(button.className).toContain("disabled:text-fog");
    // Exactly one disabled text color: a base-level `disabled:text-iron`
    // overrode the accent's fog and rendered the icon invisible (#333 on #333).
    expect(button.className).not.toContain("disabled:text-iron");
  });

  it("keeps default-tone disabled controls muted at iron", () => {
    render(
      <IconButton label="Queue" disabled>
        <svg aria-hidden="true" />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Queue" });

    expect(button).toBeDisabled();
    expect(button.className).toContain("disabled:text-iron");
  });
});
