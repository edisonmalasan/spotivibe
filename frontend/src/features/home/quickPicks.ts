import { artistHref, isProviderEntityId } from "@/features/artist/artistKeys";
import type { Track } from "@/data/repositories";
import { curatedArtistsForLanguages } from "@/features/home/curatedArtists";
import type { LocalTaste } from "@/features/home/localSeeds";
import { groupArtistsByIdentity } from "@/features/recommendations/artists";
import { normalizeLanguageCodes } from "@/lib/languages";
import type { QuickPickPickRecord } from "@/data/repositories";

/**
 * Quick Picks for Home (M23; spec: `home-mixes` — "Quick Picks are artist
 * surfaces that exist"; design decisions D1–D3; M35 — the curated source,
 * design decisions D3 and D5).
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
 * **The sources, in the order they are offered:**
 *
 * ```
 * explicit picks  →  local material  →  curated popular artists  →  provider results
 * ```
 *
 * The curated source (`features/home/curatedArtists.ts`) is the rail's
 * **completion**, never its lead: it is below the listener's own material and
 * below their own picks, and it never displaces, outranks or reorders either.
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
 * The rail's notion of "the same artist" by name: trimmed and lowercased.
 *
 * The same normalization `groupArtistsByIdentity` uses to key an artist that
 * carried no provider id, and the same one `curatedArtists.ts` uses to key a
 * curated name. One definition of "same name" in three places would be three
 * chances to disagree, so the rule is stated here and pointed at from the
 * others.
 */
