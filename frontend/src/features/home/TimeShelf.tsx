"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/design-system/Button";
import { Shelf } from "@/components/recommendations/Shelf";
import type { ListeningEventRecord, Track } from "@/data/repositories";
import { playFromShelf } from "@/features/home/browsePlayback";
import {
  TIME_SHELF_SURFACE,
  presentsSurface,
  type HomeFilterValue,
} from "@/features/home/homeFilter";
import { ShelfTrackCard } from "@/features/home/ShelfTrackCard";
import {
  bandForHour,
  bandTasteProfile,
  localHourOf,
  selectBandTracks,
  systemClock,
  TIME_BAND_LABELS,
  TIME_BAND_TERMS,
  type Clock,
  type TimeBand,
} from "@/features/home/timeBands";
import { generateMix, type MixOutcome } from "@/features/mixes/generateMix";
import { useMixStore } from "@/stores/mixStore";

/**
 * Home's time-aware shelf (M17; spec: `home-mixes` — "A time-aware shelf is
 * offered"; `discovery` — "The time-aware shelf is seeded by the current band";
 * design decision 3).
 *
 * The shelf has two jobs and neither of them is a second generation path.
 *
 * 1. **It is a lens over material the device already holds.** The band decides
 *    which of the listener's liked tracks and recent plays appears, and that is a
 *    pure selection — no request, no write, no reordering of stored history.
 * 2. **It can ask the provider for more, on activation only.** The band selects a
 *    *seed set* as well as local material, and a seed set that reaches nothing is
 *    a decoration rather than a selection. So the shelf carries one action that
 *    composes a mix through `generateMix` — the same generator the mix cards and
 *    the Smart Mixes shelf use — from a profile whose seeds are the band's. A Home
 *    that renders this shelf still issues no request of its own; the request
 *    happens when a listener presses, which is the property task 6.1 asks the
 *    tests to hold still.
 *
 * Three honest-rendering rules:
 *
 * 1. **The label is the band, never a clock reading.** "Evening", not "20:14". A
 *    label formatted from the instant would assert a time the shelf was never
 *    told and that a listener would reasonably read as a timestamp.
 * 2. **An empty shelf says so.** A band with no match in the local material
 *    presents an explained empty state rather than substituting unrelated tracks,
 *    because unrelated tracks under a mood label are a claim the shelf cannot
 *    support.
 * 3. **An activation that produced no mix says so too.** `no-signal`, `empty`,
 *    and a provider failure get three different answers, as the mix cards and
 *    `MixList` give them. A control that can fail silently is an inert tile.
 *
 * **The band reaches a query and never leaves the device.** `generateMix` is handed
 * a profile whose `seedTerms` begin with the band's mood word; the request that
 * results carries public text terms and the listener's language codes, and no band
 * value, no label, and no clock reading. Nothing here is persisted: the band's
 * whole lifetime is this render and the activation below it.
 *
 * Motion: none of this module's own (design decision 6 — M19 owns the vocabulary).
 * The action reuses the design system's Ghost Text Button, so the rendered control
 * carries the primitive's own `transition` exactly as `HomeFilterBar` does; no
 * motion utility is declared here, and `tests/motion-scope.test.ts` enforces
 * that over the milestone's whole source surface rather than over a written list.
 */

/** Explained-empty copy: honest about what would make this shelf have results. */
export const TIME_SHELF_EMPTY = {
  title: "Nothing in this mood on this device yet",
  description:
    "This shelf picks from what you have already liked and played. Play more of what you like and it will fill up.",
};

/**
 * The action's own copy: what pressing it does, and nothing more.
 *
 * Deliberately plain and deliberately *not* a mix name. The label is written
 * before anything has been composed, so a name here would be a claim with no
 * evidence behind it — and a claim word (`isHonestMixName` rejects "top",
 * "best", "essential", …) would be worse. The mix's own name comes from the
 * generator, and is shown only once one exists.
 */
export const TIME_SHELF_ACTION_LABEL = "Play a mix for this time of day";

/** The label while a composition is in flight; the control is disabled meanwhile. */
export const TIME_SHELF_ACTION_BUSY_LABEL = "Building the mix…";

/** Prefix for the status line shown after a composition succeeded. */
export const TIME_SHELF_PLAYING_PREFIX = "Playing ";

