"use client";

import { usePlayerStore } from "@/stores/playerStore";
import { formatClock } from "./formatClock";
import type { KeyboardEvent, PointerEvent } from "react";

/** Keyboard seek step for the progress slider (spec: seekable progress). */
const KEY_STEP_SECONDS = 5;

/**
 * Seekable progress row (spec: store-backed progress + duration). Renders
 * position/duration from the store and dispatches `seek` on pointer or
 * keyboard interaction; the player-reported duration bounds the seek range
 * (spec: authoritative duration correction).
 */
export function ProgressSlider() {
  const positionSeconds = usePlayerStore((state) => state.positionSeconds);
  const durationSeconds = usePlayerStore((state) => state.durationSeconds);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const seek = usePlayerStore((state) => state.seek);

  const hasTrack = currentTrack !== null;
  const duration = durationSeconds > 0 ? durationSeconds : 0;
  const ratio = duration > 0 ? Math.min(1, Math.max(0, positionSeconds / duration)) : 0;
  const percent = Math.round(ratio * 100);

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    if (!hasTrack || duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return; // jsdom / zero-size layout: nothing to compute
    const pointerRatio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    if (!Number.isFinite(pointerRatio)) return;
    seek(pointerRatio * duration);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!hasTrack) return;
    let target: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        target = positionSeconds + KEY_STEP_SECONDS;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        target = positionSeconds - KEY_STEP_SECONDS;
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = duration;
        break;
      default:
        return;
    }
    event.preventDefault();
    seek(target); // clamps to track bounds inside the store action
  };

  return (
    <div className="flex w-full items-center gap-2">
      <span
        data-testid="progress-position"
        className="text-caption font-regular tabular-nums text-mist"
      >
        {formatClock(positionSeconds)}
      </span>
      <div
        role="slider"
        tabIndex={hasTrack ? 0 : -1}
        aria-label="Track progress"
        aria-valuemin={0}
        aria-valuemax={Math.max(1, Math.round(duration))}
        aria-valuenow={Math.round(positionSeconds)}
        aria-valuetext={`${formatClock(positionSeconds)} of ${formatClock(duration)}`}
        aria-disabled={hasTrack ? undefined : true}
        data-testid="progress-slider"
        className="flex h-3 flex-1 cursor-pointer items-center rounded-buttons focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pure-white"
        onPointerDown={seekFromPointer}
        onPointerMove={(event) => {
          if (event.buttons === 1) seekFromPointer(event); // drag while held
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="pointer-events-none h-1 w-full overflow-hidden rounded-full bg-iron">
          <span
            data-testid="progress-fill"
            className="block h-1 rounded-full bg-pure-white"
            style={{ width: `${percent}%` }}
          />
        </span>
      </div>
      <span
        data-testid="progress-duration"
        className="text-caption font-regular tabular-nums text-mist"
      >
        {formatClock(duration)}
      </span>
    </div>
  );
}
