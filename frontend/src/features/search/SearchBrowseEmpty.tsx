import { EmptyState } from "@/components/design-system/EmptyState";

/**
 * The `?q=`-less browse surface. Shared by the Search route's Suspense
 * fallback (pre-hydration) and the controller's `browse` state so the copy
 * exists in exactly one place (M1 copy, kept by routes.test).
 */
export function SearchBrowseEmpty() {
  return (
    <EmptyState
      title="Search for music"
      description="Find songs, artists, albums, and more to play."
    />
  );
}
