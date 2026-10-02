"use client";

import { Music2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Shelf } from "@/components/recommendations/Shelf";
import type { ListeningEventRecord, Track } from "@/data/repositories";
import { playFromShelf } from "@/features/home/browsePlayback";
import {
  MIX_CARD_SURFACE,
  presentsSurface,
  type HomeFilterValue,
} from "@/features/home/homeFilter";
import { deriveMixCollage, type MixCollage } from "@/features/home/mixes/collage";
import { mixCardPlans, type MixCardPlan } from "@/features/home/mixes/namedMixes";
import { systemClock, type Clock } from "@/features/home/timeBands";
import { generateMix, type MixOutcome } from "@/features/mixes/generateMix";
import { buildTasteProfile } from "@/features/personalization/tasteProfile";
import { useMixStore } from "@/stores/mixStore";

/**
 * Home's named mix cards (M17; spec: `home-mixes` — "Mix cards start playback and
 * name honestly"; design decisions 1, 2, and 6).
 *
 * Three rules this surface exists to keep:
 *
 * 1. **One generator, invoked on activation.** A card carries an identity and a
 *    seed strategy and nothing else; the mix comes from `generateMix`, the same
 *    path Smart Mixes uses. Nothing here composes and nothing here issues a
 *    provider request until a listener presses, so a Home that renders six cards
 *    spends no provider work, starts no playback, and adds no request to the
 *    feed's count.
 * 2. **Honest names, decided by the shared rule.** Each card's display name is
 *    its own leading taste word, checked by `isHonestMixName` inside
 *    `mixCardPlans`. This component never names anything itself, so there is no
 *    second place where a name could become a ranking claim.
 * 3. **An empty mix is explained.** Activation can still find nothing to build
 *    from — the signal a card was rendered from can be gone by the time it is
 *    pressed — and then the card says why and starts nothing, rather than
 *    behaving as though it worked.
 *
 * Motion: none. M19 owns the vocabulary (design decision 6), so this surface
 * introduces none of its own.
 */

/** Section title. Says what activating a card does; claims nothing about taste. */
export const MIX_CARDS_TITLE = "Start a mix";

/** Secondary line: where a mix comes from, and that it is composed on demand. */
export const MIX_CARDS_DESCRIPTION =
  "Composed on this device the moment you press one, from what you like and play.";

/** Explained-empty copy for a device with no local taste at all. */
export const MIX_CARDS_EMPTY = {
  title: "Mixes appear after some listening",
  description:
    "Like a track or play a few songs on this device and the cards will have something to work from.",
};

/** Cover box, square at the 6px image radius, graphite behind the artwork. */
const COVER_CLASS =
  "flex aspect-square w-full items-center justify-center overflow-hidden rounded-cards bg-graphite";

/** A 2×2 collage: four covers, the card's own radius clipping the whole grid. */
const COLLAGE_CLASS =
  "grid aspect-square w-full grid-cols-2 grid-rows-2 overflow-hidden rounded-cards bg-graphite";

/** Copy for an activation that produced no mix; see {@link noticeFor}. */
export type MixCardNotice = string;

/**
 * Explain an activation that produced no mix.
 *
 * The three outcomes get three different answers, exactly as `MixList` treats
 * them: `no-signal` means this device has nothing to build from, `empty` means
 * the feed had nothing, and `unavailable` is a provider failure — collapsing them
 * into one message would tell a listener the feed failed when their own device
 * simply has no taste signal yet.
 */
function noticeFor(outcome: Exclude<MixOutcome, { status: "created" }>): MixCardNotice {
  if (outcome.status === "no-signal") {
    return "This device has nothing to build from yet — like a track or play a few songs, then try again.";
  }
  if (outcome.status === "empty") return "The feed had nothing for this mix right now.";
  return outcome.message;
}

