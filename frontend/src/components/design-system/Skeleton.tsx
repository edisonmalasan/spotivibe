interface SkeletonProps {
  variant?: "block" | "text" | "circle";
  className?: string;
}

const variantClassName: Record<NonNullable<SkeletonProps["variant"]>, string> = {
  block: "rounded-cards",
  text: "h-4 w-full rounded-small",
  circle: "aspect-square rounded-avatars",
};

/**
 * Loading placeholder shaped like the content it replaces (DESIGN.md surfaces,
 * animated only when motion is allowed). Decorative — hidden from assistive tech;
 * the surrounding surface owns the busy state.
 */
export function Skeleton({ variant = "block", className = "" }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      data-testid="skeleton"
      className={`animate-pulse bg-graphite ${variantClassName[variant]} ${className}`}
    />
  );
}
