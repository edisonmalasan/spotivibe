"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/design-system/Button";
import { IconButton } from "@/components/design-system/IconButton";

/**
 * Delete confirmation (M7 task 7.2, design §4): Cancel changes nothing and
 * dismisses, the destructive Delete action is the DESIGN.md white pill, and
 * the dialog follows the shared a11y contract (`role="dialog"` + `aria-modal`,
 * focus enters on mount, Escape/backdrop/Close dismiss, the opener owns focus
 * return). Dismissal is blocked while the delete is in flight; failures
 * surface as an inline alert with the dialog left live for another attempt.
 */

export const PLAYLIST_DELETE_ERROR = "Could not delete the playlist. Please try again.";

interface DeletePlaylistDialogProps {
  /** The playlist's current name — quoted in the confirmation copy. */
  name: string;
  /** Persist the deletion (and navigate) through the caller. */
  onConfirm(): Promise<void>;
  /** Dismissal — the opener decides where focus returns. */
  onClose(): void;
}

export function DeletePlaylistDialog({ name, onConfirm, onClose }: DeletePlaylistDialogProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const dismiss = (): void => {
    if (busy) return; // a delete in flight owns its dialog
    onClose();
  };

  // Escape dismisses wherever focus currently is (dialog, buttons, or outside).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        dismiss();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  function onConfirmClick(event: FormEvent): void {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    void onConfirm()
      .then(() => {
        onClose(); // the caller navigates; close for the mocked/no-op router case
      })
      .catch((error: unknown) => {
        console.warn("[library] playlist delete failed:", error);
        setFailure(PLAYLIST_DELETE_ERROR);
        setBusy(false);
      });
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-void-black/70 p-4"
      onMouseDown={dismiss}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Delete playlist?"
        tabIndex={-1}
        className="w-full max-w-sm rounded-cards bg-carbon p-5 outline-none"
        onMouseDown={(event) => event.stopPropagation()} // backdrop only dismisses
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-link font-bold text-pure-white">Delete playlist?</h2>
          <IconButton label="Close" onClick={dismiss}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </div>

        <p className="text-body font-regular text-mist">
          “{name}” will be removed from your library. This can’t be undone.
        </p>

        <form className="mt-4 flex justify-end gap-2" onSubmit={onConfirmClick}>
          <Button variant="ghost" disabled={busy} onClick={dismiss}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </form>

        {failure && (
          <p role="alert" className="mt-3 text-body text-pure-white">
            {failure}
          </p>
        )}
      </div>
    </div>
  );
}
