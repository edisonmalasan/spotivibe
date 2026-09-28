import { SearchBrowseEmpty } from "@/features/search/SearchBrowseEmpty";
import { SearchView } from "@/features/search/SearchView";
import { Suspense } from "react";

/**
 * M5 search route: shell chrome plus the client search surface. `SearchView`
 * reads `useSearchParams`, so it must sit behind a Suspense boundary for the
 * route to stay statically prerenderable (Next.js CSR-bailout rule); the
 * fallback is the same browse copy the controller shows with an empty query.
 */
export default function SearchPage() {
  return (
    <div className="flex flex-col gap-8 px-6 py-6">
      <h1 className="sr-only">Search</h1>
      <Suspense fallback={<SearchBrowseEmpty />}>
        <SearchView />
      </Suspense>
    </div>
  );
}
