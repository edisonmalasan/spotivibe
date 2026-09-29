/**
 * Pure parsing of a user-supplied playlist reference (design decision 9).
 *
 * Accepts exactly two shapes — no account/OAuth/cookies anywhere, keyless
 * like search:
 *
 * - a bare playlist ID matching {@link BARE_ID_PATTERN};
 * - an http(s) URL on a YouTube host (`youtube.com`, `*.youtube.com`,
 *   `youtu.be`) whose path is a playlist-bearing form (`/watch`,
 *   `/playlist`, `/embed/*`, or the `youtu.be` short link) carrying a valid
 *   `list` query parameter.
 *
 * Everything else — empty input, malformed URLs, non-YouTube hosts,
 * playlist-less URLs — is rejected as `null` so the route can answer
 * `400 invalid_input` before any upstream call.
 */

/** YouTube playlist IDs are URL-safe base64-ish, 6–64 characters. */
const BARE_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

function isYouTubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
}

/**
 * Extract the playlist ID from a reference, or `null` when the input is not
 * an accepted playlist reference (pure — fixture-tested, no network).
 */
export function parsePlaylistRef(src: string): string | null {
  const trimmed = src.trim();
  if (trimmed.length === 0) return null;
  if (BARE_ID_PATTERN.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!isYouTubeHost(url.hostname)) return null;

  const list = url.searchParams.get("list");
  if (list === null || !BARE_ID_PATTERN.test(list)) return null;

  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  const isShortLink = url.hostname.toLowerCase() === "youtu.be" && path.length > 0;
  const isPlaylistPath =
    path === "/watch" || path === "/playlist" || path.startsWith("/embed/") || isShortLink;
  if (!isPlaylistPath) return null;

  return list;
}
