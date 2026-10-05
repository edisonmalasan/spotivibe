import type { Artwork, PlaylistRecord, Track } from "@/data/repositories";

/**
 * Pure presentation helpers for the M7 library surfaces (design §8): cover
 * derivation, duration summing/formatting, and the shared song-count label.
 * No I/O and no framework imports — unit-tested matrices in
 * `tests/library-surface.test.tsx`.
 */

/** Best-resolution artwork entry (largest known width wins; first wins ties). */
function bestArtworkEntry(artwork: readonly Artwork[]): Artwork | undefined {
  let best: Artwork | undefined;
  for (const entry of artwork) {
    if (best === undefined || (entry.width ?? 0) > (best.width ?? 0)) {
      best = entry;
    }
  }
  return best;
}

/** The best-resolution URL for a track's artwork, if it has any. */
export function bestArtworkUrl(track: Track): string | undefined {
  return bestArtworkEntry(track.artwork)?.url;
}

/** The best-resolution URL from an artwork list (a playlist's own artwork). */
export function artworkUrl(artwork: readonly Artwork[] | undefined): string | undefined {
  return artwork === undefined ? undefined : bestArtworkEntry(artwork)?.url;
}

/**
 * A playlist's cover: its own artwork when it has some, otherwise the first ≤4
 * *distinct* track artwork URLs in track order.
 *
 * Design §8's grid rule is unchanged — 1 tile renders as a single image, 2–4 form a
 * 2×2 grid, and an empty result means "use the placeholder tile".
 *
 * **M23: the playlist's own artwork is preferred here, in the one derivation, rather
 * than in each caller.** A playlist imported from a provider, or one whose cover the
 * listener set, carries real artwork that is a truer picture of the collection than a
 * collage of whatever four of its tracks happen to have. `Sidebar` and
 * `PlaylistDetailView` were each doing this preference at the call site; `LibraryView`
 * was not, so the same playlist showed its real cover in the sidebar and a derived
 * collage in the library grid — one record, two pictures, and which one you saw depended
 * on where you looked. Putting the rule here makes that disagreement unrepresentable
 * rather than something a fourth surface can reintroduce.
 */
export function derivePlaylistArtwork(
  playlist: Pick<PlaylistRecord, "tracks" | "artwork">,
): string[] {
  const own = artworkUrl(playlist.artwork);
  if (own !== undefined) return [own];

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const entry of playlist.tracks) {
    const url = bestArtworkUrl(entry.track);
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length === 4) break;
  }
  return urls;
}

/**
 * Total duration from the tracks that report one (design §8): positive
 * `durationSeconds` values only — a track without a known duration
 * contributes nothing rather than being guessed at.
 */
export function sumPlaylistDuration(tracks: readonly Track[]): number {
  let total = 0;
  for (const track of tracks) {
    if (typeof track.durationSeconds === "number" && track.durationSeconds > 0) {
      total += track.durationSeconds;
    }
  }
  return total;
}

/**
 * Floor-formatted total: `m min` under an hour, `h hr m min` at or above
 * (design §8). A total below a minute rounds away to "nothing known" — the
 * `0 min` case the design omits — so callers show the count only.
 */
export function formatTotalDuration(seconds: number): string | null {
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** `"1 song"` / `"N songs"` — the count label shared by every library card. */
export function songCountLabel(count: number): string {
  return `${count} ${count === 1 ? "song" : "songs"}`;
}
