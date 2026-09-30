import type { Track } from "@/data/repositories";
import { ProviderError } from "./errors";
import { filterTracks } from "./filter";
import { outboundLimiter, type Semaphore } from "./limiter";
import { candidateToTrack } from "./normalize";
import { invidiousProvider } from "./providers/invidious";
import { pipedProvider } from "./providers/piped";
import { ATTEMPT_TIMEOUT_MS } from "./providers/support";
import { ytmusicProvider } from "./providers/ytmusic";
import { ytwebProvider } from "./providers/ytweb";
import { dedupeTracks, scoreTracks, sortTracks } from "./score";
import type {
  MusicProvider,
  ProviderCandidate,
  SearchCategory,
  SearchDiagnostics,
  SearchFailure,
  SearchRequest,
  SearchResult,
  TierOutcome,
} from "./types";

/**
 * The four-tier discovery chain (spec: provider chain; design decisions 4–5).
 *
 * Fixed order ytmusic → ytweb → invidious → piped; the first tier whose
 * *usable* results (post filter) are non-empty stops the chain. One total
 * request budget (~8s) plus a per-attempt timeout bound every request, and
 * the incoming request's abort signal propagates into queue waits and every
 * upstream fetch. Failures stay structured: exhausted chains return
 * `SearchFailure` with per-tier outcomes — only caller cancellation throws.
 */

/** Total wall-clock budget for one search request (design decision 5). */
export const REQUEST_BUDGET_MS = 8000;

/** Fixed tier order (ROADMAP §7.2: primary ytmusic, then fallbacks). */
export const DEFAULT_PROVIDERS: readonly MusicProvider[] = [
  ytmusicProvider,
  ytwebProvider,
  invidiousProvider,
  pipedProvider,
];

export interface ChainOptions {
  /** Override the tier list (tests). */
  providers?: readonly MusicProvider[];
  /** Total request budget in ms (tests use short budgets). */
  budgetMs?: number;
  /** Per-attempt upstream timeout in ms (tests use short timeouts). */
  attemptTimeoutMs?: number;
  /** Override the concurrency gate (tests observe serialization). */
  limiter?: Semaphore;
}

/**
 * Normalize, filter, score, order, collapse duplicates, and limit — the one
 * shared post-parse pipeline every tier's candidates flow through, so a
 * fallback tier's results are treated exactly like the primary's.
 *
 * M12: the request's category reaches the pipeline so the filter stage applies
 * that category's rules and category resolution knows what the request asked
 * for. The default keeps the pre-M12 call shape intact.
 */
export function toResultTracks(
  candidates: ProviderCandidate[],
  query: string,
  limit: number,
  category: SearchCategory = "music",
): Track[] {
  const normalized = candidates.map((candidate) => candidateToTrack(candidate, category));
  const kept = filterTracks(normalized);
  const scored = scoreTracks(kept, query);
  const sorted = sortTracks(scored);
  const deduped = dedupeTracks(sorted);
  return deduped.slice(0, limit);
}

/**
 * M12: tiers that can answer the question, by category.
 *
 * YouTube Music is a music-only surface, so a podcast query is never sent to it
 * (design decision 2). A skipped tier is recorded in diagnostics as `skipped`
 * rather than omitted, so a request record shows *why* a tier is missing.
 */
export function tiersForCategory(
  category: SearchCategory,
  providers: readonly MusicProvider[] = DEFAULT_PROVIDERS,
): readonly MusicProvider[] {
  if (category !== "podcast") return providers;
  return providers.filter((provider) => provider.id !== "ytmusic");
}

export async function runChain(
  request: SearchRequest,
  options: ChainOptions = {},
): Promise<SearchResult> {
  const category = request.category ?? "music";
  const allProviders = options.providers ?? DEFAULT_PROVIDERS;
  // M12: a category the configured tiers cannot answer is skipped *before* the
  // budget clock starts — it is not an attempt that could have succeeded.
  const usable = new Set(tiersForCategory(category, allProviders));
  const providers = allProviders.filter((provider) => usable.has(provider));
  const budgetMs = options.budgetMs ?? REQUEST_BUDGET_MS;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const limiter = options.limiter ?? outboundLimiter;

  const budgetSignal = AbortSignal.timeout(budgetMs);
  const signal = request.signal ? AbortSignal.any([request.signal, budgetSignal]) : budgetSignal;

  const tiersTried: TierOutcome[] = [];
  for (const skipped of allProviders) {
    if (!usable.has(skipped)) tiersTried.push({ tier: skipped.id, outcome: "skipped" });
  }

  const skipRemaining = (startIndex: number): SearchFailure => {
    for (let index = startIndex; index < providers.length; index += 1) {
      tiersTried.push({ tier: providers[index].id, outcome: "skipped" });
    }
    return { ok: false, tiersTried };
  };

  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];

    // Budget expired between attempts: record what never fired, stop.
    if (budgetSignal.aborted) return skipRemaining(index);

    let candidates: ProviderCandidate[];
    try {
      const release = await limiter.acquire(signal);
      try {
        candidates = await provider.search({
          ...request,
          category,
          signal,
          timeoutMs: attemptTimeoutMs,
        });
      } finally {
        release();
      }
    } catch (error) {
      // Caller cancellation is not a tier outcome — propagate it as-is.
      if (request.signal?.aborted) {
        throw request.signal.reason ?? error;
      }
      // Budget exhaustion: the attempt died on our own timeout, not upstream.
      if (budgetSignal.aborted) {
        tiersTried.push({ tier: provider.id, outcome: "timeout" });
        return skipRemaining(index + 1);
      }
      // Structured per-tier failure — fall through to the next tier.
      const kind: TierOutcome["outcome"] = error instanceof ProviderError ? error.kind : "parse";
      tiersTried.push({ tier: provider.id, outcome: kind });
      continue;
    }

    const tracks = toResultTracks(candidates, request.query, request.limit, category);
    if (tracks.length > 0) {
      tiersTried.push({ tier: provider.id, outcome: "ok" });
      const diagnostics: SearchDiagnostics = {
        tier: provider.id,
        tiersTried,
        cached: false,
        resultCount: tracks.length,
      };
      return { ok: true, tracks, diagnostics };
    }
    // The tier answered but nothing survived normalization/filtering.
    tiersTried.push({ tier: provider.id, outcome: "empty" });
  }

  return { ok: false, tiersTried };
}
