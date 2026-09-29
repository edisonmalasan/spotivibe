"use client";

import { use } from "react";
import { AlbumView } from "@/features/album/AlbumView";

/**
 * M9 album route (design §2): Next 16 dynamic `params` arrive as a promise — the
 * page reads the key with `use()` per the bundled docs
 * (`node_modules/next/dist/docs/...page.md`), the same pattern as
 * `app/artist/[key]/page.tsx` and `app/playlist/[id]/page.tsx`.
 *
 * The route is deliberately thin. The release is only known after the client
 * resolution, so the document's single `h1` cannot name it; it is a visually
 * hidden "Album" for landmarks and document outline, and `AlbumView` owns the
 * visible heading once the title resolves. The page owns the layout wrapper, and
 * the view owns its loading/empty/error/not-found states so they render in
 * place rather than at the route boundary.
 */
export default function AlbumPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <h1 className="sr-only">Album</h1>
      <AlbumView albumKey={key} />
    </div>
  );
}
