"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useMemo } from "react";
import { Shelf } from "@/components/recommendations/Shelf";
import type { ListeningEventRecord, Track } from "@/data/repositories";
import {
  QUICK_PICK_SURFACE,
  presentsSurface,
  type HomeFilterValue,
} from "@/features/home/homeFilter";
import { deriveQuickPicks, quickPickHref, type QuickPick } from "@/features/home/quickPicks";

/**
 * Home's Quick Picks shelf (M17; spec: `home-mixes` — "Quick Picks lead to
 * surfaces that exist"; `discovery` — "Quick Picks navigate to existing
 * surfaces"; design decision 5).
 *
 * Each card is a real `next/link` anchor over an existing route — never a `div`
 * with a click handler, and never a card whose target could not be resolved. The
 * derivation already dropped anything unresolvable, and this component drops
 * anything left, so a card that renders is a card that navigates.
 *
 * Geometry follows DESIGN.md's "Square Album Card" for every entry, including the
 * artist ones: two of the three kinds are not artists, and a rail that mixed a
 * circular crop into a row of square covers would break the square/circular
 * alternation the feed's geometry rhythm is built on.
 *
 * Motion: none (design decision 6 — M19 owns the vocabulary).
 */

/** Section title. Says what the shelf is, without claiming it is curated. */
export const QUICK_PICKS_TITLE = "Quick Picks";

/** Secondary line: where every entry leads. */
export const QUICK_PICKS_DESCRIPTION =
  "Artists, releases, and searches from your languages and what you already played.";

/** Square cover box at the 6px image radius, per DESIGN.md. */
const COVER_CLASS =
  "flex aspect-square w-full items-center justify-center overflow-hidden rounded-cards bg-graphite";

/**
 * One entry's cover: the best artwork the local material offers, or a
 * monochrome placeholder. A search entry never has artwork by construction — it
 * names a query, not a release — so it keeps the icon.
 */
function PickCover({ pick }: { pick: QuickPick }) {
  if (pick.artworkUrl === undefined) {
    return (
      <span className={COVER_CLASS}>
        <Search className="size-8 text-fog" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={COVER_CLASS}>
      {/* Provider artwork thumbnails: dynamic remote URLs, no optimizer allowlist
          yet (M9 owns asset handling). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={pick.artworkUrl}
        alt=""
        width={300}
        height={300}
        loading="lazy"
        className="size-full rounded-cards object-cover"
      />
    </span>
  );
}

/** One entry: a link, with the kind and target exposed for tests and evidence. */
function QuickPickCard({ pick }: { pick: QuickPick }) {
  const href = quickPickHref(pick);
  // Unreachable through the shelf — `deriveQuickPicks` dropped every entry whose
  // href cannot be resolved — and returning nothing rather than a dead card is the
  // only honest rendering left if one ever arrives.
  if (href === null) return null;
  return (
    <Link
      href={href}
      data-testid="quick-pick"
      data-quick-pick-id={pick.id}
      data-quick-pick-kind={pick.kind}
      data-quick-pick-target={pick.target}
      className="block w-full"
    >
      <article className="flex w-full flex-col gap-2 rounded-cards bg-carbon p-3 hover:bg-graphite">
        <PickCover pick={pick} />
        <span className="flex flex-col gap-1">
          <span className="truncate text-body-lg font-semibold text-pure-white">{pick.title}</span>
          <span className="truncate text-body-lg font-regular text-mist">{pick.subtitle}</span>
        </span>
      </article>
    </Link>
  );
}

export interface QuickPicksShelfProps {
  /** Liked tracks, newest-first (the `libraryStore` slice). */
  likedTracks: readonly Track[];
  /** Listening events, newest-first (the `historyStore` slice). */
  events: readonly ListeningEventRecord[];
  /** The selected catalog language codes. */
  languages: readonly string[];
  /** The presented filter, so the shelf follows the one section model's filter. */
  /**
   * Provider results the Home feed already holds, for the cold-start stand-in.
   *
   * Optional and read only when there is no local material, so a caller that has
   * none — every warm-path test of the derivation, for instance — renders today's
   * rail unchanged.
   */
  providerTracks?: readonly Track[];
  filter?: HomeFilterValue;
  className?: string;
}

/**
 * The Quick Picks rail.
 *
 * A device with no local material still gets its language entries, because a
 * selected language is a preference the device genuinely holds and `/search`
 * resolves it — so the derivation always yields at least one entry, and the
 * `Shelf` primitive's own ready-with-no-children rule is the only empty handling
 * needed. That is why this shelf passes no `empty` copy: the state is
 * unreachable, and copy for it would be copy no test could reach.
 *
 * When such a device is also handed `providerTracks`, the rail fills with real
 * artists and releases ahead of that language entry. What the rail never does —
 * cold, warm, or in between — is render a card whose target cannot be resolved:
 * every one of them navigates.
 */
export function QuickPicksShelf({
  likedTracks,
  events,
  languages,
  providerTracks,
  filter = "all",
  className = "",
}: QuickPicksShelfProps) {
  const picks = useMemo(
    () => deriveQuickPicks({ languages, taste: { likedTracks, events }, providerTracks }),
    [events, languages, likedTracks, providerTracks],
  );

  if (!presentsSurface(QUICK_PICK_SURFACE, filter)) return null;

  return (
    <Shelf
      title={QUICK_PICKS_TITLE}
      description={QUICK_PICKS_DESCRIPTION}
      shape="square"
      state="ready"
      className={className}
      data-testid={QUICK_PICK_SURFACE.id}
    >
      {picks.map((pick) => (
        <QuickPickCard key={pick.id} pick={pick} />
      ))}
    </Shelf>
  );
}
