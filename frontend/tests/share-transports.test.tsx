import "fake-indexeddb/auto";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalData } from "@/data/localData";
import { ShareButton } from "@/features/sharing/ShareButton";
import { runShare, SHARE_STATUS_TEXT } from "@/features/sharing/useShare";

/**
 * Sharing transports and outcome reporting (M18 tasks 5.1 and 5.2; spec
 * `sharing` — "Sharing works without the Web Share API").
 *
 * **The interesting cases are the unhappy ones.** A missing share API and a
 * *rejected* share are the two ways this feature can go wrong, and the
 * requirement says both take the clipboard fallback rather than becoming an
 * error — because the commonest rejection by far is a listener who dismissed the
 * OS sheet, and an application that answers that with an error is telling them
 * they did something wrong.
 *
 * **"Persists nothing" is asserted with spies, not with a `waitFor`.** A
 * negative asynchronous assertion is worthless here: `waitFor` polls, and its
 * first poll succeeds before any write that would break the expectation has
 * landed, so it would pass on a hook that persisted everything one tick later.
 * The repository's own write methods and `Storage.prototype` are therefore
 * spied, and the assertion is that *no call was made* — which is a claim about
 * the past, not about the future.
 */

const PAYLOAD = { url: "/album/OK%20Computer%20-%20Radiohead", title: "OK Computer" };

/** Install (or remove) `navigator.share` and return the spy. */
function stubShare(implementation?: (data: ShareData) => Promise<void>) {
  const spy = vi.fn(implementation);
  Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: spy });
  return spy;
}

/** Install `navigator.clipboard` and return the `writeText` spy. */
function stubClipboard(writeText?: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: { writeText: spy },
  });
  return spy;
}

function removeNavigator(name: "share" | "clipboard"): void {
  delete (navigator as unknown as Record<string, unknown>)[name];
}

beforeEach(() => {
  removeNavigator("share");
  removeNavigator("clipboard");
});

afterEach(() => {
  vi.restoreAllMocks();
  removeNavigator("share");
  removeNavigator("clipboard");
});

describe("the transport matrix (task 5.1)", () => {
  it("uses the platform share sheet when there is one, with the link and the title", async () => {
    const share = stubShare(async () => undefined);
    const clipboard = stubClipboard();

    await expect(runShare(PAYLOAD)).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: PAYLOAD.title, url: PAYLOAD.url });
    expect(clipboard).not.toHaveBeenCalled();
  });

  it("copies the link when the platform has no share API", async () => {
    const clipboard = stubClipboard();

    await expect(runShare(PAYLOAD)).resolves.toBe("copied");
    expect(clipboard).toHaveBeenCalledWith(PAYLOAD.url);
  });

  it("treats a rejected share as the fallback, never as an error", async () => {
    // The shape a dismissed OS sheet produces.
    stubShare(async () => {
      throw new DOMException("Share canceled", "AbortError");
    });
    const clipboard = stubClipboard();

    await expect(runShare(PAYLOAD)).resolves.toBe("dismissed");
    // The fallback really ran: the rejection is a path, not a dead end.
    expect(clipboard).toHaveBeenCalledWith(PAYLOAD.url);
  });

  it("reports a dismissal as a dismissal even where no clipboard exists", async () => {
    stubShare(async () => {
      throw new Error("nope");
    });

    await expect(runShare(PAYLOAD)).resolves.toBe("dismissed");
  });

  it("reports honestly when neither transport exists", async () => {
    await expect(runShare(PAYLOAD)).resolves.toBe("unavailable");
  });

  it("reports honestly when the clipboard refuses", async () => {
    stubClipboard(async () => {
      throw new Error("clipboard blocked");
    });

    await expect(runShare(PAYLOAD)).resolves.toBe("unavailable");
  });
});

describe("the outcome is always reported (task 5.2)", () => {
  async function shareAndReadStatus(): Promise<string> {
    const view = render(<ShareButton name="OK Computer" url={PAYLOAD.url} title={PAYLOAD.title} />);
    // Nothing has happened yet, so nothing is claimed: no region, no wording.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share OK Computer" }));
    });
    const status = screen.getByRole("status");
    const text = status.textContent ?? "";
    view.unmount();
    return text;
  }

  // The wording is asserted as a **literal**, not against `SHARE_STATUS_TEXT`.
  // Comparing the rendered region to the same map it was rendered from would pass
  // on any copy at all, including copy that reports a cancellation as a failure —
  // which is the one thing this requirement forbids.
  it("reports a shared link", async () => {
    stubShare(async () => undefined);
    expect(await shareAndReadStatus()).toBe("Shared");
  });

  it("reports a copied link", async () => {
    stubClipboard();
    expect(await shareAndReadStatus()).toBe("Link copied");
  });

  it("reports a dismissal as a dismissal, and never as an error", async () => {
    stubShare(async () => {
      throw new DOMException("Share canceled", "AbortError");
    });
    stubClipboard();

    const reported = await shareAndReadStatus();
    expect(reported).toBe("Sharing cancelled");
    // A status, not an alert: nothing on the surface claims something went wrong.
    expect(reported.toLowerCase()).not.toMatch(/error|fail|problem|unable|could not|cannot/);
  });

  it("reports even when there is no transport at all", async () => {
    expect(await shareAndReadStatus()).toBe("Sharing unavailable");
  });

  it("reports when the platform has no API, and copies", async () => {
    const clipboard = stubClipboard();
    expect(await shareAndReadStatus()).toBe("Link copied");
    expect(clipboard).toHaveBeenCalledWith(PAYLOAD.url);
  });

  it("words every outcome, and none of them is an error", () => {
    // The map itself, so a new outcome cannot be added without a word for it and
    // no existing word can drift into describing a cancellation as a failure.
    expect(SHARE_STATUS_TEXT).toEqual({
      idle: "",
      shared: "Shared",
      copied: "Link copied",
      dismissed: "Sharing cancelled",
      unavailable: "Sharing unavailable",
    });
    for (const [status, text] of Object.entries(SHARE_STATUS_TEXT)) {
      if (status === "idle") continue;
      expect(text.trim(), status).not.toBe("");
    }
  });
});

describe("the share action is named and persisted nowhere (tasks 5.2 and 5.5)", () => {
  it("names what it shares", () => {
    render(<ShareButton name="Karma Police" url="/search?q=x" title="Karma Police" />);

    const action = screen.getByRole("button", { name: "Share Karma Police" });
    expect(action.getAttribute("aria-label")).toBe("Share Karma Police");
  });

  it("reaches no store, repository, or persisted record", async () => {
    const repositories = await getLocalData();
    // Every writable local dataset is spied, so "nothing is persisted" is a
    // measured zero across all of them rather than an argument.
    const record = vi.spyOn(repositories.searchHistory, "record");
    const like = vi.spyOn(repositories.likedTracks, "like");
    const create = vi.spyOn(repositories.playlists, "create");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");

    stubShare(async () => undefined);
    render(<ShareButton name="OK Computer" url={PAYLOAD.url} title={PAYLOAD.title} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share OK Computer" }));
    });

    expect(screen.getByRole("status")).toHaveTextContent(SHARE_STATUS_TEXT.shared);
    for (const [label, spy] of [
      ["search history", record],
      ["liked tracks", like],
      ["playlists", create],
      ["localStorage.setItem", setItem],
      ["localStorage.removeItem", removeItem],
    ] as const) {
      expect(spy, `${label} must not be written by sharing`).not.toHaveBeenCalled();
    }
  });
});
