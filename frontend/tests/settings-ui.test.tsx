import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/settings/page";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { DEFAULT_PREFERENCES } from "@/data/repositories";
import { makeEnvelope, makeTrack } from "./helpers/backup-fixtures";
import { resetHistoryStore, useHistoryStore } from "@/stores/historyStore";

/**
 * Tasks 6.1/6.2/6.4: Settings → Data controls integration tests against the
 * real (fake-indexeddb) local-data layer — export download, rejected inputs
 * with unchanged data, replace confirmation gating, scoped clears/reset with
 * two-step inline confirmation, and busy/result feedback.
 */

// The full suite runs many jsdom workers in parallel; this file's first
// render has a cold React/fake-indexeddb start that can exceed the 1s default.
configure({ asyncUtilTimeout: 5000 });

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

let repositories: RepositorySet;

async function seedLocalData(): Promise<void> {
  repositories = await getLocalData();
  await repositories.resetAll();
  await repositories.preferences.set({ languages: ["hi"], onboardingComplete: true });
  await repositories.likedTracks.like(makeTrack("seed-1"), 100);
  const playlist = await repositories.playlists.create({ name: "Seed Mix" });
  await repositories.playlists.addTrack(playlist.id, makeTrack("seed-1"));
  await repositories.listeningHistory.record({
    trackId: "seed-1",
    track: makeTrack("seed-1"),
    playedAt: 111,
    secondsPlayed: 9,
    context: "home",
  });
  await repositories.searchHistory.record("seed query");
  await repositories.session.set({
    queue: [makeTrack("seed-1")],
    queueIndex: 0,
    positionSeconds: 2,
    repeatMode: "off",
    shuffle: false,
    volume: 0.4,
  });
  await repositories.metadataCache.put(makeTrack("seed-1"));
}

beforeEach(async () => {
  // Registered after `seedLocalData`, so the repository is seeded first and the
  // store's in-flight read is then dropped: each test starts from seeded storage
  // and an empty client-side history.
  await seedLocalData();
  resetHistoryStore();
});

afterEach(() => {
  resetHistoryStore();
  vi.restoreAllMocks();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

async function renderSettings(): Promise<void> {
  render(<SettingsPage />);
  // The controls enable once the shared local-data connection is open.
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Export backup" })).toBeEnabled();
  });
}

function pickBackupFile(content: string, name = "backup.json"): void {
  const file = new File([content], name, { type: "application/json" });
  fireEvent.change(screen.getByLabelText("Backup file"), { target: { files: [file] } });
}

