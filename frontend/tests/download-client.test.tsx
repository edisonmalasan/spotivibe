import "fake-indexeddb/auto";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  inFlightDownloadCount,
  resetDownloads,
  useDownloadTrack,
  type DownloadableTrack,
} from "@/features/download/useDownloadTrack";
import {
  DownloadIconButton,
  DownloadOverflowRow,
  downloadLabel,
  useDownloadAffordance,
} from "@/features/download/DownloadControl";
import { OverflowMenu } from "@/components/player/OverflowMenu";
import { trackedDownloadStatuses, useDownloadStore } from "@/stores/downloadStore";

/**
 * The client half of the download feature (M20; spec `download` — "A download is offered where a
 * track is, and only one runs at a time"; "A download leaves no persistent application state";
 * design decisions 7 and 8).
 *
 * Three properties are asserted, and each corresponds to a way the feature could quietly become
 * something else:
 *
 * 1. **Single-flight is joining, not refusing.** A second activation of the same track must await the
 *    *same* promise and see its outcome. Asserting `fetch` was called once is necessary but not
 *    sufficient; the second caller must also learn whether it succeeded.
 * 2. **No percentage, and no persistent state.** There is no progress figure anywhere in the
 *    rendered output, and the store holds four strings per track — no Blob, no object URL, no bytes.
 *    Asserting the store's *shape* is what makes "leaves no persistent state" a claim rather than a
 *    comment.
 * 3. **One wording for all four surfaces.** `downloadLabel` is the single source, and the rendered
 *    label is asserted against it, so a surface cannot read "Downloading" as "Saving".
 */

const TRACK: DownloadableTrack = {
  id: "yt:dQw4w9WgXcQ",
  providerId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
};

function successResponse(body = "audio"): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "audio/webm",
      "Content-Disposition": 'attachment; filename="Never-Gonna-Give-You-Up.webm"',
    },
  });
}

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

/**
 * A fetch that resolves only when the test releases it, so single-flight is observable.
 *
 * The request URL is recorded in a plain array rather than read back off `spy.mock.calls`, because a
 * zero-parameter mock types its call tuples as `[]` and every index read off it is a type error. The
 * recording also states the argument type, which is the thing the assertions below actually care
 * about — that the URL named the track the hook was bound to.
 */
function deferredFetch() {
  let release!: (value: Response) => void;
  let fail!: (reason: unknown) => void;
  const response = new Promise<Response>((resolve) => (release = resolve));
  const failure = new Promise<never>((_, reject) => (fail = reject));
  const requested: string[] = [];
  const spy = vi.fn((input: RequestInfo | URL) => {
    requested.push(String(input));
    return Promise.race([response, failure]);
  });
  return { spy, release, fail, requested };
}

beforeEach(() => {
  resetDownloads();
  useDownloadStore.setState({ statuses: {}, errors: {} });
  URL.createObjectURL = vi.fn(() => "blob:spotivibe/test") as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  resetDownloads();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the store holds status and nothing else", () => {
  it("records a short string per track and no bytes", () => {
    // The claim "a download leaves no persistent application state" is true of the store's *shape*.
    // A Blob or an object URL here would be a managed offline library wearing a status map's
    // clothes, and it would survive a reload.
    useDownloadStore.getState().markBusy("a");
    useDownloadStore.getState().markFailed("b", "nope");
    useDownloadStore.getState().markDone("c");
    const state = useDownloadStore.getState();
    expect(trackedDownloadStatuses(state)).toBe(3);
    for (const value of Object.values(state.statuses)) {
      expect(["idle", "busy", "done", "failed"]).toContain(value);
    }
    for (const message of Object.values(state.errors)) {
      expect(typeof message).toBe("string");
    }
    expect(Object.keys(state)).toEqual([
      "statuses",
      "errors",
      "markBusy",
      "markDone",
      "markFailed",
      "clear",
    ]);
  });

  it("clears a previous failure when a retry starts and when it succeeds", () => {
    const store = useDownloadStore.getState();
    store.markFailed("a", "first attempt failed");
    expect(useDownloadStore.getState().errors.a).toBe("first attempt failed");
    store.markBusy("a");
    expect(useDownloadStore.getState().errors.a).toBeUndefined();
    store.markFailed("a", "second attempt failed");
    store.markDone("a");
    expect(useDownloadStore.getState().errors.a).toBeUndefined();
    expect(useDownloadStore.getState().statuses.a).toBe("done");
  });

  it("removes an entry entirely on clear, rather than setting it to a status", () => {
    useDownloadStore.getState().markBusy("a");
    expect(trackedDownloadStatuses(useDownloadStore.getState())).toBe(1);
    useDownloadStore.getState().clear("a");
    expect(trackedDownloadStatuses(useDownloadStore.getState())).toBe(0);
    expect(useDownloadStore.getState().errors).toEqual({});
  });
});

