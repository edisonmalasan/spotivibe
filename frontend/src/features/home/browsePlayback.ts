import type { Track } from "@/data/repositories";
import { usePlayerStore } from "@/stores/playerStore";
import { useQueueStore } from "@/stores/queueStore";

/**
 * Playback entry points for the Home/Discover shelves (M8 design §9; spec:
 * `discovery` — "Home discovery feed" / "Home never autoplays").
 *
 * Deliberately the same shape as `lib/libraryPlayback.ts` (play-all / shuffle
 * over a collection) with one difference: these record the `browse` queue
 * source, so the queue surface labels a shelf as "From browse" and
 * `useListeningRecorder` records the step under the `home` listening context.
 * `lib/libraryPlayback` hardcodes `library` and must not be reused here.
 *
 * Both are **activation-only** — nothing in this module runs without a user
 * gesture, and nothing pre-fetches or pre-plays a track. The `browse` source is
 * a constant here precisely so a shelf activation cannot be confused with a
 * library one.
 */

/** The queue source every Home/Discover shelf activation is recorded under. */
export const BROWSE_QUEUE_SOURCE = "browse" as const;

/**
 * Play `track` with `context` as the playback context, recorded as `browse`.
 * An empty context still plays the track — a one-track context is the honest
 * answer, not a silent no-op.
 */
export function playFromShelf(track: Track, context: readonly Track[] = []): void {
  usePlayerStore.getState().playTrack(track, [...context], BROWSE_QUEUE_SOURCE);
}

/**
 * Same as {@link playFromShelf} but with shuffle *ensured on* first — set
 * directly, never toggled, so shuffle-off stays off on a plain shelf play and an
 * already-on state is not flipped off. `setContext` rebuilds the traversal
 * order from the flag, and the activated track still starts deterministically.
 */
export function shuffleFromShelf(track: Track, context: readonly Track[] = []): void {
  useQueueStore.setState({ shuffle: true });
  playFromShelf(track, context);
}
