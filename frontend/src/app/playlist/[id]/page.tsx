"use client";

import { use } from "react";
import { PlaylistDetailView } from "@/features/playlists/PlaylistDetailView";

/**
 * M7 playlist detail route (design §2): Next 16 dynamic `params` arrive as a
 * promise — the client page reads the id with `use()` per the bundled docs
 * (`node_modules/next/dist/docs/...page.md`), not prior-Next synchronous props.
 */
export default function PlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PlaylistDetailView playlistId={id} />;
}