/** The action's test id, so a case can reach the one control this shelf owns. */
export const TIME_SHELF_ACTION_ID = "time-shelf-mix-action";

/** The status region's test id — one per shelf, the way the mix cards have one. */
export const TIME_SHELF_STATUS_ID = "time-shelf-status";

/** The secondary line, derived from the band's own mood word. */
export function timeShelfDescription(band: TimeBand): string {
  return `Matched to the ${TIME_BAND_TERMS[band]} mood, from tracks you already have on this device.`;
}

/**
 * Explain an activation that produced no mix.
 *
 * The three outcomes get three different answers, exactly as `MixCards` and
 * `MixList` treat them: `no-signal` means this device has nothing to build from,
 * `empty` means the feed had nothing, and `unavailable` is a provider failure —
 * collapsing them into one message would tell a listener the feed failed when
 * their own device simply has no taste signal yet.
 */
function noticeFor(outcome: Exclude<MixOutcome, { status: "created" }>): string {
  if (outcome.status === "no-signal") {
    return "This device has nothing to build from yet — like a track or play a few songs, then try again.";
  }
  if (outcome.status === "empty") return "The feed had nothing for this mix right now.";
  return outcome.message;
}

export interface TimeShelfProps {
  /** Liked tracks, newest-first (the `libraryStore` slice). */
  likedTracks: readonly Track[];
  /** Listening events, newest-first (the `historyStore` slice). */
  events: readonly ListeningEventRecord[];
  /**
   * The instant this shelf reads its band from. Injected rather than read here so
   * the shelf is a function of the instant a test supplies, and so Home reads the
   * clock once per mount instead of once per surface.
   */
  now: number;
  /**
   * The selected catalog language codes. They travel with the composed request —
   * the discovery contract rejects a request with no language — and they are a
   * preference the device already holds, never anything the band derived.
   */
  languages?: readonly string[];
  /**
   * Injected clock (defaults to the system one), read at *activation* time, which
   * is the only moment a generation instant matters. `now` above dates the band
   * and the profile; this dates the mix.
   */
  clock?: Clock;
  /** The presented filter, so the shelf follows the one section model's filter. */
  filter?: HomeFilterValue;
  className?: string;
}

/** Per-activation state: whether one is composing, and what it has to say. */
interface ActivationState {
  /** True while a composition is in flight; the control is disabled meanwhile. */
  busy: boolean;
  /** The last activation's message, or `null` when nothing has been said yet. */
  status: string | null;
}

const IDLE: ActivationState = { busy: false, status: null };
const COMPOSING: ActivationState = { busy: true, status: null };

/**
 * Subscription for {@link hydrated}: there is nothing to subscribe to.
 *
 * The value flips exactly once, and it is hydration itself that flips it — not an
 * event, a timer, or an effect. `subscribe` therefore never fires and returns the
 * identity teardown React expects.
 */
function subscribeToHydration(): () => void {
  return () => undefined;
}

/** The client snapshot: there is a listener, so this is a real render. */
function onClient(): boolean {
  return true;
}

/** The server snapshot: a prerendered document knows nothing about the listener. */
function onServer(): boolean {
  return false;
}

/**
 * Whether this render is happening on the listener's own device.
 *
 * `useSyncExternalStore` is the primitive for exactly this question, and it is used
 * rather than a `mounted` flag set by an effect because that is what React
 * recommends: an effect whose body calls `setState` produces a second render pass
 * to publish a fact React already knows. Here the two snapshots *are* the answer —
 * `false` for the prerender, `true` for the client — so the first client render
 * matches the prerendered document exactly, hydration stays quiet, and the band
 * appears immediately afterwards.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(subscribeToHydration, onClient, onServer);
}

/**
 * The time-aware shelf: the current band's name, the local material that band
 * selects, and one action that asks the provider for more of it.
 *
 * **The band is read on the listener's own device, never while prerendering.**
 * `/` is statically prerendered, so a band computed during the server render is a
 * band computed at *build* time — and a build made at 13:10 would otherwise ship
 * `<section aria-label="Afternoon">` to every visitor, who then hydrates against
 * text that is not theirs. {@link useHydrated} is the gate: the prerendered
 * document contains no band at all, the first client render matches it exactly
 * (so hydration stays quiet), and the band is still a pure function of the
 * supplied hour.
 *
 * The clock is still read once per mount by the host and handed in, so the band
 * and the profile are dated against the same instant.
 */
