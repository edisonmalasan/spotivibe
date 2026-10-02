import { useLibraryStore } from "@/stores/libraryStore";
import { usePlayerStore } from "@/stores/playerStore";
import { keyHasLocalMeaning } from "@/features/shortcuts/localMeaning";

/**
 * The global binding set as **data** (M18 design decisions 1–3).
 *
 * One table is read by the listener and rendered by the help surface. That is the
 * point: a binding that exists but is unlisted, or a listed key that fires
 * nothing, is the ordinary way a help dialog starts lying. Deriving both from one
 * array means a test can compare the two and fail.
 *
 * **Every binding goes through the store's own actions.** Nothing here writes
 * player or library state directly — `play`, `pause`, `seek`, `setVolume`,
 * `toggleMute`, and `libraryStore.toggleLike` already own clamping, persistence,
 * and the engine bridge, and a shortcut that bypassed them would be a second set
 * of rules for the same state.
 *
 * **Every binding is gated by `keyHasLocalMeaning` before it runs**, inside
 * {@link dispatchShortcut} rather than here, so a future binding cannot be added
 * without the guard. The guard is one definition (design decision 1), not one
 * check per handler.
 */

/** The documented seek step, in seconds. */
export const SEEK_STEP_SECONDS = 10;

/** The documented volume step, in the store's 0–100 unit. */
export const VOLUME_STEP = 5;

/** What a binding needs from its host — currently only the help surface. */
export interface ShortcutContext {
  /** Open or close the discoverable help dialog. */
  setHelpOpen(open: boolean): void;
  /**
   * Whether help is currently open.
   *
   * A function rather than a value so the `keydown` listener can be attached once
   * and still read the latest state: re-attaching the document listener on every
   * state change would be a second way for a shortcut to be dropped.
   */
  isHelpOpen(): boolean;
}

/** One global binding: what it listens for, what it does, and how help names it. */
export interface ShortcutBinding {
  /** Stable identity — the help row's React key and its `data-shortcut-id`. */
  id: string;
  /**
   * The `KeyboardEvent.key` values this binding answers, doubled as the help copy.
   *
   * **Not quite "the exact values the platform produces", and deliberately so.**
   * `play-pause` lists `"Space"`, which is the legacy spelling no current engine
   * emits — a real spacebar arrives as `" "`. The field is help copy first, and
   * `Space` is what every platform calls that key in its own documentation. The
   * matcher accepts both spellings, so the table stays readable and the behaviour
   * stays correct; an earlier version of this docstring claimed "exact", which was
   * false, and a docstring that overstates its own field is how a reader ends up
   * trusting a claim nobody checked.
   *
   * Deriving help copy from the same field is still the point: a binding whose
   * listed key could not be pressed is a help dialog documenting a key nobody has,
   * and `shortcut-bindings.test.ts` asserts every listed key is claimed.
   */
  keys: string[];
  /** What it does, in the imperative. */
  label: string;
  /** How it behaves at the edges, for the listener who needs to know. */
  description: string;
  /** Whether this event is this binding's keypress. */
  matches(event: KeyboardEvent): boolean;
  /** Perform it. Reached only once the guard has declined to fire. */
  run(context: ShortcutContext): void;
}

/**
 * Whether a browser or platform chord is holding the key.
 *
 * One rule for every binding: `Ctrl`/`Cmd`/`Alt` belong to the platform and the
 * browser, and a shortcut that answers `Cmd+M` or `Ctrl+L` would fight the
 * window manager and the address bar. `Shift` is deliberately **not** excluded —
 * `?` and the letter bindings both require it on a standard layout, so excluding
 * it would disable half the set.
 */
