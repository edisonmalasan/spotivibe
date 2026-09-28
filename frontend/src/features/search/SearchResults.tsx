import { formatClock } from "@/components/player/formatClock";
import type { Track } from "@/data/repositories";

/**
 * Songs section: canonical track information rendered in API relevance order
 * (spec "Result sections from canonical metadata"). The track set is already
 * deduplicated by the derivation layer before it reaches this component.
 */
export function SearchResults({ tracks }: { tracks: Track[] }) {
  return (
    <ul data-testid="search-results" className="flex flex-col gap-2">
      {tracks.map((track) => {
        const artistText = track.artists.map((artist) => artist.name).join(", ");
        return (
          <li key={track.id} className="flex items-center gap-4 rounded-cards bg-smoke px-3 py-2">
            <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-images bg-graphite">
              {track.artwork[0] ? (
                // Provider artwork thumbnails: dynamic remote URLs, no optimizer
                // allowlist yet (M9 owns asset handling).
                // eslint-disable-next-line @next/next/no-img-element
                <img src={track.artwork[0].url} alt="" className="size-full object-cover" />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body-lg font-regular text-pure-white">
                {track.title}
              </span>
              <span className="truncate text-body text-mist">{artistText}</span>
            </span>
            {track.durationSeconds !== undefined && (
              <span className="text-body text-mist">{formatClock(track.durationSeconds)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
