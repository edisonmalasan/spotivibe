/**
 * Original Spotivibe identity — dark rounded tile with three ascending green
 * "vibe" bars plus the wordmark. No third-party music-service marks, logos,
 * or copy anywhere.
 */
export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <svg viewBox="0 0 24 24" className="size-7 shrink-0" aria-hidden="true">
        <rect width="24" height="24" rx="6" fill="var(--color-graphite)" />
        <rect x="5" y="12.5" width="3" height="7" rx="1.5" fill="var(--color-spotify-green)" />
        <rect x="10.5" y="8.5" width="3" height="11" rx="1.5" fill="var(--color-spotify-green)" />
        <rect x="16" y="4.5" width="3" height="15" rx="1.5" fill="var(--color-spotify-green)" />
      </svg>
      <span className="text-link font-bold text-pure-white">Spotivibe</span>
    </span>
  );
}
