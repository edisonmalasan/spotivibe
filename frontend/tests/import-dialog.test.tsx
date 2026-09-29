import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/data/repositories";
import { getLocalData, type RepositorySet } from "@/data/localData";
import {
  IMPORT_ERROR_MESSAGES,
  ImportPlaylistDialog,
} from "@/features/playlists/ImportPlaylistDialog";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Import client coverage (task 4.1, design §10): the dialog's state machine
 * (idle → resolving → success/error), the designed error-message mapping,
 * resolution failures leaving the playlist list untouched, success feedback
 * with imported/skipped/truncated counts, detail-route navigation, and the
 * dialog a11y contract — all against the real fake-indexeddb repositories.
 */

// IndexedDB round-trips plus the success-navigation beat can exceed the 1s
// default on a cold jsdom worker (same reason as settings-ui.test.tsx).
configure({ asyncUtilTimeout: 5000 });

const nav = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => nav }));

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Karma Police" });
const trackB = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Weird Fishes" });
const resolvedTracks: Track[] = [trackA, trackB];

const SOURCE_REF = "PL_HAPPY_01";

function successBody(
  overrides: {
    title?: string;
    tracks?: Track[];
    skipped?: number;
    truncated?: boolean;
  } = {},
): unknown {
  return {
    playlist: {
      title: "Radiohead Essentials",
      tracks: resolvedTracks,
      skipped: 0,
      ...overrides,
    },
    // Diagnostics are never read by the client (search safety rule).
    diagnostics: { tiers: [{ tier: "ytmusic", outcome: "success" }] },
  };
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function errorResponse(status: number, code: string): Response {
  return { ok: false, status, json: async () => ({ error: code }) } as unknown as Response;
}

function brokenErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error("Body was not JSON.");
    },
  } as unknown as Response;
}

let repositories: RepositorySet;

