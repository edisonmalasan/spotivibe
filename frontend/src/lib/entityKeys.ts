/**
 * Shared entity-key rules for the catalog routes (M9; spec: `catalog` — "Catalog
 * entity keys and resolution requests"; design §2).
 *
 * `/artist/[key]` and `/album/[key]` are each addressed by **one** parameter that
 * is either a provider entity id (sent as `id=`) or a normalized text key (sent as
 * `name=`/`title=`). Both surfaces must answer the same two questions — "is this
 * an id?" and "what is this text's identity form?" — identically, so the rules
 * live here in one provider-free module rather than in one feature and imported by
 * the other. Nothing here touches a repository, a network, or a framework.
 */

/** The YouTube channel-id prefix — the one id shape a provider hands us today. */
const YOUTUBE_CHANNEL_PREFIX = "UC";

/**
 * Shortest token the long-opaque-id rule accepts. A YouTube channel id is 24
 * characters, so 20 leaves a little slack while staying far above any real
 * artist name made only of letters and digits.
 */
const MIN_OPAQUE_ID_LENGTH = 20;

/**
 * Shortest token the underscore rule accepts. A YouTube release id
 * (`MPREb_…`, `OLAK5uy_…`) is 13 + 11–34 characters; 12 sits below the shortest
 * of those while staying far above any hyphenated or underscored *name* a person
 * would search for (AC/DC, K-Pop, 100% Hits).
 */
const MIN_UNDERSCORED_ID_LENGTH = 12;

/**
 * Whether `value` is shaped like a provider entity id rather than a text key.
 *
 * The rule is intentionally **narrow**, because misclassifying is the one failure
 * mode with no honest recovery: a name sent as `id=` resolves to nothing, and an
 * id sent as `name=` silently resolves to *some other* entity (spec: "An
 * unresolvable key is not substituted"). Three conditions qualify, each of which
 * a human-typed artist or release name practically never satisfies:
 *
 * 1. A `UC` prefix, **case-sensitively** — YouTube channel ids are
 *    case-sensitive tokens, and accepting `uc…` too would sweep in the very
 *    common band/label names that start "Uc" (UChicago, …).
 * 2. An unbroken alphanumeric run of at least {@link MIN_OPAQUE_ID_LENGTH}
 *    characters. No punctuation at all, so a name can never be mistaken for an
 *    opaque id by length alone.
 * 3. A single token of at least {@link MIN_UNDERSCORED_ID_LENGTH} characters
 *    containing an underscore and **no** other punctuation, plus no spaces — the
 *    shape of a YouTube release id. This case exists because the M9 evidence run
 *    found a real release key (`MPREb_eEpQf8QskKl`) that condition 2 rejected as a
 *    *name*, which sent the id as a search phrase and resolved an unrelated
 *    release instead of reporting the key as unresolvable. The underscore is the
 *    discriminator: it is what a release id has and a band, artist, or release
 *    name does not.
 *
 * Everything else — including the empty string, whitespace-only input, and
 * ordinary names with spaces, accents, or punctuation — is a text key.
 */
export function isProviderEntityId(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith(YOUTUBE_CHANNEL_PREFIX)) return true;
  if (new RegExp(`^[A-Za-z0-9]{${MIN_OPAQUE_ID_LENGTH},}$`).test(trimmed)) return true;
  return (
    trimmed.length >= MIN_UNDERSCORED_ID_LENGTH &&
    new RegExp(`^[A-Za-z0-9]+_[A-Za-z0-9_]+$`).test(trimmed)
  );
}

/**
 * Text identity form: trimmed with internal whitespace runs collapsed to one
 * space. This is the *presentation* normalization (what a route key and a display
 * name agree on) and deliberately does **not** lowercase, fold accents, or strip
 * punctuation, because doing any of those would merge genuinely different names
 * ("AURORA" and "Aurora") that a listener means to tell apart.
 */
export function normalizeEntityText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
