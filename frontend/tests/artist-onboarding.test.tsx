import "fake-indexeddb/auto";
import { act, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalData, type RepositorySet } from "@/data/localData";
import type { QuickPick } from "@/features/home/quickPicks";
import {
  ARTIST_ONBOARDING_EMPTY,
  ARTIST_ONBOARDING_LABEL,
  ARTIST_ONBOARDING_PENDING_TIMEOUT_MS,
  ARTIST_ONBOARDING_UNRESOLVED,
  ArtistOnboarding,
} from "@/features/onboarding/ArtistOnboarding";
import {
  clearOnboardingSeen,
  isOnboardingSeen,
  markOnboardingSeen,
  ONBOARDING_SEEN_KEY,
  subscribeToOnboarding,
} from "@/features/onboarding/onboardingGate";
import { resetQuickPickPicksStore } from "@/stores/quickPickPicksStore";

/**
 * First-run artist onboarding.
 *
 * These are the *equivalents* of the first-run cases that were deleted with
 * `language-onboarding.test.tsx`: the dialog a11y contract, the failed-write
 * retry, dismissal persisting nothing, and the guarantee that no account step
 * exists. Coverage that described a deleted component was not carried forward
 * verbatim — it would assert behaviour of something that no longer exists — but
 * the properties it protected are asserted here against the surface that
 * replaced it.
 *
 * **The surface has three states now, and every case below says which one it
 * is.** `settled` is what distinguishes them, and it is not a detail: a
 * dismissal is an answer, so a surface that offers one before the rail has
 * settled is collecting an answer to a question it never asked.
 */

// The empty state links to Settings, so `next/link` has to resolve.
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

// IndexedDB round-trips plus a cold React start can exceed the 1s default.
configure({ asyncUtilTimeout: 5000 });

let repositories: RepositorySet;

/** Three artists, in the shape the rail reports upward. */
const ARTISTS: QuickPick[] = [
  { id: "artist:UC_a", kind: "artist", target: "UC_a", title: "Aurora Vale", subtitle: "Artist" },
  { id: "artist:UC_b", kind: "artist", target: "UC_b", title: "Beacon", subtitle: "Artist" },
  { id: "artist:UC_c", kind: "artist", target: "UC_c", title: "Cobalt", subtitle: "Artist" },
];

