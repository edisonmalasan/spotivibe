import { Music2 } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  className?: string;
}

/**
 * Reusable empty surface: explanatory copy centered on the dark canvas,
 * monochrome per DESIGN.md (no accent colors outside play/active states).
 */
export function EmptyState({ title, description, icon, className = "" }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 px-6 py-12 text-center ${className}`}
    >
      <span className="text-fog" aria-hidden="true">
        {icon ?? <Music2 className="size-8" />}
      </span>
      <h2 className="text-link font-bold text-pure-white">{title}</h2>
      {description && <p className="max-w-md text-body-lg font-regular text-mist">{description}</p>}
    </div>
  );
}
