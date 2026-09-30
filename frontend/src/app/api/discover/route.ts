import { z } from "zod";
import { DEFAULT_LANGUAGE, MAX_SELECTED_LANGUAGES, isLanguageCode } from "@/lib/languages";
import {
  DISCOVERY_CACHE_TTL_MS,
  DISCOVERY_SEED_CAP,
  requiresCallerSeeds,
  runDiscovery,
  type DiscoveryKind,
  type DiscoveryResult,
} from "@/server/music/discovery";
import { DISCOVERY_KINDS } from "@/server/music/discoverySeeds";
import { guardRequest } from "@/server/http/guard";

/**
 * Discovery-feed transport boundary (design decisions 1–3):
 * `GET /api/discover?kind=…&languages=…&seeds=…&limit=…`.
 *
 * Mirrors the search route's conventions — validate first (a 400 before any
 * upstream call), pass `request.signal` through for cancellation, project
 * diagnostics onto the safe subset — with the discovery contract's three
 * differences: the accepted inputs are exactly a feed kind, catalog language
 * codes, and short caller seed terms (never liked tracks, playlists, or
 * history), only caller-seeded kinds require terms, and an all-seeds failure
 * maps to 503 instead of "all tiers failed".
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** Bounded caller seed-term length (short terms only — spec: short seed terms). */
const MAX_SEED_TERM_LENGTH = 80;

/** Split a comma-separated parameter into trimmed, non-empty terms. */
function commaSeparated(raw: string): string[] {
  return raw
    .split(",")
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

const discoveryParamsSchema = z.object({
  kind: z.enum(DISCOVERY_KINDS, {
    message: `kind must be one of ${DISCOVERY_KINDS.join(", ")}`,
  }),
  languages: z
    .string()
    .transform(commaSeparated)
    .pipe(
      z
        .array(z.string().refine(isLanguageCode, "languages must be catalog language codes"))
        .min(1, "languages must contain at least one code")
        .max(
          MAX_SELECTED_LANGUAGES,
          `languages must contain at most ${MAX_SELECTED_LANGUAGES} codes`,
        ),
    )
    .default([DEFAULT_LANGUAGE]),
  seeds: z
    .string()
    .transform(commaSeparated)
    .pipe(
      z
        .array(
          z
            .string()
            .max(
              MAX_SEED_TERM_LENGTH,
              `each seed must be at most ${MAX_SEED_TERM_LENGTH} characters`,
            ),
        )
        .max(DISCOVERY_SEED_CAP, `seeds must contain at most ${DISCOVERY_SEED_CAP} terms`),
    )
    .optional(),
  limit: z.coerce
    .number()
    .int("limit must be an integer")
    .min(1, "limit must be at least 1")
    .max(MAX_LIMIT, `limit must be at most ${MAX_LIMIT}`)
    .default(DEFAULT_LIMIT),
});

/** Shared with the in-module TTL cache so header and store cannot drift. */
const MAX_AGE_SECONDS = Math.round(DISCOVERY_CACHE_TTL_MS / 1000);
const SUCCESS_CACHE_CONTROL = `public, max-age=${MAX_AGE_SECONDS}`;
const ERROR_CACHE_CONTROL = "no-store";

function errorResponse(
  status: number,
  code: "invalid_request" | "upstream_unavailable",
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": ERROR_CACHE_CONTROL } },
  );
}

export async function GET(request: Request): Promise<Response> {
  // Throttled before anything else: a refused request must not have already
  // cost a provider call (spec `security` — bounded per-instance throttling).
  const throttled = guardRequest(request);
  if (throttled) return throttled;

  const params = new URL(request.url).searchParams;
  const parsed = discoveryParamsSchema.safeParse({
    kind: params.get("kind") ?? undefined,
    languages: params.get("languages") ?? undefined,
    seeds: params.get("seeds") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });

  // Invalid input never reaches the provider chain.
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid discovery request.";
    return errorResponse(400, "invalid_request", message);
  }

  const { kind, languages, seeds, limit } = parsed.data;

  // Caller-seeded kinds are meaningless without terms; catalog kinds ignore
  // them entirely, so this is the only place the two families diverge.
  if (requiresCallerSeeds(kind) && (seeds === undefined || seeds.length === 0)) {
    return errorResponse(400, "invalid_request", `kind "${kind}" requires at least one seed term`);
  }

  let result: DiscoveryResult;
  try {
    result = await runDiscovery({
      kind: kind as DiscoveryKind,
      languages,
      ...(seeds !== undefined ? { seeds } : {}),
      limit,
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

  // Every seed failed across the tier chain: structured 503.
  if (!result.ok) {
    return errorResponse(
      503,
      "upstream_unavailable",
      "Discovery is temporarily unavailable. Please try again shortly.",
    );
  }

  return Response.json(
    { tracks: result.tracks, diagnostics: result.diagnostics },
    { status: 200, headers: { "Cache-Control": SUCCESS_CACHE_CONTROL } },
  );
}
