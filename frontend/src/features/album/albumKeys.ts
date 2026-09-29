/**
 * Album route keys (M9 task 4.1; spec: `catalog` — "Catalog entity keys and
 * resolution requests"; design §2).
 *
 * `/album/[key]` is addressable by **one** parameter with three accepted
 * shapes, in priority order:
 *
 * 1. a provider entity id, sent as `id=`;
 * 2. `<title> - <artist>`, split back apart and sent as `title=` + `artist=`;
 * 3. a bare normalized title, sent as `title=`.
 *
 * The `title - artist` form is what this app *mints* when a provider supplied
 * no release id, which is the common case: providers expose no album lookup at
 * any tier, so a release's identity is its title plus its artist.
 *
 * This module is deliberately rule-based rather than lookup-based for the same
 * reason `artistKeys` is: a client cannot ask the provider "is this string an
 * id?" without a round trip, and an entity route must resolve in one request
 * (design §1). Pure functions only — no repository, no network, no framework
 * import.
 *
 * It also **owns the canonical album href helper** the whole app formats album
 * links with: the artist page's release tiles call {@link albumHrefFromRelease}
 * directly, and `tests/album-keys.test.ts` pins that round trip, so no second copy
 * of the album-route format can appear.
 *
 * The two key-classification rules are shared with the artist route and live in
 * `@/lib/entityKeys`; this module imports them rather than re-declaring them, so
 * an artist key and an album key can never drift apart.
 */
import { isProviderEntityId, normalizeEntityText } from "@/lib/entityKeys";

/** Route prefix for a release/album page. */
const ALBUM_ROUTE = "/album";

/**
 * The separators a composed `title - artist` key may carry. The hyphen form is
 * what {@link albumHrefFromRelease} mints; the en-dash form is accepted because
 * it is one keystroke away in a hand-written or pasted URL and splits the same
 * unambiguous way.
 */
const ALBUM_KEY_SEPARATORS = [" - ", " – "] as const;

/** The separator {@link albumHrefFromRelease} writes. */
const MINTED_ALBUM_KEY_SEPARATOR = " - ";

/** The two identifier shapes a text key may resolve to, plus the id shape. */
export type AlbumRequestKey = { title: string; artist?: string } | { id: string };

/**
 * Percent-decode a route key when it is encoded, tolerating a malformed
 * sequence — the same rule `artistKeys` documents.
 *
 * The router hands a dynamic segment over percent-decoded, so `/album/The%20Wall`
 * arrives as `The Wall`; but a key can also reach this module as a hand-written
 * or pasted href that is still encoded. A malformed sequence is left as-is
 * rather than throwing on a bad route: a broken key must render a not-found
 * state, not crash the page.
 *
 * Module-private rather than imported, because `artistKeys` keeps its own copy
 * unexported on purpose and this feature must not reach into a sibling
 * feature's internals; the two rules are pinned equal by the key tests.
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
 * Best-effort de-slug for a **whole** text key, mirroring `artistKeys`'.
 *
 * A slug's hyphens are the only reversible trace of where the spaces were, and
 * capitalization is not recoverable, so hyphens become spaces and the case the
 * key arrived in is sent as-is — the provider search is case- and
 * punctuation-insensitive, which is what makes the lossy half acceptable. Only
 * a whitespace-free key is de-slugged: a key the user typed with real spaces is
 * already text.
 *
 * Applied to the **whole key only**, never to a half of a composed one. A
 * composed key's halves are prose — `albumHrefFromRelease` wrote them from a
 * resolved title and artist — so de-slugging them could only corrupt a real name
 * (`Jay-Z` → `Jay Z`) without making any slug work. The known lossy case is
 * therefore a hyphen inside a single-word bare title, the same one
 * `/artist/K-Pop` already has, which the provider's search normalization still
 * resolves.
 */
function deSlug(text: string): string {
  return normalizeEntityText(/\s/.test(text) ? text : text.replace(/-/g, " "));
}

/**
 * Split a composed key on its first separator, or return `null` when the key
 * carries none.
 *
 * **First** separator, not last: the only key format this codebase mints is
 * `<title> - <artist>` (see {@link albumHrefFromRelease}), and a first-separator
 * split is its exact inverse, so a key this app produced always recovers the
 * title and artist the provider was asked about. The alternative would round-trip
 * the minted form wrongly for the (common) title that itself contains a
 * separator. The known lossy case is a *hand-written* key in the human
 * `Artist - Album` order, which the split reads the other way round; the request
 * then simply resolves nothing, and the page shows its recoverable not-found
 * state rather than a substituted release (spec: "An unresolvable key is not
 * substituted").
 *
 * A blank half degrades to `null`, and the caller then reads the whole key as a
 * bare title. `trim()` already absorbs a leading or trailing separator's outside
 * space, so that path is defensive rather than routine.
 */
function splitComposedKey(decoded: string): { title: string; artist: string } | null {
  for (const separator of ALBUM_KEY_SEPARATORS) {
    const at = decoded.indexOf(separator);
    if (at === -1) continue;
    const title = normalizeEntityText(decoded.slice(0, at));
    const artist = normalizeEntityText(decoded.slice(at + separator.length));
    if (title === "" || artist === "") return null;
    return { title, artist };
  }
  return null;
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
 *
 * The composed branch is tried before the id branch purely for readability: a
 * provider entity id never contains whitespace, so the two can never both
 * match, and an id is therefore never split or de-slugged.
 */
export function albumRequestKey(key: string): AlbumRequestKey | null {
  const decoded = decodeKey(key).trim();
  if (decoded === "") return null;

  const composed = splitComposedKey(decoded);
  if (composed !== null) return composed;

  if (isProviderEntityId(decoded)) return { id: decoded };
  return { title: deSlug(decoded) };
}

/**
 * The album route for `key` — a provider id when the provider supplied one,
 * else the composed or bare title. Percent-encoded so a title with spaces,
 * accents, `&`, or the ` - ` separator round-trips through the URL, which is
 * what makes the route shareable.
 */
export function albumHref(key: string): string {
  return `${ALBUM_ROUTE}/${encodeURIComponent(key.trim())}`;
}

/**
 * The album route for a resolved release — the canonical way a *release entry*
 * (an artist page's release tile, a track's album summary) becomes a link.
 *
 * Prefers the provider's release id when it supplied one, because an id is the
 * release's own identity; otherwise it composes `<title> - <artist>` when an
 * artist is known and falls back to the bare title when it is not, which is the
 * only remaining text. Each half is normalized the same way a hand-typed key
 * is, so a title or artist that arrived with stray whitespace produces the same
 * key on both sides of the link.
 */
export function albumHrefFromRelease(release: {
  id?: string;
  title: string;
  artistName?: string;
}): string {
  const id = release.id?.trim();
  if (id !== undefined && id !== "") return albumHref(id);

  const title = normalizeEntityText(release.title);
  const artist =
    release.artistName === undefined ? undefined : normalizeEntityText(release.artistName);
  if (title === "") return albumHref(artist ?? "");
  if (artist !== undefined && artist !== "") {
    return albumHref(`${title}${MINTED_ALBUM_KEY_SEPARATOR}${artist}`);
  }
  return albumHref(title);
}
