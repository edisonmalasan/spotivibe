import { create } from "zustand";
import type { Track } from "@/data/repositories";

/**
 * `radioStore` (M10 task 4.1; design §1/§3): the radio's **identity and
 * bookkeeping only** — its seed, the ids this radio has played, the refill
 * counter, and its status.
 *
 * Design §1: *a radio is a queue mode, not a second player.* The tracks live in
 * `queueStore` with `source: "radio"`, so the transport, the mini-player, Now
 * Playing, and the queue view are literally the same state an ordinary queue is.
 * That is why this store holds **no track list, no queue membership, and no
 * transport field**: it owns the seed, the played set, the variant, and the
 * status, and nothing else. A store that also held the tracks would be a second
 * source of truth for "what plays next" — the alternative design §1 rejects.
 *
 * Design §3: the played set lives here and is sent with each refill as the
 * bounded `exclude` list, and the engine *also* filters the response against it.
 * Enforcing the invariant on both sides of the network call is the point: the
 * server can only honor the ids it was given.
 *
 * Layering: components and the refill engine → radioStore. This module imports
 * only `zustand` and the canonical `Track` type — never `playerStore`,
 * `queueStore`, the engine, or the request layer, so a radio can never gain the
 * power to move the pointer or start playback on its own.
 */

/** What a radio is playing from: one track, or one artist. */
export type RadioSeed =
  { kind: "track"; track: Track } | { kind: "artist"; artist: { id?: string; name: string } };

/** The radio's lifecycle: started and running, finished, or failed. */
export type RadioStatus = "idle" | "active" | "ended" | "error";

export interface RadioState {
  /** What this radio follows, or `null` when no radio is running. */
  seed: RadioSeed | null;
  status: RadioStatus;
  /** Ids played during THIS radio, in play order, deduped. */
  playedIds: string[];
  /** Refill counter: advances only after a successful refill. */
  variant: number;
  /** The last failure worth showing on the queue, or `null`. */
  lastError: string | null;

  /** Begin a radio: fresh played set, variant back to 0, any error cleared. */
  startRadio(seed: RadioSeed): void;
  /** End the radio and clear every trace of it. */
  stopRadio(): void;
  /** Record a played track; a repeat or an id outside a radio is ignored. */
  markPlayed(trackId: string): void;
  /**
   * Advance the refill counter and return the new value. Nothing else moves it:
   * the caller makes the request and calls this only after a *successful*
   * refill, so a failure leaves the variant — and therefore the seed rotation —
   * exactly where it was.
   */
  advanceVariant(): number;
  /** Move to a status, recording (or clearing) the message shown with it. */
  setStatus(status: RadioStatus, error?: string | null): void;
}

/** Message a failed refill reports when the caller carries no text. */
export const DEFAULT_RADIO_ERROR = "Radio refill failed.";

/**
 * The pure request identity of a seed: what a refill asks for, and nothing more
 * (design §2 — the server learns the identity and the client's own refill
 * counter, never anything derived from the listener).
 *
 * A track seed becomes the track's public title plus its first artist's name
 * when it has one; an artist seed becomes the artist's public name. A track with
 * no credited artist simply carries no `artist`.
 */
export function radioIdentity(
  seed: RadioSeed,
): { kind: "track"; title: string; artist?: string } | { kind: "artist"; artist: string } {
  if (seed.kind === "artist") return { kind: "artist", artist: seed.artist.name };
  const artist = seed.track.artists[0]?.name;
  return artist === undefined
    ? { kind: "track", title: seed.track.title }
    : { kind: "track", title: seed.track.title, artist };
}

export const initialRadioState = {
  seed: null as RadioSeed | null,
  status: "idle" as RadioStatus,
  playedIds: [] as string[],
  variant: 0,
  lastError: null as string | null,
};

/** Reset radio data — test isolation and hot-reload hygiene. */
export function resetRadioStore(): void {
  useRadioStore.setState({ ...initialRadioState });
}

export const useRadioStore = create<RadioState>()((set, get) => ({
  ...initialRadioState,

  startRadio(seed) {
    // A second radio replaces the first outright: the played set belongs to one
    // radio's life, so carrying it across would exclude tracks a new radio has
    // never played.
    set({
      seed,
      status: "active",
      playedIds: [],
      variant: 0,
      lastError: null,
    });
  },

  stopRadio() {
    set({ ...initialRadioState, playedIds: [] });
  },

  markPlayed(trackId) {
    const { seed, playedIds } = get();
    // The played set is scoped to a radio's life: with no radio running there is
    // nothing to scope it to, and recording anyway would exclude the track from
    // the *next* radio's refills.
    if (seed === null) return;
    if (trackId.trim() === "" || playedIds.includes(trackId)) return;
    set({ playedIds: [...playedIds, trackId] });
  },

  advanceVariant() {
    const variant = get().variant + 1;
    set({ variant });
    return variant;
  },

  setStatus(status, error) {
    // A non-error status clears the message; an error without text gets the
    // documented default so the queue can always offer a retry against
    // something readable.
    const lastError =
      status === "error"
        ? error === undefined || error === null
          ? DEFAULT_RADIO_ERROR
          : error
        : null;
    set({ status, lastError });
  },
}));
