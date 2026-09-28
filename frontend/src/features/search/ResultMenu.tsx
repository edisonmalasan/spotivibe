"use client";

import { Ellipsis } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/design-system/IconButton";
import type { Track } from "@/data/repositories";
import { PlaylistPicker } from "@/features/search/PlaylistPicker";
import { useQueueStore } from "@/stores/queueStore";

interface ResultMenuProps {
  track: Track;
  isLiked: boolean;
  /** Explicit playback activation (design §9). */
  onPlay(): void;
  /** Awaits the liked-tracks repository before the UI updates (design §8). */
  onToggleLike(): void;
  /** Refine the search to the artist/album name (design §8). */
  onRefine(name: string): void;
}

const itemClassName =
  "flex w-full items-center rounded-buttons px-3 py-2 text-left text-body-lg text-pure-white transition hover:bg-graphite";

/**
 * Feature-local per-result context menu (design §8 — no shared menu primitive
 * until another feature needs one): `IconButton` trigger with
 * `aria-haspopup`/`aria-expanded`, `role="menu"` items in DOM order
 * (plain buttons, so Tab reaches each), Escape and outside-click close,
 * "Add to queue" appends through the queue store, and "Add to playlist"
 * opens the feature-local picker dialog.
 */
export function ResultMenu({ track, isLiked, onPlay, onToggleLike, onRefine }: ResultMenuProps) {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const albumTitle = track.album?.title;
  const artistName = track.artists[0]?.name;

  /** Focus the trigger button (the IconButton does not forward a ref). */
  const focusTrigger = useCallback(() => {
    triggerRef.current?.querySelector("button")?.focus();
  }, []);

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) focusTrigger();
    },
    [focusTrigger],
  );

  function activate(action: () => void): void {
    setOpen(false);
    action();
  }

  // Open-state listeners: outside press and Escape both dismiss the menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false); // pointer press: focus follows the pointer, not the trigger
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // Opening moves focus to the first item so Escape/Tab start from the menu.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  return (
    <div className="relative">
      <span ref={triggerRef} className="inline-flex">
        <IconButton
          label={`More options for ${track.title}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Ellipsis className="size-4" aria-hidden="true" />
        </IconButton>
      </span>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${track.title}`}
          className="absolute right-0 top-full z-30 mt-1 flex w-56 flex-col gap-0.5 rounded-cards bg-carbon p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className={itemClassName}
            onClick={() => activate(onPlay)}
          >
            Play
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClassName}
            onClick={() => activate(onToggleLike)}
          >
            {isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"}
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClassName}
            onClick={() =>
              // Queue insertion with duplicate protection (M6 task 7.1) — the
              // store rejects identities already current/upcoming; playback
              // state is never touched by `enqueue`.
              activate(() => {
                useQueueStore.getState().enqueue(track);
              })
            }
          >
            Add to queue
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemClassName}
            onClick={() => activate(() => setPickerOpen(true))}
          >
            Add to playlist
          </button>
          {artistName && (
            <button
              type="button"
              role="menuitem"
              className={itemClassName}
              onClick={() => activate(() => onRefine(artistName))}
            >
              Go to artist
            </button>
          )}
          {albumTitle && (
            <button
              type="button"
              role="menuitem"
              className={itemClassName}
              onClick={() => activate(() => onRefine(albumTitle))}
            >
              Go to album
            </button>
          )}
        </div>
      )}

      {pickerOpen && (
        <PlaylistPicker
          track={track}
          onClose={() => {
            setPickerOpen(false);
            focusTrigger(); // focus return (design §8)
          }}
        />
      )}
    </div>
  );
}
