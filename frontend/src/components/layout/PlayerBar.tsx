import { IconButton } from "@/components/design-system/IconButton";
import { Heart, ListMusic, Music2, Play, SkipBack, SkipForward } from "lucide-react";
import Link from "next/link";

/**
 * Desktop player slot (72px, void-black) below the content area. Idle state
 * only in M1: placeholder artwork/title, disabled transport controls with the
 * green play affordance, and a zeroed progress track. The whole track cluster
 * links to the expanded Now Playing route.
 */
export function PlayerBar() {
  return (
    <div
      data-testid="player-bar"
      className="hidden h-18 shrink-0 items-center gap-6 bg-void-black px-4 lg:flex"
    >
      <Link
        href="/now-playing"
        aria-label="Open Now Playing"
        className="flex w-1/3 min-w-0 items-center gap-3"
      >
        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-images bg-graphite">
          <Music2 className="size-5 text-fog" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-body-lg font-semibold text-pure-white">
            Nothing playing
          </span>
          <span className="truncate text-caption font-regular text-mist">
            Choose something to start
          </span>
        </span>
      </Link>

      <div className="flex max-w-xl flex-1 flex-col items-center gap-2">
        <div className="flex items-center gap-4">
          <IconButton label="Previous track" disabled>
            <SkipBack className="size-5" aria-hidden="true" />
          </IconButton>
          <IconButton label="Play" size="md" tone="accent" disabled>
            <Play className="size-5 fill-current" aria-hidden="true" />
          </IconButton>
          <IconButton label="Next track" disabled>
            <SkipForward className="size-5" aria-hidden="true" />
          </IconButton>
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
      </div>

      <div className="flex w-1/3 items-center justify-end gap-2">
        <IconButton label="Save to Liked Songs" disabled>
          <Heart className="size-5" aria-hidden="true" />
        </IconButton>
        <IconButton label="Queue" disabled>
          <ListMusic className="size-5" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}
