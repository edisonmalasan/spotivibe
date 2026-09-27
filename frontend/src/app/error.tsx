"use client";

import { ErrorState } from "@/components/design-system/ErrorState";

/**
 * Route error boundary (spec "Empty and error states"): a render failure inside
 * a route surfaces the design-system recoverable error state — role="alert" with
 * a retry pill wired to the router's `reset` — instead of a blank screen.
 * Generic copy only; the underlying error is never echoed to the UI.
 */
export default function RouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-carbon">
      <ErrorState onRetry={reset} />
    </div>
  );
}
