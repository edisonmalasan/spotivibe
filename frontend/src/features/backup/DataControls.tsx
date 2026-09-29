"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/design-system/Button";
import { ErrorState } from "@/components/design-system/ErrorState";
import {
  APP_VERSION,
  collectLocalData,
  planMerge,
  planReplace,
  prepareImport,
  serializeBackup,
  type BackupEnvelope,
  type ImportMode,
  type ImportStats,
  type PrepareFailure,
} from "@/data/backup";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { useHistoryStore } from "@/stores/historyStore";

/**
 * Settings → Data controls: backup export, validated import with merge/replace
 * modes, and the scoped cleanup operations. Every destructive action runs
 * through the design.md two-step inline confirmation (a `role="status"` row
 * with Cancel / Confirm; only Confirm executes). Results report through
 * `role="status"` / `role="alert"` live regions, and every failure states that
 * existing local data is unchanged. Depends on repository interfaces only.
 *
 * **Clearing listening history goes through `historyStore`**, not straight to
 * the repository. The store is the client authority for the newest events, and
 * it already wraps the same repository call: clearing behind its back would
 * leave the store holding events that no longer exist, so a co-resident consumer
 * (Home's Recently Played) would keep showing a history the user just deleted.
 * Clearing through the store keeps the write and the state in step, and still
 * reports its own failure.
 */

type BusyOperation = "export" | "import" | "clear-history" | "clear-search" | "reset";
type ConfirmableAction = "replace-import" | "clear-history" | "clear-search" | "reset";
type Feedback = { tone: "status" | "alert"; message: string };

const CONFIRMATIONS: Record<ConfirmableAction, { description: string; confirmLabel: string }> = {
  "replace-import": {
    description:
      "Replace local data? This overwrites your liked tracks, playlists, listening history, search history, preferences, and queue with the backup.",
    confirmLabel: "Replace data",
  },
  "clear-history": {
    description:
      "Clear listening history? This removes every listening history entry on this device.",
    confirmLabel: "Clear history",
  },
  "clear-search": {
    description: "Clear search history? This removes every saved search on this device.",
    confirmLabel: "Clear search history",
  },
  reset: {
    description: "Reset Spotivibe data? This clears every Spotivibe dataset on this device.",
    confirmLabel: "Reset everything",
  },
};

const UNCHANGED_SUFFIX = " Existing local data is unchanged.";

function describeFailure(error: PrepareFailure): string {
  switch (error.kind) {
    case "invalid-json":
      return "That file is not valid JSON.";
    case "invalid-format":
      return "That file is not a Spotivibe backup.";
    case "unsupported-version":
      return error.message;
    case "invalid-records":
      return error.issues.length > 0
        ? `Backup failed validation — ${error.issues[0]}`
        : "Backup contents failed validation.";
  }
}

function describeSuccess(mode: ImportMode, stats: ImportStats): string {
  const counts = [
    `${stats.likedTracks} liked track${stats.likedTracks === 1 ? "" : "s"}`,
    `${stats.playlists} playlist${stats.playlists === 1 ? "" : "s"}`,
    `${stats.history} listening history entr${stats.history === 1 ? "y" : "ies"}`,
    `${stats.searchHistory} search entr${stats.searchHistory === 1 ? "y" : "ies"}`,
  ];
  if (stats.preferences > 0) counts.push("preferences updated");
  if (stats.session > 0) counts.push("session updated");
  return `Import complete (${mode} mode): ${counts.join(", ")}.`;
}

