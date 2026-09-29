import { EmptyState } from "@/components/design-system/EmptyState";
import { DiscoverView } from "@/features/discover/DiscoverView";
import { Suspense } from "react";

/**
 * M8 `/discover` route (spec: `discovery` — "Discover surface for genres and
 * languages"). `DiscoverView` reads `useSearchParams`, so it sits behind a
 * Suspense boundary to keep the route statically prerenderable (the Next.js
 * CSR-bailout rule, same as `/search`); the fallback is the surface's own
 * explanatory empty state rather than a blank region.
 */
export default function DiscoverPage() {
  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <h1 className="sr-only">Discover</h1>
      <Suspense
        fallback={
          <EmptyState title="Loading Discover…" description="Browsing genres needs a connection." />
        }
      >
        <DiscoverView />
      </Suspense>
    </div>
  );
}
