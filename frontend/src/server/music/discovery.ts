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
import type { SearchResult, SearchSuccess, TierOutcome } from "./types";

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
 * - **Bounded seed concurrency.** Seeds run a bounded number at a time
 *   ({@link DISCOVERY_SEED_CONCURRENCY}, which is one). This is the load-bearing
 *   bound: the chain starts its own request budget *before* it queues on the
 *   shared outbound limiter, so a seed that fanned out in parallel would spend
 *   its budget waiting for a slot instead of querying a provider, and the
 *   multi-language page would fail every shelf in `timeout`. One seed at a time
 *   makes a feed's cost `seeds × per-seed budget` and nothing else, and the
 *   client caps how many feeds reach the server at once.
 * - **Bounded feed wall clock.** One feed may not keep starting new seeds
 *   past {@link DISCOVERY_FEED_BUDGET_MS}. A seed the deadline stops from
 *   starting — or from finishing — is reported in `seedsSkipped`, never in
 *   `seedsFailed`: it is a budget outcome, not a provider failure.
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
 * How many of a feed's planned seeds may be inside the chain at the same time.
 *
 * One (sequential) is deliberate. The chain starts its request budget
 * (`REQUEST_BUDGET_MS`) *before* it awaits the shared outbound limiter, so a
 * seed that is merely queued for a slot has already burned part of its budget —
 * and a multi-language page fans out to many feeds at once, so most seeds of a
 * page would exhaust an 8s budget while waiting and be reported as `timeout`.
 * Running seeds one at a time makes a feed's outbound pressure exactly one
 * chain call, which is what the limiter's slots are sized for. Raising this
 * value re-introduces that queue-vs-budget race; lower it only if a feed's
 * wall clock becomes the problem (see {@link DISCOVERY_FEED_BUDGET_MS}).
 */
export const DISCOVERY_SEED_CONCURRENCY = 1;

/**
 * Wall-clock budget for **one seed's** chain call, overriding the chain's own
 * {@link import("./chain").REQUEST_BUDGET_MS}.
 *
 * It is deliberately larger than the chain's 8s default for one reason: the
 * chain's budget clock starts before the limiter wait, so a seed that queues
 * behind other pages' outbound requests needs headroom to still reach a
 * provider. 10s absorbs the limiter queue while still bounding a single seed.
 */
export const DISCOVERY_SEED_TIMEOUT_MS = 10_000;

/**
 * Wall-clock budget for **one feed's** whole seed loop, after which no further
 * seed is started and the in-flight one is cut short.
 *
 * It bounds the tail the seed cap alone does not: 8 seeds at 10s each would
 * otherwise be an 80s request. A feed that is answered quickly (the ordinary
 * case — providers answer in hundreds of milliseconds) never reaches it, so the
 * budget only truncates a genuinely slow upstream, and the truncated seeds are
 * named in `seedsSkipped` rather than failing the feed.
 */
export const DISCOVERY_FEED_BUDGET_MS = 20_000;

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
  /**
   * How many seeds this feed actually attempted — `seedsFailed.length` plus the
   * seeds that produced tracks. It is *not* the planned count when
   * {@link DiscoveryDiagnostics.seedsSkipped} is non-empty.
   */
  seedsTried: number;
  /**
   * The queries whose chain was exhausted, in attempt order. A non-empty list
   * is the spec's "one failing seed does not fail the feed" signal; a list
   * holding every attempted query is the all-seeds failure.
   */
  seedsFailed: string[];
  /**
   * The queries this feed never got to — or never finished — because
   * {@link DISCOVERY_FEED_BUDGET_MS} elapsed first, in plan order.
   *
   * Deliberately distinct from {@link DiscoveryDiagnostics.seedsFailed}: no
   * provider was asked and none failed, so reporting a budget-skipped seed as a
   * failed seed would blame upstream for this service's own bound (and would
   * make a feed that simply ran long look like the all-seeds failure).
   */
  seedsSkipped: string[];
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
 * Chain options for one feed, plus the service's own feed-level budget.
 *
 * A superset of the chain's options, so every existing caller that passes
 * `ChainOptions` still type-checks unchanged; only `feedBudgetMs` is new (and
 * it exists so tests can compose a feed under a short deadline).
 */
