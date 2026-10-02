"use client";

import { pillButtonClassName } from "@/components/design-system/Button";
import { IconButton } from "@/components/design-system/IconButton";
import { PlaylistCover } from "@/components/playlist/PlaylistCover";
import { useLibraryReady } from "@/features/library/useLibraryReady";
import { playlistHref } from "@/features/playlists/playlistKeys";
import {
  PlaylistFormDialog,
  type PlaylistFormValue,
} from "@/features/playlists/PlaylistFormDialog";
import { artworkUrl, derivePlaylistArtwork } from "@/lib/playlistPresentation";
import { useLibraryStore } from "@/stores/libraryStore";
import { Heart, Plus } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

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
 * DESIGN.md "Sidebar Panel" + M7 task 8.1/8.2 (design §7): the 340px carbon
 * column hydrates `libraryStore` on mount and swaps its static prompt cards
 * for live entries — Liked Songs (accent heart tile) and one compact 6px row
 * per playlist (own or derived cover, name) linking to the detail surfaces.
 * Browsing only: entries are plain links, never playback triggers. While the
 * library is empty (and during the first read) the M1 guidance cards remain,
 * and the `+` control opens the shared Create playlist dialog in place, so
 * playlists created or deleted elsewhere appear/vanish without a reload.
 */
export function Sidebar() {
  const likedTracks = useLibraryStore((state) => state.likedTracks);
  const playlists = useLibraryStore((state) => state.playlists);
  const ready = useLibraryReady();
  const [createOpen, setCreateOpen] = useState(false);
  const addTriggerRef = useRef<HTMLSpanElement>(null);

  const empty = likedTracks.length === 0 && playlists.length === 0;

  /** Dismiss the dialog and hand focus back to the `+` that opened it. */
  function closeCreate(): void {
    setCreateOpen(false);
    addTriggerRef.current?.querySelector("button")?.focus();
  }

  async function createPlaylist(value: PlaylistFormValue): Promise<void> {
    await useLibraryStore.getState().createPlaylist(value);
  }

  return (
    <aside className="hidden w-[340px] shrink-0 flex-col overflow-hidden rounded-t-md bg-carbon lg:flex">
      <div className="flex items-center justify-between px-4 py-4">
        <h2 className="text-link font-bold text-pure-white">Your Library</h2>
        <span ref={addTriggerRef}>
          <IconButton label="Add to Your Library" onClick={() => setCreateOpen(true)}>
            <Plus className="size-5" aria-hidden="true" />
          </IconButton>
        </span>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4">
        {!ready || empty ? (
          libraryPrompts.map((prompt) => (
            <div
              key={prompt.title}
              className="flex flex-col gap-2 rounded-cards bg-graphite p-3 transition-colors hover:bg-smoke"
            >
              <h3 className="text-body-lg font-bold text-pure-white">{prompt.title}</h3>
              <p className="text-body-lg font-regular text-mist">{prompt.description}</p>
              <Link href={prompt.href} className={`mt-1 self-start ${pillButtonClassName}`}>
                {prompt.cta}
              </Link>
            </div>
          ))
        ) : (
          <>
            <Link
              href="/library/liked"
              className="flex items-center gap-3 rounded-cards px-2 py-2 transition-colors hover:bg-graphite"
            >
              <span
                className="grid size-10 shrink-0 place-items-center rounded-images bg-spotify-green"
                aria-hidden="true"
              >
                <Heart className="size-5 fill-pure-white text-pure-white" />
              </span>
              <span className="truncate text-body-lg font-regular text-pure-white">
                Liked Songs
              </span>
            </Link>
            {playlists.map((playlist) => {
              const ownCover = artworkUrl(playlist.artwork);
              const coverUrls = ownCover ? [ownCover] : derivePlaylistArtwork(playlist);
              return (
                <Link
                  key={playlist.id}
                  href={playlistHref(playlist.id)}
                  className="flex items-center gap-3 rounded-cards px-2 py-2 transition-colors hover:bg-graphite"
                >
                  <PlaylistCover urls={coverUrls} className="size-10 shrink-0" />
                  <span className="truncate text-body-lg font-regular text-pure-white">
                    {playlist.name}
                  </span>
                </Link>
              );
            })}
          </>
        )}
      </div>

      {createOpen && (
        <PlaylistFormDialog
          title="Create playlist"
          submitLabel="Create"
          onSave={createPlaylist}
          onClose={closeCreate}
        />
      )}
    </aside>
  );
}
