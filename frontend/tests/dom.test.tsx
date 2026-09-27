import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("DOM test infrastructure", () => {
  it("renders in jsdom with jest-dom matchers available", () => {
    render(<div data-testid="smoke">dom ready</div>);

    const node = screen.getByTestId("smoke");
    expect(node).toBeInTheDocument();
    expect(node).toBeVisible();
    expect(node).toHaveTextContent("dom ready");
  });
});
