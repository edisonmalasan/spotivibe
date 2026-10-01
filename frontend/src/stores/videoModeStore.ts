import { create } from "zustand";

/**
 * `videoModeStore`: whether the parked YouTube player is temporarily shown as a
 * visible video (`lyrix-style-hidden-player`).
 *
 * **Why a store rather than local state.** The host lives in the AppShell while
 * the control lives on the Now Playing route, so the two cannot be connected by
 * a prop. The alternative — re-parenting the iframe into the route — would
 * reload it and restart playback, which the single-persistent-instance rule
 * forbids. A store lets the route read the state while the shell keeps
 * rendering the same node.
 *
 * **Why it is not persisted.** A cold launch must not restore into a *visible*
 * player, and persisting a `true` would make stored state reintroduce the
 * visible-player configuration this change parks by default. It is therefore a
 * per-visit view state: it resets with the page, and `PlayerHost` clears it when
 * the app goes idle.
 *
 * It holds no transport state. Playback continues identically in both states; the
 * flag changes only how the host is presented.
 */
export interface VideoModeState {
  /** True only while the user has explicitly asked to see the video. */
  visible: boolean;
  setVisible(visible: boolean): void;
  toggle(): void;
  reset(): void;
}

export const initialVideoModeState = { visible: false } as const;

/** Reset video mode — test isolation and the idle path that must clear it. */
export function resetVideoModeStore(): void {
  useVideoModeStore.setState({ ...initialVideoModeState });
}

export const useVideoModeStore = create<VideoModeState>()((set, get) => ({
  ...initialVideoModeState,
  setVisible: (visible) => set({ visible }),
  toggle: () => set({ visible: !get().visible }),
  reset: () => set({ ...initialVideoModeState }),
}));
