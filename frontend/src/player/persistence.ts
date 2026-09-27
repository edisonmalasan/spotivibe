import type { SessionSnapshot } from "@/data/repositories";
import { getLocalData } from "@/data/localData";
import { usePlayerStore } from "@/stores/playerStore";

/**
 * Session persistence for ROADMAP M4: debounced writes of the playback
 * session (queue, index, position, repeat, shuffle, volume) through M2's
 * session repository, plus an immediate flush when the page is hidden or
 * closed. Pure subscription logic — the store stays free of data-layer
 * imports, so store tests need no IndexedDB.
 */

export const SESSION_DEBOUNCE_MS = 2000;

function snapshotOf(state: ReturnType<typeof usePlayerStore.getState>): SessionSnapshot | null {
  if (!state.currentTrack || state.queue.length === 0) return null;
  return {
    queue: state.queue,
    queueIndex: state.queueIndex,
    positionSeconds: state.positionSeconds,
    repeatMode: state.repeatMode,
    shuffle: state.shuffle,
    volume: state.volume / 100, // store 0..100 → snapshot 0..1
  };
}

/**
 * Cold-boot restore: re-apply the volume/mute boot preference, then load the
 * persisted session so the current track comes back cued paused (never
 * autoplay — spec: session persistence without autoplay). Restore is skipped
 * when storage is unavailable or playback already started while it loaded;
 * either way failures are logged, not thrown.
 */
export async function restorePlaybackSession(): Promise<void> {
  usePlayerStore.getState().applyVolumePreference();
  if (typeof indexedDB === "undefined") return; // storage unavailable (tests, locked-down browsers)
  try {
    const data = await getLocalData();
    const session = await data.session.get();
    const store = usePlayerStore.getState();
    if (session && store.currentTrack === null) {
      store.restoreSession(session);
    }
  } catch (error: unknown) {
    console.warn("[playback] session restore skipped:", error);
  }
}

/** Subscribe the session repository to store changes; returns a detacher. */
export function attachSessionPersistence(options: { debounceMs?: number } = {}): () => void {
  const debounceMs = options.debounceMs ?? SESSION_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Serialize writes so overlapping debounced flushes cannot interleave.
  let writeChain: Promise<void> = Promise.resolve();

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const snapshot = snapshotOf(usePlayerStore.getState());
    if (!snapshot) return; // nothing playing ⇒ nothing to persist
    writeChain = writeChain
      .then(() => getLocalData())
      .then(async (data) => {
        await data.session.set(snapshot);
      })
      .catch((error: unknown) => {
        // Storage unavailable/blocked: playback continues in memory; the next
        // change retries. Never reject the chain (that would kill later writes).
        console.warn("[playback] session persist skipped:", error);
      });
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  const unsubscribe = usePlayerStore.subscribe((state, previous) => {
    if (
      state.queue !== previous.queue ||
      state.queueIndex !== previous.queueIndex ||
      state.positionSeconds !== previous.positionSeconds ||
      state.repeatMode !== previous.repeatMode ||
      state.shuffle !== previous.shuffle ||
      state.volume !== previous.volume
    ) {
      schedule();
    }
  });

  const handleVisibility = (): void => {
    if (document.visibilityState === "hidden") flush();
  };
  const handlePageHide = (): void => flush();
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("pagehide", handlePageHide);

  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("pagehide", handlePageHide);
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
