import { artistHref, isProviderEntityId } from "@/features/artist/artistKeys";
import type { Track } from "@/data/repositories";
import type { LocalTaste } from "@/features/home/localSeeds";
import { groupArtistsByIdentity } from "@/features/recommendations/artists";
import { normalizeLanguageCodes } from "@/lib/languages";
import type { QuickPickPickRecord } from "@/data/repositories";

/**
 * Quick Picks for Home (M23; spec: `home-mixes` — "Quick Picks are artist
 * surfaces that exist"; design decisions D1–D3).
 *
 * The rail is **artist-only**. M17 and M22 also allowed release and search
 * entries, and M22 went further: it reserved rail capacity for one `Search` card
 * per selected language. That produced the outcome this milestone reverses — with
 * the maximum selection the rail was eight language cards and zero artists, and
 * even on a brand-new device with one default language the last card was a search
 * for that language. Languages are **inputs to which artists are surfaced**, not
 * things to be surfaced; see `deriveQuickPicks`.
 *
 * Every entry is a real artist: it carries a canonical identity, resolves to the
 * artist route through `artistHref`, and renders as the circular artist card. An
 * entry that cannot resolve is dropped here rather than rendered and discovered
 * by a listener clicking it.
 *
 * Pure and deterministic: the same inputs always yield the same entries in the
 * same order, and nothing is mutated.
 */

/** The kinds of surface a Quick Pick can lead to — now exactly one. */
export const QUICK_PICK_KINDS = ["artist"] as const;

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
  /** Which existing surface this entry leads to. Always `"artist"`. */
  readonly kind: QuickPickKind;
  /**
   * The artist's canonical identity: a provider artist id when the candidate
   * carried one, else the artist's name. Never empty — `deriveQuickPicks` drops
   * anything that would be. Both shapes resolve through `artistHref`.
   */
  readonly target: string;
  /** Display label — the artist's name, as the provider spelled it. */
  readonly title: string;
  /** Secondary line; says which kind of surface this is, never a ranking. */
  readonly subtitle: string;
  /** The artist's own artwork when the candidate tracks offered one. */
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
   * Optional because most callers cannot answer the question it answers: only the
   * Home surface knows what its own feed fetched. Omitting it is the honest
   * default and yields exactly the pre-M22 behaviour, which is also why the field
   * is optional rather than required — a required one would make every call site
   * state an answer, and the compiler cannot tell a caller that passed `[]` on
   * purpose from one that forgot.
   *
   * Read only when there is no local material. See `deriveQuickPicks`.
   */
  readonly providerTracks?: readonly Track[];
  /**
   * Artists the listener explicitly picked during first-run onboarding.
   *
   * The only Quick Picks the listener *stated* rather than the app inferred, so
   * they lead the rail. Deliberately **not** gated behind "no local material":
   * a device that picked five artists and has since liked nothing must keep
   * showing those five, and treating them like a cold-start stand-in would drop
   * them the moment it liked one track. Optional because a caller that has not
   * loaded them has no picks, which is the pre-change behaviour.
   */
  readonly picks?: readonly QuickPickPickRecord[];
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
  }
}

/**
 * Append an entry if it is resolvable and not already offered.
 *
 * The resolvability check lives here rather than at the call sites so an entry
 * cannot be constructed unrenderable by a future kind: two call sites all
 * remembering "…and only if the href resolves" is two chances to forget.
 */
function collect(picks: QuickPick[], seen: Set<string>, pick: QuickPick): void {
  if (picks.length >= MAX_QUICK_PICKS) return;
  const identity = `${pick.kind}:${pick.target.trim().toLowerCase()}`;
  if (seen.has(identity)) return;
  if (quickPickHref(pick) === null) return;
  seen.add(identity);
  picks.push(pick);
}

/** One artist candidate: the grouped entry plus whether a selected language spoke for it. */
interface Candidate {
  readonly entry: ReturnType<typeof groupArtistsByIdentity>[number];
  readonly languageMatched: boolean;
}

/**
 * Group tracks into artist candidates and note which of them a selected language
 * vouched for.
 *
 * `groupArtistsByIdentity` is the existing derivation behind the former Popular
 * Artists shelf, reused so an artist is grouped the same way in every place it
 * appears. It already reads each artist's best artwork off that artist's own
 * tracks, which is why this milestone needs no provider artwork endpoint.
 *
 * The language test reads `Track.language`, which the discovery feed stamps with
 * the language of the seed that produced the track (`server/music/discovery.ts`).
 * That stamp is what makes the selection able to shape candidates at all; a
 * device whose results carry no stamp simply leaves every candidate unmatched,
 * which is the documented degradation rather than an empty rail.
 */
