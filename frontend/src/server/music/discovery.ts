import { normalizeLanguageCodes } from "@/lib/languages";
import { createInflightDedup, createTtlCache, type InflightDedup, type TtlCache } from "./cache";
import { runChain, type ChainOptions } from "./chain";
import {
  catalogSeedsFor,
  composeGenreQuery,
  composeTasteQuery,
  requiresCallerSeeds,
  type DiscoveryKind,
} from "./discoverySeeds";
import { filterTracks } from "./filter";
import { dedupeTracks, qualityScore, sortTracks } from "./score";
import type { SearchSuccess, TierOutcome } from "./types";

/**
 * The discovery-feed composition service (ROADMAP M8; design decisions 1–3).
 *
 * One requested feed is composed server-side from the curated seed catalog: each
 * seed runs through the **existing** `runChain` — same four tiers, same
 * outbound limiter, same per-attempt timeout, same abort propagation — and the
 * results are merged into one feed.
 *
 * Properties this service guarantees, and the spec relies on:
 *
 * - **Language attribution comes from the seed, not from track metadata**
 *   (design decision 3). Providers expose no reliable per-track language, so
 *   each returned track carries the language code of the seed that produced it.
 *   This is attribution, not a ground-truth claim.
 * - **Per-seed failure tolerance.** A seed whose chain is exhausted is skipped
 *   and named in `seedsFailed`; only a feed whose *every* seed fails returns a
 *   structured failure (the route answers 503).
 * - **No new filtering rules.** The merged feed goes through the existing
 *   `filterTracks` / `qualityScore` / `sortTracks` / `dedupeTracks` stages, so a
 *   discovery track is scored and ordered exactly like a search result.
 * - **Bounded fan-out.** A feed never issues more than
 *   {@link DISCOVERY_SEED_CAP} provider queries, and the cap equals
 *   `MAX_SELECTED_LANGUAGES` so *every* selected language is always represented
 *   in the first round of seeds.
 * - **No user data.** The request carries a kind, language codes, and short
 *   caller terms — never likes, playlists, or history, and nothing is stored.
 *
 * Layered exactly like the search service: bounded TTL result cache →
 * in-flight dedupe → the chain, with failures never cached.
 */

/** Feed kinds re-exported from the seed catalog (the service is their entry point). */
export { DISCOVERY_KINDS, requiresCallerSeeds } from "./discoverySeeds";
/** Feed kinds this service composes; `discoverySeeds` owns the definition. */
export type { DiscoveryKind } from "./discoverySeeds";

/**
 * The canonical track a feed returns, taken from the search chain's own result
 * type: a discovery track *is* a search track, and this module deliberately
 * never re-imports the domain model from the data layer.
 */
export type DiscoveryTrack = SearchSuccess["tracks"][number];

/**
 * Upper bound on provider queries one feed may fan out to. Equal to
 * `MAX_SELECTED_LANGUAGES` on purpose: seeds are planned language-fair (every
 * language's first seed is planned before any language's second), so the cap
 * can bound the fan-out without ever dropping a selected language.
 */
export const DISCOVERY_SEED_CAP = 8;

/**
 * Discovery-feed cache TTL. The route mirrors it as `Cache-Control: max-age`,
 * so a repeat feed is answered from the shared store rather than re-queried
 * (spec: short-lived HTTP cache).
 */
export const DISCOVERY_CACHE_TTL_MS = 300_000;

/** Bound on cached feeds (per runtime instance, best-effort). */
export const DISCOVERY_CACHE_MAX_ENTRIES = 60;

/** What the route layer hands to the discovery service. */
export interface DiscoveryRequest {
  kind: DiscoveryKind;
  /** Selected catalog language codes; normalized to catalog codes internally. */
  languages: readonly string[];
  /**
   * Caller-supplied seed terms, used only by caller-seeded kinds
   * (`genre`, `for-you`, `mix`) and ignored by catalog kinds.
   */
  seeds?: readonly string[];
  /** Maximum total tracks in the composed feed. */
  limit: number;
  /** Incoming request's abort signal — cancellation propagates upstream. */
  signal?: AbortSignal;
}

/** One planned provider attempt: the query text and the language it speaks for. */
export interface DiscoverySeed {
  /** The provider query text for this attempt. */
  readonly query: string;
  /** Catalog language code this attempt is attributed to (design decision 3). */
  readonly language: string;
}

