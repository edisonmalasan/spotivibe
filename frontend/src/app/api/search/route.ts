import { z } from "zod";
import { runSearch, SEARCH_CACHE_TTL_MS } from "@/server/music/search";
import { guardRequest } from "@/server/http/guard";
import type { SearchDiagnostics, SearchResult } from "@/server/music/types";

/**
 * The only transport boundary of the provider layer (design decision 8):
 * `GET /api/search?q=<string>&limit=<1..50, default 20>&category=<music|podcast>`.
 *
 * Thin shell — zod validation, pass-through of `request.signal` for
 * cancellation, structured serialization. It never proxies media, never
 * accepts local user data, and diagnostics are projected onto a safe subset
 * (tier ids/outcomes/cache state only) before they leave the server.
 *
 * M12 adds exactly one parameter: `category`, the question being asked. It is
 * enumerated, so an unknown value is rejected before any provider is contacted,
 * and it is not a filter applied after the fact — it selects the tier order, the
 * upstream parameters, the filter rules, and the cache key (design decision 1).
 */

/** Bounded query length (spec: non-empty after trimming, bounded length). */
const MAX_QUERY_LENGTH = 200;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const searchParamsSchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, "q must not be empty")
    .max(MAX_QUERY_LENGTH, `q must be at most ${MAX_QUERY_LENGTH} characters`),
  limit: z.coerce
    .number()
    .int("limit must be an integer")
    .min(1, "limit must be at least 1")
    .max(MAX_LIMIT, `limit must be at most ${MAX_LIMIT}`)
    .default(DEFAULT_LIMIT),
  /**
   * M12: the question being asked. Enumerated rather than a free string, so an
   * unknown value is rejected by the same 400 path as an empty query — a
   * permissive string here would let a caller label results arbitrarily.
   */
  category: z.enum(["music", "podcast"]).default("music"),
});

/** Shared with the in-module TTL cache so header and store cannot drift. */
const MAX_AGE_SECONDS = Math.round(SEARCH_CACHE_TTL_MS / 1000);
const SUCCESS_CACHE_CONTROL = `public, max-age=${MAX_AGE_SECONDS}`;
const ERROR_CACHE_CONTROL = "no-store";

function errorResponse(
  status: number,
  code: "invalid_query" | "upstream_unavailable",
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": ERROR_CACHE_CONTROL } },
  );
}

/** Project diagnostics onto the safe subset (design decision 8). */
function safeDiagnostics(diagnostics: SearchDiagnostics): SearchDiagnostics {
  return {
    tier: diagnostics.tier,
    tiersTried: diagnostics.tiersTried.map((entry) => ({
      tier: entry.tier,
      outcome: entry.outcome,
    })),
    cached: diagnostics.cached,
    resultCount: diagnostics.resultCount,
  };
}

export async function GET(request: Request): Promise<Response> {
  // Throttled before anything else: a refused request must not have already
  // cost a provider call (spec `security` — bounded per-instance throttling).
  const throttled = guardRequest(request);
  if (throttled) return throttled;

  const params = new URL(request.url).searchParams;
  const parsed = searchParamsSchema.safeParse({
    q: params.get("q") ?? undefined,
    limit: params.get("limit") ?? undefined,
    category: params.get("category") ?? undefined,
  });

  // Invalid input never reaches the provider chain.
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid search request.";
    return errorResponse(400, "invalid_query", message);
  }

  let result: SearchResult;
  try {
    result = await runSearch({
      query: parsed.data.q,
      limit: parsed.data.limit,
      category: parsed.data.category,
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) {
      // Caller disconnected mid-flight — nothing left to deliver.
      return new Response(null, {
        status: 499,
        headers: { "Cache-Control": ERROR_CACHE_CONTROL },
      });
    }
    throw error;
  }

  // Every tier failed or none produced usable results: structured 503.
  if (!result.ok) {
    return errorResponse(
      503,
      "upstream_unavailable",
      "All music providers are currently unavailable. Please try again shortly.",
    );
  }

  return Response.json(
    { tracks: result.tracks, diagnostics: safeDiagnostics(result.diagnostics) },
    { status: 200, headers: { "Cache-Control": SUCCESS_CACHE_CONTROL } },
  );
}
