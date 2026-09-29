import type { Track } from "@/data/repositories";
import { normalizeEntityText } from "@/features/artist/artistKeys";

/**
 * "Liked tracks by this artist" as a **pure local derivation** (M9 task 3.4;
 * spec: `catalog` — "Local catalog signals"; design §4).
 *
 * This is a question the local library can already answer, so it is answered
 * where the answer already lives: `libraryStore.likedTracks`. There is no
 * request, no new store, no new dataset, and no import of the store itself —
 * the function takes the liked tracks as an argument, which is what makes it
 * testable as a pure filter and keeps a personalization signal from growing a
 * data dependency it does not have.
 *
 * Identity follows the domain rule the rest of the app uses: an artist id when
 * both sides carry one, else the name. `splitArtists` only ever attaches an id
 * to the *first* artist of a result and only when the tier supplied one, so the
 * name path is the common one and the id path is the exact one.
 */

/** The identity the artist page resolved for the artist it is showing. */
export interface ResolvedArtistIdentity {
  /** Provider entity id, when the resolution carried one. */
  id?: string;
  name: string;
}

/** A trimmed non-blank string, or `undefined` for absent/blank input. */
function trimmedOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

/**
 * Case-, punctuation-, and whitespace-insensitive identity fold.
 *
 * Built on the shared {@link normalizeEntityText} so a name is trimmed and
 * whitespace-collapsed the same way a route key is, then lowercased and reduced
 * to its letters and digits — so "Aurora Sky", "aurora-sky", and "  Aurora  Sky "
 * are one artist. Diacritics are deliberately **preserved** (NFD folding would
 * be a further guess about spelling); provider spellings are consistent enough
 * that the fold is about formatting noise, not about equating two spellings.
 */
function identityKey(value: string): string {
  return normalizeEntityText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * The liked tracks credited to `artist`, in the input order.
 *
 * A track counts as this artist's when **any** of its credited artists matches
 * — a collaboration by the artist is a liked track by the artist, and stopping
 * at `artists[0]` would drop those. Matching is per credit:
 *
 * - both sides carry an id → the ids must be equal (the exact path), and
 *   a name match is *not* consulted, so two same-named channels cannot merge;
 * - otherwise → the normalized names must be equal (the common path, for the
 *   id-less credits `splitArtists` produces).
 *
 * Input order is the output order, so the caller's list stays authoritative and
 * the result is deterministic. An artist with no id and a blank name cannot
 * match anything, which returns an empty list rather than every liked track.
 * The input is never mutated.
 */
export function likedTracksByArtist(
  likedTracks: readonly Track[],
  artist: ResolvedArtistIdentity,
): Track[] {
  const wantedId = trimmedOptional(artist.id);
  const wantedName = identityKey(artist.name);
  if (wantedId === undefined && wantedName === "") return [];

  return likedTracks.filter((track) =>
    track.artists.some((credit) => {
      const creditId = trimmedOptional(credit.id);
      if (wantedId !== undefined && creditId !== undefined) return creditId === wantedId;
      return wantedName !== "" && identityKey(credit.name) === wantedName;
    }),
  );
}
