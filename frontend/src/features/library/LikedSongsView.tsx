"use client";

import { Heart, LayoutGrid, List, Play, Shuffle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/design-system/Button";
import { EmptyState } from "@/components/design-system/EmptyState";
import { IconButton } from "@/components/design-system/IconButton";
import { SearchInput } from "@/components/design-system/SearchInput";
import { PlaylistCover } from "@/components/playlist/PlaylistCover";
import { SongRow } from "@/components/track/SongRow";
import type { Track } from "@/data/repositories";
import { libraryFilterMatches } from "@/features/library/libraryFilter";
import { useLibraryReady } from "@/features/library/useLibraryReady";
import { playAll, shufflePlay } from "@/lib/libraryPlayback";
import { bestArtworkUrl, songCountLabel } from "@/lib/playlistPresentation";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePlayerStore } from "@/stores/playerStore";

/** Presentation switch (spec: Liked Songs surface — list/grid pair). */
type ViewMode = "list" | "grid";

/**
 * `LikedSongsView` (M7 tasks 6.1–6.2, design §3): the `/library/liked`
 * surface — hero with the accent heart tile and count, bulk-play toolbar
 * (circular green play + Shuffle + the `aria-pressed` view toggle), the local
 * filter, and the collection rendered from `libraryStore.likedTracks`
 * (newest-first). Rows play within the full collection and unlike through
 * the store, so like state stays consistent across search, Now Playing, and
 * this surface without a remount. Bulk controls render visibly disabled and
 * inert when empty, and nothing here ever autoplays — activation only.
 */
export function LikedSongsView() {
  const tracks = useLibraryStore((state) => state.likedTracks);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const ready = useLibraryReady();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("list");

  /** Unlike through the repository-first store; failures keep state on screen. */
  function unlike(track: Track): void {
    useLibraryStore
      .getState()
      .toggleLike(track)
      .catch((error: unknown) => {
        console.warn("[library] like toggle failed:", error);
      });
  }

  /** Row/tile activation: this track with the full collection as context. */
  function play(track: Track): void {
    playTrack(track, tracks, "library");
  }

  if (!ready) {
    return (
      <div className="flex flex-col gap-6 px-6 py-6">
        <h1 className="text-heading font-bold text-pure-white">Liked Songs</h1>
        <p role="status" className="text-body text-mist">
          Loading your library…
        </p>
      </div>
    );
  }

  const empty = tracks.length === 0;
  // A stored record is untrusted data, exactly as the repositories already treat it
  // (see the preferences repository's "fall back per field"): a row written by an
  // older build, or by an import that could not fill every field, must not
  // white-screen the surface that reads it. M13's browser evidence run found this the
  // hard way - a liked row with no artists crashed the route into the error boundary
  // while offline, and the run scored it a pass until its assertion was scoped to the
  // route's own subtree.
  const usable = tracks.filter(
    (track): track is Track & { title: string; artists: { name: string }[] } =>
      typeof track?.title === "string" &&
      Array.isArray(track?.artists) &&
      track.artists.every((artist) => typeof artist?.name === "string"),
  );
  const shown = usable.filter((track) =>
    libraryFilterMatches(query, track.title, ...track.artists.map((artist) => artist.name)),
  );

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <div className="flex flex-wrap items-end gap-6">
        <div
          className="grid size-32 shrink-0 place-items-center rounded-images bg-spotify-green sm:size-44 lg:size-56"
          aria-hidden="true"
        >
          <Heart className="size-14 fill-pure-white text-pure-white sm:size-20" />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-heading font-bold text-pure-white">Liked Songs</h1>
          <p className="text-body-lg font-regular text-mist">{songCountLabel(tracks.length)}</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <IconButton
          label="Play all"
          size="md"
          tone="accent"
          disabled={empty}
          onClick={() => playAll(tracks)}
        >
          <Play className="size-5 fill-current" aria-hidden="true" />
        </IconButton>
        <Button variant="ghost" disabled={empty} onClick={() => shufflePlay(tracks)}>
          <Shuffle className="size-4" aria-hidden="true" />
          Shuffle
        </Button>
        {!empty && (
          <div className="ml-auto flex items-center gap-1">
            <IconButton
              label="List view"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              <List className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label="Grid view"
              aria-pressed={view === "grid"}
              onClick={() => setView("grid")}
            >
              <LayoutGrid className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        )}
      </div>

      {empty ? (
        <EmptyState
          title="No liked songs yet"
          description="Tap the heart on any song to save it here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <SearchInput
            aria-label="Filter liked songs"
            placeholder="Filter liked songs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="max-w-sm"
          />

          {shown.length === 0 ? (
            <p className="text-body text-mist">No matches</p>
          ) : view === "list" ? (
            <ul className="flex flex-col gap-2">
              {shown.map((track) => (
                <SongRow
                  key={track.id}
                  track={track}
                  onPlay={() => play(track)}
                  trailing={
                    <IconButton
                      label={`Remove ${track.title} from Liked Songs`}
                      onClick={() => unlike(track)}
                    >
                      <Heart
                        className="size-4 fill-current text-spotify-green"
                        aria-hidden="true"
                      />
                    </IconButton>
                  }
                />
              ))}
            </ul>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {shown.map((track) => {
                const cover = bestArtworkUrl(track);
                const artistText = track.artists.map((artist) => artist.name).join(", ");
                return (
                  <li key={track.id}>
                    <button
                      type="button"
                      onClick={() => play(track)}
                      className="group flex w-full flex-col gap-2 rounded-cards bg-carbon p-3 text-left transition-colors hover:bg-graphite"
                    >
                      <PlaylistCover urls={cover ? [cover] : []} className="aspect-square w-full" />
                      <span className="truncate text-body-lg font-semibold text-pure-white">
                        {track.title}
                      </span>
                      <span className="truncate text-body text-mist">{artistText}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