describe("useDownloadTrack - single-flight", () => {
  it("joins a second activation to the first transfer rather than starting another", async () => {
    const { spy, release } = deferredFetch();
    vi.stubGlobal("fetch", spy);
    const { result } = renderHook(() => useDownloadTrack(TRACK));

    const first = result.current.download();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const second = result.current.download();
    await waitFor(() => expect(result.current.status).toBe("busy"));

    // Two callers, one request. This is the requirement: a track shown twice on one screen is one
    // download with two views of it, not two downloads.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(inFlightDownloadCount()).toBe(1);

    release(successResponse());
    await Promise.all([first, second]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("lets the joining caller learn the outcome, rather than telling it nothing", async () => {
    // The other half of joining. A "not now" boolean would give the second caller no outcome at all,
    // which is why this module keys a promise rather than a flag.
    const { spy, release } = deferredFetch();
    vi.stubGlobal("fetch", spy);
    const { result } = renderHook(() => useDownloadTrack(TRACK));
    const first = result.current.download();
    const second = result.current.download();
    release(successResponse());
    await Promise.all([first, second]);
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.error).toBeNull();
  });

  it("propagates a failure to the joining caller, because it awaited the same promise", async () => {
    const { spy, release } = deferredFetch();
    vi.stubGlobal("fetch", spy);
    const { result } = renderHook(() => useDownloadTrack(TRACK));
    const first = result.current.download();
    const second = result.current.download();
    release(Response.json({ error: { code: "upstream_unavailable" } }, { status: 502 }));
    await Promise.all([first, second]);
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.error).toMatch(/upstream_unavailable/);
  });

  it("keys single-flight by track id, so two tracks do not share a transfer", async () => {
    const { spy, release, requested } = deferredFetch();
    vi.stubGlobal("fetch", spy);
    const first = renderHook(() => useDownloadTrack(TRACK));
    const other: DownloadableTrack = { ...TRACK, id: "yt:other", providerId: "aaaaaaaaaaa" };
    const second = renderHook(() => useDownloadTrack(other));
    const a = first.result.current.download();
    const b = second.result.current.download();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(inFlightDownloadCount()).toBe(2);
    // Each asked for the track it is bound to. A hook that could be handed a different track would
    // make the second caller download the first track's file.
    expect(requested.some((url) => url.includes("dQw4w9WgXcQ"))).toBe(true);
    expect(requested.some((url) => url.includes("aaaaaaaaaaa"))).toBe(true);
    release(successResponse());
    await Promise.all([a, b]);
  });

  it("frees the key once the transfer settles, so a retry is a real second download", async () => {
    const { spy, release } = deferredFetch();
    vi.stubGlobal("fetch", spy);
    const { result } = renderHook(() => useDownloadTrack(TRACK));
    const first = result.current.download();
    release(successResponse());
    await first;
    expect(inFlightDownloadCount()).toBe(0);
    expect(spy, "the first attempt made exactly one request").toHaveBeenCalledTimes(1);
    const secondFetch = vi.fn(async () => successResponse());
    vi.stubGlobal("fetch", secondFetch);
    await result.current.download();
    expect(
      secondFetch,
      "a retry after success must not be swallowed by the single-flight key",
    ).toHaveBeenCalledTimes(1);
  });

  it("frees the key even when the transfer failed", async () => {
    // A key that leaked on the failure path would make "Retry download" a no-op forever, and the
    // symptom — a button that does nothing — would look like a browser problem.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const { result } = renderHook(() => useDownloadTrack(TRACK));
    await result.current.download();
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(inFlightDownloadCount()).toBe(0);
  });

  it("never caches the request, and always passes an abort signal", async () => {
    // The request options are recorded rather than read off the mock's call tuple, so the assertion
    // is about what the hook actually sent instead of about how vitest types a call.
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), init });
      return Promise.resolve(successResponse());
    });
    vi.stubGlobal("fetch", spy);
    const { result } = renderHook(() => useDownloadTrack(TRACK));
    await result.current.download();
    expect(seen[0]?.url).toContain("/api/download/dQw4w9WgXcQ");
    expect(seen[0]?.init?.cache).toBe("no-store");
    // And the timeout is a real backstop rather than an omitted option.
    expect(seen[0]?.init?.signal).toBeDefined();
  });

  it("gives every failure a message a person can read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const { result } = renderHook(() => useDownloadTrack(TRACK));
    await result.current.download();
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current.error).toMatch(/500/);

    // A rejection with no message still produces something, because an empty error slot renders as
    // a silent failure with no way to retry.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error(""))),
    );
    const second = renderHook(() => useDownloadTrack({ ...TRACK, id: "yt:b" }));
    await second.result.current.download();
    await waitFor(() => expect(second.result.current.status).toBe("failed"));
    expect(second.result.current.error).toBe("The download could not be completed.");
  });
});

