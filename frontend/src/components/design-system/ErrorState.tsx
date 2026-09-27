import { CircleAlert } from "lucide-react";
import { Button } from "./Button";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/**
 * Recoverable error surface: announced via role="alert", monochrome per DESIGN.md
 * (signal red is a decorative accent, not a status color), recovery via the white
 * pill — the one primary action style.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "Please try again.",
  onRetry,
  retryLabel = "Try again",
  className = "",
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-4 px-6 py-12 text-center ${className}`}
    >
      <span className="text-fog" aria-hidden="true">
        <CircleAlert className="size-8" />
      </span>
      <div className="flex flex-col gap-2">
        <h2 className="text-link font-bold text-pure-white">{title}</h2>
        <p className="max-w-md text-body-lg font-regular text-mist">{description}</p>
      </div>
      {onRetry && (
        <Button onClick={onRetry} data-testid="error-retry">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
