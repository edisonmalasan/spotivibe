"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/design-system/Button";
import { IconButton } from "@/components/design-system/IconButton";

/**
 * Shared create/edit playlist dialog (design §4): one component for both
 * modes, following the `PlaylistPicker`/`ImportPlaylistDialog` a11y contract
 * (`role="dialog"` + `aria-modal`, focus enters on mount, Escape/backdrop/
 * Close dismiss, the opener owns focus return). Dismissal is blocked while a
 * save is in flight so a racing write can never outlive its dialog; failures
 * surface as an inline alert with the form left live for another attempt.
 */

export interface PlaylistFormValue {
  name: string;
  description?: string;
}

interface PlaylistFormDialogProps {
  /** Dialog title — also its accessible name. */
  title: string;
  submitLabel: string;
  /** Prefill for edit mode; omitted for create. */
  initial?: { name: string; description?: string };
  /** Persist through the library store; rejection surfaces as the alert. */
  onSave(value: PlaylistFormValue): Promise<void>;
  /** Dismissal — the opener decides where focus returns. */
  onClose(): void;
}

export const PLAYLIST_SAVE_ERROR = "Could not save the playlist. Please try again.";

export function PlaylistFormDialog({
  title,
  submitLabel,
  initial,
  onSave,
  onClose,
}: PlaylistFormDialogProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus starts inside the dialog so keyboard users land in the surface they
  // opened; dismissal returns focus to the trigger (opener-owned).
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const dismiss = (): void => {
    if (busy) return; // a save in flight owns its dialog
    onClose();
  };

  // Escape dismisses wherever focus currently is (input, textarea, or dialog).
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

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || busy) return;
    setBusy(true);
    setFailure(null);
    void onSave({
      name: trimmed,
      description: description.trim() === "" ? undefined : description.trim(),
    })
      .then(() => {
        onClose();
      })
      .catch((error: unknown) => {
        console.warn("[library] playlist save failed:", error);
        setFailure(PLAYLIST_SAVE_ERROR);
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
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-sm rounded-cards bg-carbon p-5 outline-none"
        onMouseDown={(event) => event.stopPropagation()} // backdrop only dismisses
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-link font-bold text-pure-white">{title}</h2>
          <IconButton label="Close" onClick={dismiss}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </div>

        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1 text-body text-mist" htmlFor="playlist-form-name">
            Name
            <input
              id="playlist-form-name"
              type="text"
              value={name}
              placeholder="Playlist name"
              className="rounded-buttons bg-graphite px-3 py-2 text-body-lg text-pure-white outline-none"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label
            className="flex flex-col gap-1 text-body text-mist"
            htmlFor="playlist-form-description"
          >
            Description (optional)
            <textarea
              id="playlist-form-description"
              value={description}
              rows={3}
              placeholder="What's this playlist about?"
              className="resize-none rounded-buttons bg-graphite px-3 py-2 text-body-lg text-pure-white outline-none"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <Button type="submit" loading={busy} disabled={name.trim() === ""}>
            {busy ? "Saving…" : submitLabel}
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
