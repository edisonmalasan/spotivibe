import { EmptyState } from "@/components/design-system/EmptyState";

/**
 * M1 placeholder route: shell chrome plus an empty state. Liked songs,
 * playlists, and library persistence arrive with M2/M7.
 */
export default function LibraryPage() {
  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <h1 className="sr-only">Your Library</h1>
      <EmptyState
        title="Your library is empty"
        description="Songs, albums, and playlists you save will appear here."
      />
    </div>
  );
}
