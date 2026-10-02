"use client";

import { IconButton } from "@/components/design-system/IconButton";
import { formatClock } from "@/components/player/formatClock";
import type { Track } from "@/data/repositories";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { DragEvent } from "react";

interface QueueRowProps {
  track: Track;
  /**
   * Upcoming rows pass remove/move handlers; read-only rows (history) pass
   * none and render no action controls. Each control renders only when its
   * handler is present — the Now playing row, for example, exposes remove
   * only (its continuation/remove path, design §4).
   */
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Boundary flags keep every move control rendered (disabled at the edge). */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** Native HTML5 drag wiring — the pointer path calls the same `reorder`. */
  onDragStart?: (event: DragEvent<HTMLLIElement>) => void;
  onDragOver?: (event: DragEvent<HTMLLIElement>) => void;
  onDrop?: (event: DragEvent<HTMLLIElement>) => void;
  onDragEnd?: () => void;
  /** Pointer feedback: marks the hovered drop target. */
  isDropTarget?: boolean;
}

/**
 * Queue surface row (design §5): artwork, title, artist, and duration in the
 * design tokens, with `Remove from queue` / `Move up` / `Move down` icon
 * controls on rows that carry the matching handlers. The controls fade in on
 * hover but stay in the layout and the tab order, so keyboard users always
 * reach them and the global `:focus-visible` outline keeps focus visible
 * (spec: operable by keyboard).
 */
export function QueueRow({
  track,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp = true,
  canMoveDown = true,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDropTarget = false,
}: QueueRowProps) {
  const artistText = track.artists.map((artist) => artist.name).join(", ") || "Unknown artist";
  const editable = onRemove !== undefined || onMoveUp !== undefined || onMoveDown !== undefined;

  return (
    <li
      data-testid="queue-row"
      data-track-id={track.id}
      draggable={onDragStart !== undefined}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`motion-feedback group flex items-center gap-3 rounded-cards bg-smoke px-3 py-2 hover:bg-graphite${
        isDropTarget ? " outline-2 outline-offset-2 outline-pure-white" : ""
      }`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-3">
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
      </span>

      {editable && (
        <span className="motion-feedback flex shrink-0 items-center gap-1 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
          {onMoveUp !== undefined && (
            <IconButton label="Move up" disabled={!canMoveUp} onClick={onMoveUp}>
              <ChevronUp className="size-4" aria-hidden="true" />
            </IconButton>
          )}
          {onMoveDown !== undefined && (
            <IconButton label="Move down" disabled={!canMoveDown} onClick={onMoveDown}>
              <ChevronDown className="size-4" aria-hidden="true" />
            </IconButton>
          )}
          {onRemove !== undefined && (
            <IconButton label="Remove from queue" onClick={onRemove}>
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          )}
        </span>
      )}
    </li>
  );
}