/**
 * Diagnostics for a discovery feed. Consumers MUST NOT depend on these fields;
 * they are a safe subset (kinds, language codes, seed queries, tier ids and
 * outcomes) and never carry headers, keys, or raw upstream bodies.
 */
export interface DiscoveryDiagnostics {
  kind: DiscoveryKind;
  /** Language codes the feed was composed for, after normalization. */
  languages: string[];
  /** How many seeds this feed attempted. */
  seedsTried: number;
  /**
   * The queries whose chain was exhausted, in attempt order. A non-empty list
   * is the spec's "one failing seed does not fail the feed" signal; a list
   * holding every attempted query is the all-seeds failure.
   */
  seedsFailed: string[];
  /** Tier outcomes across every seed attempt, in attempt order. */
  tiersTried: TierOutcome[];
  /** True when the feed was served from the TTL result cache. */
  cached: boolean;
  /** Canonical tracks in the response. */
  resultCount: number;
}

export interface DiscoverySuccess {
  ok: true;
  tracks: DiscoveryTrack[];
  diagnostics: DiscoveryDiagnostics;
}

export interface DiscoveryFailure {
  ok: false;
  /** Every seed failed; the route answers 503. */
  reason: "upstream";
  diagnostics: DiscoveryDiagnostics;
}

export type DiscoveryResult = DiscoveryFailure | DiscoverySuccess;

/** Cache/dedup key: kind + sorted languages + sorted seeds + limit. */
export function discoveryCacheKey(request: DiscoveryRequest): string {
  const languages = [...normalizeLanguageCodes(request.languages)].sort();
  const seeds = [...(request.seeds ?? [])].map((term) => term.trim()).sort();
  return `discover:${request.kind}|${languages.join(",")}|${seeds.join(",")}|${request.limit}`;
}

/** Drop blank terms, trim, and cap at {@link DISCOVERY_SEED_CAP}. */
function normalizeSeedTerms(seeds: readonly string[] | undefined): string[] {
  if (seeds === undefined) return [];
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const raw of seeds) {
    const term = raw.trim();
    if (term.length === 0 || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length === DISCOVERY_SEED_CAP) break;
  }
  return terms;
}

/**
 * Plan one feed's provider attempts from the curated catalog (design decision
 * 1). Bounded and language-fair:
 *
 * - catalog kinds (`trending`, `podcast`, `collection`) take their text from
 *   the catalog, round-robin across the selected languages so every language is
 *   planned before any language contributes a second seed;
 * - caller-seeded kinds (`genre`, `for-you`, `mix`) compose each caller term
 *   per language, terms outer / languages inner for the same fairness;
 * - identical (query, language) pairs collapse, and the whole plan is capped at
 *   {@link DISCOVERY_SEED_CAP}.
 */