describe("downloadLabel", () => {
  it("has exactly one wording per status", () => {
    expect(downloadLabel("idle")).toBe("Download");
    expect(downloadLabel("busy")).toBe(downloadLabel("busy"));
    expect(downloadLabel("busy")).toMatch(/^Downloading/);
    expect(downloadLabel("done")).toBe("Downloaded");
    expect(downloadLabel("failed")).toBe("Retry download");
    // The label must be derived from the module, not retyped here, or this suite would be asserting
    // a copy that could drift from the one four surfaces actually render.
    expect(downloadLabel("busy")).toMatch(/^Downloading/);
  });

  it("never states a percentage", () => {
    // ROADMAP 21.5's non-goal, enforced where the words are chosen rather than by review. The size
    // behind any such figure is an estimate, so a percentage computed from it would be a confident
    // number derived from a guess.
    for (const status of ["idle", "busy", "done", "failed"] as const) {
      expect(downloadLabel(status), status).not.toMatch(/\d+\s*%|percent|remaining/i);
    }
  });
});

describe("useDownloadAffordance", () => {
  it("is disabled, not absent, when there is no track to download", () => {
    // The hook cannot be skipped, so an absent track is a value that can never be downloaded. What
    // matters is that activating it does nothing at all.
    const spy = vi.fn(async () => successResponse());
    vi.stubGlobal("fetch", spy);
    const { result } = renderHook(() => useDownloadAffordance(null));
    expect(result.current.disabled).toBe(true);
    result.current.run();
    expect(spy, "an affordance with no track must not start a download").not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });
});

