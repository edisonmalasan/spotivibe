import { create } from "zustand";
import { getLocalData } from "@/data/localData";
import type { ListeningEventRecord, NewListeningEvent } from "@/data/repositories";

/**
 * `historyStore` (ROADMAP M8, design §5/§6): the client authority for the
 * listening-history dataset that `useListeningRecorder` writes and the Home
 * "recently played" section reads.
 *
 * Layering: components/hooks → historyStore → the `ListeningHistoryRepository`
 * interface (never `data/indexeddb`). Events are repository-first — the write is
 * awaited before state updates, so a failed write leaves the UI exactly as it
 * was and rejects for the caller. This module never imports `playerStore` or
 * `queueStore` (architecture-tested): transport stays outside history by
 * construction, and the queue-source → `ListeningContext` mapping lives in the
 * recording hook.
 */

/** Newest events kept in state for the recently-played surfaces. */
export const RECENT_HISTORY_LIMIT = 50;

export interface HistoryState {
  /** Events newest-first (repository order), bounded by `RECENT_HISTORY_LIMIT`. */
  events: ListeningEventRecord[];
  /** True once the first successful read has settled. */
  hydrated: boolean;

  /**
   * Read the newest events from the repository. Concurrent callers share one
   * in-flight read; a later call re-reads rather than appends, so a Settings
   * clear or backup import can resync the store.
   */
  hydrate(): Promise<void>;
  /** Persist one event, then reflect the refreshed newest-first list. */
  record(event: NewListeningEvent): Promise<ListeningEventRecord>;
  /** Clear the whole listening-history dataset, then reflect the empty list. */
  clear(): Promise<void>;
}

export const initialHistoryState = {
  events: [] as ListeningEventRecord[],
  hydrated: false,
};

let hydrateInFlight: Promise<void> | null = null;
/** Monotonic token so a slow stale read can never overwrite a newer one. */
let refreshToken = 0;

/** Reset listening-history data — test isolation and hot-reload hygiene. */
export function resetHistoryStore(): void {
  hydrateInFlight = null;
  refreshToken = 0;
  useHistoryStore.setState({ ...initialHistoryState });
}

/** Re-read the newest events into state. */
async function refreshEvents(): Promise<void> {
  const token = ++refreshToken;
  const data = await getLocalData();
  const events = await data.listeningHistory.list(RECENT_HISTORY_LIMIT);
  if (token === refreshToken) useHistoryStore.setState({ events, hydrated: true });
}

export const useHistoryStore = create<HistoryState>()(() => ({
  ...initialHistoryState,

  hydrate() {
    if (!hydrateInFlight) {
      hydrateInFlight = refreshEvents().finally(() => {
        hydrateInFlight = null;
      });
    }
    return hydrateInFlight;
  },

  async record(event) {
    const data = await getLocalData();
    const created = await data.listeningHistory.record(event);
    await refreshEvents();
    return created;
  },

  async clear() {
    const data = await getLocalData();
    await data.listeningHistory.clear();
    await refreshEvents();
  },
}));
