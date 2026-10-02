import "fake-indexeddb/auto";
import type { ReactNode } from "react";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TopBar } from "@/components/layout/TopBar";
import type { Track } from "@/data/repositories";
import { SEARCH_DEBOUNCE_MS, useSearchController } from "@/features/search/useSearchController";
import {
  SUGGESTION_DEBOUNCE_MS,
  useSearchSuggestions,
} from "@/features/search/useSearchSuggestions";
import { deriveSuggestions, MAX_SUGGESTIONS } from "@/features/search/suggestions";
import { buildSearchUrl } from "@/lib/searchUrl";
import { resetSearchStore, useSearchStore } from "@/stores/searchStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Search suggestions (M18 tasks 4.1-4.5; spec `search` — "The search field offers
 * suggestions as it is typed" and "Suggestion behaviour leaves the existing search
 * controller unchanged").
 *
 * Three properties are proved here and each needs its own instrument:
 *
 * 1. **Local-only.** The popup is the one surface that fires on every keystroke,
 *    so "no provider request" is asserted by counting `fetch` calls while a
 *    results request *is* in flight — a spy that only ever sees zero because
 *    nothing else in the test talks to the network proves nothing.
 * 2. **Two lanes.** The controller's debounce/abort and the suggestion lane's
 *    debounce/abort are asserted not to touch one another by holding both requests
 *    open at once and watching both signals.
 * 3. **Nothing superseded renders.** Proved with a *deliberately slow first read*
 *    resolved after a fast second one, and asserted positively (what the popup
 *    shows), never with a negative asynchronous assertion — a `waitFor` around a
 *    "must still be empty" expectation passes on the first poll, before the
 *    response that would break it has landed.
 */

const nav = vi.hoisted(() => ({
  q: "",
  pathname: "/",
  back: vi.fn(),
  forward: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => nav.pathname,
  // The URL is read from the store rather than from a frozen string, so the
  // page host's URL -> store adoption is a no-op and typing is not immediately
  // reverted by a deep link that never changed. The store -> URL direction still
  // runs and is asserted through `nav.replace`.
  useSearchParams: () => new URLSearchParams({ q: useSearchStore.getState().query }),
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

const history = vi.hoisted(() => ({ list: vi.fn() }));

// Only the suggestion lane's *read* is controlled here. The controller's local
// fallback stays real, because a stubbed library would make the "both lanes run
// together" test untestable for the wrong reason.
vi.mock("@/features/search/localSearch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/search/localSearch")>()),
  loadSearchHistory: async (limit?: number) => history.list(limit),
}));

// Only the debounce timers are faked so promise/microtask work stays native.
const FAKED_TIMERS = ["setTimeout", "clearTimeout"] as const;

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Karma Police" });

function okResponse(tracks: Track[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ tracks, diagnostics: {} }),
  } as unknown as Response;
}

/** A fetch stub whose calls are settled by the test, so abort races are real. */
function stubDeferredFetch() {
  const calls: Array<{ signal: AbortSignal; resolve(tracks: Track[]): void }> = [];
  const mock = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        calls.push({
          signal: init?.signal as AbortSignal,
          resolve: (tracks) => resolve(okResponse(tracks)),
        });
      }),
  );
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}

/** A deferred search-history read, so a slow first request can be ordered. */
function stubDeferredHistory() {
  const calls: Array<{ limit: number | undefined; resolve(entries: unknown[]): void }> = [];
  history.list.mockImplementation(
    (limit?: number) =>
      new Promise((resolve) => {
        calls.push({ limit, resolve: resolve as (entries: unknown[]) => void });
      }),
  );
  return calls;
}

function historyEntry(query: string, searchedAt: number) {
  return { query, normalizedQuery: query.trim().toLowerCase(), searchedAt };
}

/** Drain promise chains and the IndexedDB turns the controller's fallback uses. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    for (let turn = 0; turn < 12; turn += 1) {
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** Advance past this lane's own debounce. */
async function passSuggestionDebounce(): Promise<void> {
  await advance(SUGGESTION_DEBOUNCE_MS);
  await flush();
}