export function TimeShelf({
  likedTracks,
  events,
  now,
  languages = [],
  clock = systemClock,
  filter = "all",
  className = "",
}: TimeShelfProps) {
  const upsert = useMixStore((state) => state.upsert);
  const [activation, setActivation] = useState<ActivationState>(IDLE);
  const { busy, status } = activation;
  const hydrated = useHydrated();

  const band = useMemo(() => bandForHour(localHourOf(now)), [now]);
  // The one profile the band composes from: the listener's own local taste, with
  // the band's terms in front of it. `hasSignal` is read off it rather than off a
  // second derivation, so the action and the generator can never disagree about
  // whether this device has anything to build from. Derived before the local
  // selection below, because it is the shelf's more complete statement of what the
  // band chose.
  const profile = useMemo(
    () => bandTasteProfile(band, { likedTracks, events, languages, now }),
    [band, events, languages, likedTracks, now],
  );
  const tracks = useMemo(
    () => selectBandTracks(band, [...likedTracks, ...events.map((event) => event.track)]),
    [band, events, likedTracks],
  );

  const play = useCallback(async () => {
    setActivation(COMPOSING);
    try {
      const outcome = await generateMix({ profile, languages, now: clock() });

      if (outcome.status !== "created") {
        setActivation({ busy: false, status: noticeFor(outcome) });
        return;
      }

      // The generator stored the mix; the store's cache is updated so the Smart
      // Mixes section on this very page lists what was just built.
      upsert(outcome.mix);
      // The name is the generator's own — `deriveMixName`, checked by
      // `isHonestMixName` — and nothing here names anything.
      setActivation({ busy: false, status: `${TIME_SHELF_PLAYING_PREFIX}${outcome.mix.name}` });
      const first = outcome.mix.tracks[0];
      // Playing rather than navigating: the listener stays on Home, and the queue
      // source is the same `browse` every other shelf activation records.
      if (first !== undefined) playFromShelf(first, outcome.mix.tracks);
    } catch (error: unknown) {
      // A thrown error is still "this activation produced no mix", and saying so is
      // the difference between an action and an inert tile.
      setActivation({
        busy: false,
        status: error instanceof Error ? error.message : "This mix could not be built.",
      });
    }
  }, [clock, languages, profile, upsert]);

  if (!presentsSurface(TIME_SHELF_SURFACE, filter)) return null;
  // Nothing band-dependent is rendered before hydration, so a prerendered document
  // cannot ship one visitor's band to another.
  if (!hydrated) return null;

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/*
        The action sits above the shelf it belongs to rather than inside the rail:
        a rail child is a card, and the shelf's own children are the local tracks
        the band selected. Putting the control in the rail would also turn the
        explained-empty state into a "ready" shelf holding one button, which is the
        one rendering the empty state exists to replace.
      */}
      {profile.hasSignal ? (
        <Button
          // The design system's Ghost Text Button, so the action looks like every
          // other secondary control in the shell. `aria-busy` and `disabled` are
          // passed directly rather than through `loading`, because `loading` renders
          // a spinning `LoaderCircle` — motion, which design decision 6 withholds
          // from M17.
          variant="ghost"
          className="w-full justify-start"
          data-testid={TIME_SHELF_ACTION_ID}
          aria-busy={busy || undefined}
          disabled={busy}
          onClick={() => {
            void play();
          }}
        >
          {busy ? TIME_SHELF_ACTION_BUSY_LABEL : TIME_SHELF_ACTION_LABEL}
        </Button>
      ) : null}
      {status === null ? null : (
        <p
          role="status"
          data-testid={TIME_SHELF_STATUS_ID}
          className="text-body-lg font-regular text-mist"
        >
          {status}
        </p>
      )}
      <Shelf
        title={TIME_BAND_LABELS[band]}
        description={timeShelfDescription(band)}
        shape="square"
        state={tracks.length > 0 ? "ready" : "empty"}
        empty={TIME_SHELF_EMPTY}
        data-testid={TIME_SHELF_SURFACE.id}
        data-band={band}
      >
        {tracks.map((track) => (
          <ShelfTrackCard key={track.id} track={track} context={tracks} />
        ))}
      </Shelf>
    </div>
  );
}
