"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ellipsis } from "lucide-react";
import { OverflowMenu, type OverflowMenuEntry } from "@/components/player/OverflowMenu";
import type { Track } from "@/data/repositories";
import { albumHrefFromRelease } from "@/features/album/albumKeys";
import { artistHref } from "@/features/artist/artistKeys";
import { DownloadOverflowRow } from "@/features/download/DownloadControl";
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
 * Track context menu (design §8; spec `search` — "Result context actions").
 *
 * The menu **shell** — the `IconButton` trigger, `role="menu"` items in DOM order as plain buttons,
 * focus management, Escape and outside-click dismissal — is now
 * {@link import("@/components/player/OverflowMenu").OverflowMenu}, because M20 needed the same
 * behaviour in the two player bars and `ResultMenu` had named itself feature-local pending exactly
 * that ("no shared menu primitive until another feature needs one"). This file keeps the items.
 *
 * Item order is unchanged and load-bearing in two places: "Play" stays first, and the radio item
 * stays last, after the navigation items, because it is the only item that *replaces* what plays
 * rather than editing or navigating. The download row (M20) sits with the editing actions, above the
 * navigation pair, because a download also changes nothing about what plays.
 */
export function ResultMenu({ track, isLiked, onPlay, onToggleLike }: ResultMenuProps) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);

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

  const items: OverflowMenuEntry[] = [
    { label: "Play", onSelect: onPlay },
    { label: isLiked ? "Remove from Liked Songs" : "Save to Liked Songs", onSelect: onToggleLike },
    {
      label: "Add to queue",
      onSelect() {
        // Queue insertion with duplicate protection (M6 task 7.1) — the
        // store rejects identities already current/upcoming; playback
        // state is never touched by `enqueue`.
        useQueueStore.getState().enqueue(track);
      },
    },
    { label: "Add to playlist", onSelect: () => setPickerOpen(true) },
    /*
      M20: the download row, with the editing actions rather than after the navigation
      pair. It is a custom entry rather than a declarative one because its label is one of
      four states read from a store, and it is placed here so the radio item stays last.
    */
    { element: <DownloadOverflowRow track={track} /> },
    ...(artistRoute === undefined
      ? []
      : [{ label: "Go to artist", onSelect: () => router.push(artistRoute) }]),
    ...(albumRoute === undefined
      ? []
      : [{ label: "Go to album", onSelect: () => router.push(albumRoute) }]),
    /*
      M10 (spec `search` — "Result context actions"): a track radio seeded by this
      result. The engine replaces the queue with the radio's own tracks and starts
      playback once. Fire-and-forget by design: the outcome is not a menu concern,
      and the engine reports a failure through the non-blocking refill affordance
      rather than a dialog in a closed menu.
    */
    {
      label: "Start track radio",
      onSelect() {
        void startTrackRadio(track);
      },
    },
  ];

  return (
    <>
      {/* The 16px trigger is this surface's own, preserved from before the shell was
          shared: the default is the 20px the player bars use, and a search result row
          is not a 72px player bar. */}
      <OverflowMenu
        label={`More options for ${track.title}`}
        menuLabel={`Actions for ${track.title}`}
        items={items}
        icon={<Ellipsis className="size-4" aria-hidden="true" />}
      />

      {pickerOpen && (
        <PlaylistPicker
          track={track}
          onClose={() => {
            setPickerOpen(false);
            // Focus return (design §8). The trigger is queried rather than held in a ref,
            // because the menu owns its trigger's DOM and the picker is a sibling of it.
            document.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
          }}
        />
      )}
    </>
  );
}