function normalizedArtistName(name: string): string {
  return name.trim().toLowerCase();
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
 *
 * **Two keys, not one.** The identity key is `kind:target`, which is what the
 * rail has always used. The **name** key is the artist's normalized name, and
 * it is what makes an artist offered once under a provider identity and again
 * under a bare name appear once. A curated entry's target *is* its name, while
 * a provider entry's target is often a provider id, so without the second key
 * the same artist would be offered twice.
 */
function collect(
  picks: QuickPick[],
  seen: Set<string>,
  seenNames: Set<string>,
  pick: QuickPick,
): void {
  if (picks.length >= MAX_QUICK_PICKS) return;
  const identity = `${pick.kind}:${pick.target.trim().toLowerCase()}`;
  if (seen.has(identity)) return;
  const name = normalizedArtistName(pick.title);
  if (name !== "" && seenNames.has(name)) return;
  if (quickPickHref(pick) === null) return;
  seen.add(identity);
  if (name !== "") seenNames.add(name);
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
 * What the candidate tracks know about the artist with a given name.
 *
 * Both halves are already carried by the tracks the caller supplied, so neither
 * costs a request.
 */
interface CandidateArtist {
  /**
   * The provider's own artist id, when a candidate track supplied one.
   *
   * `groupArtistsByIdentity` keys an artist by its provider id when the track
   * carried one and by the normalized name otherwise, so the id is the
   * provider's own when `isProviderEntityId` says so — which is the same rule
   * `entityTarget` applies when it decides which identity a card carries.
   */
  readonly providerId?: string;
  /** The artist's best artwork across the candidate tracks, if any track has one. */
  readonly artworkUrl?: string;
}

/**
 * What the candidate tracks know about every artist they credit, keyed by the
 * artist's **normalized name**.
 *
 * `groupArtistsByIdentity` already reads "each artist's best artwork off that
 * artist's own tracks", so this reuses it rather than writing a second artwork
 * rule. The key is the artist's **name** rather than its derived identity,
 * because a curated entry's identity *is* its name: the curated source knows
 * "Drake" and nothing else.
 *
 * **The match is exact, and that is the whole safety property.** A curated
 * entry is a *name*, and a name that approximately matched a different artist
 * would put the wrong face on the card, and would give it the wrong identity.
 * A map lookup on the normalized name — trimmed and lowercased, the rail's own
 * normalization — can only ever match the same name, which is the same artist
 * by the rail's own definition. There is no prefix match, no substring match
 * and no fuzzy match here: a curated "Anirudh" does not pick up a track by
 * "Anirudh Ravichander", and a curated "A.R. Rahman Tamil" does not pick up
 * "A.R. Rahman"'s.
 *
 * **Where two candidate artists share a name, an id beats no id.** A feed can
 * credit one artist with a channel id on some of its tracks and without one on
 * others — `splitArtists` attaches an id only when the tier supplied one — and
 * the two are then two entries in `groupArtistsByIdentity` under one name. The
 * first artwork found is kept, and the provider id is taken from whichever
 * entry has one, so the identity the curated card carries does not depend on
 * the order the tracks arrived in.
 */
function candidateArtistsByName(tracks: readonly Track[]): Map<string, CandidateArtist> {
  const artists = new Map<string, CandidateArtist>();
  if (tracks.length === 0) return artists;
  // The limit is the number of tracks, which is an upper bound on the number of
  // artists: the default limit of ten would drop artists the map needs.
  for (const entry of groupArtistsByIdentity(tracks, tracks.length)) {
    const key = normalizedArtistName(entry.name);
    if (key === "") continue;
    const providerId = isProviderEntityId(entry.id) ? entry.id : undefined;
    const existing = artists.get(key);
    if (existing === undefined) {
      artists.set(key, {
        ...(providerId === undefined ? {} : { providerId }),
        ...(entry.artworkUrl === undefined ? {} : { artworkUrl: entry.artworkUrl }),
      });
      continue;
    }
    // A second candidate artist under the same name: the artwork already found
    // stands, and an id beats no id.
    if (existing.providerId === undefined && providerId !== undefined) {
      artists.set(key, { ...existing, providerId });
    }
  }
  return artists;
}

/**
 * Derive the Quick Picks from the listener's own material, and from the
 * curated popular artists of their languages.
 *
 * Artist candidates come from four sources, in that order, because the order is
 * the *strength* of the evidence:
 *
 * ```
 * explicit picks  →  local material  →  curated popular artists  →  provider results
 * ```
 *
 * - **Explicit picks** are the one entry in the rail the listener chose by hand.
 * - **Local material** is a place they have already been.
 * - **Curated popular artists** are names the application knows, shaped by the
 *   selected languages. They are the rail's **completion**, not its lead: they
 *   complete a rail the other sources left short and they never displace,
 *   outrank or reorder an entry derived from local material or from a pick.
 * - **Provider results** are an artist that merely appears in what Home
 *   fetched — a place they have not been — and they are the last resort.
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
 *
 * **The rail is never empty.** With the curated source in the chain, a device
 * with no picks, no local material and a provider that failed still gets
 * artists — the first-run picker has real artists to offer instead of *"We
 * couldn't find any artists yet."*
 *
 * ## What the curated source changed about the rail's own states
 *
 * Because the curated source always contributes, the rail always holds artists,
 * and three of the rail's states are therefore **unreachable**: it is
 * **"ready" from the first paint** (no loading skeleton), it **never shows its
 * empty state**, and it **never shows its error state** — a provider failure is
 * reported by the trending shelf that failed, which still offers its retry, and
 * the rail has artists to show instead of an apology.
 *
 * **A device with local material sees a content swap.** The stores hydrate
 * asynchronously, so the first paint holds the curated artists of the selected
 * languages and the device's own liked artists take their place once the
 * stores have hydrated. The curated entries are added to the rail rather than
 * replacing anything — the local artists keep their own order and their own
 * artwork — but the cards a listener sees do change when the stores settle.
 *
 * **None of this removed a branch.** The `home-mixes` requirement still carries
 * a settled-with-no-artists path, so the code that handles it is left intact
 * and is covered directly rather than through a rail that can no longer reach
 * it.
 */
export function deriveQuickPicks(input: QuickPickInput): QuickPick[] {
  const picks: QuickPick[] = [];
  const seen = new Set<string>();
  const seenNames = new Set<string>();

  // Normalised once, above the passes, because both the preference test and the
  // documented degradation depend on it being a fixed set rather than the raw
  // input: an empty or wholly invalid selection normalizes to the default
  // language, so `selected` is never empty.
  const selected = new Set(normalizeLanguageCodes(input.languages));

  // The local material: liked tracks first, then plays, both newest-first as the
  // stores hand them over.
  const material = [...input.taste.likedTracks, ...input.taste.events.map((e) => e.track)];

  /*
   * **What the candidate tracks already know about each artist**, keyed by the
   * artist's name: their artwork, and their provider identity when a track
   * supplied one.
   *
   * A curated popular artist is a name, so on its own there is no picture to
   * show and no identity to carry — but where a candidate track is by that same
   * artist, both are *already in hand*, and the requirement says so: a curated
   * popular artist whose name matches an artist in the candidate tracks SHALL
   * carry that artist's artwork, because the artwork is already carried by the
   * tracks the caller supplied. No request is issued to obtain it, and a
   * curated artist with no matching track still renders the application's
   * existing placeholder.
   *
   * **The identity matters as much as the picture.** The requirement says a
   * Quick Pick navigates "using the provider artist identity when the entry has
   * one and the artist's name otherwise" — and this artist *does* have one, on
   * the provider's own entry for it. The curated entry is the one that survives
   * the name-dedupe, so it is the one that has to carry it; otherwise the rail
   * would offer the artist by a bare name when a precise identity was in hand.
   *
   * The candidate tracks are the local material and the provider results,
   * whichever are present. The provider results' gate is about *entries* — a
   * provider artist must not compete with a liked one — and the artwork and the
   * identity of a track the caller supplied are not an entry.
   */
  const candidates = candidateArtistsByName([...material, ...(input.providerTracks ?? [])]);

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
    collect(picks, seen, seenNames, {
      id: `artist:${pick.artistId}`,
      kind: "artist",
      target: entityTarget(pick.artistId, pick.name),
      title: pick.name,
      subtitle: "Artist",
    });
  }

  /*
   * **Local material**, which is the listener's own evidence and therefore
   * outranks everything that is merely suggested.
   *
   * The pass reads the material as it has always been read; the only thing that
   * changed in M35 is that the curated source is *offered the leftover room*
   * afterwards rather than not at all.
   */
  if (material.length > 0) {
    for (const candidate of byLanguagePreference(
      collectCandidates(material, selected, MAX_QUICK_PICKS),
    )) {
      const { entry } = candidate;
      collect(picks, seen, seenNames, {
        id: `artist:${entry.id}`,
        kind: "artist",
        target: entityTarget(entry.id, entry.name),
        title: entry.name,
        subtitle: "Artist",
        ...(entry.artworkUrl === undefined ? {} : { artworkUrl: entry.artworkUrl }),
      });
    }
  }

  /*
   * **Curated popular artists** — the rail's completion, and its reason for
   * never being empty.
   *
   * They are collected *after* the listener's own evidence, so nothing derived
   * from local material or from a pick is displaced, outranked or reordered by
   * them: `collect` appends, and the earlier entries are already in place.
   *
   * **Their artwork and their identity come from the candidate tracks, when a
   * candidate track is by that same artist.** The lookup is on the artist's
   * **exact normalized name**, so it can only ever match the same artist — an
   * approximate match would put the wrong face on the card and give it the
   * wrong identity. A curated artist with no matching candidate track carries
   * no artwork, keeps its name as its target, and renders the application's
   * existing artist placeholder.
   */
  for (const name of curatedArtistsForLanguages([...selected])) {
    const key = normalizedArtistName(name);
    const candidate = candidates.get(key);
    // The provider id when a candidate track supplied one, else the name — the
    // same two identities `entityTarget` chooses between everywhere else.
    const identity = candidate?.providerId ?? key;
    collect(picks, seen, seenNames, {
      // The provider's own entry for this artist would have carried this id, so
      // the two cannot collide and the card's identity matches the artist it
      // names.
      id: `artist:${identity}`,
      kind: "artist",
      target: entityTarget(identity, name),
      title: name,
      subtitle: "Artist",
      ...(candidate?.artworkUrl === undefined ? {} : { artworkUrl: candidate.artworkUrl }),
    });
  }

  /*
   * **Provider results**, last, and only for a device with no local material.
   *
   * `material.length === 0` is the whole gate: when there is any local material
   * at all this is `[]` and the pass below reads exactly what it read before
   * this source existed.
   */
  if (material.length === 0) {
    for (const candidate of byLanguagePreference(
      collectCandidates(input.providerTracks ?? [], selected, MAX_QUICK_PICKS),
    )) {
      const { entry } = candidate;
      collect(picks, seen, seenNames, {
        id: `artist:${entry.id}`,
        kind: "artist",
        target: entityTarget(entry.id, entry.name),
        title: entry.name,
        subtitle: "Artist",
        ...(entry.artworkUrl === undefined ? {} : { artworkUrl: entry.artworkUrl }),
      });
    }
  }

  return picks;
}
