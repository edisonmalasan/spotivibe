import { albumHref } from "@/features/album/albumKeys";
import { artistHref, isProviderEntityId } from "@/features/artist/artistKeys";
import type { Track } from "@/data/repositories";
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
 * Inputs are what the device already holds: the selected languages (a
 * preference), the liked tracks, the listening events, and — as the fourth
 * source `home-mixes` specifies — **provider results the Home surface has
 * already fetched**. Nothing here stores, requests, or profiles: the provider
 * results arrive as arguments from the feed's own shelves, so the derivation
 * stays a pure function over its inputs rather than a hook that fetches
 * something.
 *
 * That fourth source is the cold-start path, and it is deliberately narrow
 * (see design decision D2): it contributes **only** when the device holds no
 * local material at all. A device with one liked track reads exactly what it
 * read before this source existed — not because a test noticed, but because
 * the stand-in array is empty when `material` is not.
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
  /**
   * Provider results the Home surface **already holds** — its trending and
   * collection shelves' tracks.
   *
   * Optional because most callers cannot answer the question it answers: only
   * the Home surface knows what its own feed fetched. Omitting it is the
   * honest default and yields exactly the pre-M22 behaviour, which is also why
   * the field is optional rather than required — a required one would make every
   * call site state an answer, and the compiler cannot tell a caller that
   * passed `[]` on purpose from one that forgot.
   *
   * Read only when there is no local material. See `deriveQuickPicks`.
   */
  readonly providerTracks?: readonly Track[];
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
 * The artist pass, over one array of tracks.
 *
 * Extracted rather than inlined so the local and stand-in paths share one
 * implementation. `groupArtistsByIdentity` is the existing derivation behind
 * the Popular Artists shelf, reused so an artist is grouped the same way in
 * every place it appears.
 */
function collectArtists(
  picks: QuickPick[],
  seen: Set<string>,
  material: readonly Track[],
  limit: number,
): void {
  for (const entry of groupArtistsByIdentity(material)) {
    if (picks.length >= limit) return;
    collect(picks, seen, {
      id: `artist:${entry.id}`,
      kind: "artist",
      target: entityTarget(entry.id, entry.name),
      title: entry.name,
      subtitle: "Artist",
      artworkUrl: entry.artworkUrl,
    });
  }
}

/**
 * The release pass, over one array of tracks.
 *
 * Extracted for the same reason as `collectArtists`, and with the same caveat:
 * a second inline copy would be character-identical at the moment of writing
 * and free to drift afterwards, so any later change to the artwork choice or
 * the album-key rules would have to be made twice and would be made once.
 */
function collectReleases(
  picks: QuickPick[],
  seen: Set<string>,
  material: readonly Track[],
  limit: number,
): void {
  for (const track of material) {
    if (picks.length >= limit) return;
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
}

/**
 * Derive the Quick Picks from the listener's own material.
 *
 * The sources, in that order, because the order is the *strength* of the
 * evidence: an artist the listener liked is a place they have already been, an
 * album on a track they liked is a place they have not, and a language they
 * selected is a way in rather than something they chose to follow.
 *
 * **The bound is one shared `MAX_QUICK_PICKS` across all of these passes, and
 * that means a device with eight local artists gets no language entry at all.**
 * An earlier version of this comment claimed the opposite — that a device with
 * many artists could not push the language entries out. It could; the comment
 * was wrong about the code beneath it. The behaviour is left as it is, because
 * changing it would change what every device with material renders, and the only
 * reason the stand-in below behaves differently is that it is new. See design
 * decision D6.
 *
 * The stand-in pass sits between the releases and the languages, and exists only
 * for a device with no local material at all. It reads `providerTracks` — the
 * results the Home surface already fetched — so it costs no request and stores
 * nothing. Two properties hold by construction rather than by testing:
 *
 * - **It cannot outrank local evidence, because it is never considered alongside
 *   it.** When `material` is non-empty the stand-in array is empty; there is no
 *   case in which a provider result competes with a liked artist.
 * - **It cannot crowd out the language entries**, because its limit reserves
 *   them. Without the reservation a cold device on a healthy network would fill
 *   the bound with trending artists and lose the one entry the derivation
 *   guarantees, making that guarantee depend on the network.
 */
export function deriveQuickPicks(input: QuickPickInput): QuickPick[] {
  const picks: QuickPick[] = [];
  const seen = new Set<string>();

  // Normalised once, above the passes, because the stand-in's limit is derived
  // from how many language entries there are to preserve.
  const languageCodes = normalizeLanguageCodes(input.languages);

  // The local material: liked tracks first, then plays, both newest-first as the
  // stores hand them over.
  const material = [...input.taste.likedTracks, ...input.taste.events.map((e) => e.track)];
  collectArtists(picks, seen, material, MAX_QUICK_PICKS);
  collectReleases(picks, seen, material, MAX_QUICK_PICKS);

  // The cold-start stand-in. `material.length === 0` is the whole gate: when
  // there is any local material at all this is `[]` and every pass below reads
  // exactly what it read before this source existed.
  const standIn = material.length === 0 ? (input.providerTracks ?? []) : [];
  // At least one language entry always survives, whatever the provider returned.
  const standInLimit = Math.max(0, MAX_QUICK_PICKS - languageCodes.length);
  collectArtists(picks, seen, standIn, standInLimit);
  collectReleases(picks, seen, standIn, standInLimit);

  for (const code of languageCodes) {
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
