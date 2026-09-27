import { EmptyState } from "@/components/design-system/EmptyState";

/**
 * M1 placeholder route: shell chrome plus an empty state. Search results,
 * query handling, and playback arrive with M5.
 */
export default function SearchPage() {
  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <h1 className="sr-only">Search</h1>
      <EmptyState
        title="Search for music"
        description="Find songs, artists, albums, and more to play."
      />
    </div>
  );
}
