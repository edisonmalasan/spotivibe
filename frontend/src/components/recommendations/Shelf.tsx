import { Children, type ReactNode } from "react";
import { EmptyState } from "@/components/design-system/EmptyState";
import { ErrorState } from "@/components/design-system/ErrorState";
import { SectionHeader } from "@/components/design-system/SectionHeader";
import { Skeleton } from "@/components/design-system/Skeleton";

/**
 * DESIGN.md "Layout" — one row of cards per viewport width, flowing as a single
 * horizontally scrollable line: 5 at desktop (≥1024px), 3 at tablet (≥640px),
 * 2 below. Column widths are percentages of the rail's content box (a fixed
 * basis would not fill the shell's fluid main column), sized to leave the 16px
 * gap inside the row. `grid-rows-1` + `grid-flow-col` is what makes the extra
 * cards scroll sideways instead of wrapping into a second row.
 *
 * `pt-1 pb-2` is breathing room for the global `:focus-visible` outline, which
 * would otherwise be clipped by the scroll container.
 */
const railClassName =
  "grid auto-cols-[46%] grid-flow-col grid-rows-1 gap-4 overflow-x-auto pb-2 pt-1 sm:auto-cols-[30%] lg:auto-cols-[18%]";

/** Default placeholder count — one desktop row plus a peeking card. */
const DEFAULT_SKELETON_COUNT = 6;

/** Copy shown when a shelf resolved with nothing and no empty copy was given. */
const DEFAULT_EMPTY_TITLE = "Nothing here yet";

/**
 * The scrollable card rail. Focusable so a keyboard user can pan it with the
 * arrow keys, and grouped under the shelf's own name so the landmark and the
 * scroll region are not announced as one anonymous box. Card focus rings are
 * untouched — every card keeps the global `:focus-visible` outline.
 */
function Rail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      data-testid="shelf-rail"
      role="group"
      aria-label={`${title} shelf`}
      tabIndex={0}
      className={railClassName}
    >
      {children}
    </div>
  );
}

/**
 * A shelf's lifecycle. The four states are the spec's per-shelf resilience
 * contract: a shelf shows skeletons while in flight, an explanatory empty state
 * when it has no content, a retryable error when its own request failed, and its
 * content when ready — one failing shelf never blocks its siblings.
 */
export type ShelfState = "loading" | "ready" | "empty" | "error";

export interface ShelfProps {
  /** Section title; also the region's accessible name. */
  title: string;
  /**
   * Card geometry for this shelf's content. Drives the placeholder shape so a
   * loading shelf looks like the cards it will replace, and documents intent for
   * the feed's square/circular alternation rule.
   */
  shape: "square" | "circular";
  state: ShelfState;
  /** Rendered inside the rail for `state="ready"`; cards own their own geometry. */
  children?: ReactNode;
  /** Optional secondary line under the header (mist 14px, per DESIGN.md). */
  description?: string;
  /** Optional 'Show all' link, forwarded to {@link SectionHeader}. */
  action?: { label: string; href: string };
  /** Recovery handler for `state="error"`; omitted → no retry control. */
  onRetry?: () => void;
  /** Copy for `state="empty"` (or a ready shelf with no children). */
  empty?: { title: string; description?: string };
  /** Copy for `state="error"`. */
  error?: { title: string; description?: string };
  /** Placeholder count while loading (default 6). */
  skeletonCount?: number;
  className?: string;
  /** Optional test hook, e.g. `"home-shelf-trending"`. */
  "data-testid"?: string;
  /**
   * Optional evidence hook for a shelf whose content follows a local time band:
   * the band it is currently presenting, e.g. `"evening"`.
   *
   * Declared as its own narrow prop rather than spread onto the node, because
   * TypeScript does not check hyphenated JSX attribute names — `data-band={band}`
   * on a component that never declared it compiles cleanly, type-checks cleanly,
   * and then reaches no DOM at all. Naming it here makes the attribute part of
   * the component's real contract, keeps the rendered attribute set finite and
   * reviewable, and lets a shelf that has no band simply render none.
   */
  "data-band"?: string;
}

/**
 * One discovery shelf (design §7): a titled, compact section whose content is a
 * horizontally scrollable card rail.
 *
 * The primitive is deliberately state-driven rather than self-fetching — the
 * Home/Discover surfaces own one request per shelf (design §2) and hand the
 * resolved state down, which is what keeps a single failing shelf isolated.
 * The rail is a focusable scroll container, so a keyboard user can scroll it
 * with the arrow keys, and each card keeps its own global focus ring.
 */
export function Shelf({
  title,
  shape,
  state,
  children,
  description,
  action,
  onRetry,
  empty,
  error,
  skeletonCount = DEFAULT_SKELETON_COUNT,
  className = "",
  "data-testid": testId,
  "data-band": band,
}: ShelfProps) {
  // A ready shelf with nothing to show is an empty shelf, not a blank one: the
  // feed must never render an unexplained gap (spec: explanatory empty state).
  const resolvedState: ShelfState =
    state === "ready" && Children.toArray(children).length === 0 ? "empty" : state;

  const body = () => {
    switch (resolvedState) {
      case "loading":
        return (
          <Rail title={title}>
            {Array.from({ length: skeletonCount }, (_, index) => (
              <div key={index} data-testid="shelf-skeleton" className="flex flex-col gap-2">
                {/* The card's own geometry, so a loading shelf looks like what it
                    replaces: a 1:1 cover at the 6px card radius, or a 1:1 circle
                    at the 500px avatar radius. */}
                {shape === "circular" ? (
                  <Skeleton variant="circle" className="w-full" />
                ) : (
                  <Skeleton className="aspect-square w-full" />
                )}
                <Skeleton variant="text" />
              </div>
            ))}
          </Rail>
        );
      case "error":
        return (
          <ErrorState
            title={error?.title}
            description={error?.description}
            onRetry={onRetry}
            retryLabel="Retry"
          />
        );
      case "empty":
        return (
          <EmptyState
            title={empty?.title ?? DEFAULT_EMPTY_TITLE}
            description={empty?.description}
          />
        );
      case "ready":
        return <Rail title={title}>{children}</Rail>;
    }
  };

  return (
    // Named region: assistive tech announces the shelf by its own title without
    // depending on heading order inside the feed.
    <section
      aria-label={title}
      className={`mb-8 ${className}`}
      data-testid={testId}
      data-band={band}
    >
      <SectionHeader title={title} action={action} />
      {description && <p className="mb-6 text-body-lg font-regular text-mist">{description}</p>}
      {body()}
    </section>
  );
}
