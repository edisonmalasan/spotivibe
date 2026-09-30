/**
 * Whether a stored record can be rendered (M14; spec `local-data` — "Versioned IndexedDB
 * storage with durable data", scenario "A record that cannot be rendered does not fail
 * the surface").
 *
 * ## Why this exists
 *
 * A stored record is **untrusted data**. Some of it arrives from a provider we do not
 * control, and some of it arrives from a backup file a person edited or a browser
 * extension mangled. M13's verification pass found the consequence: a liked track whose
 * `artists` was missing crashed `/library/liked` into the route error boundary — a
 * whole page lost to one malformed row. The fix was local to that surface, which is
 * exactly what leaves the *next* surface to find the same thing on its own.
 *
 * So the rule is here instead, in one place, next to the record shapes it judges.
 *
 * ## What a guard does and does not do
 *
 * It **skips** what cannot be rendered. It does not repair: a record missing its title
 * is not given an invented one, because a fabricated title in someone's library is
 * worse than an absent row — it is something they cannot tell apart from real data. A
 * field that is present but empty is defaulted; a field that is absent or the wrong type
 * disqualifies the record.
 *
 * ## Why these are predicates, not a normalizer
 *
 * A predicate narrows the type, so a surface that uses one cannot accidentally read the
 * field it just checked — the compiler rejects it. That is the property a comment
 * cannot give, and it is why the surfaces call these rather than checking inline.
 */
import type { ListeningEventRecord, PlaylistRecord, Track } from "./types";

/** A track with the fields every rendering surface reads, proven present. */
export type RenderableTrack = Track & {
  title: string;
  artists: Array<{ name: string }>;
};

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * A named artist list.
 *
 * `artist.name` is what every row renders, so an entry without a usable name
 * disqualifies the track rather than rendering an empty byline — which is what the
 * pre-M14 crash looked like when the whole `artists` array was missing.
 */
function isArtistList(value: unknown): value is Array<{ name: string }> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((artist) => isText((artist as { name?: unknown } | null)?.name))
  );
}

/**
 * A track that can be rendered.
 *
 * `providerId` is required as well as the visible fields: it is how playback resolves a
 * track back to its video, so a record without it cannot be played however well it
 * renders. Skipping it here means the listener is not offered a row that fails when
 * they press play.
 */
export function isRenderableTrack(value: unknown): value is RenderableTrack {
  if (value === null || typeof value !== "object") return false;
  const track = value as Partial<Track>;
  return (
    isText(track.providerId) &&
    isText(track.title) &&
    isArtistList(track.artists) &&
    (track.artwork === undefined || Array.isArray(track.artwork))
  );
}

/** The tracks a surface may render, in the order it received them. */
export function renderableTracks(values: readonly unknown[]): RenderableTrack[] {
  return values.filter(isRenderableTrack);
}

/**
 * A playlist that can be rendered.
 *
 * A playlist needs a name, an id to route with, and an entry list that is an array —
 * an empty playlist is legitimate (a person made it and deleted everything), a missing
 * entry list is not.
 */
export function isRenderablePlaylist(value: unknown): value is PlaylistRecord {
  if (value === null || typeof value !== "object") return false;
  const playlist = value as Partial<PlaylistRecord>;
  return (
    isText(playlist.id) &&
    isText(playlist.name) &&
    // An empty playlist is legitimate - a person made it and removed everything - so
    // the entry list only has to *be* an array.
    Array.isArray(playlist.tracks) &&
    typeof playlist.updatedAt === "number" &&
    (playlist.description === undefined || typeof playlist.description === "string")
  );
}

export function renderablePlaylists(values: readonly unknown[]): PlaylistRecord[] {
  return values.filter(isRenderablePlaylist);
}

/**
 * A listening event that can be rendered.
 *
 * `track` is judged by {@link isRenderableTrack}, because the history surface renders
 * the same fields every other surface does; an event whose track cannot be drawn is not
 * a row anyone can read.
 */
export function isRenderableEvent(value: unknown): value is ListeningEventRecord {
  if (value === null || typeof value !== "object") return false;
  const event = value as Partial<ListeningEventRecord>;
  return (
    // A non-empty id, not merely a string one: an event is updated and cleared *by
    // id*, so an empty id is a row nobody can remove. The first version of this guard
    // accepted one, and its own test caught it.
    isText(event.id) &&
    isText(event.trackId) &&
    // The history surface groups by day from `playedAt`, so a non-finite timestamp is
    // not a row it can place.
    typeof event.playedAt === "number" &&
    Number.isFinite(event.playedAt) &&
    isRenderableTrack(event.track)
  );
}

export function renderableEvents(values: readonly unknown[]): ListeningEventRecord[] {
  return values.filter(isRenderableEvent);
}
