/**
 * Curated popular artists, shaped by the selected languages (M35; spec:
 * `home-mixes` — "Quick Picks are artist surfaces that exist"; design decisions
 * D1–D4).
 *
 * Pure data plus one pure function. No React, no fetch, no storage, and no
 * import at all — the language catalog is the only application module it is
 * allowed to reach, and it does not need even that. A curated artist is a
 * *name*, so nothing here needs to know what a provider, a repository or a
 * store looks like.
 *
 * ## Attribution
 *
 * The artist names below are **Lyrix's data**, copied from
 * `frontend/src/components/recommendations/QuickPicks.tsx` in `aryanjsx/Lyrix`
 * (commit `d1f493f`; the repository is linked from `ATTRIBUTION.md`). A list of
 * well-known artists per language is a curation rather than an algorithm, and
 * re-deriving the same names while claiming independence would be the
 * dishonest option. Lyrix is MIT-licensed; the notice is retained here in full
 * and the file is listed in `ATTRIBUTION.md`.
 *
 * ```text
 * MIT License
 *
 * Copyright (c) 2026 Lyrix Contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * ```
 *
 * **The behaviour is independently reimplemented.** Only the names were
 * copied. Lyrix's component, its SWR caching, its `ArtistCard`, its
 * `/api/artist/thumbnails` batch lookup and its name-slug route were not — the
 * derivation lives in `quickPicks.ts`, the card is this application's own, and
 * a curated entry resolves through `/artist/[key]` — by the provider identity a
 * candidate track supplied for that artist where there is one, and by the name
 * otherwise — without issuing a request.
 *
 * **The keys are this application's own.** Lyrix's ids are its own (`hindi`);
 * these are ISO 639-1 codes that exist in `lib/languages.ts`. **Punjabi is not
 * ported**: the catalog has no `pa` code, and a language code that does not
 * exist is a lookup that silently never matches.
 *
 * ## What the curated source costs the rail, and what it buys
 *
 * **The rail is now never empty, and three of its states are therefore
 * unreachable.** Because this source always contributes, the rail always holds
 * artists, so the Quick Picks rail:
 *
 * - is **"ready" from the first paint** — it no longer shows a loading
 *   skeleton;
 * - **never shows its empty state** — the "Nothing here yet" explanation;
 * - **never shows its error state** — a provider failure is no longer reported
 *   on the rail. The failure is not lost: the trending shelf that actually
 *   failed still reports it and still offers its retry. The rail simply has
 *   something to show instead of an apology.
 *
 * **A device with local material sees a content swap.** The stores hydrate
 * asynchronously, so the first paint of a warm device holds the curated artists
 * of the selected languages, and its own liked artists take their place once
 * the stores have hydrated. The curated entries are *added* to the rail rather
 * than replacing anything — the local artists keep their own order and their
 * own artwork — but the cards a listener sees do change when the stores settle.
 * That is stated here rather than left to be discovered.
 */

/**
 * The curated popular artists of every language this application holds a list
 * for — **10 languages, 33 artists**.
 *
 * Keyed by Spotivibe's ISO 639-1 codes, and only by codes the catalog in
 * `lib/languages.ts` actually contains. The value is the artist's name, and the
 * name is the entry's whole identity: it is what the artist route resolves and
 * what the card shows.
 *
 * **Three of the 33 names are Lyrix's own disambiguated labels rather than bare
 * artist names** — `A.R. Rahman Tamil`, `Sid Sriram Telugu` and
 * `Arijit Bengali`. They are ported as they stand, because the names are the
 * data and re-writing them would be a different curation rather than a port.
 * They are still artists with a language qualifier, and each resolves to a real
 * artist surface.
 *
 * **One name was deliberately not ported.** Lyrix's Japanese list also held
 * `Anime OST`, which is a **category** rather than an artist. It is not carried
 * here, because the requirement is decisive: *every Quick Pick SHALL be a
 * resolvable artist* and *a Quick Pick SHALL NOT be a search, a release, or any
 * other kind of entry*. A card labelled `Anime OST` with the subtitle `Artist`
 * mislabels a category, and `/artist/Anime%20OST` is a provider **search** for
 * a phrase rather than an artist surface. Dropping it is what makes the ported
 * set 33 artists rather than Lyrix's 34.
 */
