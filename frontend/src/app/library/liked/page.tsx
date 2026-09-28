import { LikedSongsView } from "@/features/library/LikedSongsView";

/**
 * M7 Liked Songs route (design §2): a client view over `libraryStore` —
 * the hero, toolbar, filter, and collection render from local storage, so
 * the route needs no network and no server data.
 */
export default function LikedSongsPage() {
  return <LikedSongsView />;
}
