import type { Track } from "@/data/repositories";
import { usePlayerStore } from "@/stores/playerStore";
import { useQueueStore } from "@/stores/queueStore";

/**
 * Shared bulk-play entry points for library collections (M7 tasks 6.2/7.2,
 * design §6): play-all and shuffle over an ordered collection, recorded with
 * the `library` queue source so the queue surface labels it "From your
 * library". Both are activation-only — nothing here runs without a user
 * gesture — and an empty collection makes both inert no-ops (the surfaces
 * also render their controls disabled, the app-shell disabled-state rule).
 */

/** Play the collection's first track with the full collection as context. */
export function playAll(collection: Track[]): void {
  if (collection.length === 0) return;
  usePlayerStore.getState().playTrack(collection[0], collection, "library");
}

/**
 * Same as `playAll` but with shuffle *ensured on* first — set directly,
 * never toggled, so shuffle-off stays off on plain play-all and an already
 * on state isn't flipped off. `setContext` rebuilds the traversal order from
 * this flag synchronously on the next line, and the first track still starts
 * deterministically at index 0 (design §6: shuffled continuation only).
 */
export function shufflePlay(collection: Track[]): void {
  if (collection.length === 0) return;
  useQueueStore.setState({ shuffle: true });
  usePlayerStore.getState().playTrack(collection[0], collection, "library");
}
