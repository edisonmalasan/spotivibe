import { IconButton } from "@/components/design-system/IconButton";
import { Music2, Play } from "lucide-react";
import Link from "next/link";

/**
 * Compact-shell player slot above the bottom navigation (void-black strip):
 * small idle artwork/title cluster linking to the expanded Now Playing route,
 * plus the green play affordance. Hidden from 1024px up (PlayerBar takes over).
 */
export function MiniPlayer() {
  return (
    <div
      data-testid="mini-player"
      className="flex h-14 shrink-0 items-center gap-3 bg-void-black px-3"
    >
      <Link
        href="/now-playing"
        aria-label="Open Now Playing"
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-images bg-graphite">
          <Music2 className="size-4 text-fog" aria-hidden="true" />
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
      <IconButton label="Play" tone="accent" disabled>
        <Play className="size-5 fill-current" aria-hidden="true" />
      </IconButton>
    </div>
  );
}
