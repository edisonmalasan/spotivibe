"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/design-system/Button";
import { IconButton } from "@/components/design-system/IconButton";
import type { PlaylistRecord } from "@/data/repositories";
import { playlistHref } from "@/features/playlists/playlistKeys";
import {
  PlaylistImportError,
  fetchPlaylist,
  type ResolvedPlaylist,
} from "@/features/playlists/playlistApi";
import { useLibraryStore } from "@/stores/libraryStore";

/**
 * `ImportPlaylistDialog` (design §10): the `/library` header's Import action.
 * State machine — `idle → resolving → success`, with `resolving → error`
 * mapping each failure onto its designed message — and the `PlaylistPicker`
 * a11y contract by convention (`role="dialog"` + `aria-modal`, focus enters
 * on mount, Escape/backdrop/Close dismiss, the opener owns focus return).
 *
 * Resolution and creation are separate by design: `fetchPlaylist` completes
 * first, so every failure path leaves the database untouched; only then does
 * `libraryStore.createPlaylistFromResolved` write (rolling back on a
 * mid-sequence failure). Success shows the imported/skipped/truncated counts
 * and then navigates to the new playlist's detail route — navigation is
 * delayed by a short, readable beat (see `SUCCESS_NAVIGATION_DELAY_MS`)
 * because the feedback would otherwise unmount with the dialog before it
 * could be read; dismissing during that beat cancels the navigation.
 */

/** Readable pause between the success counts and the detail-route push. */
export const SUCCESS_NAVIGATION_DELAY_MS = 1500;

/** Design §10's error mapping, plus the local-write failure the store reports. */
export const IMPORT_ERROR_MESSAGES = {
  invalid_input: "That doesn't look like a YouTube playlist link.",
  playlist_unavailable: "That playlist is private or unavailable.",
  upstream_unavailable: "Couldn't reach YouTube — try again.",
  network: "You're offline — import needs a connection.",
  /** Mid-write local failure — the store already rolled the partial import back. */
  local_write: "Couldn't save the playlist. Please try again.",
} as const;

export type ImportFailureCode = keyof typeof IMPORT_ERROR_MESSAGES;

interface ImportSummary {
  id: string;
  imported: number;
  skipped: number;
  truncated: boolean;
}

interface ImportPlaylistDialogProps {
  /** Dismissal — the opener decides where focus returns. */
  onClose(): void;
}

export function ImportPlaylistDialog({ onClose }: ImportPlaylistDialogProps) {
  const router = useRouter();
  const createPlaylistFromResolved = useLibraryStore((state) => state.createPlaylistFromResolved);
  const [src, setSrc] = useState("");
  const [phase, setPhase] = useState<"idle" | "resolving" | "success" | "error">("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set on dismissal so a late resolution never writes or updates state. */
  const dismissedRef = useRef(false);

  // Focus starts inside the dialog so keyboard users land in the surface they
  // opened; dismissal returns focus to the trigger (opener-owned, see picker).
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Cancel an in-flight resolution or pending navigation when the dialog goes
  // away for any reason (Escape, backdrop, Close, parent unmount).
  useEffect(() => {
    return () => {
      dismissedRef.current = true;
      controllerRef.current?.abort();
      if (navTimerRef.current !== null) {
        clearTimeout(navTimerRef.current);
        navTimerRef.current = null;
      }
    };
  }, []);

  /** Dismiss once: cancel pending work, then hand back to the opener. */
  const dismiss = useCallback(() => {
    dismissedRef.current = true;
    controllerRef.current?.abort();
    if (navTimerRef.current !== null) {
      clearTimeout(navTimerRef.current);
      navTimerRef.current = null;
    }
    onClose();
  }, [onClose]);

  // Escape dismisses wherever focus currently is (input, button, or dialog).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        dismiss();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dismiss]);

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    const trimmed = src.trim();
    if (trimmed === "" || phase === "resolving" || phase === "success") return;
    setFailure(null);
    setPhase("resolving");
    void run(trimmed);
  }

  async function run(trimmed: string): Promise<void> {
    const controller = new AbortController();
    controllerRef.current = controller;

    // Phase 1: resolve the remote playlist — completes before any write, so
    // every failure path below leaves the database untouched (design §10).
    let resolved: ResolvedPlaylist;
    try {
      resolved = await fetchPlaylist(trimmed, controller.signal);
    } catch (error) {
      if (dismissedRef.current || controller.signal.aborted) return; // dismissed
      console.warn("[library] playlist resolution failed:", error);
      const code: ImportFailureCode = error instanceof PlaylistImportError ? error.code : "network";
      setFailure(IMPORT_ERROR_MESSAGES[code]);
      setPhase("error");
      return;
    }
    if (dismissedRef.current) return;

    // Phase 2: persist through the store (rolls back on mid-write failure).
    let playlist: PlaylistRecord;
    try {
      playlist = await createPlaylistFromResolved({
        name: resolved.title,
        description: resolved.description,
        tracks: resolved.tracks,
      });
    } catch (error) {
      if (dismissedRef.current) return;
      console.warn("[library] playlist import write failed:", error);
      setFailure(IMPORT_ERROR_MESSAGES.local_write);
      setPhase("error");
      return;
    }
    if (dismissedRef.current) return;

    setSummary({
      id: playlist.id,
      imported: resolved.tracks.length,
      skipped: resolved.skipped,
      truncated: resolved.truncated ?? false,
    });
    setPhase("success");
    navTimerRef.current = setTimeout(() => {
      navTimerRef.current = null;
      router.push(playlistHref(playlist.id));
      onClose();
    }, SUCCESS_NAVIGATION_DELAY_MS);
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
        aria-label="Import playlist"
        tabIndex={-1}
        className="w-full max-w-sm rounded-cards bg-carbon p-5 outline-none"
        onMouseDown={(event) => event.stopPropagation()} // backdrop only dismisses
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-link font-bold text-pure-white">Import playlist</h2>
          <IconButton label="Close" onClick={dismiss}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </div>

        {phase === "success" && summary ? (
          <div role="status" className="flex flex-col gap-1">
            <p className="text-body-lg font-bold text-pure-white">
              {summary.imported === 1 ? "Imported 1 song" : `Imported ${summary.imported} songs`}
            </p>
            {summary.skipped > 0 && (
              <p className="text-body text-mist">
                {summary.skipped === 1
                  ? "1 unavailable entry skipped"
                  : `${summary.skipped} unavailable entries skipped`}
              </p>
            )}
            {summary.truncated && <p className="text-body text-mist">First 500 songs imported</p>}
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={onSubmit}>
            <label
              className="flex flex-col gap-1 text-body text-mist"
              htmlFor="import-playlist-source"
            >
              YouTube playlist URL or ID
              <input
                id="import-playlist-source"
                type="text"
                value={src}
                placeholder="https://youtube.com/playlist?list=… or ID"
                className="rounded-buttons bg-graphite px-3 py-2 text-body-lg text-pure-white outline-none"
                disabled={phase === "resolving"}
                onChange={(event) => setSrc(event.target.value)}
              />
            </label>

            {phase === "resolving" && (
              <p role="status" className="text-body text-mist">
                Resolving playlist…
              </p>
            )}

            <Button
              type="submit"
              loading={phase === "resolving"}
              disabled={src.trim() === "" || phase === "success"}
            >
              {phase === "resolving" ? "Importing…" : "Import"}
            </Button>

            {failure && (
              <p role="alert" className="text-body text-pure-white">
                {failure}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