export const CURATED_ARTISTS_BY_LANGUAGE: Readonly<Record<string, readonly string[] | undefined>> =
  {
    hi: [
      "Arijit Singh",
      "Pritam",
      "Shreya Ghoshal",
      "A.R. Rahman",
      "Neha Kakkar",
      "Jubin Nautiyal",
    ],
    en: ["Taylor Swift", "The Weeknd", "Dua Lipa", "Ed Sheeran", "Drake", "Billie Eilish"],
    ta: ["Anirudh", "Sid Sriram", "A.R. Rahman Tamil", "Yuvan"],
    te: ["Thaman S", "DSP", "Sid Sriram Telugu"],
    bn: ["Arijit Bengali", "Anupam Roy"],
    mr: ["Ajay-Atul"],
    ko: ["BTS", "BLACKPINK", "NewJeans", "Stray Kids"],
    es: ["Bad Bunny", "Shakira", "Rauw Alejandro"],
    ja: ["YOASOBI", "Kenshi Yonezu"],
    ur: ["Atif Aslam", "Rahat Fateh Ali"],
  };

/**
 * The language-agnostic floor: the list offered to a listener whose language
 * has no list of its own.
 *
 * Lyrix's own default — no language selected — was `hindi + english` sliced to
 * ten, which is the same idea, so the floor is the ported lists used the way
 * Lyrix uses them. Ten names, so a listener with an uncovered language still
 * gets a full rail rather than a token one.
 */
export const CURATED_ARTISTS_FLOOR: readonly string[] = [
  "Arijit Singh",
  "Pritam",
  "Shreya Ghoshal",
  "A.R. Rahman",
  "Neha Kakkar",
  "Jubin Nautiyal",
  "Taylor Swift",
  "The Weeknd",
  "Dua Lipa",
  "Ed Sheeran",
];

/**
 * How many entries the curated source always offers.
 *
 * Lyrix's Marathi list holds exactly **one** artist, and a one-card rail is
 * the shape the `home-mixes` spec forbids — "the number of entries never equals
 * the number of selected languages by that coincidence". So a selection that
 * would yield a single curated artist is topped up from the floor.
 */
const MINIMUM_CURATED_ARTISTS = 2;

/**
 * The same normalization the rest of the rail uses: trimmed and lowercased.
 *
 * `groupArtistsByIdentity` keys an artist by its provider id when the track
 * carried one and by this normalization of its name otherwise, so the two
 * agree on what "the same artist" means. A name that differs only by case or
 * surrounding whitespace is the same artist, and the rail says so.
 */
function normalizedName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The curated popular artists for a set of selected language codes.
 *
 * Pure and deterministic: the same languages always yield the same names in
 * the same order, and nothing is mutated.
 *
 * The rules, in order:
 *
 * 1. **A language with a list of its own is offered that list.** A language
 *    without one is offered the **floor**, so the rail never depends on the
 *    catalog's coverage — 28 of the 38 catalog languages have no list of their
 *    own, and an empty rail is a worse answer than a generic one.
 * 2. **Names are deduplicated by normalized name.** The floor overlaps the
 *    English list, so a selection of `en` plus an uncovered language would
 *    otherwise offer `Taylor Swift` twice.
 * 3. **At least two entries are always offered.** A selection that would yield
 *    exactly one — Lyrix's Marathi list is exactly one — is topped up from the
 *    floor, because a single-card rail is the shape the spec forbids.
 *
 * An empty selection is Lyrix's own default: the floor.
 */
export function curatedArtistsForLanguages(languages: readonly string[]): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  const add = (name: string): void => {
    const key = normalizedName(name);
    if (key === "" || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };

  if (languages.length === 0) {
    for (const name of CURATED_ARTISTS_FLOOR) add(name);
    return names;
  }

  for (const code of languages) {
    const list = CURATED_ARTISTS_BY_LANGUAGE[code] ?? CURATED_ARTISTS_FLOOR;
    for (const name of list) add(name);
  }

  // The one-card trap: a selection that yields a single artist is completed
  // from the floor rather than left as the single card the spec forbids.
  if (names.length === 1) {
    for (const name of CURATED_ARTISTS_FLOOR) {
      add(name);
      if (names.length >= MINIMUM_CURATED_ARTISTS) break;
    }
  }

  return names;
}
