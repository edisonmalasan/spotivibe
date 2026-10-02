import type { Track } from "@/data/repositories";
import { buildSearchUrl } from "@/lib/searchUrl";

/**
 * A track's share payload — **deliberately a search URL** (M18 task 5.4;
 * design decision 8).
 *
 * **There is no `/track/[id]` route, by design.** M9 gave the album and the artist
 * a page each and deliberately did not give a track one, so a track has no page of
 * its own to link to. Adding one would mean a new route, its own `catalog` delta,
 * its own resolution request, and its own lifecycle — for a page whose entire
 * content is what a search for the track already shows. So a shared track link
 * resolves to the search that finds it.
 *
 * **The representation is lossy, and that is a decision rather than an omission.**
 * The URL carries the track's artists and title, which is exactly what the search
 * normalizes on, so the link does resolve back to the track. What it cannot carry
 * is the track's *identity*: two tracks sharing an artist and a title produce the
 * same link, and nothing in it says which recording was playing. That is acceptable
 * here because the alternative is not a better link — it is a provider URL, which
 * resolves on somebody else's service and breaks the moment this application is
 * deployed somewhere else. Anything that needs a stable identity for a track must
 * use `Track.providerId` (the YouTube video id), and it must not come through
 * here.
 */

/** What a track contributes to a share: its Spotivibe URL and a human title. */
export interface TrackSharePayload {
  url: string;
  title: string;
}

/**
 * The Spotivibe link and title a track shares.
 *
 * The query is the artist names and the title joined by a space — the shape a
 * listener would type to find the track — and {@link buildSearchUrl} encodes it.
 * A track credited to nobody is searched for by its title alone rather than by a
 * leading space.
 */
export function trackSharePayload(track: Track): TrackSharePayload {
  const artists = track.artists.map((artist) => artist.name).join(", ");
  const query = `${artists} ${track.title}`.trim();
  return {
    url: buildSearchUrl(query),
    // The title is what a platform sheet shows next to the link, so it is prose
    // rather than a query: the artists are already in it.
    title: artists === "" ? track.title : `${track.title} — ${artists}`,
  };
}
