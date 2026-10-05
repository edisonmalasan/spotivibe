"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Shelf, type ShelfState } from "@/components/recommendations/Shelf";
import { ArtistCard } from "@/components/design-system/ArtistCard";
import type { ListeningEventRecord, Track } from "@/data/repositories";
import {
  QUICK_PICK_SURFACE,
  presentsSurface,
  type HomeFilterValue,
} from "@/features/home/homeFilter";
import { deriveQuickPicks, quickPickHref, type QuickPick } from "@/features/home/quickPicks";

/**
 * Home's Quick Picks shelf (M23; spec: `home-mixes` — "Quick Picks are artist
 * surfaces that exist"; `discovery` — "Home discovery feed"; design decisions
 * D1–D4).
 *
 * Each card is a real `next/link` anchor over the artist route — never a `div`
 * with a click handler, and never a card whose target could not be resolved. The
 * derivation already dropped anything unresolvable, and this component drops
 * anything left, so a card that renders is a card that navigates.
 *
 * Geometry is the circular artist card for **every** entry, because every entry
 * is an artist. Before M23 this shelf rendered square covers and mixed in a
 * circular rail elsewhere in the feed; `discovery` permits one circular artist
 * section and `DESIGN.md` forbids two adjacent ones, so this shelf is now that
 * section and the former Popular Artists shelf is consolidated into it. The
 * artwork it shows is the artist's own, resolved from the candidate tracks — no
 * request is issued to obtain it — and `ArtistCard` keeps its placeholder when
 * an artist has no artwork, so a missing image degrades rather than breaking.
 *
 * Motion: none of its own; `ArtistCard` carries the M19 vocabulary.
 */

/** Section title. Says what the shelf is, without claiming it is curated. */
export const QUICK_PICKS_TITLE = "Quick Picks";

/**
 * Failure copy for the rail, exported so `HomeView` has one definition of it.
 *
 * **M23:** moved here from `HomeView` because the rail now owns the error state that
 * the consolidated Popular Artists section used to own. Declared in one place rather
 * than duplicated, so the two surfaces cannot drift into telling the listener
 * different stories about the same failure.
 */
export const QUICK_PICKS_ERROR = {
  title: "This shelf didn't load",
  description: "We couldn't reach the music provider. Check your connection and try again.",
} as const;

/**
 * Secondary line: what every entry is, and where the candidates come from.
 *
 * This string used to say "Artists, releases, and searches". Two of those three
 * are gone as of M23 — the rail is artist-only — so leaving the wording would be a
 * claim the shelf no longer makes. It names the artist's own songs instead, which
 * is what activating a card opens.
 */
export const QUICK_PICKS_DESCRIPTION =
  "Artists from what you have played, your languages, and what is playing now.";

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
      {/* `home-artist-card` is retained from the consolidated Popular Artists
          section: this is the feed's circular artist card, and assertions written
          against that test id keep their meaning. */}
      <ArtistCard name={pick.title} artworkUrl={pick.artworkUrl} testId="home-artist-card" />
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
  /**
   * Provider results the Home feed already holds, for the cold-start stand-in.
   *
   * Optional and read only when there is no local material, so a caller that has
   * none — every warm-path test of the derivation, for instance — renders today's
   * rail unchanged.
   */
  providerTracks?: readonly Track[];
  /** The presented filter, so the shelf follows the one section model's filter. */
  filter?: HomeFilterValue;
  className?: string;
  /**
   * M23: the provider feed's state, for the rail's own lifecycle.
   *
   * The rail was previously *only* a language/release shelf and the separate
   * Popular Artists section carried the provider error state. Consolidating the two
   * means this shelf now has to carry it, or a trending failure would leave a silently
   * empty rail with no reason shown — a regression in the resilience the `discovery`
   * spec requires of every shelf.
   *
   * Passed in rather than fetched, so the rail still issues no request of its own.
   */
  providerState?: ShelfState;
  /** Retry handler for `providerState === "error"`. */
  onRetry?: () => void;
}

/**
 * The Quick Picks rail.
 *
 * The rail is filled entirely by real artists. There is no fallback entry of
 * another kind: a device with no local material and no resolved provider results
 * renders an honest empty rail through the `Shelf` primitive's own
 * ready-with-no-children rule rather than a search card standing in for a
 * language. That is the deliberate change from M22, where the reserved language
 * entry existed precisely so the rail could never be empty.
 */
export function QuickPicksShelf({
  likedTracks,
  events,
  languages,
  providerTracks,
  filter = "all",
  className = "",
  providerState = "ready",
  onRetry,
}: QuickPicksShelfProps) {
  const picks = useMemo(
    () => deriveQuickPicks({ languages, taste: { likedTracks, events }, providerTracks }),
    [events, languages, likedTracks, providerTracks],
  );

  if (!presentsSurface(QUICK_PICK_SURFACE, filter)) return null;

  /*
   * M23: the rail's state follows its *content* first and the provider feed only when
   * it has nothing.
   *
   * Local taste is enough to fill the rail on its own, so a provider failure must not
   * hide artists the device already knows. The error state is therefore reserved for
   * the case where the rail is empty *because* the provider failed — which is the
   * same rule the removed Popular Artists section followed, since it too derived from
   * the trending result.
   */
  const state: ShelfState =
    picks.length > 0 ? "ready" : providerState === "ready" ? "empty" : providerState;

  return (
    <Shelf
      title={QUICK_PICKS_TITLE}
      description={QUICK_PICKS_DESCRIPTION}
      shape="circular"
      state={state}
      onRetry={state === "error" ? onRetry : undefined}
      error={QUICK_PICKS_ERROR}
      className={className}
      data-testid={QUICK_PICK_SURFACE.id}
    >
      {picks.map((pick) => (
        <QuickPickCard key={pick.id} pick={pick} />
      ))}
    </Shelf>
  );
}
