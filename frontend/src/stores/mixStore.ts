import { create } from "zustand";
import type { MixRecord } from "@/data/repositories";
import { getLocalData } from "@/data/localData";

/**
 * Smart Mix state (M11; spec: `mixes` — "Mix identity and naming").
 *
 * A mix is a **persisted, named snapshot**, not a derived view: the listener
 * recognizes the name, so it has to survive a reload, and the name has to come
 * back with it. This store therefore mirrors the radio store's shape — it holds
 * bookkeeping only, never the *source of truth* for a mix's contents, which live
 * in the repository. `MixRecord[]` is a cache of the dataset, exactly as
 * `historyStore.events` is a cache of the history dataset.
 *
 * The generation status lives here too because a mix is generated on demand (the
 * Home section, or the History page's action) and the two policies — "generate
 * one" and "refresh this one" — must not be two different code paths.
 */

export type MixStatus = "idle" | "generating" | "refreshing" | "ready" | "error";

export interface MixState {
  mixes: MixRecord[];
  status: MixStatus;
  /** The mix currently being generated or refreshed, or `null`. */
  activeId: string | null;
  /** The last failure worth showing, or `null`. */
  error: string | null;
  /** Read the dataset. */
  hydrate(): Promise<void>;
  /** Store a freshly generated or refreshed mix (upsert by id). */
  upsert(mix: MixRecord): void;
  remove(id: string): Promise<void>;
  setStatus(status: MixStatus, error?: string | null): void;
  reset(): void;
}

export const initialMixState = {
  mixes: [] as MixRecord[],
  status: "idle" as MixStatus,
  activeId: null as string | null,
  error: null as string | null,
};

/** Test isolation and hot-reload hygiene, matching the other stores. */
export function resetMixStore(): void {
  useMixStore.setState({ ...initialMixState });
}

export const useMixStore = create<MixState>()((set, get) => ({
  ...initialMixState,

  async hydrate() {
    try {
      const data = await getLocalData();
      set({ mixes: await data.mixes.list(), error: null });
    } catch (error: unknown) {
      // A read failure is reported, not thrown: the mixes section is a local
      // convenience and must not take the page it lives on down with it.
      set({ error: error instanceof Error ? error.message : "Mixes could not be read." });
    }
  },

  upsert(mix) {
    // Newest generation first, so a refreshed mix keeps its place at the top
    // without the surface having to re-sort.
    const rest = get().mixes.filter((existing) => existing.id !== mix.id);
    set({ mixes: [mix, ...rest], status: "ready", error: null, activeId: null });
  },

  async remove(id) {
    set({ mixes: get().mixes.filter((mix) => mix.id !== id) });
    try {
      const data = await getLocalData();
      await data.mixes.remove(id);
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : "The mix could not be removed." });
    }
  },

  setStatus(status, error) {
    set({
      status,
      // A non-error status clears the message; an error without text still gets a
      // readable one so a surface can always offer a retry against something.
      error: status === "error" ? (error ?? "A mix could not be built.") : null,
      ...(status === "idle" || status === "ready" ? { activeId: null } : {}),
    });
  },

  reset() {
    set({ ...initialMixState });
  },
}));
