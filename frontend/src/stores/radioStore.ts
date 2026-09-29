import { create } from "zustand";
import type { RadioSnapshot, Track } from "@/data/repositories";

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
  /**
   * Restore a persisted rotation counter. Only {@link restoreRadio} calls this:
   * a reload resumes the rotation, it does not rewind it.
   */
  setVariant(variant: number): void;
  /** Move to a status, recording (or clearing) the message shown with it. */
  setStatus(status: RadioStatus, error?: string | null): void;
}

/** Message a failed refill reports when the caller carries no text. */
export const DEFAULT_RADIO_ERROR = "Radio refill failed.";

/**
 * The persistable radio types live in the data layer, because the **snapshot**
 * they describe is a repository shape: the store re-exports them so callers of
 * `snapshotRadio`/`restoreRadio` do not have to reach across layers for them.
 */
export type { RadioSeedSnapshot, RadioSnapshot } from "@/data/repositories";

/**
 * The persistable form of the current radio, or `null` when no radio is running
 * (never started, or ended) — a finished radio must not be resurrected.
 */
export function snapshotRadio(state: RadioState): RadioSnapshot | null {
  const { seed, status, variant } = state;
  if (seed === null || status === "ended") return null;
  if (seed.kind === "track") {
    const artist = seed.track.artists[0]?.name;
    return {
      seed: {
        kind: "track",
        trackId: seed.track.id,
        title: seed.track.title,
        ...(artist !== undefined ? { artist } : {}),
      },
      variant,
    };
  }
  return {
    seed: {
      kind: "artist",
      ...(seed.artist.id !== undefined ? { id: seed.artist.id } : {}),
      name: seed.artist.name,
    },
    variant,
  };
}

/**
 * Put a persisted radio back, resolving a track radio's seed through
 * `resolveTrack`.
 *
 * Returns `false` — having changed nothing — when a track radio's seed is no
 * longer available. That is the honest outcome: the radio's identity is the seed
 * track, and without it there is nothing to refill *for*. The queue keeps
 * playing as ordinary content rather than pretending a radio continues.
 */
export function restoreRadio(
  snapshot: RadioSnapshot,
  resolveTrack: (trackId: string) => Track | undefined,
): boolean {
  const seed: RadioSeed | null =
    snapshot.seed.kind === "artist"
      ? {
          kind: "artist",
          artist: {
            ...(snapshot.seed.id !== undefined ? { id: snapshot.seed.id } : {}),
            name: snapshot.seed.name,
          },
        }
      : (() => {
          const track = resolveTrack(snapshot.seed.trackId);
          return track === undefined ? null : { kind: "track", track };
        })();
  if (seed === null) return false;
  const store = useRadioStore.getState();
  store.startRadio(seed);
  // The rotation continues where it left off rather than restarting, so a
  // reloaded radio does not re-ask the question it already asked.
  if (snapshot.variant > 0) store.setVariant(snapshot.variant);
  return true;
}

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

  /**
   * Put the rotation counter back to a persisted value, so a reloaded radio
   * resumes its rotation instead of re-asking the question it already asked.
   * Only ever used by {@link restoreRadio}; the refill path moves the counter
   * exclusively through {@link RadioState.advanceVariant}.
   */
  setVariant(variant) {
    if (!Number.isInteger(variant) || variant < 0) return;
    set({ variant });
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