describe("Settings data controls", () => {
  it("renders the Data controls with export, import, mode, and cleanup controls", async () => {
    await renderSettings();

    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Data controls" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export backup" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import backup" })).toBeInTheDocument();
    expect(screen.getByLabelText("Backup file")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Merge local data/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Replace local data/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Clear listening history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear search history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset Spotivibe data" })).toBeInTheDocument();
  });

  it("downloads a spotivibe-backup JSON containing only the six backup datasets", async () => {
    const capturedBlobs: Blob[] = [];
    let downloadName = "";
    URL.createObjectURL = ((source: Blob | MediaSource) => {
      if (source instanceof Blob) capturedBlobs.push(source);
      return "blob:settings-ui";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadName = this.download;
    });

    await renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Export backup" }));

    await waitFor(() => expect(capturedBlobs).toHaveLength(1));
    const envelope = JSON.parse(await capturedBlobs[0].text()) as Record<string, unknown>;
    expect(envelope.format).toBe("spotivibe-backup");
    expect(envelope.version).toBe(1);
    expect(envelope.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(typeof envelope.appVersion).toBe("string");
    expect(Object.keys(envelope.data as Record<string, unknown>).sort()).toEqual([
      "history",
      "likedTracks",
      "playlists",
      "preferences",
      "searchHistory",
      "session",
    ]);
    expect(downloadName).toMatch(/^spotivibe-backup-\d{4}-\d{2}-\d{2}\.json$/);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Backup downloaded"));
  });

  it("rejects invalid files with alert feedback that states local data is unchanged", async () => {
    await renderSettings();
    const input = screen.getByLabelText("Backup file");

    fireEvent.change(input, {
      target: { files: [new File(["{not json"], "broken.json", { type: "application/json" })] },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("That file is not valid JSON."),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Existing local data is unchanged.");

    fireEvent.change(input, {
      target: {
        files: [
          new File([JSON.stringify({ format: "other-app", version: 1 })], "foreign.json", {
            type: "application/json",
          }),
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("That file is not a Spotivibe backup."),
    );

    fireEvent.change(input, {
      target: {
        files: [
          new File([JSON.stringify({ format: "spotivibe-backup", version: 99 })], "future.json", {
            type: "application/json",
          }),
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/newer version of Spotivibe/),
    );

    fireEvent.change(input, {
      target: {
        files: [
          new File(
            [
              JSON.stringify({
                format: "spotivibe-backup",
                version: 1,
                exportedAt: "2026-01-01T00:00:00.000Z",
                data: { likedTracks: "nope" },
              }),
            ],
            "malformed.json",
            { type: "application/json" },
          ),
        ],
      },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Backup failed validation/),
    );

    expect(await repositories.likedTracks.list()).toHaveLength(1);
    expect(await repositories.searchHistory.list()).toHaveLength(1);
  });

  it("requires confirmation before a replace import and changes nothing when canceled", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("radio", { name: /Replace local data/ }));
    pickBackupFile(JSON.stringify(makeEnvelope()));

    const row = await screen.findByRole("status");
    expect(row).toHaveTextContent("Replace local data?");
    // Not executed before confirmation.
    expect(await repositories.likedTracks.list()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByTestId("confirm-replace-import")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Canceled — no changes were made.");
    expect(await repositories.likedTracks.list()).toHaveLength(1);
    expect(await repositories.searchHistory.list()).toHaveLength(1);
  });

  it("executes a confirmed replace import and reports the mode with counts", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("radio", { name: /Replace local data/ }));
    pickBackupFile(JSON.stringify(makeEnvelope()));
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: "Replace data" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Import complete (replace mode)"),
    );
    expect(screen.getByRole("status")).toHaveTextContent("2 liked tracks");
    expect(screen.getByRole("status")).toHaveTextContent("1 playlist");

    const liked = await repositories.likedTracks.list();
    expect(liked.map((record) => record.trackId)).toEqual(["t2", "t1"]);
    expect((await repositories.searchHistory.list()).map((entry) => entry.query)).toEqual([
      "beatles",
    ]);
    expect(await repositories.listeningHistory.list()).toHaveLength(1);
    // Derived cache is not a backup dataset and stays untouched by replace.
    expect(await repositories.metadataCache.list()).toHaveLength(1);
  });

  it("applies a merge import immediately without confirmation and keeps local-only records", async () => {
    await renderSettings();
    pickBackupFile(JSON.stringify(makeEnvelope()));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Import complete (merge mode)"),
    );
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

    const liked = await repositories.likedTracks.list();
    expect(liked.map((record) => record.trackId)).toEqual(["t2", "t1", "seed-1"]);
    expect(await repositories.playlists.list()).toHaveLength(2);
    expect(await repositories.searchHistory.list()).toHaveLength(2);
    expect(await repositories.listeningHistory.list()).toHaveLength(2);
  });

  it("clears only listening history after confirmation; cancel leaves it intact", async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Clear listening history" }));
    const row = await screen.findByRole("status");
    expect(row).toHaveTextContent("Clear listening history?");
    expect(await repositories.listeningHistory.list()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Clear history" })).not.toBeInTheDocument(),
    );
    expect(await repositories.listeningHistory.list()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Clear listening history" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Listening history cleared."),
    );

    expect(await repositories.listeningHistory.list()).toEqual([]);
    expect(await repositories.likedTracks.list()).toHaveLength(1);
    expect(await repositories.playlists.list()).toHaveLength(1);
    expect(await repositories.searchHistory.list()).toHaveLength(1);
    expect(await repositories.metadataCache.list()).toHaveLength(1);
  });

  it("clears listening history through the store and leaves no stale events", async () => {
    // The store is the client authority for the newest events, so hydrating it
    // first is what makes the difference observable: a UI that deleted the
    // repository rows behind the store's back would leave the store holding the
    // events the user just asked to remove, and every co-resident consumer
    // (Home's Recently Played) would keep rendering them.
    await useHistoryStore.getState().hydrate();
    expect(useHistoryStore.getState().events).toHaveLength(1);

    const originalClear = useHistoryStore.getState().clear;
    const clearSpy = vi.fn(originalClear);
    useHistoryStore.setState({ clear: clearSpy });

    try {
      await renderSettings();
      fireEvent.click(screen.getByRole("button", { name: "Clear listening history" }));
      await screen.findByRole("status");
      fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("Listening history cleared."),
      );

      // The write went through the store's own action, exactly once.
      expect(clearSpy).toHaveBeenCalledTimes(1);
      expect(await repositories.listeningHistory.list()).toEqual([]);
      // …and the store's events went with it, not stale.
      expect(useHistoryStore.getState().events).toEqual([]);
    } finally {
      useHistoryStore.setState({ clear: originalClear });
    }
  });

  it("clears only search history after confirmation", async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Clear search history" }));
    const row = await screen.findByRole("status");
    expect(row).toHaveTextContent("Clear search history?");

    fireEvent.click(screen.getByRole("button", { name: "Clear search history" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Search history cleared."),
    );

    expect(await repositories.searchHistory.list()).toEqual([]);
    expect(await repositories.likedTracks.list()).toHaveLength(1);
    expect(await repositories.listeningHistory.list()).toHaveLength(1);
    expect(await repositories.preferences.get()).toEqual({
      languages: ["hi"],
      autoplayNext: true,
      reduceMotion: false,
      onboardingComplete: true,
    });
  });

  it("resets every dataset only after confirmation; cancel resets nothing", async () => {
    await renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Reset Spotivibe data" }));
    const row = await screen.findByRole("status");
    expect(row).toHaveTextContent("Reset Spotivibe data?");
    expect(await repositories.likedTracks.list()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Reset everything" })).not.toBeInTheDocument(),
    );
    expect(await repositories.likedTracks.list()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Reset Spotivibe data" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Reset everything" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Spotivibe data reset."),
    );

    expect(await repositories.likedTracks.list()).toEqual([]);
    expect(await repositories.playlists.list()).toEqual([]);
    expect(await repositories.listeningHistory.list()).toEqual([]);
    expect(await repositories.searchHistory.list()).toEqual([]);
    expect(await repositories.session.get()).toBeNull();
    expect(await repositories.metadataCache.list()).toEqual([]);
    expect(await repositories.preferences.get()).toEqual(DEFAULT_PREFERENCES);
  });

  it("reports an apply failure as data-intact and leaves local data unchanged", async () => {
    await renderSettings();
    const originalApplyImport = repositories.applyImport;
    repositories.applyImport = () => Promise.reject(new Error("simulated apply failure"));
    try {
      pickBackupFile(JSON.stringify(makeEnvelope()));
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Import failed. Existing local data is unchanged.",
        ),
      );
      expect(await repositories.likedTracks.list()).toHaveLength(1);
      expect(await repositories.searchHistory.list()).toHaveLength(1);
    } finally {
      repositories.applyImport = originalApplyImport;
    }
  });
});
