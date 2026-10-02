import type { Track } from "@/data/repositories";
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
