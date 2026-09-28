import { LibraryView } from "@/features/library/LibraryView";

/**
 * M7 library surface (design §3): a client view over `libraryStore` — the
 * header, filter, Liked Songs entry, and playlist grid all render from
 * local storage, so the route needs no network and no server data.
 */
export default function LibraryPage() {
  return <LibraryView />;
}