beforeEach(async () => {
  resetLibraryStore();
  nav.push.mockClear();
  repositories = await getLocalData();
  await repositories.resetAll();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function typeRef(value: string): HTMLElement {
  const input = screen.getByLabelText("YouTube playlist URL or ID");
  fireEvent.change(input, { target: { value } });
  return input;
}

function submitReference(value: string): void {
  typeRef(value);
  fireEvent.click(screen.getByRole("button", { name: "Import" }));
}

/** Opener stand-in: owns focus return like the search menu's dialog hosts. */
function ImportHarness() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => {
          setOpen(true);
        }}
      >
        Import playlist
      </button>
      {open && (
        <ImportPlaylistDialog
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

describe("import dialog (task 4.1)", () => {
  it("stays idle until a reference is typed and an empty submission sends no request", () => {
    const fetchMock = vi.fn(async () => okResponse(successBody()));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportPlaylistDialog onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();

    // Quick non-empty check: a programmatic submit must not hit the network.
    const input = screen.getByLabelText("YouTube playlist URL or ID");
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: SOURCE_REF } });
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("runs idle → resolving → success: persists in order, reports counts, navigates", async () => {
    let settleFetch!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      settleFetch = resolve;
    });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();
    render(<ImportPlaylistDialog onClose={onClose} />);

    const input = typeRef(SOURCE_REF);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    // Resolving: request in flight, controls inert, single status message.
    expect(await screen.findByRole("status")).toHaveTextContent("Resolving playlist…");
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(`/api/playlist?src=${SOURCE_REF}`, expect.anything());

    settleFetch(okResponse(successBody({ skipped: 2, truncated: true })));

    // Success feedback: imported + skipped + truncated (design-literal cap note,
    // independent of the small fixture's track count).
    expect(await screen.findByText("Imported 2 songs")).toBeInTheDocument();
    expect(screen.getByText("2 unavailable entries skipped")).toBeInTheDocument();
    expect(screen.getByText("First 500 songs imported")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Persisted: named from the resolved playlist, tracks in source order.
    const stored = await repositories.playlists.list();
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe("Radiohead Essentials");
    expect(stored[0].tracks.map((entry) => entry.track.id)).toEqual([trackA.id, trackB.id]);

    // Navigation to the new detail route follows the readable feedback beat.
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/playlist/${stored[0].id}`));
    expect(onClose).toHaveBeenCalled();
  });

  const errorCases: Array<[string, () => Response | Promise<Response>, string]> = [
    [
      "400 invalid input",
      () => errorResponse(400, "invalid_input"),
      IMPORT_ERROR_MESSAGES.invalid_input,
    ],
    [
      "404 private playlist",
      () => errorResponse(404, "playlist_unavailable"),
      IMPORT_ERROR_MESSAGES.playlist_unavailable,
    ],
    [
      "503 upstream outage",
      () => errorResponse(503, "upstream_unavailable"),
      IMPORT_ERROR_MESSAGES.upstream_unavailable,
    ],
    [
      "503 with a non-JSON body falls back to the status",
      () => brokenErrorResponse(503),
      IMPORT_ERROR_MESSAGES.upstream_unavailable,
    ],
    [
      "an error body without a known code falls back to the status",
      () => errorResponse(404, "mystery"),
      IMPORT_ERROR_MESSAGES.playlist_unavailable,
    ],
    [
      "fetch rejects (offline)",
      () => Promise.reject(new TypeError("Failed to fetch")),
      IMPORT_ERROR_MESSAGES.network,
    ],
  ];

  it.each(errorCases)(
    "%s → surfaces the mapped message without creating a playlist",
    async (_label, makeResponse, message) => {
      vi.stubGlobal("fetch", vi.fn(makeResponse));
      render(<ImportPlaylistDialog onClose={vi.fn()} />);

      submitReference("PL_FAILED1");

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      // Error → retryable: the form is live again for another attempt.
      expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
      expect(await repositories.playlists.list()).toHaveLength(0);
      expect(nav.push).not.toHaveBeenCalled();
    },
  );

  it("leaves the playlist list untouched when resolution fails", async () => {
    const existing = await repositories.playlists.create({ name: "Road Trip" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(404, "playlist_unavailable")),
    );
    render(<ImportPlaylistDialog onClose={vi.fn()} />);

    submitReference("PL_PRIVATE1");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      IMPORT_ERROR_MESSAGES.playlist_unavailable,
    );
    expect((await repositories.playlists.list()).map((playlist) => playlist.id)).toEqual([
      existing.id,
    ]);
    await useLibraryStore.getState().hydrate();
    expect(useLibraryStore.getState().playlists.map((playlist) => playlist.id)).toEqual([
      existing.id,
    ]);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("reports a local write failure and leaves no partial playlist behind", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse(successBody())),
    );
    vi.spyOn(useLibraryStore.getState(), "createPlaylistFromResolved").mockRejectedValueOnce(
      new Error("disk full"),
    );
    render(<ImportPlaylistDialog onClose={vi.fn()} />);

    submitReference("PL_WRITEFAIL");

    expect(await screen.findByRole("alert")).toHaveTextContent(IMPORT_ERROR_MESSAGES.local_write);
    expect(await repositories.playlists.list()).toHaveLength(0);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("recovers from a failed attempt: error → resolving → success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(503, "upstream_unavailable"))
      .mockResolvedValueOnce(okResponse(successBody()));
    vi.stubGlobal("fetch", fetchMock);
    render(<ImportPlaylistDialog onClose={vi.fn()} />);

    const input = typeRef("PL_RETRY_01");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      IMPORT_ERROR_MESSAGES.upstream_unavailable,
    );
    expect(input).toHaveValue("PL_RETRY_01"); // the entered reference survives

    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Imported 2 songs")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await repositories.playlists.list()).toHaveLength(1);
  });

  it("honors the dialog a11y contract: role, focus entry, dismissal, focus return", async () => {
    render(<ImportHarness />);
    const trigger = screen.getByRole("button", { name: "Import playlist" });

    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Import playlist" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus(); // keyboard users land inside the surface

    // Escape dismisses and the opener returns focus to its trigger.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    // Backdrop press dismisses (focus follows the pointer back to the trigger).
    fireEvent.click(trigger);
    const reopened = await screen.findByRole("dialog", { name: "Import playlist" });
    fireEvent.mouseDown(reopened.parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    // The Close control dismisses the same way.
    fireEvent.click(trigger);
    const third = await screen.findByRole("dialog", { name: "Import playlist" });
    fireEvent.click(within(third).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