function field(): HTMLInputElement {
  return screen.getByRole("combobox", { name: "Search" });
}

/**
 * Put DOM focus on the search field.
 *
 * `.focus()` rather than `fireEvent.focus`: the popup opens on real focus, and
 * only a real focus call also moves `document.activeElement`, which is what the
 * "focus returns to the field" assertions read.
 */
function focusField(): void {
  act(() => {
    field().focus();
  });
}

function optionTexts(): string[] {
  return screen.getAllByRole("option").map((option) => option.textContent ?? "");
}

beforeEach(() => {
  resetSearchStore();
  nav.q = "";
  nav.pathname = "/";
  nav.replace.mockClear();
  history.list.mockReset();
  history.list.mockResolvedValue([]);
  vi.useFakeTimers({ toFake: [...FAKED_TIMERS] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("suggestion derivation (task 4.1, pure)", () => {
  it("offers this device's recents for an empty query, newest first", () => {
    const suggestions = deriveSuggestions("", [
      historyEntry("old thing", 1),
      historyEntry("newest thing", 3),
      historyEntry("middle thing", 2),
    ]);

    expect(suggestions.map((entry) => entry.value)).toEqual([
      "newest thing",
      "middle thing",
      "old thing",
    ]);
    expect(suggestions.every((entry) => entry.kind === "recent")).toBe(true);
  });

  it("narrows the recents to what the query implies, completions first", () => {
    const suggestions = deriveSuggestions("kar", [
      historyEntry("Radiohead", 4),
      historyEntry("karmacode", 3),
      historyEntry("Karma Police", 2),
      historyEntry("The Beatles", 1),
    ]);

    expect(suggestions.map((entry) => entry.value)).toEqual(["karmacode", "Karma Police"]);
    expect(suggestions.every((entry) => entry.kind === "refinement")).toBe(true);
  });

  it("keeps the text as it was typed, and never offers the same value twice", () => {
    const suggestions = deriveSuggestions("kar", [
      // Same timestamp, so the given order decides which text survives — the
      // de-duplication is about the identity, not about preferring a spelling.
      historyEntry("Karma Police", 1),
      historyEntry("karma police", 1),
    ]);

    expect(suggestions.map((entry) => entry.value)).toEqual(["Karma Police"]);
  });

  it("bounds the list, and offers nothing for a query this device never searched", () => {
    const many = Array.from({ length: MAX_SUGGESTIONS + 4 }, (_, index) =>
      historyEntry(`query ${index}`, index),
    );

    expect(deriveSuggestions("", many)).toHaveLength(MAX_SUGGESTIONS);
    expect(deriveSuggestions("nothing like this", many)).toEqual([]);
  });
});

describe("the suggestion lane (tasks 4.1 and 4.2)", () => {
  it("reads this device's history and never a provider", async () => {
    // Both lanes are mounted on the same query: the results request is real and
    // in flight, so the single `fetch` call below is attributable to it and the
    // suggestion lane's contribution is a measured zero rather than an absence.
    const { mock: fetchMock } = stubDeferredFetch();
    history.list.mockResolvedValue([historyEntry("Radiohead live", 1)]);

    const { result } = renderHook(() => ({
      suggestions: useSearchSuggestions(true),
      controller: useSearchController(useSearchStore((state) => state.query)),
    }));

    act(() => useSearchStore.getState().setQuery("radio"));
    await advance(SUGGESTION_DEBOUNCE_MS);
    await advance(SEARCH_DEBOUNCE_MS);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1); // the results request, and only it
    expect(history.list).toHaveBeenCalledTimes(1);
    expect(result.current.suggestions.map((entry) => entry.value)).toEqual(["Radiohead live"]);
    expect(result.current.controller.surface.status).toBe("loading"); // results not settled yet
  });

  it("reads nothing until its own debounce has elapsed", async () => {
    // The lane is the one surface that fires on every keystroke, so "it waits" is
    // a cost claim rather than a feel: without the debounce it is a storage read
    // per character, and every rendered assertion would still pass.
    history.list.mockResolvedValue([historyEntry("Radiohead live", 1)]);
    renderHook(() => ({ suggestions: useSearchSuggestions(true) }));

    await advance(SUGGESTION_DEBOUNCE_MS - 1);
    await flush();
    expect(history.list).not.toHaveBeenCalled();

    await advance(1);
    await flush();
    expect(history.list).toHaveBeenCalledTimes(1);
  });

  it("issues nothing at all while the field is unfocused or the list is dismissed", async () => {
    const { rerender } = renderHook(
      ({ enabled }) => ({ suggestions: useSearchSuggestions(enabled) }),
      {
        initialProps: { enabled: false },
      },
    );

    await advance(SUGGESTION_DEBOUNCE_MS * 4);
    await flush();
    expect(history.list).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await passSuggestionDebounce();
    expect(history.list).toHaveBeenCalledTimes(1);
  });

  it("proceeds together with a results request, and neither aborts the other", async () => {
    const fetchStub = stubDeferredFetch();
    const historyCalls = stubDeferredHistory();

    const { result } = renderHook(() => ({
      suggestions: useSearchSuggestions(true),
      controller: useSearchController(useSearchStore((state) => state.query)),
    }));

    act(() => useSearchStore.getState().setQuery("radio"));
    await advance(SUGGESTION_DEBOUNCE_MS);
    await advance(SEARCH_DEBOUNCE_MS);
    await flush();

    // Both requests are open at the same time, with independent signals.
    expect(historyCalls).toHaveLength(1);
    expect(fetchStub.calls).toHaveLength(1);
    const suggestionLaneSettled = result.current.suggestions;
    expect(suggestionLaneSettled).toEqual([]);
    expect(fetchStub.calls[0].signal.aborted).toBe(false);

    // A second keystroke supersedes *both* lanes — each aborting only its own
    // request, which is the independence the requirement names.
    act(() => useSearchStore.getState().setQuery("radiohead"));
    await advance(SUGGESTION_DEBOUNCE_MS);
    await advance(SEARCH_DEBOUNCE_MS);
    await flush();
    expect(historyCalls).toHaveLength(2);
    expect(fetchStub.calls).toHaveLength(2);
    expect(fetchStub.calls[0].signal.aborted).toBe(true); // the controller's own
    expect(fetchStub.calls[1].signal.aborted).toBe(false);

    await act(async () => {
      historyCalls[1].resolve([historyEntry("radiohead live", 1)]);
      fetchStub.calls[1].resolve([trackA]);
    });
    await flush();

    expect(result.current.suggestions.map((entry) => entry.value)).toEqual(["radiohead live"]);
    expect(result.current.controller.surface).toEqual({ status: "results", tracks: [trackA] });
  });

  it("discards a superseded suggestion rather than rendering it", async () => {
    const historyCalls = stubDeferredHistory();
    const { result } = renderHook(() => ({ suggestions: useSearchSuggestions(true) }));

    act(() => useSearchStore.getState().setQuery("kar"));
    await passSuggestionDebounce(); // the first request is now open
    expect(historyCalls).toHaveLength(1);

    act(() => useSearchStore.getState().setQuery("karma"));
    await passSuggestionDebounce(); // the second request supersedes the first
    expect(historyCalls).toHaveLength(2);

    // The *slow first* request answers last. Positive assertion on what the popup
    // offers — never `waitFor` around "nothing appeared", which passes on the
    // first poll, before this resolve has even run.
    await act(async () => {
      historyCalls[1].resolve([historyEntry("Karma Police", 2)]);
    });
    await flush();
    expect(result.current.suggestions.map((entry) => entry.value)).toEqual(["Karma Police"]);

    await act(async () => {
      historyCalls[0].resolve([historyEntry("karmacode", 1), historyEntry("Karma Police", 2)]);
    });
    await flush();
    // The superseded answer neither replaces nor merges into what is on offer.
    expect(result.current.suggestions.map((entry) => entry.value)).toEqual(["Karma Police"]);
  });

  it("treats a cancelled suggestion as nothing rather than as a failure", async () => {
    const historyCalls = stubDeferredHistory();
    const { result, rerender } = renderHook(
      ({ enabled }) => ({
        suggestions: useSearchSuggestions(enabled),
      }),
      { initialProps: { enabled: true } },
    );

    act(() => useSearchStore.getState().setQuery("kar"));
    await passSuggestionDebounce();
    expect(historyCalls).toHaveLength(1);

    // Cancelled mid-request, the way Escape cancels it: the field dismisses the
    // list while the read is still open.
    rerender({ enabled: false });
    await act(async () => {
      historyCalls[0].resolve([historyEntry("Karma Police", 1)]);
    });
    await flush();

    // Nothing rendered, and nothing thrown or reported: a cancelled hint is not an
    // event the listener needs told about.
    expect(result.current.suggestions).toEqual([]);
  });

  it("offers nothing, rather than failing, when the history cannot be read", async () => {
    history.list.mockRejectedValue(new Error("storage unavailable"));
    const { result } = renderHook(() => ({ suggestions: useSearchSuggestions(true) }));

    act(() => useSearchStore.getState().setQuery("kar"));
    await passSuggestionDebounce();

    expect(result.current.suggestions).toEqual([]);
  });
});

describe("the suggestion lane leaves the controller alone (task 4.5)", () => {
  it("returns exactly `{ surface, retry }`", () => {
    const { result } = renderHook(() =>
      useSearchController(useSearchStore((state) => state.query)),
    );
    expect(Object.keys(result.current).sort()).toEqual(["retry", "surface"]);
  });

  it("keeps the two lanes in separate modules, neither importing the other", () => {
    // The strongest available evidence that the controller is unchanged: the two
    // request lanes cannot reach one another because neither file names the other.
    // Every behavioural property of the controller is asserted by
    // `tests/search-controller.test.ts`, which runs untouched.
    //
    // Comments are stripped first: the lane's own documentation *names*
    // `SEARCH_DEBOUNCE_MS` to explain that its debounce is the shorter of the
    // two, and a rule that a comment could fail is a rule about prose.
    const code = (path: string[]) =>
      readFileSync(join(srcDir, ...path), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    const controller = code(["features", "search", "useSearchController.ts"]);
    const lane = code(["features", "search", "useSearchSuggestions.ts"]);

    expect(controller).not.toContain("useSearchSuggestions");
    expect(lane).not.toContain("useSearchController");
    expect(lane).not.toContain("SEARCH_DEBOUNCE_MS");
  });
});

describe("the search field as a combobox (task 4.3)", () => {
  it("declares the combobox roles and exposes the active option", async () => {
    history.list.mockResolvedValue([
      historyEntry("Radiohead live", 1),
      historyEntry("Radiohead", 2),
    ]);
    render(<TopBar />);

    const input = field();
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(input).toHaveAttribute("aria-controls", "search-suggestion-listbox");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // Focusing is what asks for suggestions, so a typed query alone does not open
    // the popup — that is the same requirement as "an empty field offers recents".
    focusField();
    fireEvent.change(input, { target: { value: "radio" } });
    await passSuggestionDebounce();

    expect(screen.getByRole("listbox", { name: "Search suggestions" })).toBeInTheDocument();
    expect(optionTexts()).toEqual(["Radiohead", "Radiohead live"]);
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getAllByRole("option").map((option) => option.getAttribute("aria-selected")),
    ).toEqual(["false", "false"]);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", "search-suggestion-0");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("moves the active option with the arrow keys and wraps at both ends", async () => {
    history.list.mockResolvedValue([
      historyEntry("third", 1),
      historyEntry("second", 2),
      historyEntry("first", 3),
    ]);
    render(<TopBar />);
    const input = field();

    focusField();
    await passSuggestionDebounce();
    expect(optionTexts()).toEqual(["first", "second", "third"]);

    const active = () => input.getAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(active()).toBe("search-suggestion-0");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(active()).toBe("search-suggestion-1");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(active()).toBe("search-suggestion-0");
    fireEvent.keyDown(input, { key: "ArrowUp" }); // wraps to the end
    expect(active()).toBe("search-suggestion-2");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // and back to the start
    expect(active()).toBe("search-suggestion-0");
  });

  it("commits the active suggestion into the field and closes the list", async () => {
    history.list.mockResolvedValue([historyEntry("Karma Police", 1)]);
    render(<TopBar />);
    const input = field();

    focusField();
    fireEvent.change(input, { target: { value: "kar" } });
    await passSuggestionDebounce();
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useSearchStore.getState().query).toBe("Karma Police");
    expect(input).toHaveValue("Karma Police");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("commits on pointer activation without taking focus off the field", async () => {
    history.list.mockResolvedValue([historyEntry("Karma Police", 1)]);
    render(<TopBar />);
    const input = field();

    focusField();
    fireEvent.change(input, { target: { value: "kar" } });
    await passSuggestionDebounce();

    fireEvent.mouseDown(screen.getByRole("option", { name: "Karma Police" }));
    expect(useSearchStore.getState().query).toBe("Karma Police");
    expect(input).toHaveFocus();
  });

  it("closes on Escape and puts focus back on the field", async () => {
    history.list.mockResolvedValue([historyEntry("Karma Police", 1)]);
    render(<TopBar />);
    const input = field();

    focusField();
    fireEvent.change(input, { target: { value: "kar" } });
    await passSuggestionDebounce();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).not.toHaveAttribute("aria-activedescendant");

    // A dismissed list stays closed until the listener asks for it again.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "karma" } });
    await passSuggestionDebounce();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("leaves Enter alone when no suggestion is active", async () => {
    history.list.mockResolvedValue([historyEntry("Karma Police", 1)]);
    render(<TopBar />);
    const input = field();

    focusField();
    fireEvent.change(input, { target: { value: "kar" } });
    await passSuggestionDebounce();

    fireEvent.keyDown(input, { key: "Enter" }); // no active option
    expect(useSearchStore.getState().query).toBe("kar"); // the field's own value stands
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("offers this device's recents for a focused, empty field", async () => {
    history.list.mockResolvedValue([historyEntry("yesterday", 2), historyEntry("last week", 1)]);
    render(<TopBar />);

    focusField();
    await passSuggestionDebounce();

    expect(optionTexts()).toEqual(["yesterday", "last week"]);
  });
});

describe("committing a suggestion syncs the URL exactly as typing does (task 4.5)", () => {
  it("writes the same URL for a committed suggestion as for the same typed query", async () => {
    history.list.mockResolvedValue([historyEntry("night at the opera", 1)]);

    /** Type `value`, settle the URL write, and return the URL it produced. */
    async function urlAfterTyping(value: string): Promise<unknown> {
      const first = render(<TopBar />);
      fireEvent.change(field(), { target: { value } });
      await advance(300);
      const written = nav.replace.mock.calls.at(-1)?.[0];
      first.unmount();
      nav.replace.mockClear();
      return written;
    }

    const typedUrl = await urlAfterTyping("night at the opera");
    expect(typedUrl).toBe(buildSearchUrl("night at the opera"));

    // Committed from the popup: the same store write and the same URL write.
    resetSearchStore();
    render(<TopBar />);
    focusField();
    fireEvent.change(field(), { target: { value: "night at" } });
    await passSuggestionDebounce();
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "Enter" });
    await advance(300);

    expect(nav.replace.mock.calls.at(-1)?.[0]).toBe(typedUrl);
  });
});