function downloadJson(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function DataControls() {
  const [repositories, setRepositories] = useState<RepositorySet | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [busy, setBusy] = useState<BusyOperation | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [pending, setPending] = useState<ConfirmableAction | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const envelopeRef = useRef<BackupEnvelope | null>(null);

  useEffect(() => {
    let alive = true;
    getLocalData()
      .then((opened) => {
        if (alive) setRepositories(opened);
      })
      .catch(() => {
        if (alive) setStorageError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Move focus to a freshly opened confirmation row (design.md decision 8).
  useEffect(() => {
    if (pending) confirmationRef.current?.focus();
  }, [pending]);

  function handleRetry() {
    setStorageError(false);
    getLocalData()
      .then(setRepositories)
      .catch(() => setStorageError(true));
  }

  function openConfirmation(action: ConfirmableAction) {
    setFeedback(null);
    setPending(action);
  }

  function handleCancel() {
    setPending(null);
    envelopeRef.current = null;
    setFeedback({ tone: "status", message: "Canceled — no changes were made." });
  }

  async function runAction(
    key: BusyOperation,
    startMessage: string,
    operation: () => Promise<void>,
    successMessage: string,
    failureMessage: string,
  ): Promise<void> {
    setBusy(key);
    setFeedback({ tone: "status", message: startMessage });
    try {
      await operation();
      setFeedback({ tone: "status", message: successMessage });
    } catch {
      setFeedback({ tone: "alert", message: failureMessage });
    } finally {
      setBusy(null);
    }
  }

  async function applyImportNow(mode: ImportMode, envelope: BackupEnvelope): Promise<void> {
    if (!repositories) return;
    setBusy("import");
    setFeedback({ tone: "status", message: `Importing backup (${mode} mode)…` });
    try {
      const plan =
        mode === "merge"
          ? planMerge(envelope, await collectLocalData(repositories))
          : planReplace(envelope);
      await repositories.applyImport(plan);
      setFeedback({ tone: "status", message: describeSuccess(mode, plan.stats) });
    } catch {
      // The applier's single transaction aborts on any error, so a failed
      // apply leaves the pre-import database exactly as it was.
      setFeedback({
        tone: "alert",
        message: "Import failed. Existing local data is unchanged.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirm(): Promise<void> {
    if (!repositories || !pending) return;
    const action = pending;
    setPending(null);
    setFeedback(null);
    if (action === "replace-import") {
      const envelope = envelopeRef.current;
      envelopeRef.current = null;
      if (envelope) await applyImportNow("replace", envelope);
      return;
    }
    if (action === "clear-history") {
      await runAction(
        "clear-history",
        "Clearing listening history…",
        // The store wraps the same repository call and re-reads the newest
        // events, so nothing keeps rendering the events this delete removes.
        () => useHistoryStore.getState().clear(),
        "Listening history cleared.",
        "Could not clear listening history — your data is unchanged.",
      );
      return;
    }
    if (action === "clear-search") {
      await runAction(
        "clear-search",
        "Clearing search history…",
        () => repositories.searchHistory.clear(),
        "Search history cleared.",
        "Could not clear search history — your data is unchanged.",
      );
      return;
    }
    await runAction(
      "reset",
      "Resetting Spotivibe data…",
      () => repositories.resetAll(),
      "Spotivibe data reset.",
      "Could not reset Spotivibe data — your data is unchanged.",
    );
  }

  async function handleExport(): Promise<void> {
    if (!repositories) return;
    setBusy("export");
    setFeedback({ tone: "status", message: "Exporting backup…" });
    try {
      const envelope = serializeBackup(await collectLocalData(repositories), {
        appVersion: APP_VERSION,
      });
      downloadJson(
        `spotivibe-backup-${envelope.exportedAt.slice(0, 10)}.json`,
        `${JSON.stringify(envelope, null, 2)}\n`,
      );
      setFeedback({
        tone: "status",
        message: "Backup downloaded — your data stays on this device.",
      });
    } catch {
      setFeedback({ tone: "alert", message: "Export failed — your local data is unchanged." });
    } finally {
      setBusy(null);
    }
  }

  async function handleFileChanged(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.target;
    const file = input.files?.[0];
    // Clear the value so the same file can be re-selected after a failure.
    input.value = "";
    if (!file || !repositories || pending) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      setFeedback({
        tone: "alert",
        message: `Could not read the selected file.${UNCHANGED_SUFFIX}`,
      });
      return;
    }
    const prepared = prepareImport(text);
    if (!prepared.ok) {
      setFeedback({
        tone: "alert",
        message: `${describeFailure(prepared.error)}${UNCHANGED_SUFFIX}`,
      });
      return;
    }
    if (importMode === "replace") {
      // Replace waits for explicit confirmation after validation (design.md decision 8).
      envelopeRef.current = prepared.envelope;
      openConfirmation("replace-import");
      return;
    }
    await applyImportNow("merge", prepared.envelope);
  }

  if (storageError) {
    return (
      <ErrorState
        title="Local storage is unavailable"
        description="Spotivibe keeps your data on this device only, but this browser is blocking storage. Enable site storage and try again."
        retryLabel="Try again"
        onRetry={handleRetry}
      />
    );
  }

  const ready = repositories !== null;
  const controlsDisabled = !ready || busy !== null;
  const modeFieldsetDisabled = controlsDisabled || pending !== null;

  const cleanupActions: Array<{ action: ConfirmableAction; label: string }> = [
    { action: "clear-history", label: "Clear listening history" },
    { action: "clear-search", label: "Clear search history" },
    { action: "reset", label: "Reset Spotivibe data" },
  ];

  function renderConfirmation(action: ConfirmableAction) {
    const copy = CONFIRMATIONS[action];
    return (
      <div
        role="status"
        tabIndex={-1}
        ref={confirmationRef}
        data-testid={`confirm-${action}`}
        className="flex flex-col gap-3 rounded-card bg-graphite px-4 py-3 sm:flex-row sm:items-center"
      >
        <p className="text-body-lg font-regular text-pure-white">{copy.description}</p>
        <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
          <Button variant="ghost" onClick={handleCancel} disabled={busy !== null}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={busy !== null}>
            {copy.confirmLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8" aria-busy={busy !== null || undefined}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleExport} loading={busy === "export"} disabled={controlsDisabled}>
            Export backup
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            loading={busy === "import"}
            disabled={controlsDisabled || pending !== null}
          >
            Import backup
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            aria-label="Backup file"
            className="sr-only"
            onChange={handleFileChanged}
          />
        </div>

        <fieldset disabled={modeFieldsetDisabled} className="flex w-fit flex-col items-start gap-2">
          <legend className="mb-2 text-label font-bold text-mist">Import mode</legend>
          <label className="flex items-center gap-2 text-body-lg font-regular text-mist">
            <input
              type="radio"
              name="import-mode"
              value="merge"
              checked={importMode === "merge"}
              onChange={() => setImportMode("merge")}
            />
            Merge local data — keep local records and add the backup&apos;s records
          </label>
          <label className="flex items-center gap-2 text-body-lg font-regular text-mist">
            <input
              type="radio"
              name="import-mode"
              value="replace"
              checked={importMode === "replace"}
              onChange={() => setImportMode("replace")}
            />
            Replace local data — overwrite local records with the backup
          </label>
        </fieldset>

        {pending === "replace-import" && renderConfirmation("replace-import")}
      </div>

      <div className="flex flex-col gap-3">
        {cleanupActions.map((item) => (
          <div key={item.action}>
            {pending === item.action ? (
              renderConfirmation(item.action)
            ) : (
              <div className="flex">
                <Button
                  variant="ghost"
                  className="justify-start"
                  onClick={() => openConfirmation(item.action)}
                  disabled={controlsDisabled}
                >
                  {item.label}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {feedback && (
        <p
          role={feedback.tone}
          data-testid="data-controls-feedback"
          className={
            feedback.tone === "alert"
              ? "text-body-lg font-bold text-pure-white"
              : "text-body-lg font-regular text-mist"
          }
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
