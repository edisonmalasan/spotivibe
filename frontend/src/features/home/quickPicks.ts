import { albumHref } from "@/features/album/albumKeys";
import { artistHref, isProviderEntityId } from "@/features/artist/artistKeys";
import type { LocalTaste } from "@/features/home/localSeeds";
import { groupArtistsByIdentity } from "@/features/recommendations/artists";
import { bestArtworkUrl } from "@/lib/playlistPresentation";
import { buildSearchUrl } from "@/lib/searchUrl";
import { languageName, normalizeLanguageCodes } from "@/lib/languages";

/**
 * Quick Picks for Home (M17; spec: `home-mixes` — "Quick Picks lead to surfaces
 * that exist"; design decision 5).
 *
 * The whole point of this shelf is that **nothing in it is a dead end**. Every
 * entry carries a `kind` and a `target` that one of the app's existing routes
 * already resolves — an artist id or text key, an album key, or a search query —
 * and the component renders it as a real link. An entry with an empty target, or
 * one whose href cannot be resolved, is dropped here rather than rendered and
 * discovered by a listener clicking it.
 *
 * Inputs are only what the device already holds: the selected languages (a
 * preference), the liked tracks, and the listening events. No new stored data, no
 * request, and no profile — the same local-first contract `deriveSeedTerms`
 * keeps, which is why the derivation is a pure function over its inputs rather
 * than a hook that fetches something.
 *
 * Pure and deterministic: the same local material always yields the same entries
 * in the same order, and nothing is mutated.
 */

/** The kinds of surface a Quick Pick can lead to — all of which exist today. */
export const QUICK_PICK_KINDS = ["artist", "album", "search"] as const;

export type QuickPickKind = (typeof QUICK_PICK_KINDS)[number];

/** Whether `value` names a kind the shelf can resolve. */
export function isQuickPickKind(value: unknown): value is QuickPickKind {
  return typeof value === "string" && (QUICK_PICK_KINDS as readonly string[]).includes(value);
}

/**
 * How many entries the shelf offers.
 *
 * A rail is read by scrolling sideways, so an unbounded list is a shelf whose tail
 * nobody finds; eight is one desktop row plus a peeking card, matching the
 * `Shelf` rail's own proportions.
 */
export const MAX_QUICK_PICKS = 8;

/** One Quick Pick: what it is, where it goes, and what it is labelled with. */
export interface QuickPick {
  /** Stable id — the card's `data-quick-pick-id` and its React key. */
  readonly id: string;
  /** Which existing surface this entry leads to. */
  readonly kind: QuickPickKind;
  /**
   * The value that surface resolves: a provider entity id or text key for an
   * artist, a release key for an album, a raw query for a search. Never empty —
   * `deriveQuickPicks` drops anything that would be.
   */
  readonly target: string;
  /** Display label — the artist's name, the release title, or the language. */
  readonly title: string;
  /** Secondary line; says which kind of surface this is, never a ranking. */
  readonly subtitle: string;
  /** The best cover the local material offers, when it has one. */
  readonly artworkUrl?: string;
}

/** Everything the derivation reads. All of it is already on the device. */
export interface QuickPickInput {
  /** The selected catalog language codes. */
  readonly languages: readonly string[];
  /** Liked tracks and listening events, as the stores expose them. */
  readonly taste: LocalTaste;
}

/** `Daft Punk, Pharrell Williams`, or a neutral label for no credited artist. */
function artistText(artists: readonly { name: string }[]): string {
  const names = artists.map((artist) => artist.name.trim()).filter((name) => name !== "");
  return names.length > 0 ? names.join(", ") : "Unknown artist";
}

/** Identity fallback: the provider id when the entry has one, else the name. */
function entityTarget(id: string, name: string): string {
  return isProviderEntityId(id) ? id : name;
}

/**
 * The route one entry navigates to, or `null` when its target cannot be
 * resolved.
 *
 * Split out from the derivation on purpose: the derivation decides *what* an entry
 * is, this decides *where it goes*, and the component renders a link built from
 * the value returned here. That separation is what lets the tests assert
 * resolvability directly instead of inferring it from a rendered href.
 */
export function quickPickHref(pick: QuickPick): string | null {
  const target = pick.target.trim();
  if (target === "" || !isQuickPickKind(pick.kind)) return null;
  switch (pick.kind) {
    case "artist":
      return artistHref(target);
    case "album":
      return albumHref(target);
    case "search":
      return buildSearchUrl(target);
  }
}

/**
 * Append an entry if it is resolvable and not already offered.
 *
 * The resolvability check lives here rather than at the call sites so an entry
 * cannot be constructed unrenderable by a future kind: three call sites all
 * remembering "…and only if the href resolves" is three chances to forget.
 */
function collect(picks: QuickPick[], seen: Set<string>, pick: QuickPick): void {
  if (picks.length >= MAX_QUICK_PICKS) return;
  const identity = `${pick.kind}:${pick.target.trim().toLowerCase()}`;
  if (seen.has(identity)) return;
  if (quickPickHref(pick) === null) return;
  seen.add(identity);
  picks.push(pick);
}

/**
 * Derive the Quick Picks from the listener's own material.
 *
 * Three sources, in that order, because the order is the *strength* of the
 * evidence: an artist the listener liked is a place they have already been, an
 * album on a track they liked is a place they have not, and a language they
 * selected is the weakest of the three — a way in rather than something they
 * chose to follow. The bound is applied across all three, so a device with many
 * artists cannot push the language entries out entirely.
 */
export function deriveQuickPicks(input: QuickPickInput): QuickPick[] {
  const picks: QuickPick[] = [];
  const seen = new Set<string>();

  // The local material: liked tracks first, then plays, both newest-first as the
  // stores hand them over. `groupArtistsByIdentity` is the existing derivation
  // behind the Popular Artists shelf, reused so an artist is grouped the same way
  // in both places.
  const material = [...input.taste.likedTracks, ...input.taste.events.map((e) => e.track)];
  for (const entry of groupArtistsByIdentity(material)) {
    collect(picks, seen, {
      id: `artist:${entry.id}`,
      kind: "artist",
      target: entityTarget(entry.id, entry.name),
      title: entry.name,
      subtitle: "Artist",
      artworkUrl: entry.artworkUrl,
    });
  }

  for (const track of material) {
    const album = track.album;
    const title = album?.title.trim() ?? "";
    // A track with no album metadata is not an album entry wearing a title.
    if (album === undefined || title === "") continue;
    const id = album.id?.trim() ?? "";
    collect(picks, seen, {
      id: `album:${id === "" ? title : id}`,
      kind: "album",
      // The provider's release id when it supplied one, else the bare title —
      // both shapes the album route already resolves.
      target: id === "" ? title : id,
      title,
      subtitle: artistText(track.artists),
      artworkUrl: bestArtworkUrl(track),
    });
  }

  for (const code of normalizeLanguageCodes(input.languages)) {
    const label = languageName(code);
    collect(picks, seen, {
      id: `search:${code}`,
      kind: "search",
      target: label,
      title: label,
      subtitle: "Search",
    });
  }

  return picks;
}
