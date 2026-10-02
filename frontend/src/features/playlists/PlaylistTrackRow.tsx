"use client";

import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { DragEvent } from "react";
import { IconButton } from "@/components/design-system/IconButton";
import { formatClock } from "@/components/player/formatClock";
import type { Track } from "@/data/repositories";

interface PlaylistTrackRowProps {
  track: Track;
  /** 1-based display position in the ordered list. */
  position: number;
  /** Row body activation — plays this track within the playlist (design §6). */
  onPlay(): void;
  onRemove(): void;
  onMoveUp(): void;
  onMoveDown(): void;
  /** Boundary flags keep every move control rendered (disabled at the edge). */
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Native HTML5 drag wiring — the pointer path calls the same `reorder`. */
  onDragStart(event: DragEvent<HTMLLIElement>): void;
  onDragOver(event: DragEvent<HTMLLIElement>): void;
  onDrop(event: DragEvent<HTMLLIElement>): void;
  onDragEnd(): void;
  /** Pointer feedback: marks the hovered drop target. */
  isDropTarget: boolean;
}

/**
 * Ordered playlist track row (M7 task 7.3, design §3): position number,
 * artwork, title/artist, duration, and `Move up`/`Move down`/`Remove` icon
 * controls trailing the row body. The row body is the play activation (no
 * nested buttons), the `<li>` is draggable with the queue's M6 wiring, and
 * keyboard moves and drag drops both land on the same store `reorder` —
 * identical resulting orders by construction. Controls stay in the layout
 * and tab order (fade-in on hover only, visible on focus).
 */
export function PlaylistTrackRow({
  track,
  position,
  onPlay,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDropTarget,
}: PlaylistTrackRowProps) {
  const artistText = track.artists.map((artist) => artist.name).join(", ") || "Unknown artist";

  return (
    <li
      data-testid="playlist-track-row"
      data-track-id={track.id}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`motion-feedback group flex items-center gap-3 rounded-cards bg-smoke px-3 py-2 hover:bg-graphite${
        isDropTarget ? " outline-2 outline-offset-2 outline-pure-white" : ""
      }`}
    >
      <button
        type="button"
        aria-label={`Play ${track.title}`}
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span
          className="w-6 shrink-0 text-right text-body text-mist tabular-nums"
          aria-hidden="true"
        >
          {position}
        </span>
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-images bg-graphite">
          {track.artwork[0] ? (
            // Provider artwork thumbnails: dynamic remote URLs, no optimizer
            // allowlist yet (M9 owns asset handling).
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.artwork[0].url} alt="" className="size-full object-cover" />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-lg font-regular text-pure-white">{track.title}</span>
          <span className="truncate text-body text-mist">{artistText}</span>
        </span>
        {track.durationSeconds !== undefined && (
          <span className="shrink-0 text-body text-mist tabular-nums">
            {formatClock(track.durationSeconds)}
          </span>
        )}
      </button>

      <span className="motion-feedback flex shrink-0 items-center gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
        <IconButton label="Move up" disabled={!canMoveUp} onClick={onMoveUp}>
          <ChevronUp className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton label="Move down" disabled={!canMoveDown} onClick={onMoveDown}>
          <ChevronDown className="size-4" aria-hidden="true" />
        </IconButton>
        <IconButton label={`Remove ${track.title} from playlist`} onClick={onRemove}>
          <X className="size-4" aria-hidden="true" />
        </IconButton>
      </span>
    </li>
  );
}
