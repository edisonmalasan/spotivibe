import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopBar } from "@/components/layout/TopBar";
import { resetSearchStore, useSearchStore } from "@/stores/searchStore";

const nav = vi.hoisted(() => ({
  pathname: "/",
  back: vi.fn(),
  forward: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));

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

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => nav.pathname,
}));

// Only the debounce timers are faked so promise/microtask work stays native.
const FAKED_TIMERS = ["setTimeout", "clearTimeout"] as const;

/**
 * The top-bar search field.
 *
 * M18 made it a combobox (design decision 6) — it is the one field in the
 * application with a suggestion popup — so the role queried here is `combobox`
 * rather than the `searchbox` its `type="search"` would otherwise imply. The
 * accessible name is unchanged, which is what keeps this a change of role and not
 * of identity.
 */
function searchbox(): HTMLInputElement {
  return screen.getByRole("combobox", { name: "Search" });
}

beforeEach(() => {
  resetSearchStore();
  nav.pathname = "/";
  nav.replace.mockClear();
  vi.useFakeTimers({ toFake: [...FAKED_TIMERS] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TopBar search input wiring (task 1.2)", () => {
  it("keeps the input controlled by the store and updates it while typing", () => {
    render(<TopBar />);
    expect(searchbox()).toHaveValue("");

    fireEvent.change(searchbox(), { target: { value: "karma" } });

    expect(useSearchStore.getState().query).toBe("karma");
    expect(searchbox()).toHaveValue("karma");
    expect(nav.replace).not.toHaveBeenCalled(); // navigation is debounced
  });

  it("navigates to /search with the encoded query after the debounce", () => {
    render(<TopBar />);
    fireEvent.change(searchbox(), { target: { value: "night at the opera" } });

    vi.advanceTimersByTime(299);
    expect(nav.replace).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/search?q=night%20at%20the%20opera");
    expect(searchbox()).toHaveValue("night at the opera"); // input keeps its value
  });

  it("writes no navigation when the Search route already owns the URL", () => {
    nav.pathname = "/search";
    render(<TopBar />);

    fireEvent.change(searchbox(), { target: { value: "hello" } });
    vi.advanceTimersByTime(300);

    expect(nav.replace).not.toHaveBeenCalled();
    expect(useSearchStore.getState().query).toBe("hello");
  });

  it("skips the repeat write when the target URL already matches", () => {
    render(<TopBar />);
    fireEvent.change(searchbox(), { target: { value: "same" } });
    vi.advanceTimersByTime(300);
    expect(nav.replace).toHaveBeenCalledTimes(1);

    fireEvent.change(searchbox(), { target: { value: "same" } });
    vi.advanceTimersByTime(300);

    expect(nav.replace).toHaveBeenCalledTimes(1); // compare-first: no duplicate
  });

  it("collapses a typing burst into one replace for the settled query", () => {
    render(<TopBar />);
    for (const value of ["r", "ra", "radio", "radiohead"]) {
      fireEvent.change(searchbox(), { target: { value } });
      vi.advanceTimersByTime(100); // still inside the debounce window
    }
    expect(nav.replace).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);

    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/search?q=radiohead");
  });
});