describe("DownloadIconButton", () => {
  it("renders nothing when there is no track, matching how Now Playing omits other controls", () => {
    const { container } = render(<DownloadIconButton track={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("announces its status through one accessible name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => successResponse()),
    );
    render(<DownloadIconButton track={TRACK} />);
    const button = await screen.findByRole("button", { name: downloadLabel("idle") });
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: downloadLabel("busy") })).toHaveAttribute(
        "aria-busy",
        "true",
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: downloadLabel("done") })).toBeTruthy(),
    );
  });

  it("reports a failure in a polite live region rather than in a dialog", async () => {
    // A download is a background action the listener started; a modal would interrupt whatever they
    // were doing to tell them about something they can simply try again.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { code: "no_suitable_format" } }, { status: 502 })),
    );
    render(<DownloadIconButton track={TRACK} />);
    fireEvent.click(await screen.findByRole("button", { name: downloadLabel("idle") }));
    // A bare polite live region, deliberately **not** `role="status"`. `role="status"` is the
    // surface-level role, and Now Playing's radio alert already owns it; two of them on one page
    // would say "there are two page states" when there is one state and one control message.
    const region = await waitFor(() => {
      const found = document.querySelector('[aria-live="polite"].sr-only');
      expect(found, "the failure must be announced politely").toBeTruthy();
      return found!;
    });
    expect(region).not.toHaveAttribute("role", "status");
    await waitFor(() => expect(region.textContent).toMatch(/no_suitable_format/));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: downloadLabel("failed") })).toBeTruthy(),
    );
  });

  it("shows no percentage and no progress figure at any point", async () => {
    // The rendered surface is where a progress bar would appear, so this is the assertion that
    // ROADMAP 21.5's non-goal survives a future "just add a percentage" edit.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => successResponse()),
    );
    const { container } = render(<DownloadIconButton track={TRACK} />);
    fireEvent.click(screen.getByRole("button", { name: downloadLabel("idle") }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: downloadLabel("done") })).toBeTruthy(),
    );
    expect(container.textContent).not.toMatch(/\d+\s*%/);
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.querySelector("progress")).toBeNull();
  });
});