export function planDiscoverySeeds(request: DiscoveryRequest): DiscoverySeed[] {
  const languages = normalizeLanguageCodes(request.languages);
  const terms = normalizeSeedTerms(request.seeds);
  const planned: DiscoverySeed[] = [];

  if (requiresCallerSeeds(request.kind)) {
    for (const term of terms) {
      for (const language of languages) {
        planned.push({
          query:
            request.kind === "genre"
              ? composeGenreQuery(term, language)
              : composeTasteQuery(term, language, request.kind),
          language,
        });
      }
    }
  } else {
    const perLanguage = languages.map((language) => ({
      language,
      queries: catalogSeedsFor(request.kind, language),
    }));
    const longest = perLanguage.reduce((max, entry) => Math.max(max, entry.queries.length), 0);
    for (let round = 0; round < longest; round += 1) {
      for (const entry of perLanguage) {
        const query = entry.queries[round];
        if (query !== undefined) planned.push({ query, language: entry.language });
      }
    }
  }

  const seen = new Set<string>();
  const deduped: DiscoverySeed[] = [];
  for (const seed of planned) {
    const key = `${seed.language}|${seed.query}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(seed);
    if (deduped.length === DISCOVERY_SEED_CAP) break;
  }
  return deduped;
}

/**
 * Compose one feed: plan the seeds, run each through the existing chain,
 * stamp language attribution, merge, and re-apply the shared
 * normalize/filter/score/sort/dedupe pipeline.
 *
 * Only caller cancellation throws (mirroring `runChain`): any other per-seed
 * failure degrades into `seedsFailed` rather than failing the feed. A feed
 * returns a structured failure only when it produced no tracks at all — and
 * because the chain only succeeds with at least one surviving track, that is
 * exactly the "every seed failed" case.
 */
export async function resolveDiscovery(
  request: DiscoveryRequest,
  options: ChainOptions = {},
): Promise<DiscoveryResult> {
  const languages = normalizeLanguageCodes(request.languages);
  const seeds = planDiscoverySeeds({ ...request, languages });

  const diagnostics: DiscoveryDiagnostics = {
    kind: request.kind,
    languages,
    seedsTried: seeds.length,
    seedsFailed: [],
    tiersTried: [],
    cached: false,
    resultCount: 0,
  };

  const attempts = await Promise.all(
    seeds.map(async (seed) => {
      const searchRequest = {
        query: seed.query,
        limit: request.limit,
        ...(request.signal ? { signal: request.signal } : {}),
      };
      try {
        return { seed, result: await runChain(searchRequest, options) };
      } catch (error) {
        // Only caller cancellation escapes the chain; re-throw it so the route
        // can answer 499. Anything else is a failed seed, and is reported.
        if (request.signal?.aborted) throw request.signal.reason ?? error;
        return { seed, result: null };
      }
    }),
  );

  const stamped: DiscoveryTrack[] = [];
  for (const attempt of attempts) {
    if (attempt.result === null) {
      diagnostics.seedsFailed.push(attempt.seed.query);
      continue;
    }
    // Tier outcomes are recorded for *every* attempt, successful or not: the
    // all-seeds-failed path is exactly where they are worth having. The chain
    // carries them under `diagnostics` on success and at the top level on
    // failure, so both shapes are read here.
    diagnostics.tiersTried.push(
      ...(attempt.result.ok ? attempt.result.diagnostics.tiersTried : attempt.result.tiersTried),
    );
    if (!attempt.result.ok) {
      diagnostics.seedsFailed.push(attempt.seed.query);
      continue;
    }
    for (const track of attempt.result.tracks) {
      // Quality is scored against the seed that produced the track (the same
      // query the chain used), and `language` is the seed's code — never
      // inferred from the track's text (design decision 3).
      stamped.push({
        ...track,
        qualityScore: qualityScore(track, attempt.seed.query),
        language: attempt.seed.language,
      });
    }
  }

  const tracks = dedupeTracks(sortTracks(filterTracks(stamped))).slice(0, request.limit);
  diagnostics.resultCount = tracks.length;

  if (tracks.length === 0) {
    return { ok: false, reason: "upstream", diagnostics };
  }
  return { ok: true, tracks, diagnostics };
}

export interface DiscoveryDeps {
  cache: TtlCache<DiscoverySuccess>;
  inflight: InflightDedup<DiscoveryResult>;
  chainOptions?: ChainOptions;
}

const defaultCache = createTtlCache<DiscoverySuccess>({
  ttlMs: DISCOVERY_CACHE_TTL_MS,
  maxEntries: DISCOVERY_CACHE_MAX_ENTRIES,
});
const defaultInflight = createInflightDedup<DiscoveryResult>();

/** The process-wide service state the route uses (documented shared state). */
export const defaultDiscoveryDeps: DiscoveryDeps = {
  cache: defaultCache,
  inflight: defaultInflight,
};

/**
 * Run one feed through cache → dedup → composition. Successes are cached for
 * {@link DISCOVERY_CACHE_TTL_MS} and reported with `cached: true`; failures are
 * never cached, so a retry re-queries upstream.
 */
export async function runDiscovery(
  request: DiscoveryRequest,
  deps: DiscoveryDeps = defaultDiscoveryDeps,
): Promise<DiscoveryResult> {
  const key = discoveryCacheKey(request);

  const cached = deps.cache.get(key);
  if (cached) {
    return { ...cached, diagnostics: { ...cached.diagnostics, cached: true } };
  }

  return deps.inflight.run(key, async () => {
    const result = await resolveDiscovery(request, deps.chainOptions);
    if (result.ok) deps.cache.set(key, result);
    return result;
  });
}
