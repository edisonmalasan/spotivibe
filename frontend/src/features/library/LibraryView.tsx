"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/design-system/Button";
import { EmptyState } from "@/components/design-system/EmptyState";
import { SearchInput } from "@/components/design-system/SearchInput";
import { PlaylistCover } from "@/components/playlist/PlaylistCover";
import { filterPlaylists, libraryFilterMatches } from "@/features/library/libraryFilter";
import { useLibraryReady } from "@/features/library/useLibraryReady";
import { ImportPlaylistDialog } from "@/features/playlists/ImportPlaylistDialog";
import { playlistHref } from "@/features/playlists/playlistKeys";
import {
  PlaylistFormDialog,
  type PlaylistFormValue,
} from "@/features/playlists/PlaylistFormDialog";
import { derivePlaylistArtwork, songCountLabel } from "@/lib/playlistPresentation";
import { useLibraryStore } from "@/stores/libraryStore";

/** Which dialog (if any) the header currently hosts. */
type HostedDialog = "create" | "import" | null;

/**
 * `LibraryView` (M7 tasks 5.1–5.3, design §3): the `/library` surface —
 * header with Create/Import actions, the local filter, the Liked Songs entry,
 * and the playlist grid — rendered entirely from `libraryStore` (which reads
 * IndexedDB), so the page needs no network. An empty library keeps the M1
 * explanatory empty state; a filter with no hits shows a "no matches" line
 * instead. Dialogs follow the shared a11y contract and return focus to the
 * header control that opened them (ResultMenu's wrapper-ref pattern).
 */
export function LibraryView() {
  const likedIds = useLibraryStore((state) => state.likedIds);
  const playlists = useLibraryStore((state) => state.playlists);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<HostedDialog>(null);
  /** True once the shared library read has settled (or failed) on mount. */
  const resolved = useLibraryReady();
  const createTriggerRef = useRef<HTMLSpanElement>(null);
  const importTriggerRef = useRef<HTMLSpanElement>(null);

  /** Dismiss a dialog and hand focus back to the header control that opened it. */
  function closeDialog(opened: Exclude<HostedDialog, null>): void {
    setDialog(null);
    const host = opened === "create" ? createTriggerRef : importTriggerRef;
    host.current?.querySelector("button")?.focus();
  }

  async function createPlaylist(value: PlaylistFormValue): Promise<void> {
    await useLibraryStore.getState().createPlaylist(value);
  }

  if (!resolved) {
    return (
      <div className="flex flex-col gap-6 px-6 py-6">
        <h1 className="text-heading font-bold text-pure-white">Your Library</h1>
        <p role="status" className="text-body text-mist">
          Loading your library…
        </p>
      </div>
    );
  }

  const libraryEmpty = likedIds.size === 0 && playlists.length === 0;
  const shownPlaylists = filterPlaylists(playlists, query);
  const showLikedEntry = libraryFilterMatches(query, "Liked Songs");
  const showNoMatches = query.trim() !== "" && !showLikedEntry && shownPlaylists.length === 0;

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-heading font-bold text-pure-white">Your Library</h1>
        <div className="flex items-center gap-2">
          <span ref={createTriggerRef}>
            <Button
              onClick={() => {
                setDialog("create");
              }}
            >
              Create playlist
            </Button>
          </span>
          <span ref={importTriggerRef}>
            <Button
              variant="ghost"
              onClick={() => {
                setDialog("import");
              }}
            >
              Import playlist
            </Button>
          </span>
        </div>
      </div>

      <SearchInput
        aria-label="Filter your library"
        placeholder="Filter your library"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="max-w-sm"
      />

      {libraryEmpty ? (
        <EmptyState
          title="Your library is empty"
          description="Songs, albums, and playlists you save will appear here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {showLikedEntry && (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              <li>
                <Link
                  href="/library/liked"
                  className="group flex w-full flex-col gap-2 rounded-cards bg-carbon p-3 transition-colors hover:bg-graphite"
                >
                  <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-images bg-spotify-green">
                    <Heart className="size-10 fill-pure-white text-pure-white" aria-hidden="true" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-body-lg font-semibold text-pure-white">Liked Songs</span>
                    <span className="text-body-lg font-regular text-mist">
                      {songCountLabel(likedIds.size)}
                    </span>
                  </div>
                </Link>
              </li>
            </ul>
          )}

          {shownPlaylists.length > 0 && (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {shownPlaylists.map((playlist) => (
                <li key={playlist.id}>
                  <Link
                    href={playlistHref(playlist.id)}
                    className="group flex w-full flex-col gap-2 rounded-cards bg-carbon p-3 transition-colors hover:bg-graphite"
                  >
                    <PlaylistCover
                      urls={derivePlaylistArtwork(playlist)}
                      className="aspect-square w-full"
                    />
                    <div className="flex flex-col gap-1">
                      <span className="truncate text-body-lg font-semibold text-pure-white">
                        {playlist.name}
                      </span>
                      <span className="text-body-lg font-regular text-mist">
                        {songCountLabel(playlist.tracks.length)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {showNoMatches && <p className="text-body text-mist">No matches</p>}
        </div>
      )}

      {dialog === "create" && (
        <PlaylistFormDialog
          title="Create playlist"
          submitLabel="Create"
          onSave={createPlaylist}
          onClose={() => closeDialog("create")}
        />
      )}
      {dialog === "import" && <ImportPlaylistDialog onClose={() => closeDialog("import")} />}
    </div>
  );
}