describe("DownloadOverflowRow", () => {
  it("is a menu item so the menu's own semantics apply", () => {
    render(<DownloadOverflowRow track={TRACK} />);
    const row = screen.getByRole("menuitem", { name: downloadLabel("idle") });
    expect(row.tagName).toBe("BUTTON");
    expect(row).toHaveAttribute("type", "button");
  });

  it("is disabled and does nothing when there is no track", () => {
    const spy = vi.fn(async () => successResponse());
    vi.stubGlobal("fetch", spy);
    render(<DownloadOverflowRow track={null} />);
    const row = screen.getByRole("menuitem", { name: downloadLabel("idle") });
    expect(row).toBeDisabled();
    expect(row).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(row);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("OverflowMenu", () => {
  const items = [
    { label: "Add to queue", onSelect: vi.fn() },
    { label: "Go to artist", onSelect: vi.fn() },
  ];

  beforeEach(() => {
    items.forEach((item) => item.onSelect.mockClear());
  });

  it("is closed until activated, and announces its state", () => {
    render(<OverflowMenu label="More options" items={items} />);
    const trigger = screen.getByRole("button", { name: "More options" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on click and moves focus to the first row", () => {
    // Focus moving to the first row is what makes Escape and Tab start from inside the menu rather
    // than from the trigger.
    render(<OverflowMenu label="More options" items={items} />);
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByRole("button", { name: "More options" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const rows = screen.getAllByRole("menuitem");
    expect(rows).toHaveLength(2);
    expect(document.activeElement).toBe(rows[0]);
  });

  it("renders declarative rows in the caller's order", () => {
    // Ordering is the caller's decision, which is why a store-backed row is an *entry* in `items`
    // rather than always-last children.
    render(
      <OverflowMenu
        label="More options"
        items={[items[0]!, { label: "Download", onSelect: vi.fn() }, items[1]!]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getAllByRole("menuitem").map((row) => row.textContent)).toEqual([
      "Add to queue",
      "Download",
      "Go to artist",
    ]);
  });

  it("renders children after the declarative rows", () => {
    render(
      <OverflowMenu label="More options" items={[items[0]!]}>
        <DownloadOverflowRow track={TRACK} />
      </OverflowMenu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getAllByRole("menuitem").map((row) => row.textContent)).toEqual([
      "Add to queue",
      downloadLabel("idle"),
    ]);
  });

  it("runs a row's action and closes", () => {
    const onSelect = vi.fn();
    render(<OverflowMenu label="More options" items={[{ label: "Go to artist", onSelect }]} />);
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Go to artist" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not run a disabled row", () => {
    const onSelect = vi.fn();
    render(
      <OverflowMenu
        label="More options"
        items={[{ label: "Go to artist", onSelect, disabled: true }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    const row = screen.getByRole("menuitem", { name: "Go to artist" });
    expect(row).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(row);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(<OverflowMenu label="More options" items={items} />);
    const trigger = screen.getByRole("button", { name: "More options" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on an outside press and leaves focus where the pointer put it", () => {
    // A pointer user clicked somewhere else; yanking focus back to the trigger would be hostile.
    render(
      <div>
        <OverflowMenu label="More options" items={items} />
        <button type="button">elsewhere</button>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    const outside = screen.getByRole("button", { name: "elsewhere" });
    fireEvent.mouseDown(outside);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "More options" }));
  });

  it("does not close when the press is inside the menu or the trigger", () => {
    render(<OverflowMenu label="More options" items={items} />);
    const trigger = screen.getByRole("button", { name: "More options" });
    fireEvent.click(trigger);
    fireEvent.mouseDown(trigger);
    expect(screen.queryByRole("menu")).not.toBeNull();
    fireEvent.mouseDown(screen.getAllByRole("menuitem")[0]!);
    expect(screen.queryByRole("menu")).not.toBeNull();
  });

  it("toggles closed on a second activation of the trigger", () => {
    render(<OverflowMenu label="More options" items={items} />);
    const trigger = screen.getByRole("button", { name: "More options" });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a custom row's activation too, without being handed a close function", () => {
    // The dismissal is delegated to the menu container precisely so a store-backed row gets the same
    // behaviour without being coupled to the shell.
    render(
      <OverflowMenu
        label="More options"
        items={[items[0]!, { element: <DownloadOverflowRow track={TRACK} /> }, items[1]!]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "More options" });
    fireEvent.click(trigger);
    expect(screen.getAllByRole("menuitem").map((row) => row.textContent)).toEqual([
      "Add to queue",
      downloadLabel("idle"),
      "Go to artist",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Go to artist" }));
    expect(items[1]!.onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes when a custom row is activated by keyboard, and restores focus", () => {
    render(
      <OverflowMenu
        label="More options"
        items={[items[0]!, { element: <DownloadOverflowRow track={TRACK} /> }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "More options" });
    fireEvent.click(trigger);
    const row = screen.getByRole("menuitem", { name: downloadLabel("idle") });
    // `detail: 0` is the reliable discriminator between a keyboard activation (Enter or Space on a
    // button) and a pointer one.
    fireEvent.click(row, { detail: 0 });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("names the menu after its trigger, so it is not an unnamed landmark", () => {
    render(<OverflowMenu label="More options for Blue Monday" items={items} />);
    fireEvent.click(screen.getByRole("button", { name: "More options for Blue Monday" }));
    expect(screen.getByRole("menu")).toHaveAccessibleName("More options for Blue Monday");
  });

  it("lets a caller name the menu separately from its trigger", () => {
    // `ResultMenu` has always said "Actions for <track>" on the menu and "More options for <track>"
    // on the trigger, and M5's suite asserts both strings. Sharing the shell must not have renamed
    // a landmark a screen-reader user already navigates by.
    render(
      <OverflowMenu
        label="More options for Blue Monday"
        menuLabel="Actions for Blue Monday"
        items={items}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More options for Blue Monday" }));
    expect(screen.getByRole("menu")).toHaveAccessibleName("Actions for Blue Monday");
  });

  it("renders no rows at all without inventing any", () => {
    render(<OverflowMenu label="More options" items={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });
});