beforeEach(async () => {
  resetQuickPickPicksStore();
  clearOnboardingSeen();
  repositories = await getLocalData();
  await repositories.resetAll();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("first-run artist onboarding", () => {
  it("offers the rail's own artists as toggleable selections", () => {
    render(<ArtistOnboarding artists={ARTISTS} settled onClose={vi.fn()} />);

    for (const artist of ARTISTS) {
      expect(screen.getByRole("button", { name: new RegExp(artist.title) })).toBeInTheDocument();
    }
    // Selection is announced, not conveyed by a ring colour alone.
    const first = screen.getByRole("button", { name: /Aurora Vale/ });
    expect(first).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(first);
    expect(first).toHaveAttribute("aria-pressed", "true");
  });

  it("stores the picked artists and marks first run complete", async () => {
    render(<ArtistOnboarding artists={ARTISTS} settled onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Aurora Vale/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cobalt/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));

    await waitFor(async () => {
      const stored = await repositories.quickPickPicks.list();
      expect(stored.map((record) => record.name).sort()).toEqual(["Aurora Vale", "Cobalt"]);
    });
    expect(isOnboardingSeen()).toBe(true);
  });

  it("reaches the dashboard when nothing is picked", async () => {
    const onClose = vi.fn();
    render(<ArtistOnboarding artists={ARTISTS} settled onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // A dismissal with nothing selected still ends first run — re-asking is nagging.
    expect(isOnboardingSeen()).toBe(true);
    expect(await repositories.quickPickPicks.list()).toEqual([]);
  });

  it("prompts no account, sign-in, or email step", () => {
    render(<ArtistOnboarding artists={ARTISTS} settled onClose={vi.fn()} />);

    for (const word of [/sign in/i, /log ?in/i, /account/i, /@/]) {
      expect(screen.queryByText(word)).not.toBeInTheDocument();
    }
  });

  it("honors the dialog a11y contract: role, focus entry, and dismissal", async () => {
    const onClose = vi.fn();
    render(<ArtistOnboarding artists={ARTISTS} settled onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("dismisses on a backdrop press, persisting no picks", async () => {
    const onClose = vi.fn();
    render(<ArtistOnboarding artists={ARTISTS} settled onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await repositories.quickPickPicks.list()).toEqual([]);
    // Dismissal ends first run rather than re-asking on every visit.
    expect(isOnboardingSeen()).toBe(true);
  });

  it("reports a failed write and keeps the dialog open for a retry", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onClose = vi.fn();
    vi.spyOn(repositories.quickPickPicks, "replaceAll").mockRejectedValueOnce(
      new Error("disk full"),
    );

    render(<ArtistOnboarding artists={ARTISTS} settled onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /Aurora Vale/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start listening" }));

    // The alert is the point: telling someone their picks were saved when they
    // were not is the worst outcome available here.
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't save/i);
    expect(onClose).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

/**
 * The three states.
 *
 * The surface's own claim is "these are the artists you are choosing between",
 * so it may only make that claim once the rail has settled. A dismissal is an
 * answer, and an answer to a question that has not been asked is not an
 * answer at all.
 */
describe("the first-run surface's three states", () => {
  it("says nothing about the artists and offers no dismissal before the rail has settled", () => {
    render(<ArtistOnboarding artists={[]} settled={false} onClose={vi.fn()} />);

    // Not "there are no artists" — the rail has not answered.
    expect(screen.queryByText(/couldn't find any artists/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("artist-onboarding-empty")).not.toBeInTheDocument();
    // And no dismissal control of any kind: not a disabled one.
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    // The surface still says what it is doing.
    expect(screen.getByTestId("artist-onboarding-pending")).toBeInTheDocument();
  });

  it("does not dismiss on Escape or a backdrop press before the rail has settled", () => {
    const onClose = vi.fn();
    render(<ArtistOnboarding artists={[]} settled={false} onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);

    expect(onClose).not.toHaveBeenCalled();
    // A dismissal is an answer, and nothing has been answered.
    expect(isOnboardingSeen()).toBe(false);
  });

  it("offers the grid, and a dismissal, once the rail has settled with artists", () => {
    render(<ArtistOnboarding artists={ARTISTS} settled onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Aurora Vale/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.queryByTestId("artist-onboarding-pending")).not.toBeInTheDocument();
  });

  it("says so, and promises no choice it cannot offer, once the rail has settled with nothing", () => {
    render(<ArtistOnboarding artists={[]} settled onClose={vi.fn()} />);

    expect(screen.getByTestId("artist-onboarding-empty")).toHaveTextContent(
      /couldn't find any artists/i,
    );
    // The candidates are the rail's entries, and the rail is empty — so the copy
    // must not promise a later choice. It says where artists come from instead.
    expect(screen.getByTestId("artist-onboarding-empty")).not.toHaveTextContent(/pick them/i);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // No "Start listening" that would store nothing and look like a real choice.
    expect(screen.queryByRole("button", { name: "Start listening" })).not.toBeInTheDocument();
    // And it is dismissible, because the answer is true.
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("uses the settled and the unresolved copy for the two different emptinesses", () => {
    const { unmount } = render(<ArtistOnboarding artists={[]} settled={false} onClose={vi.fn()} />);
    // Not settled, and not yet timed out: the surface must not claim there are
    // no artists, because it does not know that yet.
    expect(screen.queryByText(ARTIST_ONBOARDING_EMPTY)).not.toBeInTheDocument();
    unmount();

    render(<ArtistOnboarding artists={[]} settled onClose={vi.fn()} />);
    expect(screen.getByText(ARTIST_ONBOARDING_EMPTY)).toBeInTheDocument();
    expect(screen.queryByText(ARTIST_ONBOARDING_UNRESOLVED)).not.toBeInTheDocument();
  });
});

/**
 * The pending state is bounded.
 *
 * A provider request that never settles would otherwise hold a surface that
 * offers no way out, and a surface that will not let someone leave is worse
 * than the defect it fixes.
 */
describe("the pending state cannot strand the listener", () => {
  it("keeps waiting, and keeps the dismissal away, until the bound expires", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<ArtistOnboarding artists={[]} settled={false} onClose={onClose} />);

    act(() => {
      vi.advanceTimersByTime(ARTIST_ONBOARDING_PENDING_TIMEOUT_MS - 1);
    });
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    // The bound has expired: the surface may be left.
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("bounds the wait by a time a listener can actually wait for", () => {
    // A bound of "a minute" is a bound on paper. This asserts the number is
    // one a listener would accept being held for.
    expect(ARTIST_ONBOARDING_PENDING_TIMEOUT_MS).toBeGreaterThan(0);
    expect(ARTIST_ONBOARDING_PENDING_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it("still shows the artists when the rail settles after the bound expires", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ArtistOnboarding artists={[]} settled={false} onClose={vi.fn()} />,
    );
    act(() => {
      vi.advanceTimersByTime(ARTIST_ONBOARDING_PENDING_TIMEOUT_MS);
    });
    expect(screen.getByTestId("artist-onboarding-empty")).toBeInTheDocument();

    rerender(<ArtistOnboarding artists={ARTISTS} settled onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Aurora Vale/ })).toBeInTheDocument();
    expect(screen.queryByTestId("artist-onboarding-empty")).not.toBeInTheDocument();
  });
});

describe("the first-run gate", () => {
  it("is not seen before it is marked, and is seen afterwards", () => {
    expect(isOnboardingSeen()).toBe(false);
    markOnboardingSeen();
    expect(isOnboardingSeen()).toBe(true);
  });

  it("round-trips through localStorage under a namespaced key", () => {
    markOnboardingSeen();
    expect(localStorage.getItem(ONBOARDING_SEEN_KEY)).toBe("1");
    clearOnboardingSeen();
    expect(localStorage.getItem(ONBOARDING_SEEN_KEY)).toBeNull();
  });

  it("notifies a same-tab subscriber, because `storage` does not fire here", () => {
    /*
     * The `storage` event fires only in *other* tabs, so a same-tab write needs its
     * own notification or `useSyncExternalStore` never re-reads its snapshot. That
     * bug left the dialog open after dismissal; this asserts the mechanism directly
     * rather than relying on the HomeView test to notice it again.
     */
    const onChange = vi.fn();
    const unsubscribe = subscribeToOnboarding(onChange);

    markOnboardingSeen();
    expect(onChange).toHaveBeenCalledTimes(1);

    clearOnboardingSeen();
    expect(onChange).toHaveBeenCalledTimes(2);

    unsubscribe();
    markOnboardingSeen();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("treats an unreadable store as not seen rather than throwing", () => {
    // A locked-down context can throw on access; the listener must still be able
    // to reach the surface rather than being locked out of it forever.
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(isOnboardingSeen()).toBe(false);
    getItem.mockRestore();
  });
});