function hasPlatformModifier(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

/** Case-insensitive letter match, so `m` and `M` are the same binding. */
function isLetter(event: KeyboardEvent, letter: string): boolean {
  return event.key.toUpperCase() === letter;
}

/**
 * The space bar.
 *
 * The platform value is `" "`, so that is what the matching keys on; `"Space"` is
 * the legacy spelling still produced by older engines, and accepting it costs
 * nothing. It is also the value listed for display, which is what makes the
 * binding table's `keys` field honest: every entry in it is a real
 * `KeyboardEvent.key`, so help cannot document a key that cannot be pressed.
 */
function isSpace(event: KeyboardEvent): boolean {
  return event.key === " " || event.key === "Space";
}

function seekBy(deltaSeconds: number): void {
  const player = usePlayerStore.getState();
  player.seek(player.positionSeconds + deltaSeconds);
}

/**
 * Raise the volume by one step, unmuting first.
 *
 * `setVolume` deliberately does not clear `muted` — the store's own contract is
 * that the two are independent. So a shortcut that only called it would move a
 * number the listener cannot hear, and the keypress would look broken. Design
 * decision 3: raising the volume of a muted player unmutes it.
 */
function raiseVolumeBy(step: number): void {
  const player = usePlayerStore.getState();
  if (player.muted) player.toggleMute();
  player.setVolume(player.volume + step);
}

/**
 * Toggle the like on the now-playing track.
 *
 * Nothing happens with no track playing: there is no row to like, and the
 * library has no notion of a "current" like to toggle. Matching
 * `app/now-playing/page.tsx`'s existing precedent is deliberate — Apply resolved
 * the open question this way rather than binding it to a focused shelf row.
 */
function toggleNowPlayingLike(): void {
  const track = usePlayerStore.getState().currentTrack;
  if (!track) return;
  void useLibraryStore.getState().toggleLike(track);
}

export const SHORTCUT_BINDINGS: readonly ShortcutBinding[] = [
  {
    id: "play-pause",
    keys: ["Space"],
    label: "Play or pause",
    description: "Toggles playback. Does nothing with no track loaded.",
    matches: isSpace,
    run: () => {
      const player = usePlayerStore.getState();
      if (player.status === "playing") player.pause();
      else player.play();
    },
  },
  {
    id: "seek-back",
    keys: ["ArrowLeft"],
    label: `Back ${SEEK_STEP_SECONDS} seconds`,
    description: "Seeks backwards, stopping at the start of the track.",
    matches: (event) => event.key === "ArrowLeft",
    run: () => seekBy(-SEEK_STEP_SECONDS),
  },
  {
    id: "seek-forward",
    keys: ["ArrowRight"],
    label: `Forward ${SEEK_STEP_SECONDS} seconds`,
    description: "Seeks forwards, stopping at the end of the track.",
    matches: (event) => event.key === "ArrowRight",
    run: () => seekBy(SEEK_STEP_SECONDS),
  },
  {
    id: "volume-up",
    keys: ["ArrowUp"],
    label: `Volume up ${VOLUME_STEP}`,
    description: "Raises the volume and unmutes if the player was muted.",
    matches: (event) => event.key === "ArrowUp",
    run: () => raiseVolumeBy(VOLUME_STEP),
  },
  {
    id: "volume-down",
    keys: ["ArrowDown"],
    label: `Volume down ${VOLUME_STEP}`,
    description: "Lowers the volume. Mute is left as it is.",
    matches: (event) => event.key === "ArrowDown",
    run: () => {
      const player = usePlayerStore.getState();
      player.setVolume(player.volume - VOLUME_STEP);
    },
  },
  {
    id: "mute",
    keys: ["M"],
    label: "Mute or unmute",
    description: "Toggles the player's real muted state. Your volume is not changed.",
    matches: (event) => isLetter(event, "M"),
    run: () => usePlayerStore.getState().toggleMute(),
  },
  {
    id: "like",
    keys: ["L"],
    label: "Like the current track",
    description: "Saves or removes the track you are listening to right now.",
    matches: (event) => isLetter(event, "L"),
    run: toggleNowPlayingLike,
  },
  {
    id: "help",
    keys: ["?"],
    label: "Open this list",
    description: "Lists every keyboard shortcut.",
    matches: (event) => event.key === "?",
    run: (context) => context.setHelpOpen(true),
  },
  {
    id: "help-dismiss",
    keys: ["Escape"],
    label: "Close this list",
    // The wording is deliberately careful. An earlier draft read "Closes the
    // shortcut list and nothing else", which reads as though *this binding* is the
    // mechanism — and it is not. While this list is open, focus is inside the dialog,
    // `Dialog` stops propagation, and the guard would decline anyway; the row is
    // printed inside the very dialog whose own handler does the closing. What the
    // user experiences is true either way (Escape does close the list); what was
    // false was the claim about which code performs it.
    description: "Escape closes this list. An open menu or dialog keeps its own dismissal.",
    matches: (event) => event.key === "Escape",
    // Design decision 2, amended after Apply: the global handler does not own
    // `Escape` dismissal. It owns it only to close help, and even that is a
    // **backstop** — it fires only when a keypress reaches this handler from
    // outside the dialog, which is what happens when focus has been stolen from the
    // dialog by something else. A menu that closes itself first is never acted on
    // twice, and a dialog that called `stopPropagation()` is never seen at all.
    // `shortcut-bindings.test.ts` exercises exactly the focus-stolen case.
    run: (context) => {
      if (context.isHelpOpen()) context.setHelpOpen(false);
    },
  },
] as const;

/** The binding a keypress addresses, or `null` when it addresses none of them. */
export function bindingFor(event: KeyboardEvent): ShortcutBinding | null {
  if (hasPlatformModifier(event)) return null;
  return SHORTCUT_BINDINGS.find((binding) => binding.matches(event)) ?? null;
}

/**
 * Keys whose browser default action the binding takes over.
 *
 * The default action of `Space` and the four arrows is to scroll. A shortcut that
 * paused playback *and* scrolled the page would look broken, so those are
 * cancelled — and only those: `Escape` is excluded because its default action
 * (leaving fullscreen) belongs to the listener, and cancelling it while help is
 * closed would be a global handler taking a keypress it did not handle.
 */
const SCROLL_KEYS = new Set([" ", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * Run the binding this keypress addresses, if any.
 *
 * The guard comes first and unconditionally, which is what makes it a property
 * rather than a convention: it is impossible to reach a `run` without passing
 * `keyHasLocalMeaning`. Returns whether a binding ran, so a caller (and a test)
 * can tell "nothing was bound to this key" from "a binding declined".
 */
export function dispatchShortcut(event: KeyboardEvent, context: ShortcutContext): boolean {
  if (keyHasLocalMeaning(event.target)) return false;
  const binding = bindingFor(event);
  if (!binding) return false;
  if (SCROLL_KEYS.has(event.key)) event.preventDefault();
  binding.run(context);
  return true;
}