export interface DiscoveryOptions extends ChainOptions {
  /** Total wall-clock budget for this feed's seed loop (tests use short values). */
  feedBudgetMs?: number;
}

/** One seed's chain outcome; `null` result means the chain itself threw. */
interface SeedAttempt {
  seed: DiscoverySeed;
  result: SearchResult | null;
}

/**
 * Compose one feed: plan the seeds, run each through the existing chain,
 * stamp language attribution, merge, and re-apply the shared
 * normalize/filter/score/sort/dedupe pipeline.
 *
 * Seeds run at most {@link DISCOVERY_SEED_CONCURRENCY} at a time, each with its
 * own {@link DISCOVERY_SEED_TIMEOUT_MS} chain budget, and the whole loop stops
 * starting seeds after {@link DISCOVERY_FEED_BUDGET_MS}. Only caller
 * cancellation throws (mirroring `runChain`): any other per-seed failure
 * degrades into `seedsFailed`, and a seed the feed budget stopped is reported
 * in `seedsSkipped`. A feed returns a structured failure only when it produced
 * no tracks at all — which is the "every seed failed or was skipped" case, and
 * the route answers 503 either way.
 */
export async function resolveDiscovery(
  request: DiscoveryRequest,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const languages = normalizeLanguageCodes(request.languages);
  const seeds = planDiscoverySeeds({ ...request, languages });
  const seedBudgetMs = options.budgetMs ?? DISCOVERY_SEED_TIMEOUT_MS;

  // The feed's own wall clock. It is not a per-seed budget: it decides how long
  // this composition may keep *starting* seeds, and it is the only reason a
  // planned seed can go unattempted.
  const feedSignal = AbortSignal.timeout(options.feedBudgetMs ?? DISCOVERY_FEED_BUDGET_MS);
  // A seed dies with the feed, so one slow seed cannot overrun the feed budget
  // by its own budget on top of it.
  const seedSignal = request.signal ? AbortSignal.any([request.signal, feedSignal]) : feedSignal;

  const diagnostics: DiscoveryDiagnostics = {
    kind: request.kind,
    languages,
    seedsTried: 0,
    seedsFailed: [],
    seedsSkipped: [],
    tiersTried: [],
    cached: false,
    resultCount: 0,
  };

  // Indexed by plan position so the merge below stays in plan order regardless
  // of which worker finished first: `undefined` means "never attempted".
  const attempts: Array<SeedAttempt | undefined> = new Array<SeedAttempt | undefined>(seeds.length);
  let nextSeed = 0;
  let stopped = false;

  const runSeed = async (seed: DiscoverySeed): Promise<SeedAttempt> => ({
    seed,
    result: await runChain(
      { query: seed.query, limit: request.limit, signal: seedSignal },
      { ...options, budgetMs: seedBudgetMs },
    ),
  });

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextSeed;
      nextSeed += 1;
      if (index >= seeds.length || stopped) return;
      // The feed's budget is spent: this seed is never attempted, so it cannot
      // be reported as a provider failure.
      if (feedSignal.aborted) return;
      const seed = seeds[index];
      try {
        attempts[index] = await runSeed(seed);
      } catch (error) {
        // Only caller cancellation escapes the chain; re-throw it so the route
        // can answer 499, and stop the remaining workers from starting seeds.
        if (request.signal?.aborted) {
          stopped = true;
          throw request.signal.reason ?? error;
        }
        // The feed's own deadline cut the seed short: a budget outcome, not an
        // upstream failure, so it is reported as skipped rather than failed.
        if (feedSignal.aborted) {
          stopped = true;
          return;
        }
        attempts[index] = { seed, result: null };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(DISCOVERY_SEED_CONCURRENCY, seeds.length)) }, () =>
      worker(),
    ),
  );

  const stamped: DiscoveryTrack[] = [];
  for (const [index, attempt] of attempts.entries()) {
    const seed = seeds[index];
    if (attempt === undefined) {
      diagnostics.seedsSkipped.push(seed.query);
      continue;
    }
    if (attempt.result === null) {
      diagnostics.seedsFailed.push(seed.query);
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
      diagnostics.seedsFailed.push(seed.query);
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
  diagnostics.seedsTried = seeds.length - diagnostics.seedsSkipped.length;

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
  chainOptions?: DiscoveryOptions;
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
