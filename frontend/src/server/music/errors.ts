import type { ProviderFailureKind, TierId } from "./types";

/**
 * A tier-attempt failure carrying its taxonomy kind (spec: multi-tier
 * provider fallback chain). The orchestrator records the kind in diagnostics
 * and falls through to the next tier.
 */
export class ProviderError extends Error {
  readonly tier: TierId;
  readonly kind: ProviderFailureKind;

  constructor(
    tier: TierId,
    kind: ProviderFailureKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderError";
    this.tier = tier;
    this.kind = kind;
  }
}

/** Type guard for chained-cause checks in the orchestrator. */
export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
