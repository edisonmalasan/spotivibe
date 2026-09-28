"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/design-system/Button";
import { IconButton } from "@/components/design-system/IconButton";
import { getLocalData } from "@/data/localData";
import type { PlaylistRecord, Track } from "@/data/repositories";

interface PlaylistPickerProps {
  track: Track;
  /** Dismissal — the opener decides where focus returns. */
  onClose(): void;
}

/**
 * Feature-local "add to playlist" dialog (design §8): picks an existing local
 * playlist or creates one inline (create → addTrack), both through repository
 * APIs only. Escape/backdrop/close dismiss; focus starts on the dialog.
 */
export function PlaylistPicker({ track, onClose }: PlaylistPickerProps) {
  const [playlists, setPlaylists] = useState<PlaylistRecord[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getLocalData()
      .then((data) => data.playlists.list())
      .then((list) => {
        if (!cancelled) setPlaylists(list);
      })
      .catch((error: unknown) => {
        console.warn("[search] playlists unavailable:", error);
        if (!cancelled) setPlaylists([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus starts inside the dialog so keyboard users land in the surface they
  // opened; dismissal returns focus to the menu trigger (see ResultMenu).
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Escape dismisses wherever focus currently is (list, input, or dialog).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      onClose();
    } catch (error) {
      console.warn("[search] add to playlist failed:", error);
      setFailure("Could not add the track. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function addTo(playlistId: string): void {
    void run(async () => {
      const data = await getLocalData();
      await data.playlists.addTrack(playlistId, track);
    });
  }

  function createAndAdd(event: FormEvent): void {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || busy) return;
    void run(async () => {
      const data = await getLocalData();
      const playlist = await data.playlists.create({ name: trimmed });
      await data.playlists.addTrack(playlist.id, track);
    });
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-void-black/70 p-4"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add to playlist"
        tabIndex={-1}
        className="w-full max-w-sm rounded-cards bg-carbon p-5 outline-none"
        onMouseDown={(event) => event.stopPropagation()} // backdrop only dismisses
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-link font-bold text-pure-white">Add to playlist</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </div>

        {playlists === null ? (
          <p className="text-body text-mist" role="status">
            Loading playlists…
          </p>
        ) : playlists.length === 0 ? (
          <p className="text-body text-mist">No playlists yet — create one below.</p>
        ) : (
          <ul className="mb-4 flex max-h-48 flex-col gap-1 overflow-y-auto">
            {playlists.map((playlist) => (
              <li key={playlist.id}>
                <button
                  type="button"
                  className="w-full rounded-buttons px-3 py-2 text-left text-body-lg text-pure-white transition hover:bg-graphite"
                  disabled={busy}
                  onClick={() => addTo(playlist.id)}
                >
                  {playlist.name}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="flex flex-col gap-3" onSubmit={createAndAdd}>
          <label className="flex flex-col gap-1 text-body text-mist" htmlFor="new-playlist-name">
            New playlist
            <input
              id="new-playlist-name"
              type="text"
              value={name}
              placeholder="Playlist name"
              className="rounded-buttons bg-graphite px-3 py-2 text-body-lg text-pure-white outline-none"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={name.trim() === "" || busy}>
            Create and add
          </Button>
        </form>

        {failure && (
          <p role="alert" className="mt-3 text-body text-pure-white">
            {failure}
          </p>
        )}
      </div>
    </div>
  );
}
