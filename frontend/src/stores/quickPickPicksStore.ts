import { create } from "zustand";
import type { QuickPickPickRecord } from "@/data/repositories";
import { getLocalData } from "@/data/localData";

/**
 * First-run artist picks.
 *
 * Repository-first, like `preferencesStore`: the write goes to IndexedDB and the
 * state is refreshed from what was actually stored, so a rejected write is a
 * failure the onboarding surface can report rather than a silent divergence
 * between what is on screen and what is on disk.
 *
 * The repository — not this store — owns the write. `replaceAll` is one
 * transaction, so a listener never sees a half-applied selection.
 */
export interface QuickPickPicksState {
  /** The picks, most recently picked first. Empty until `load` resolves. */
  picks: QuickPickPickRecord[];
  /** Whether the initial read has completed. */
  hydrated: boolean;
  load(): Promise<void>;
  /**
   * Replace the whole selection in one write — how onboarding confirms.
   *
   * `names` supplies the display name per artist, which `replaceAll` cannot
   * know: the repository stores identity and time, and the name came from a card
   * the listener looked at.
   */
  confirm(artistIds: readonly string[], names: ReadonlyMap<string, string>): Promise<void>;
  reset(): void;
}

async function readPicks(): Promise<QuickPickPickRecord[]> {
  const data = await getLocalData();
  return data.quickPickPicks.list();
}

/** Write one selection, then read back rather than trusting the argument. */
async function writePicks(
  artistIds: readonly string[],
  names: ReadonlyMap<string, string>,
): Promise<QuickPickPickRecord[]> {
  const data = await getLocalData();
  // A name is required by the record shape and cannot be recovered from the id,
  // so an artist the caller could not name is skipped rather than stored with a
  // placeholder that would render as the artist's identity.
  const entries = artistIds.flatMap((artistId) => {
    const name = names.get(artistId)?.trim();
    return name === undefined || name === "" ? [] : [{ artistId, name }];
  });
  // One transaction, so the rail never shows a partially applied selection.
  await data.quickPickPicks.replaceAll(entries);
  return data.quickPickPicks.list();
}

export const useQuickPickPicksStore = create<QuickPickPicksState>()((set) => ({
  picks: [],
  hydrated: false,

  async load() {
    try {
      const picks = await readPicks();
      set({ picks, hydrated: true });
    } catch (error: unknown) {
      // A read failure must not strand the surface in a permanent loading state.
      console.warn("[onboarding] quick pick picks read failed:", error);
      set({ picks: [], hydrated: true });
    }
  },

  async confirm(artistIds, names) {
    const picks = await writePicks(artistIds, names);
    set({ picks, hydrated: true });
  },

  reset() {
    set({ picks: [], hydrated: false });
  },
}));

/** Reset cross-test state. */
export function resetQuickPickPicksStore(): void {
  useQuickPickPicksStore.getState().reset();
}
