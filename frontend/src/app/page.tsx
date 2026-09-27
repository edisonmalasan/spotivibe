import { EmptyState } from "@/components/design-system/EmptyState";
import { SectionHeader } from "@/components/design-system/SectionHeader";
import { Skeleton } from "@/components/design-system/Skeleton";

/**
 * M1 placeholder route: shell chrome plus section header, cover-shaped
 * skeleton grid, and an empty state. No trending data or playback yet (M8).
 */
export default function HomePage() {
  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <h1 className="sr-only">Home</h1>

      <section>
        <SectionHeader title="Trending songs" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="aspect-square w-full" />
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Made for you" />
        <EmptyState
          title="Nothing here yet"
          description="Recommendations will appear here as you explore Spotivibe."
        />
      </section>
    </div>
  );
}
