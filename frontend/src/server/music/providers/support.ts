import { HttpFetchError } from "@/server/http/fetchJson";
import { ProviderError } from "../errors";
import type { TierId } from "../types";

/**
 * Shared helpers for the four provider tiers.
 *
 * Reference behavior ported selectively from Lyrix's `innertubeService.ts`
 * (ROADMAP §6.1 KEEP/REFACTOR): browser-like headers, recursive renderer
 * traversal with a 30-result cap, per-attempt timeouts, and instance lists —
 * rewritten as Spotivibe-owned code.
 */

/** Browser-like User-Agent — Innertube and public instances reject bot clients. */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Shared JSON headers for Innertube POST requests. */
export const JSON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "User-Agent": BROWSER_USER_AGENT,
  "Accept-Language": "en-US,en;q=0.9",
};

/** Per-upstream-attempt timeout (design decision 5; Lyrix used 4s). */
export const ATTEMPT_TIMEOUT_MS = 4000;

/** Max candidates parsed from one tier response (Lyrix capped at 30). */
export const MAX_PARSE_RESULTS = 30;

/** Max instance attempts per fallback tier (design decision 4). */
export const MAX_INSTANCE_ATTEMPTS = 2;

/**
 * Recursively collect every node stored under `key` (e.g. a renderer name),
 * capped at `cap` results. Lyrix-derived traversal, generic over the key.
 */
export function collectNodes(
  root: unknown,
  key: string,
  cap: number = MAX_PARSE_RESULTS,
): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (found.length >= cap) return;
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as Record<string, unknown>;
    const value = record[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      found.push(value as Record<string, unknown>);
    }
    for (const child of Object.values(record)) walk(child);
  };
  walk(root);
  return found;
}

/**
 * Resolve an instance list from an optional comma-separated env override,
 * falling back to the built-in defaults when absent or entirely invalid.
 * Trailing slashes are stripped; only http(s) base URLs are accepted.
 */
export function parseInstanceList(raw: string | undefined, defaults: readonly string[]): string[] {
  const values = (raw ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter((value) => /^https?:\/\/[^\s/]+/i.test(value));
  return values.length > 0 ? values : [...defaults];
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Classify a failure from a tier attempt: transport errors become
 * {@link ProviderError}s with their taxonomy kind; caller/budget aborts
 * propagate untouched (they are not tier failures — the orchestrator decides
 * how to stop); anything else is treated as a parse-stage failure so a bug in
 * one tier degrades into a fallback instead of crashing the request.
 */
export function wrapFailure(tier: TierId, error: unknown): unknown {
  if (error instanceof ProviderError) return error;
  if (error instanceof HttpFetchError) {
    return new ProviderError(tier, error.kind, `${tier}: ${error.message}`, { cause: error });
  }
  if (isAbort(error)) return error;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new ProviderError(tier, "parse", `${tier}: unexpected parse failure: ${message}`, {
    cause: error,
  });
}
