import type { Track } from "@/data/repositories";
import { artistKeyOf, genreKeysOf } from "@/features/personalization/tasteProfile";
import type { MixCardPlan } from "@/features/home/mixes/namedMixes";
import { bestArtworkUrl } from "@/lib/playlistPresentation";

/**
 * Collage covers for a mix card (M17; spec: `home-mixes` — "Mix cards start
 * playback and name honestly", presentation implied; design decision 1).
 *
 * A card has no tracks until it is activated, so its cover is derived from the
 * mix **once it exists** — the same derivation `derivePlaylistArtwork` performs
 * for a playlist cover, with one difference: it reports *how* to draw what it
 * found, because a mix's artwork is whatever the feed happened to return and the
 * card must never render an empty grid.
 *
 * Three outcomes, and the third is the documented fallback rather than an
 * accident:
 *
 * - `collage` — a full 2×2 grid of distinct covers.
 * - `single` — fewer distinct covers than a grid needs: the best cover is drawn
 *   alone, which is also the answer for a one-track mix.
 * - `placeholder` — no cover at all, for an empty mix or a mix whose tracks
 *   carry no artwork.
 *
 * The grid needs `COLLAGE_SLOTS` covers rather than two: a two-tile "collage" is
 * two covers side by side, which reads as a layout accident rather than as a
 * collage, so a mix with two or three covers is shown as the single cover it can
 * actually justify.
 *
 * Pure and deterministic: same tracks in, same cover out, input never mutated.
 */

/** Covers in the grid: a 2×2 collage. */
export const COLLAGE_SLOTS = 4;

/** How a mix card draws the artwork it has. */
export type MixCollage =
  | { readonly kind: "collage"; readonly urls: readonly string[] }
  | { readonly kind: "single"; readonly url: string }
  | { readonly kind: "placeholder" };

/**
 * The cover a mix presents.
 *
 * Distinct URLs only — the same cover on four tracks is one cover, and a grid of
 * four identical tiles is worse than the single cover it would have been. The
 * order is first appearance, so the cover a listener recognises from the top of
 * the mix is the one that leads.
 */
export function deriveMixCollage(tracks: readonly Track[]): MixCollage {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    const url = bestArtworkUrl(track);
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  if (urls.length >= COLLAGE_SLOTS) return { kind: "collage", urls: urls.slice(0, COLLAGE_SLOTS) };
  const single = urls[0];
  return single === undefined ? { kind: "placeholder" } : { kind: "single", url: single };
}

/**
 * Material a preview may draw from: what the device already holds.
 *
 * **M23.** Both sources are already in memory on the surface that calls this — the
 * mix-card row receives liked tracks and listening events as props — so nothing here
 * reads storage and nothing here can issue a request. That is what makes the preview
 * free: it is the same tracks the taste profile was built from.
 */
export type PreviewMaterial = readonly Track[];

/**
 * The cover a card shows *before* it is activated.
 *
 * A card has no mix yet, so it cannot show a mix's artwork. What it can honestly show
 * is artwork belonging to the material its own strategy draws from — the tracks whose
 * artist or genre keys that strategy selected. That is a preview of the *kind* of thing
 * the card will compose, drawn from the listener's own library, and it is why the card
 * never has to say the preview is the mix.
 *
 * The selection is ranked by the plan's own strategy rather than taken in input order,
 * so two cards with different strategies show different covers instead of the same four
 * tiles twice. `deriveMixCollage` still decides *how* to draw whatever it is handed, so
 * the 1 / 2–4 / 0 rule is stated once rather than twice.
 *
 * A strategy whose selections match nothing falls back to the device's taste in the
 * profile's own ranking — see {@link fallbackMaterial}. It never borrows a cover from
 * an unrelated track: whatever ends up on a card is artwork from the listener's own
 * library.
 */
export function deriveMixPreviewCollage(plan: MixCardPlan, material: PreviewMaterial): MixCollage {
  // `profile.genres` are the strategy's own selections for the genre-led cards, and
  // `profile.seedTerms` covers the artist/term-led ones — the two halves of what a
  // plan asks the generator for.
  /*
   * The plan's own *seed terms* are the discriminator, not the profile's rankings.
   *
   * This matters and is easy to get subtly wrong: `mixCardPlans` narrows a plan by
   * replacing `seedTerms` and leaves `artists`/`genres` as the whole profile's. So
   * matching on the profile's rankings would give every card the same vocabulary and
   * every card the same picture — six copies of one tile row. `chill` selects only
   * calm genre words, `night` only dark ones, `top` seeds by artist, and a language
   * card by its language name; that difference is the whole of what distinguishes the
   * strategies, so that is what is matched on.
   *
   * A term is folded to the same shape `buildTasteProfile` folds keys to before it is
   * compared, and a track's artist credits go through the same `artistKeyOf` the
   * profile scored them under — otherwise "Aurora" and "aurora" would be two artists
   * and the top card would find nothing in a library full of Aurora.
   */
  const terms = new Set(
    plan.profile.seedTerms.map((term) => term.trim().toLowerCase()).filter((term) => term !== ""),
  );

  const ranked = material
    .map((track, index) => ({ track, index, score: matchScore(track, terms) }))
    // Only the matching material is eligible; the score orders it.
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (ranked.length > 0) return deriveMixCollage(ranked.map((entry) => entry.track));
  return deriveMixCollage(fallbackMaterial(plan, material));
}

/**
 * What a card shows when its own selections match nothing on the device.
 *
 * A language card seeds on its language's *name* — "English" — which by construction
 * names no artist and no genre, so it matches nothing in a library of tracks. Falling
 * straight to the placeholder would leave every language card on the row blank, which
 * is not an honest reading of "the device holds artwork": the device does, and the card
 * is about this listener's taste in that language rather than about a term.
 *
 * So the fallback is the device's own taste in the profile's ranking — the artist's
 * weights, strongest first — which is what the strategy would have leaned on anyway had
 * it selected nothing. It is still the listener's library and still no request. What it
 * deliberately is not is a track matched on nothing, which would be a picture of a
 * different thing.
 */
function fallbackMaterial(plan: MixCardPlan, material: PreviewMaterial): PreviewMaterial {
  const order = new Map(plan.profile.artists.map((entry, index) => [entry.key, index]));
  return [...material]
    .map((track, index) => ({
      track,
      index,
      rank: Math.min(
        ...track.artists.map((artist) => order.get(artistKeyOf(artist)) ?? Number.MAX_SAFE_INTEGER),
        Number.MAX_SAFE_INTEGER,
      ),
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.track);
}

/**
 * How strongly a track belongs to what a plan asked for.
 *
 * Both match routes are checked because the two strategies select different *kinds* of
 * term against the same bounded list: a term can name an artist the track is credited
 * to, or a genre the track's own text implies. A track matching neither scores zero and
 * is not eligible at all, which is what makes an unmatched strategy show the honest
 * placeholder instead of a borrowed cover.
 */
function matchScore(track: Track, terms: ReadonlySet<string>): number {
  let score = 0;
  for (const artist of track.artists) {
    if (terms.has(artistKeyOf(artist))) score += 2;
  }
  for (const key of genreKeysOf(track)) {
    if (terms.has(key)) score += 1;
  }
  return score;
}