/** The cover a card shows: the composed mix's collage, or the placeholder. */
function MixCover({ collage }: { collage: MixCollage | undefined }) {
  if (collage === undefined || collage.kind === "placeholder") {
    return (
      <span className={COVER_CLASS} data-testid="mix-card-cover-placeholder">
        <Music2 className="size-8 text-fog" aria-hidden="true" />
      </span>
    );
  }
  if (collage.kind === "single") {
    return (
      <span className={COVER_CLASS} data-testid="mix-card-cover-single">
        {/* Provider artwork thumbnails: dynamic remote URLs, no optimizer
            allowlist yet (M9 owns asset handling). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={collage.url}
          alt=""
          width={300}
          height={300}
          loading="lazy"
          className="size-full rounded-cards object-cover"
        />
      </span>
    );
  }
  return (
    <span className={COLLAGE_CLASS} data-testid="mix-card-cover-collage">
      {collage.urls.map((url) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={url}
          src={url}
          alt=""
          width={150}
          height={150}
          loading="lazy"
          className="size-full object-cover"
        />
      ))}
    </span>
  );
}

/** One card: its cover, the honest name, and the single action it owns. */
function MixCard({
  plan,
  collage,
  busy,
  notice,
  onPlay,
}: {
  plan: MixCardPlan;
  collage: MixCollage | undefined;
  busy: boolean;
  notice: MixCardNotice | null;
  onPlay: (plan: MixCardPlan) => void;
}) {
  const { identity } = plan;
  return (
    <li className="flex w-full flex-col">
      <button
        type="button"
        data-testid="mix-card"
        data-mix-id={identity.id}
        aria-label={`Play ${identity.name}`}
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={() => {
          onPlay(plan);
        }}
        className="flex w-full flex-col gap-2 rounded-cards bg-carbon p-3 text-left hover:bg-graphite"
      >
        <MixCover collage={collage} />
        <span className="flex flex-col gap-1">
          <span className="truncate text-body-lg font-semibold text-pure-white">
            {identity.name}
          </span>
          <span className="truncate text-body-lg font-regular text-mist">On this device</span>
        </span>
      </button>
      {notice === null ? null : (
        <p role="status" data-testid="mix-card-notice" className="mt-2 text-body-lg text-mist">
          {notice}
        </p>
      )}
    </li>
  );
}

export interface MixCardsProps {
  /** Liked tracks, newest-first (the `libraryStore` slice). */
  likedTracks: readonly Track[];
  /** Listening events, newest-first (the `historyStore` slice). */
  events: readonly ListeningEventRecord[];
  /** The selected catalog language codes, for the language-aware cards. */
  languages: readonly string[];
  /**
   * The instant the cards' profile is dated against. Supplied by the host so the
   * mix cards and the time-aware shelf cannot disagree about "now"; when omitted
   * the card reads it from `clock` once per mount, which is what a standalone
   * caller gets.
   */
  now?: number;
  /**
   * Injected clock (defaults to the system one) so a test dates the generation
   * without reading the wall clock. Read at activation time, which is the only
   * moment a generation instant matters.
   */
  clock?: Clock;
  /** The presented filter, so the row follows the one section model's filter. */
  filter?: HomeFilterValue;
  className?: string;
}

/** Per-card surface state: which card is composing, and what it has to say. */
interface CardState {
  /** The identity currently composing, or `null`. */
  busyId: string | null;
  /** The last activation that could not produce a mix, per card id. */
  notices: Record<string, MixCardNotice>;
  /** Each composed card's cover, derived from the mix's own tracks. */
  collages: Record<string, MixCollage>;
}

const IDLE: CardState = { busyId: null, notices: {}, collages: {} };

/**
 * The mix-card row.
 *
 * Renders nothing without a local taste signal: a card with nothing to build from
 * could only ever answer "no signal", so it is not offered at all — the stronger
 * half of "an empty mix is explained rather than silently inert". The explanation
 * itself still exists for the case that does arise, where the signal disappears
 * between rendering a card and pressing it.
 *
 * The profile is derived with `buildTasteProfile` from the store slices the feed
 * already holds, so this surface reads no IndexedDB of its own and adds nothing
 * to Home's request count. The clock is read once per mount: the recency decay it
 * feeds is a page-lifetime approximation, and reading it during render would make
 * every render impure and re-derive every card for no reason.
 */
export function MixCards({
  likedTracks,
  events,
  languages,
  now: suppliedNow,
  clock = systemClock,
  filter = "all",
  className = "",
}: MixCardsProps) {
  const upsert = useMixStore((state) => state.upsert);
  const [mountNow] = useState(() => suppliedNow ?? clock());
  const [card, setCard] = useState<CardState>(IDLE);
  const now = suppliedNow ?? mountNow;

  const profile = useMemo(
    () => buildTasteProfile({ likedTracks, events, languages, now }),
    [events, languages, likedTracks, now],
  );
  const plans = useMemo(() => mixCardPlans({ profile, languages }), [profile, languages]);

  const play = useCallback(
    async (plan: MixCardPlan) => {
      const id = plan.identity.id;
      setCard((current) => ({ ...current, busyId: id }));
      try {
        const outcome = await generateMix({
          profile: plan.profile,
          // A language card is scoped to its own language; the named cards use the
          // whole selection the listener chose.
          languages: plan.identity.language === undefined ? languages : [plan.identity.language],
          now: clock(),
        });

        if (outcome.status !== "created") {
          setCard((current) => ({
            ...current,
            busyId: null,
            notices: { ...current.notices, [id]: noticeFor(outcome) },
          }));
          return;
        }

        // The generator stored the mix; the store's cache is updated so the Smart
        // Mixes shelf on this very page lists what was just built.
        upsert(outcome.mix);
        setCard((current) => ({
          busyId: null,
          notices: current.notices,
          // The cover comes from the mix's own tracks — the first thing a card can
          // know about itself that is real evidence rather than a guess.
          collages: { ...current.collages, [id]: deriveMixCollage(outcome.mix.tracks) },
        }));
        const first = outcome.mix.tracks[0];
        // Playing rather than navigating: the listener stays on Home, and the queue
        // source is the same `browse` every other shelf activation records.
        if (first !== undefined) playFromShelf(first, outcome.mix.tracks);
      } catch (error: unknown) {
        // A thrown error is still "this card produced no mix", and saying so is the
        // difference between a card and an inert tile.
        setCard((current) => ({
          ...current,
          busyId: null,
          notices: {
            ...current.notices,
            [id]: error instanceof Error ? error.message : "This mix could not be built.",
          },
        }));
      }
    },
    [clock, languages, upsert],
  );

  if (!presentsSurface(MIX_CARD_SURFACE, filter)) return null;
  if (!profile.hasSignal) return null;

  return (
    <Shelf
      title={MIX_CARDS_TITLE}
      description={MIX_CARDS_DESCRIPTION}
      shape="square"
      state={plans.length > 0 ? "ready" : "empty"}
      empty={MIX_CARDS_EMPTY}
      className={className}
      data-testid={MIX_CARD_SURFACE.id}
    >
      {plans.map((plan) => (
        <MixCard
          key={plan.identity.id}
          plan={plan}
          collage={card.collages[plan.identity.id]}
          busy={card.busyId === plan.identity.id}
          notice={card.notices[plan.identity.id] ?? null}
          onPlay={(selected) => {
            void play(selected);
          }}
        />
      ))}
    </Shelf>
  );
}
