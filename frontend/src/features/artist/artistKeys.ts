/**
 * Artist route keys (M9; spec: `catalog` — "Catalog entity keys and resolution
 * requests"; design §2).
 *
 * `/artist/[key]` is addressable by **one** parameter that is either a provider
 * entity id (sent as `id=`) or a normalized text key (sent as `name=`). Only
 * YouTube exists as a provider today and `splitArtists` attaches an id to the
 * *first* artist of a result only when the tier supplied one, so an id-only
 * route would break most entry points — hence the text-key half. Both halves
 * are pure functions over the key: no repository, no network, no framework
 * import.
 *
 * The whole module is deliberately rule-based rather than lookup-based, because
 * a client cannot ask the provider "is this string an id?" without a round trip
 * and an artist route must resolve in one request (design §1).
 *
 * The two classification rules are shared with the album route and therefore live
 * in `@/lib/entityKeys`; they are re-exported here because the artist route's
 * consumers (entry points, tests) read them as part of this route's contract, and
 * the pinned export list in `tests/artist-keys.test.ts` guards the surface.
 */
import { isProviderEntityId, normalizeEntityText } from "@/lib/entityKeys";

export { isProviderEntityId, normalizeEntityText };

/** Route prefix for an artist page. */
const ARTIST_ROUTE = "/artist";

/** The two identifier shapes a route key may resolve to. */
export type ArtistRequestKey = { name: string } | { id: string };

/**
 * Percent-decode a route key when it is encoded, tolerating a malformed
 * sequence.
 *
 * The router hands a dynamic segment over percent-decoded, so `/artist/Bj%C3%B6rk`
 * arrives as `Björk`; but a key can also reach this module as a hand-written or
 * pasted href that is still encoded. Decoding is attempted only when a `%` is
 * present and a malformed sequence is left as-is rather than throwing on a bad
 * route — a broken key must render a not-found state, not crash the page.
 */
function decodeKey(key: string): string {
  if (!key.includes("%")) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

/**
 * Best-effort de-slug for a text key.
 *
 * A slug's hyphens are the only reversible trace of where the name's spaces
 * were, and **capitalization is not recoverable** — `lumivox` came from
 * `Lumivox`, `lumivöx`, or `LumiVox`, and guessing would be fabricating
 * metadata. So hyphens become spaces and the case the key arrived in is sent
 * as-is; the provider search is case- and punctuation-insensitive, which is
 * what makes the lossy half of this acceptable.
 *
 * Only a whitespace-free key is de-slugged: a key the user typed with real
 * spaces is already text and is passed through untouched. The known lossy case
 * is therefore a hyphen *inside a name* (`/artist/K-Pop` → `K Pop`), which the
 * same search normalization still resolves. The canonical key is never rewritten
 * — `artistHref` round-trips whatever it was given — so this affects only the
 * text sent to the provider, never the link.
 */
function deSlug(text: string): string {
  return normalizeEntityText(/\s/.test(text) ? text : text.replace(/-/g, " "));
}

/**
 * Translate a route key into the identifier the resolution request carries.
 *
 * Returns `null` for blank input rather than throwing: an empty key is a
 * *missing route parameter*, not a malformed request, and the caller (the API
 * module, the view) turns it into the right answer — a local `invalid_request`
 * failure before any network call, or a not-found state with no request at all.
 * Returning `null` keeps this pure module free of the API error type, which
 * would otherwise make the two files import each other.
 */
export function artistRequestKey(key: string): ArtistRequestKey | null {
  const decoded = decodeKey(key).trim();
  if (decoded === "") return null;
  return isProviderEntityId(decoded) ? { id: decoded } : { name: deSlug(decoded) };
}

/**
 * The artist route for `key` — an id when the provider supplied one, else the
 * artist's name. Percent-encoded so a name with spaces, accents, or `&`
 * round-trips through the URL, which is what makes the route shareable.
 */
export function artistHref(key: string): string {
  return `${ARTIST_ROUTE}/${encodeURIComponent(key.trim())}`;
}
