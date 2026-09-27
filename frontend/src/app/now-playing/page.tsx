import { IconButton } from "@/components/design-system/IconButton";
import { ChevronDown, Heart, ListMusic, Music2, Play, SkipBack, SkipForward } from "lucide-react";
import Link from "next/link";

/**
 * Expanded Now Playing route (M1 shell surface): reachable from the player
 * region's affordances, fills the content area. Idle placeholder state —
 * artwork block, placeholder title/artist, and control placeholders only.
 */
export default function NowPlayingPage() {
  return (
    <div className="flex min-h-full flex-col items-center gap-6 px-4 py-6">
      <div className="flex w-full max-w-3xl items-center justify-between">
        <Link
          href="/"
          aria-label="Close Now Playing"
          className="inline-flex size-8 items-center justify-center rounded-buttons text-pure-white transition hover:bg-smoke"
        >
          <ChevronDown className="size-5" aria-hidden="true" />
        </Link>
        <h1 className="text-link font-bold text-pure-white">Now Playing</h1>
        <span className="size-8" aria-hidden="true" />
      </div>

      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-images bg-graphite">
          <Music2 className="size-16 text-fog" aria-hidden="true" />
        </div>

        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-heading font-bold text-pure-white">Nothing playing</p>
          <p className="text-body-lg font-regular text-mist">Choose something to start</p>
        </div>

        <div className="flex w-full items-center gap-2">
          <span className="text-caption font-regular text-mist">0:00</span>
          <span
            role="progressbar"
            aria-label="Track progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={0}
            className="h-1 flex-1 overflow-hidden rounded-full bg-iron"
          >
            <span className="block h-1 w-0 rounded-full bg-pure-white" />
          </span>
          <span className="text-caption font-regular text-mist">0:00</span>
        </div>

        <div className="flex items-center gap-4">
          <IconButton label="Save to Liked Songs" disabled>
            <Heart className="size-5" aria-hidden="true" />
          </IconButton>
          <IconButton label="Previous track" disabled>
            <SkipBack className="size-5" aria-hidden="true" />
          </IconButton>
          <IconButton label="Play" size="md" tone="accent" disabled>
            <Play className="size-5 fill-current" aria-hidden="true" />
          </IconButton>
          <IconButton label="Next track" disabled>
            <SkipForward className="size-5" aria-hidden="true" />
          </IconButton>
          <IconButton label="Queue" disabled>
            <ListMusic className="size-5" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
