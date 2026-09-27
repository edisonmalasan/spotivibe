import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RouteError from "@/app/error";
import { EmptyState } from "@/components/design-system/EmptyState";
import { ErrorState } from "@/components/design-system/ErrorState";
import { Skeleton } from "@/components/design-system/Skeleton";

describe("Skeleton", () => {
  it("is a decorative pulse hidden from assistive tech", () => {
    render(<Skeleton />);
    const skeleton = screen.getByTestId("skeleton");

    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton.className).toContain("animate-pulse");
    expect(skeleton.className).toContain("bg-graphite");
    expect(skeleton.className).toContain("rounded-cards");
  });

  it("shapes text and circle variants like the content they replace", () => {
    const { rerender } = render(<Skeleton variant="text" />);
    expect(screen.getByTestId("skeleton").className).toContain("h-4");
    expect(screen.getByTestId("skeleton").className).toContain("rounded-small");

    rerender(<Skeleton variant="circle" />);
    expect(screen.getByTestId("skeleton").className).toContain("rounded-avatars");
    expect(screen.getByTestId("skeleton").className).toContain("aspect-square");
  });
});

describe("EmptyState", () => {
  it("renders explanatory copy with a default monochrome icon", () => {
    const { container } = render(
      <EmptyState
        title="Your library is empty"
        description="Save songs, albums, and playlists to see them here."
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Your library is empty" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Save songs, albums, and playlists to see them here."),
    ).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("accepts a custom icon", () => {
    const { container } = render(
      <EmptyState title="Nothing yet" icon={<span data-testid="custom-icon" />} />,
    );

    expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("omits the description when none is given", () => {
    const { container } = render(<EmptyState title="Nothing yet" />);

    expect(screen.getByRole("heading", { name: "Nothing yet" })).toBeInTheDocument();
    expect(container.querySelector("p")).toBeNull();
  });
});

describe("ErrorState", () => {
  it("announces itself as an alert with a recovery affordance", () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Something went wrong" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Try again" }).className).toContain("bg-pure-white");
  });

  it("renders without a retry control when no handler is given", () => {
    render(<ErrorState />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("accepts custom copy", () => {
    render(
      <ErrorState
        title="Playback failed"
        description="Check your connection."
        onRetry={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Playback failed" })).toBeInTheDocument();
    expect(screen.getByText("Check your connection.")).toBeInTheDocument();
  });
});

describe("Route error boundary", () => {
  it("surfaces a recoverable error state and retries through the router reset", () => {
    let resets = 0;
    render(<RouteError error={new Error("render failed")} reset={() => (resets += 1)} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(resets).toBe(1);
  });
});
