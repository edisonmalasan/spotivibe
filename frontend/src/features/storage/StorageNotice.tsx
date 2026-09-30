"use client";

import { useStorageStatus } from "@/features/storage/storageStatus";

/**
 * The storage-failure notice (M14; spec `local-data` — "Versioned IndexedDB storage
 * with durable data", scenario "A database that cannot be opened is named, not
 * hidden").
 *
 * The copy has one job: **do not look like data loss.** An empty library and a broken
 * database look identical from inside the application, and they mean completely
 * different things to the person looking at them — one is a fresh install, the other is
 * their library being unreadable *right now* and still on the device.
 *
 * So this says three things, in order: what happened, what that means for their data,
 * and what they can do. It is a notice rather than a modal because the application is
 * still partly usable without storage — the shell, the player region, and anything the
 * network can answer all keep working, and a modal would take those away over a problem
 * the person cannot fix by looking at a dialog.
 *
 * DESIGN.md: the region is a status surface with the same restraint as the connection
 * banner — a role="status" region, token colours only, positioned clear of the player.
 */
export function StorageNotice() {
  const status = useStorageStatus();

  if (status !== "unavailable") return null;

  return (
    <div
      role="status"
      data-testid="storage-notice"
      className="fixed left-1/2 top-32 z-40 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-cards bg-graphite px-4 py-3 shadow-lg lg:top-18"
    >
      <p className="text-body font-bold text-pure-white">
        Spotivibe could not read your local data.
      </p>
      <p className="mt-1 text-body text-mist">
        Nothing was deleted — your library, playlists, and history are still on this device. Storage
        is usually blocked by private browsing, a full disk, or the browser denying site data.
        Reopening Spotivibe after leaving private mode will usually fix it.
      </p>
    </div>
  );
}