function collectCandidates(
  material: readonly Track[],
  selected: ReadonlySet<string>,
  limit: number,
): Candidate[] {
  const byIdentity = new Map<string, Candidate>();
  // A second pass would be needed to learn an artist's languages from tracks that
  // arrive after it, so languages are accumulated as the grouping runs and the
  // verdict is read once every track has been seen.
  const spokenFor = new Map<string, boolean>();

  for (const entry of groupArtistsByIdentity(material, limit)) {
    byIdentity.set(entry.id, { entry, languageMatched: false });
    spokenFor.set(entry.id, false);
  }
  if (byIdentity.size === 0 || selected.size === 0) {
    return [...byIdentity.values()];
  }

  for (const track of material) {
    const language = track.language;
    if (language === undefined || !selected.has(language)) continue;
    const artist = track.artists[0];
    if (artist === undefined) continue;
    // `groupArtistsByIdentity` keys an artist by its provider id when the track
    // carried one and by its normalized name otherwise, so the same key has to be
    // derived here or a language would vouch for an entry that does not exist.
    const id = artist.id ?? artist.name.trim().toLowerCase();
    if (spokenFor.get(id) === true) continue;
    spokenFor.set(id, true);
  }

  return [...byIdentity.values()].map(({ entry }) => ({
    entry,
    languageMatched: spokenFor.get(entry.id) === true,
  }));
}

/**
 * Order candidates so a selected language decides *which* artists lead, not what
 * kind of card appears.
 *
 * A **stable partition**, not a filter: artists a selected language vouched for
 * come first in their existing order and the rest follow. Nothing is removed, so
 * the rail cannot be emptied by a selection — the outcome `ROADMAP.md` §21.7
 * already withdrew once, for a state the code could not reach.
 *
 * Determinism comes free from the partition: both halves keep first-appearance
 * order, so the same material and selection always produce the same rail.
 */
function byLanguagePreference(candidates: readonly Candidate[]): Candidate[] {
  const preferred: Candidate[] = [];
  const rest: Candidate[] = [];
  for (const candidate of candidates) {
    (candidate.languageMatched ? preferred : rest).push(candidate);
  }
  return [...preferred, ...rest];
}

/**
 * Derive the Quick Picks from the listener's own material.
 *
 * Artist candidates come from two sources, in that order, because the order is
 * the *strength* of the evidence: an artist the listener liked is a place they
 * have already been; an artist that merely appears in what Home fetched is a
 * place they have not.
 *
 * The provider source is deliberately narrow (design decision D2): it contributes
 * **only** when the device holds no local material at all. A device with one liked
 * track reads exactly what it read before this source existed — not because a
 * test noticed, but because the stand-in array is empty when `material` is not.
 *
 * Two properties hold by construction rather than by testing:
 *
 * - **It cannot outrank local evidence, because it is never considered alongside
 *   it.** When `material` is non-empty the stand-in array is empty; there is no
 *   case in which a provider result competes with a liked artist.
 * - **There is no reserved capacity for anything.** M22 held one slot back per
 *   selected language so that a language entry could survive; with no language
 *   entry there is nothing to reserve, so the provider source may use the whole
 *   bound. That is what makes a cold device with the maximum language selection
 *   offer eight artists instead of eight searches.
 */
export function deriveQuickPicks(input: QuickPickInput): QuickPick[] {
  const picks: QuickPick[] = [];
  const seen = new Set<string>();

  // Normalised once, above the passes, because both the preference test and the
  // documented degradation depend on it being a fixed set rather than the raw
  // input: an empty or wholly invalid selection normalizes to the default
  // language, so `selected` is never empty.
  const selected = new Set(normalizeLanguageCodes(input.languages));

  // The local material: liked tracks first, then plays, both newest-first as the
  // stores hand them over.
  const material = [...input.taste.likedTracks, ...input.taste.events.map((e) => e.track)];

  /*
   * **Explicit picks lead**, and they are not a stand-in for anything.
   *
   * A pick is the one entry in this rail the listener chose by hand, so it ranks
   * above inferred evidence: a liked track says they acted on an artist, a
   * provider result says nobody chose. They are emitted first and, because
   * `collect` dedupes by canonical identity, an artist who is both picked and
   * liked appears exactly once — as the pick.
   *
   * They deliberately bypass the cold-start gate below. Gating them on
   * `material.length === 0` would mean a listener who picked five artists and
   * then liked one track silently lost four of their own choices, which is the
   * exact failure the cold-start stand-in exists to avoid for the other sources.
   */
  for (const pick of input.picks ?? []) {
    collect(picks, seen, {
      id: `artist:${pick.artistId}`,
      kind: "artist",
      target: entityTarget(pick.artistId, pick.name),
      title: pick.name,
      subtitle: "Artist",
    });
  }

  // The cold-start stand-in. `material.length === 0` is the whole gate: when
  // there is any local material at all this is `[]` and the pass below reads
  // exactly what it read before this source existed.
  const source = material.length === 0 ? (input.providerTracks ?? []) : material;

  for (const candidate of byLanguagePreference(
    collectCandidates(source, selected, MAX_QUICK_PICKS),
  )) {
    const { entry } = candidate;
    collect(picks, seen, {
      id: `artist:${entry.id}`,
      kind: "artist",
      target: entityTarget(entry.id, entry.name),
      title: entry.name,
      subtitle: "Artist",
      ...(entry.artworkUrl === undefined ? {} : { artworkUrl: entry.artworkUrl }),
    });
  }

  return picks;
}
