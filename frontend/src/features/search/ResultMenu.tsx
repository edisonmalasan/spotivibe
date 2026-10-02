"use client";

import { Ellipsis } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/design-system/IconButton";
import type { Track } from "@/data/repositories";
import { albumHrefFromRelease } from "@/features/album/albumKeys";
import { artistHref } from "@/features/artist/artistKeys";
import { startTrackRadio } from "@/features/personalization/startRadio";
import { PlaylistPicker } from "@/features/search/PlaylistPicker";
import { useQueueStore } from "@/stores/queueStore";

interface ResultMenuProps {
  track: Track;
  isLiked: boolean;
  /** Explicit playback activation (design §9). */
  onPlay(): void;
  /** Awaits the liked-tracks repository before the UI updates (design §8). */
  onToggleLike(): void;
}

const itemClassName =
  "motion-feedback flex w-full items-center rounded-buttons px-3 py-2 text-left text-body-lg text-pure-white hover:bg-graphite";

/**
 * A metadata field that carries identity, or `undefined` when it carries none.
 *
 * A provider artist can be credited with an id and a blank name, and an album
 * summary can arrive untitled. Neither is an entity called `""` — they are
 * unresolvable metadata, so the item is omitted rather than linking to a route
 * that could only render not-found. Same guard the pre-M9 `albumTitle &&` check
 * applied, now applied to the id half too.
 */
function nonBlank(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Feature-local per-result context menu (design §8 — no shared menu primitive
 * until another feature needs one): `IconButton` trigger with
 * `aria-haspopup`/`aria-expanded`, `role="menu"` items in DOM order
 * (plain buttons, so Tab reaches each), Escape and outside-click close,
 * "Add to queue" appends through the queue store, "Add to playlist"
 * opens the feature-local picker dialog, "Go to artist"/"Go to album"
 * open the real catalog surfaces (M9 task 6.1) rather than refining the query,
 * and M10's "Start track radio" hands the result to the radio engine.
 *
 * The radio item is the last one, after the navigation items, because it is the
 * only item that *replaces* what plays rather than editing or navigating: the
 * menu closes first (through the same `activate` every other item uses) and the
 * request runs after, so the user sees the menu dismiss immediately instead of
 * waiting on the network. Every existing item keeps its position and behavior.
 */
export function ResultMenu({ track, isLiked, onPlay, onToggleLike }: ResultMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const primaryArtist = track.artists[0];

  // Catalog routes (M9): the provider id when the result carried one, else the
  // text the entity is known by. Both shapes resolve, so a thin result still
  // navigates somewhere real instead of dropping the item.
  const artistKey = nonBlank(primaryArtist?.id) ?? nonBlank(primaryArtist?.name);
  const artistRoute = artistKey === undefined ? undefined : artistHref(artistKey);
  const albumTitle = nonBlank(track.album?.title);
  const albumRoute =
    albumTitle === undefined
      ? undefined
      : albumHrefFromRelease({
          id: nonBlank(track.album?.id),
          title: albumTitle,
          artistName: nonBlank(primaryArtist?.name),
        });

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
          {artistRoute !== undefined && (
            <button
              type="button"
              role="menuitem"
              className={itemClassName}
              onClick={() => activate(() => router.push(artistRoute))}
            >
              Go to artist
            </button>
          )}
          {albumRoute !== undefined && (
            <button
              type="button"
              role="menuitem"
              className={itemClassName}
              onClick={() => activate(() => router.push(albumRoute))}
            >
              Go to album
            </button>
          )}
          {/*
            M10 (spec `search` — "Result context actions"): a track radio seeded
            by this result. The engine replaces the queue with the radio's own
            tracks and starts playback once; the menu closes before the request
            is issued, and a refused start leaves the existing queue untouched.
          */}
          <button
            type="button"
            role="menuitem"
            className={itemClassName}
            onClick={() =>
              activate(() => {
                // Fire-and-forget by design: the outcome is not a menu concern,
                // and the engine reports a failure through the non-blocking
                // refill affordance rather than a dialog in a closed menu.
                void startTrackRadio(track);
              })
            }
          >
            Start track radio
          </button>
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
