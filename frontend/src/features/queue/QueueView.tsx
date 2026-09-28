"use client";

import { EmptyState } from "@/components/design-system/EmptyState";
import { SectionHeader } from "@/components/design-system/SectionHeader";
import { QueueRow } from "@/features/queue/QueueRow";
import type { QueueSource } from "@/data/repositories";
import { usePlayerStore } from "@/stores/playerStore";
import { useQueueStore } from "@/stores/queueStore";
import { useState, type DragEvent } from "react";

/** Display labels for the recorded queue source (design §1 — shown in the header). */
const SOURCE_LABEL: Record<QueueSource, string> = {
  search: "From search",
  browse: "From browse",
  library: "From your library",
  queue: "From queue",
  unknown: "Unknown source",
};

/**
 * Queue surface (design §5, spec "Queue surface"): the queue route's view.
 * Three sections — Now playing, Next & upcoming (traversal order), Recently
 * played (read-only) — plus the source label and an empty state. Upcoming
 * rows expose remove/move controls and native drag; drag and keyboard both
 * call the same `reorder`, so both paths produce the identical order. The
 * surface only edits queue state (via `playerStore.removeFromQueue` for the
 * transport-aware branch) and never starts playback itself.
 */
export function QueueView() {
  const queue = useQueueStore((state) => state.queue);
  const queueIndex = useQueueStore((state) => state.queueIndex);
  const playOrder = useQueueStore((state) => state.playOrder);
  const history = useQueueStore((state) => state.history);
  const source = useQueueStore((state) => state.source);
  const reorder = useQueueStore((state) => state.reorder);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const removeFromQueue = usePlayerStore((state) => state.removeFromQueue);

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  const hasCurrent = currentTrack !== null && queueIndex >= 0 && queueIndex < queue.length;
  const position = playOrder.indexOf(queueIndex);
  // Displayed upcoming = traversal entries after the current one (the whole
  // order when there is no current entry — mirrors `reorder`'s definition).
  const upcoming = hasCurrent ? (position === -1 ? [] : playOrder.slice(position + 1)) : playOrder;

  const startDrag = (from: number) => (event: DragEvent<HTMLLIElement>) => {
    event.dataTransfer?.setData("text/plain", String(from));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    setDragFrom(from);
  };
  const hoverDrag = (to: number) => (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDropTarget(to);
  };
  const dropDrag = (to: number) => (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    const from = dragFrom;
    setDragFrom(null);
    setDropTarget(null);
    if (from !== null && from !== to) reorder(from, to);
  };
  const endDrag = () => {
    setDragFrom(null);
    setDropTarget(null);
  };

  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-heading font-bold text-pure-white">Queue</h1>
        {source !== "unknown" && (
          <span className="text-label font-regular text-mist">{SOURCE_LABEL[source]}</span>
        )}
      </div>

      {queue.length === 0 ? (
        <EmptyState
          title="Nothing queued yet"
          description="Play something and your queue will show up here."
        />
      ) : (
        <>
          {hasCurrent && queue[queueIndex] && (
            <section aria-label="Now playing" className="flex flex-col">
              <SectionHeader title="Now playing" />
              <ul className="flex flex-col gap-2">
                <QueueRow track={queue[queueIndex]} />
              </ul>
            </section>
          )}

          <section aria-label="Next & upcoming" className="flex flex-col">
            <SectionHeader title="Next & upcoming" />
            {upcoming.length === 0 ? (
              <p className="text-body font-regular text-mist">Nothing up next.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {upcoming.map((queueAt, upcomingPosition) => (
                  <QueueRow
                    key={queueAt}
                    track={queue[queueAt]}
                    onRemove={() => removeFromQueue(queueAt)}
                    onMoveUp={
                      upcomingPosition > 0
                        ? () => reorder(upcomingPosition, upcomingPosition - 1)
                        : undefined
                    }
                    onMoveDown={
                      upcomingPosition < upcoming.length - 1
                        ? () => reorder(upcomingPosition, upcomingPosition + 1)
                        : undefined
                    }
                    canMoveUp={upcomingPosition > 0}
                    canMoveDown={upcomingPosition < upcoming.length - 1}
                    onDragStart={startDrag(upcomingPosition)}
                    onDragOver={hoverDrag(upcomingPosition)}
                    onDrop={dropDrag(upcomingPosition)}
                    onDragEnd={endDrag}
                    isDropTarget={dropTarget === upcomingPosition && dragFrom !== null}
                  />
                ))}
              </ul>
            )}
          </section>

          {history.length > 0 && (
            <section aria-label="Recently played" className="flex flex-col">
              <SectionHeader title="Recently played" />
              <ul className="flex flex-col gap-2">
                {[...history].reverse().map((entry, index) => (
                  <QueueRow
                    key={`${entry.track.id}-${entry.playedAt}-${index}`}
                    track={entry.track}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
