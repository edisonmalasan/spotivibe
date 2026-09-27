import { pillButtonClassName } from "@/components/design-system/Button";
import { IconButton } from "@/components/design-system/IconButton";
import { Plus } from "lucide-react";
import Link from "next/link";

const libraryPrompts = [
  {
    title: "Start your library",
    description: "Playlists and songs you save will live here.",
    cta: "Open library",
    href: "/library",
  },
  {
    title: "Discover something new",
    description: "Search artists, albums, and songs to play right away.",
    cta: "Search now",
    href: "/search",
  },
];

/**
 * DESIGN.md "Sidebar Panel": 340px carbon column below the top bar with the
 * 16px/700 "Your Library" heading, add control, and two graphite prompt cards
 * (heading + description + white pill action). Hidden below 1024px.
 */
export function Sidebar() {
  return (
    <aside className="hidden w-[340px] shrink-0 flex-col overflow-hidden rounded-t-md bg-carbon lg:flex">
      <div className="flex items-center justify-between px-4 py-4">
        <h2 className="text-link font-bold text-pure-white">Your Library</h2>
        <IconButton label="Add to Your Library">
          <Plus className="size-5" aria-hidden="true" />
        </IconButton>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4">
        {libraryPrompts.map((prompt) => (
          <div key={prompt.title} className="flex flex-col gap-2 rounded-cards bg-graphite p-3">
            <h3 className="text-body-lg font-bold text-pure-white">{prompt.title}</h3>
            <p className="text-body-lg font-regular text-mist">{prompt.description}</p>
            <Link href={prompt.href} className={`mt-1 self-start ${pillButtonClassName}`}>
              {prompt.cta}
            </Link>
          </div>
        ))}
      </div>
    </aside>
  );
}
