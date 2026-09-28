import { Skeleton } from "@/components/design-system/Skeleton";

/**
 * Loading placeholders shaped like the result layout (design §10: one
 * top-result block plus result rows). Purely decorative — the surrounding
 * surface carries the busy announcement, so this tree stays hidden from
 * assistive tech.
 */
export function SearchSkeletons() {
  return (
    <div data-testid="search-skeletons" aria-hidden="true" className="flex flex-col gap-6">
      <Skeleton className="h-28 w-full" />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="flex items-center gap-4">
            <Skeleton variant="circle" className="size-12 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="w-2/3">
                <Skeleton variant="text" />
              </div>
              <div className="w-1/3">
                <Skeleton variant="text" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
