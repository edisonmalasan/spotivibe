"use client";

import { Pencil, Play, Shuffle, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { Button, pillButtonClassName } from "@/components/design-system/Button";
import { EmptyState } from "@/components/design-system/EmptyState";
import { IconButton } from "@/components/design-system/IconButton";
import { PlaylistCover } from "@/components/playlist/PlaylistCover";
import type { Track } from "@/data/repositories";
import { useLibraryReady } from "@/features/library/useLibraryReady";
import { DeletePlaylistDialog } from "@/features/playlists/DeletePlaylistDialog";
import {
  PlaylistFormDialog,
  type PlaylistFormValue,
} from "@/features/playlists/PlaylistFormDialog";
import { PlaylistTrackRow } from "@/features/playlists/PlaylistTrackRow";
import { playAll, shufflePlay } from "@/lib/libraryPlayback";
import {
  artworkUrl,
  derivePlaylistArtwork,
  formatTotalDuration,
  songCountLabel,
  sumPlaylistDuration,
} from "@/lib/playlistPresentation";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePlayerStore } from "@/stores/playerStore";

/** Which dialog (if any) the toolbar currently hosts. */
type HostedDialog = "edit" | "delete" | null;

interface PlaylistDetailViewProps {
  /** Route parameter from `/playlist/[id]` (Next 16 promise params). */
  playlistId: string;
}

/**
 * `PlaylistDetailView` (M7 tasks 7.1–7.3, design §2/§3): the `/playlist/[id]`
 * surface — hero (own or derived cover with placeholder fallback, name,
 * description, `Playlist • N songs • X min` meta line), toolbar (play all,
 * Shuffle, Edit, Delete), and the ordered track rows with play, remove, and
 * drag/keyboard reorder. Everything reads `libraryStore`, so an unknown or
 * deleted ID renders a recoverable not-found state with a way back — never a
 * blank page — and no operation here can touch transport (the store and this
 * surface never import playback state for edits; play activations go through
 * the shared `library` helpers only).
 */
export function PlaylistDetailView({ playlistId }: PlaylistDetailViewProps) {
  const router = useRouter();
  const playlist = useLibraryStore((state) =>
    state.playlists.find((entry) => entry.id === playlistId),
  );
  const playTrack = usePlayerStore((state) => state.playTrack);
  const ready = useLibraryReady();
  const [dialog, setDialog] = useState<HostedDialog>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const editTriggerRef = useRef<HTMLSpanElement>(null);
  const deleteTriggerRef = useRef<HTMLSpanElement>(null);

  /** Dismiss a dialog and hand focus back to the toolbar control that opened it. */
  function closeDialog(opened: Exclude<HostedDialog, null>): void {
    setDialog(null);
    const host = opened === "edit" ? editTriggerRef : deleteTriggerRef;
    host.current?.querySelector("button")?.focus();
  }

  async function saveEdit(value: PlaylistFormValue): Promise<void> {
    await useLibraryStore.getState().updatePlaylist(playlistId, value);
  }

  async function confirmDelete(): Promise<void> {
    await useLibraryStore.getState().deletePlaylist(playlistId);
    // Deleted from the surface you were viewing → back to the library.
    router.push("/library");
  }

  function removeTrack(track: Track): void {
    void useLibraryStore
      .getState()
      .removeTrackFromPlaylist(playlistId, track.id)
      .catch((error: unknown) => {
        console.warn("[library] track removal failed:", error);
      });
  }

  function move(from: number, to: number): void {
    if (to < 0) return;
    void useLibraryStore
      .getState()
      .reorderPlaylistTrack(playlistId, from, to)
      .catch((error: unknown) => {
        console.warn("[library] track reorder failed:", error);
      });
  }

  // Drag wiring identical to the queue's M6 pattern — drop lands on the same
  // `reorder` the move controls call, so both paths agree by construction.
  const startDrag = (from: number) => (event: DragEvent<HTMLLIElement>) => {
    event.dataTransfer?.setData("text/plain", String(from));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    setDragFrom(from);
  };
  const hoverDrag = (to: number) => (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDropTarget(to);
  };
  const dropDrag = (to: number) => (event: DragEvent<HTMLLIElement>) => {
    event.preventDefault();
    const from = dragFrom;
    setDragFrom(null);
    setDropTarget(null);
    if (from !== null && from !== to) move(from, to);
  };
  const endDrag = () => {
    setDragFrom(null);
    setDropTarget(null);
  };

  if (!ready) {
    return (
      <div className="flex flex-col gap-6 px-6 py-6">
        <p role="status" className="text-body text-mist">
          Loading playlist…
        </p>
      </div>
    );
  }

  if (!playlist) {
    // Recoverable not-found (design §2): never a blank page or error boundary.
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-6">
        <EmptyState
          title="Playlist not found"
          description="It may have been deleted from your library."
        />
        <Link href="/library" className={pillButtonClassName}>
          Back to Your Library
        </Link>
      </div>
    );
  }

  const tracks = playlist.tracks.map((entry) => entry.track);
  const empty = tracks.length === 0;
  const duration = formatTotalDuration(sumPlaylistDuration(tracks));
  const ownCover = artworkUrl(playlist.artwork);
  const coverUrls = ownCover ? [ownCover] : derivePlaylistArtwork(playlist);
  const metaLine = [
    "Playlist",
    songCountLabel(tracks.length),
    ...(duration ? [duration] : []),
  ].join(" • ");

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <div className="flex flex-wrap items-end gap-6">
        <PlaylistCover urls={coverUrls} className="size-40 shrink-0 sm:size-48 lg:size-58" />
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-heading font-bold text-pure-white">{playlist.name}</h1>
          {playlist.description && (
            <p className="max-w-2xl text-body-lg font-regular text-mist">{playlist.description}</p>
          )}
          <p className="text-body font-regular text-mist">{metaLine}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
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
        <span ref={editTriggerRef}>
          <Button
            variant="ghost"
            onClick={() => {
              setDialog("edit");
            }}
          >
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </Button>
        </span>
        <span ref={deleteTriggerRef}>
          <Button
            variant="ghost"
            onClick={() => {
              setDialog("delete");
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </Button>
        </span>
      </div>

      {empty ? (
        <EmptyState
          title="No tracks yet"
          description="Add songs from search to build this playlist."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {tracks.map((track, index) => (
            <PlaylistTrackRow
              key={track.id} // membership is duplicate-free by the store rule
              track={track}
              position={index + 1}
              onPlay={() => playTrack(track, tracks, "library")}
              onRemove={() => removeTrack(track)}
              onMoveUp={() => move(index, index - 1)}
              onMoveDown={() => move(index, index + 1)}
              canMoveUp={index > 0}
              canMoveDown={index < tracks.length - 1}
              onDragStart={startDrag(index)}
              onDragOver={hoverDrag(index)}
              onDrop={dropDrag(index)}
              onDragEnd={endDrag}
              isDropTarget={dropTarget === index && dragFrom !== null}
            />
          ))}
        </ul>
      )}

      {dialog === "edit" && (
        <PlaylistFormDialog
          title="Edit playlist"
          submitLabel="Save"
          initial={{ name: playlist.name, description: playlist.description }}
          onSave={saveEdit}
          onClose={() => closeDialog("edit")}
        />
      )}
      {dialog === "delete" && (
        <DeletePlaylistDialog
          name={playlist.name}
          onConfirm={confirmDelete}
          onClose={() => closeDialog("delete")}
        />
      )}
    </div>
  );
}
