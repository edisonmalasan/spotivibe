import { createInflightDedup, createTtlCache, type InflightDedup, type TtlCache } from "./cache";
import { runChain, type ChainOptions } from "./chain";
import { filterTracks } from "./filter";
import { dedupeTracks, qualityScore, sortTracks } from "./score";
import type { SearchSuccess, TierOutcome } from "./types";

/**
 * The radio-feed resolution service (ROADMAP M10; design decisions 2 and 3).
 *
 * One refill is answered from **at most two** provider queries chosen by
 * rotating a curated phrase list indexed by the caller's own `variant` number,
 * each run through the **existing** `runChain` — same four tiers, same shared
 * outbound limiter, same per-attempt timeout, same abort propagation — and
 * merged into one canonical track set with the caller's exclusion list applied
 * afterwards.
 *
 * Properties this service guarantees, and the spec relies on:
 *
 * - **The server never learns how many times anyone has asked.** `variant` is
 *   the caller's refill counter, and the planned seeds are a *pure function* of
 *   `(identity, variant)` — no server-held state, no randomness, no per-caller
 *   record. Two identical requests therefore plan identical seeds, and two
 *   different variants plan different ones (design decision 2).
 * - **Bounded fan-out, and a budget that is what keeps it bounded.** A refill
 *   issues at most {@link RADIO_SEED_CAP} provider queries, they run at most
 *   {@link RADIO_SEED_CONCURRENCY} at a time, each within
 *   {@link RADIO_SEED_TIMEOUT_MS}, and the loop stops after
 *   {@link RADIO_REQUEST_BUDGET_MS}. A radio refill is a *background* request
 *   that can fire repeatedly, so it inherits the M8/M9 bound rather than
 *   inventing a fan-out of its own.
 * - **Exclusion is applied after the merge,** so it holds identically for
 *   every tier and for a result served from the TTL cache. A candidate is
 *   dropped when its `id` *or* its `providerId` is in the list, so neither a
 *   canonical `youtube:<id>` nor a bare video id can leak back in.
 * - **An over-long exclusion list is rejected, never truncated.** Silently
 *   dropping ids would quietly re-serve a track the caller has already played,
 *   which is exactly the failure the bound exists to prevent (design decision 3).
 * - **An empty answer is an empty answer.** A refill whose every resolved track
 *   is excluded reports `unresolvable`; nothing outside the requested identity
 *   is ever substituted for it.
 * - **Per-seed failure tolerance.** A seed whose chain is exhausted is named in
 *   `seedsFailed` and the other seed still answers the refill; a seed the
 *   request budget stops is named in `seedsSkipped`, which is a budget outcome
 *   and never a provider failure.
 * - **No new filtering rules, and no user data.** Merged tracks go through the
 *   existing `filterTracks` / `qualityScore` / `sortTracks` / `dedupeTracks`
 *   stages, and the request carries an identity, a variant, a limit, and an id
 *   list — never a taste profile, liked tracks, or listening history. This
 *   module imports nothing from `@/data` at all, which is what makes that
 *   structural rather than aspirational.
 *
 * Layered exactly like the discovery and catalog services: bounded TTL result
 * cache → in-flight dedupe → the chain, with failures never cached.
 */

/**
 * The canonical track a refill returns, taken from the search chain's own
 * result type: a radio track *is* a search track, and this module deliberately
 * never imports the domain model from the data layer. It is structurally the
 * same `Track` the client surfaces use.
 */
export type RadioTrack = SearchSuccess["tracks"][number];

/** Every identity a radio may be started from. */
export const RADIO_KINDS = ["track", "artist"] as const;

/** One radio identity kind: a single track, or a whole artist. */
export type RadioKind = (typeof RADIO_KINDS)[number];

/**
 * Upper bound on provider queries one refill may issue (design decision 2).
 * Two is the documented ceiling: enough to widen the seed's material without
 * letting a background refill become a fan-out.
 */
export const RADIO_SEED_CAP = 2;

/**
 * How many of a refill's planned seeds may be inside the chain at the same
 * time. One (sequential) for the reason documented on the catalog and
 * discovery services: the chain starts its request budget *before* it awaits
 * the shared outbound limiter, so a seed that merely queued for a slot would
 * burn its budget waiting and be reported as `timeout` without any provider
 * being asked.
 */
export const RADIO_SEED_CONCURRENCY = 1;

/**
 * Wall-clock budget for **one seed's** chain call, overriding the chain's own
 * {@link import("./chain").REQUEST_BUDGET_MS}. The same value M8/M9 use, for
 * the same reason: it absorbs the limiter queue and still bounds a single seed.
 */
export const RADIO_SEED_TIMEOUT_MS = 10_000;

/**
 * Wall-clock budget for **one refill's** whole seed loop, after which no further
 * seed is started and the in-flight one is cut short.
 *
 * The bound that actually keeps a repeated background refill cheap: the seed
 * cap alone still allows `2 × 10s`, and a radio firing a refill every time the
 * queue runs low would otherwise put that much pressure on the shared limiter
 * on every cycle. Truncated seeds are reported in `seedsSkipped` rather than
 * failing the request.
 */
export const RADIO_REQUEST_BUDGET_MS = 20_000;

/** Default number of tracks one refill returns. */
export const RADIO_TRACK_LIMIT = 20;

/** Hard ceiling on a caller-supplied `limit` (the route rejects anything above). */
export const RADIO_MAX_LIMIT = 50;

/**
 * Maximum ids one exclusion list may carry (design decision 3, and the spec
 * scenario that an over-long list is rejected). 60 canonical ids stay well
 * inside any practical request-line limit; a longer list is a bug, not a radio.
 */
export const RADIO_MAX_EXCLUDE = 60;

/** Longest single excluded id. A canonical id is `youtube:<11 chars>`. */
export const RADIO_MAX_EXCLUDE_ID_LENGTH = 64;

/**
 * Highest accepted rotation index. A radio's refill counter is a small
 * positive number; the bound keeps the number a plain integer and stops an
 * unbounded value from becoming an accidental profiling key.
 */
export const RADIO_MAX_VARIANT = 999;

/** Radio-resolution cache TTL (the route mirrors it as `Cache-Control: max-age`). */
export const RADIO_CACHE_TTL_MS = 300_000;

/** Bound on cached resolutions (per runtime instance, best-effort). */
export const RADIO_CACHE_MAX_ENTRIES = 60;

/**
 * Longest composed seed query this service will send upstream. The route
 * already bounds the identity text; this clips a composition such as
 * `<artist> <title> similar` so no seed grows without limit from concatenated
 * identifier text.
 */
export const RADIO_SEED_MAX_LENGTH = 200;

/** One planned provider attempt for a refill. */
export interface RadioSeed {
  /** The provider query text for this attempt. */
  query: string;
  /** What this seed is for, surfaced in tests and diagnostics narratives. */
  label: string;
}

/**
 * Diagnostics for a refill. Consumers MUST NOT depend on these fields; they are
 * a safe subset (seed queries, tier ids and outcomes, cache state) and never
 * carry headers, keys, credentials, or raw upstream bodies.
 */
export interface RadioDiagnostics {
  /**
   * How many seeds this request actually attempted — `seedsFailed.length` plus
   * the seeds that produced tracks. It is *not* the planned count when
   * {@link RadioDiagnostics.seedsSkipped} is non-empty.
   */
  seedsTried: number;
  /**
   * The queries whose chain was exhausted, in attempt order. A list holding
   * every attempted query is the all-seeds upstream failure the route answers
   * 503 for.
   */
  seedsFailed: string[];
  /**
   * The queries this request never got to — or never finished — because
   * {@link RADIO_REQUEST_BUDGET_MS} elapsed first, in plan order.
   *
   * Deliberately distinct from {@link RadioDiagnostics.seedsFailed}: no
   * provider was asked and none failed, so reporting a budget-skipped seed as a
   * failed seed would blame upstream for this service's own bound.
   */
  seedsSkipped: string[];
  /** Tier outcomes across every seed attempt, in attempt order. */
  tiersTried: TierOutcome[];
  /** True when the resolution was served from the TTL result cache. */
  cached: boolean;
  /** Canonical tracks in the response, after exclusion. */
  resultCount: number;
}

/**
 * Why a refill produced nothing:
 *
 * - `invalid_request` — the request was out of bounds (a malformed kind, a
 *   variant or limit outside its documented range, or an exclusion list longer
 *   than {@link RADIO_MAX_EXCLUDE}). The route answers 400, and **no provider
 *   was contacted**.
 * - `unresolvable` — the request named no usable identity, or resolved nothing
 *   that survived the exclusion list. The route answers 404 rather than
 *   substituting material outside the requested identity.
 * - `upstream` — no provider answered at all: every seed exhausted its chain
 *   with a transport/parse failure, or the request budget stopped them all. The
 *   route answers 503.
 */
export type RadioFailureReason = "invalid_request" | "unresolvable" | "upstream";

/** A refill that produced tracks. */
export interface RadioSuccess {
  ok: true;
  /** Canonical tracks, in resolved order, with every excluded id absent. */
  tracks: RadioTrack[];
  /** The rotation index these seeds were planned from (the echoed variant). */
  variant: number;
  diagnostics: RadioDiagnostics;
}

/** A refill that produced nothing. */
export interface RadioFailure {
  ok: false;
  reason: RadioFailureReason;
  diagnostics: RadioDiagnostics;
}

/** The structured result of one refill, successful or not. */
export type RadioResolution = RadioSuccess | RadioFailure;

/** How a radio identity is identified by the caller. */
export interface RadioRequest {
  /** Which identity the radio follows. */
  kind: RadioKind;
  /** Public track title. Required for `kind: "track"`, ignored for `"artist"`. */
  title?: string;
  /** Public artist name. Required for `kind: "artist"`, optional narrowing otherwise. */
  artist?: string;
  /** The caller's refill counter — the *only* rotation input (default 0). */
  variant?: number;
  /** Maximum tracks to return (defaults to {@link RADIO_TRACK_LIMIT}). */
  limit?: number;
  /**
   * Bounded list of ids to keep out of the result. The caller owns the played
   * set; the server honors exactly the ids it is given and never more.
   */
  exclude?: readonly string[];
  /** Incoming request's abort signal — cancellation propagates upstream. */
  signal?: AbortSignal;
}

/** The inputs {@link planRadioSeeds} is a pure function of. */
export interface RadioSeedPlan {
  kind: RadioKind;
  title?: string;
  artist?: string;
  /** Rotation index; the planned pair is indexed by it (wrapping). */
  variant?: number;
}

/** Chain options for one refill, plus the service's own request budget. */
export interface RadioOptions extends ChainOptions {
  /** Total wall-clock budget for the seed loop (tests use short values). */
  requestBudgetMs?: number;
}

/** Per-refill cache + in-flight dedupe state. */
export interface RadioDeps {
  cache: TtlCache<RadioSuccess>;
  inflight: InflightDedup<RadioResolution>;
  /** Chain options applied to every seed's `runChain` call (tests inject tiers). */
  chainOptions?: RadioOptions;
}

/* ------------------------------------------------------------------ *
 * Curated rotation catalog.
 * ------------------------------------------------------------------ */

/**
 * Phrase pairs an **artist** radio cycles through, one pair per rotation index.
 *
 * These are plain query-text hints — deliberately carrying no chart, ranking,
 * or editorial claim ("popular", not "best of"), and never a third-party
 * playlist id, exactly like the M8 discovery seed catalog. The list is short on
 * purpose so the engine never has to change when it is improved: the
 * composition is `RADIO_PHRASE_CYCLES` pairs, and improving the radio means
 * editing this array.
 *
 * No entry uses a word the shared `filterTracks` bans as an unwanted variant
 * (`remix`, `mashup`, `dj mix`, `live` is allowed but `8d`/`slowed` are not):
 * a seed whose own phrase would be filtered out of every returned title would
 * resolve nothing, and half a rotation cycle that always fails is worse than a
 * short one that never does.
 */
const ARTIST_PHRASE_CYCLES: readonly (readonly [string, string])[] = [
  ["songs", "radio"],
  ["live", "concert"],
  ["acoustic", "unplugged"],
  ["instrumental", "orchestral"],
  ["covers", "tribute"],
  ["popular", "classics"],
  ["new songs", "latest releases"],
  ["full album tracks", "music videos"],
];

/**
 * Phrase pairs a **track** radio cycles through, one pair per rotation index.
 *
 * Written as templates over the track's own public identity — `{anchor}` is
 * `<artist> <title>`, `{title}` and `{artist}` the individual halves — so a
 * track radio stays inside the seed's neighbourhood across every cycle instead
 * of drifting into whatever a single fixed query happened to surface. A missing
 * artist leaves its token empty and the query is whitespace-collapsed, so a
 * title-only identity still composes.
 */
const TRACK_PHRASE_CYCLES: readonly (readonly [string, string])[] = [
  ["{anchor}", "{title} {artist} similar"],
  ["{anchor} live", "{title} {artist} live version"],
  ["{anchor} acoustic", "{title} {artist} acoustic version"],
  ["{anchor} similar songs", "{title} songs similar to this"],
  ["{artist} songs like {title}", "{title} cover version"],
  ["{anchor} instrumental", "{title} {artist} instrumental version"],
  ["{anchor} full album", "{title} {artist} album tracks"],
  ["{artist} songs like {title} popular", "{title} fan favourites"],
];

/**
 * How many distinct rotation cycles the phrase catalogs above can serve. The
 * index wraps, so variant `n` and variant `n % RADIO_PHRASE_CYCLES` plan the
 * same pair: a radio that has been refilled this many times is asking for
 * material the catalog has already been asked for.
 */
export const RADIO_PHRASE_CYCLES = ARTIST_PHRASE_CYCLES.length;

/** The caller's text, trimmed, or `undefined` when it was absent or blank. */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/** Normalized, whitespace-collapsed identifier text for cache keys. */
function normalizedKey(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Trim, collapse whitespace, clip to length, and drop empties/duplicates. */
function normalizeSeedPlan(planned: readonly (string | null)[]): RadioSeed[] {
  const seeds: RadioSeed[] = [];
  const seen = new Set<string>();
  for (const raw of planned) {
    if (raw === null) continue;
    const query = raw.trim().replace(/\s+/g, " ").slice(0, RADIO_SEED_MAX_LENGTH);
    if (query.length === 0) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    seeds.push({ query, label: "radio" });
    if (seeds.length === RADIO_SEED_CAP) break;
  }
  return seeds;
}

/** The rotation index a request asks for, wrapped onto the catalog's range. */
function normalizedVariant(variant: number | undefined): number {
  const raw = variant ?? 0;
  if (!Number.isFinite(raw)) return 0;
  return ((Math.trunc(raw) % RADIO_PHRASE_CYCLES) + RADIO_PHRASE_CYCLES) % RADIO_PHRASE_CYCLES;
}

/** The phrase pair a rotation index selects, wrapping at the catalog's length. */
function cycleAt(variant: number): readonly [string, string] {
  const index =
    ((Math.trunc(variant) % RADIO_PHRASE_CYCLES) + RADIO_PHRASE_CYCLES) % RADIO_PHRASE_CYCLES;
  return ARTIST_PHRASE_CYCLES[index] as readonly [string, string];
}

/** The phrase pair a track rotation index selects, wrapping at the catalog's length. */
function trackCycleAt(variant: number): readonly [string, string] {
  const index =
    ((Math.trunc(variant) % RADIO_PHRASE_CYCLES) + RADIO_PHRASE_CYCLES) % RADIO_PHRASE_CYCLES;
  return TRACK_PHRASE_CYCLES[index] as readonly [string, string];
}

/**
 * Expand a track phrase template over the identity's halves.
 *
 * A token with no identity behind it expands to nothing and the surrounding
 * whitespace is collapsed, so `<title>` alone still composes a clean query
 * rather than one padded with a gap the provider would have to ignore.
 */
function expandPhrase(template: string, title: string, artist: string | undefined): string {
  return template
    .replaceAll("{anchor}", artist === undefined ? title : `${artist} ${title}`)
    .replaceAll("{title}", title)
    .replaceAll("{artist}", artist ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Plan a refill's provider attempts (design decision 2): **at most two** seeds,
 * chosen by rotating a curated phrase list indexed by the caller's `variant`.
 *
 * The function is a pure function of `(kind, identity, variant)`. There is no
 * randomness and no server-held state, so the same identity at the same
 * variant always plans the same pair, and a different variant always plans a
 * different one (up to {@link RADIO_PHRASE_CYCLES} distinct cycles).
 *
 * - an **artist** radio composes `<artist> <phrase>` from the artist cycle;
 * - a **track** radio composes `<artist> <title>`-anchored queries from the
 *   track cycle.
 *
 * A request with no usable identity for its kind plans nothing, which is what
 * lets {@link resolveRadio} report `unresolvable` without contacting anyone.
 */
export function planRadioSeeds(plan: RadioSeedPlan): RadioSeed[] {
  const variant = plan.variant ?? 0;
  const title = present(plan.title);
  const artist = present(plan.artist);

  if (plan.kind === "artist") {
    if (artist === undefined) return [];
    const [first, second] = cycleAt(variant);
    return normalizeSeedPlan([`${artist} ${first}`, `${artist} ${second}`]);
  }

  if (title === undefined) return [];
  const [first, second] = trackCycleAt(variant);
  return normalizeSeedPlan([
    expandPhrase(first, title, artist),
    expandPhrase(second, title, artist),
  ]);
}

/* ------------------------------------------------------------------ *
 * Exclusion.
 * ------------------------------------------------------------------ */

/**
 * Drop every track whose `id` **or** `providerId` appears in `exclude`.
 *
 * Applied after the merge, so it holds identically for every tier and for a
 * result served from the TTL cache. Matching is exact against the caller's
 * opaque id tokens — a canonical `youtube:<videoId>` and a bare `<videoId>` are
 * both matched, because a caller may hold either.
 */
export function applyExclusions(
  tracks: RadioTrack[],
  exclude: readonly string[] = [],
): RadioTrack[] {
  if (exclude.length === 0) return tracks;
  const excluded = new Set(exclude.map((id) => id.trim()).filter((id) => id.length > 0));
  if (excluded.size === 0) return tracks;
  return tracks.filter((track) => !excluded.has(track.id) && !excluded.has(track.providerId));
}

/**
 * The caller's exclusion list as this service will honor it: trimmed, empties
 * dropped, order-independent, and bounded.
 *
 * The bound is a rejection, never a truncation — dropping ids the caller asked
 * to exclude would quietly re-serve already-played tracks, so an over-long
 * list fails the request instead.
 */
function normalizedExclusions(exclude: readonly string[] | undefined): string[] {
  const ids = (exclude ?? []).map((id) => id.trim()).filter((id) => id.length > 0);
  return [...new Set(ids)].sort();
}

/**
 * Cache/dedup key: the whole request (design decision 2), so identical refill
 * requests dedupe and different cycles never collide.
 *
 * The exclusion list is part of the identity — two callers excluding different
 * played sets are different requests, not one cached answer — and it is sorted
 * first so a set sent in a different order still hits the same entry. The
 * variant is stored already wrapped onto the curated cycle, so two variants
 * that plan the *same* pair of seeds (a radio past the end of a cycle) share
 * one entry rather than re-querying an identical question.
 */
export function radioCacheKey(request: RadioRequest): string {
  return `radio:${[
    request.kind,
    normalizedKey(request.title),
    normalizedKey(request.artist),
    normalizedVariant(request.variant),
    request.limit ?? RADIO_TRACK_LIMIT,
    normalizedExclusions(request.exclude).join(","),
  ].join("|")}`;
}

/* ------------------------------------------------------------------ *
 * Composition.
 * ------------------------------------------------------------------ */

/** Empty diagnostics for a request that never reached a provider. */
function freshDiagnostics(): RadioDiagnostics {
  return {
    seedsTried: 0,
    seedsFailed: [],
    seedsSkipped: [],
    tiersTried: [],
    cached: false,
    resultCount: 0,
  };
}

/** A failure that happened before (or instead of) any provider contact. */
function reject(reason: RadioFailureReason): RadioFailure {
  return { ok: false, reason, diagnostics: freshDiagnostics() };
}

/**
 * Whether a resolution that produced nothing should be reported as an upstream
 * failure rather than as an unresolvable identity.
 *
 * `unresolvable` means a provider *answered* and carried nothing usable — the
 * chain records that as a tier `empty` outcome, a different fact from a tier
 * that never answered. Everything else (only transport/parse failures, or no
 * attempt at all because the request budget stopped the loop) is `upstream`,
 * because in that case the identity was never actually tested.
 */
function isUpstreamFailure(diagnostics: RadioDiagnostics): boolean {
  if (diagnostics.tiersTried.length === 0) return true;
  return diagnostics.tiersTried.every(
    (entry) => entry.outcome !== "empty" && entry.outcome !== "ok",
  );
}

/** Classify a seed loop that produced no tracks. */
function reasonFor(diagnostics: RadioDiagnostics, seeds: readonly RadioSeed[]): RadioFailureReason {
  if (seeds.length === 0) return "unresolvable";
  return isUpstreamFailure(diagnostics) ? "upstream" : "unresolvable";
}

/** One seed's chain outcome; a `null` result means the chain itself threw. */
interface SeedAttempt {
  seed: RadioSeed;
  result: Awaited<ReturnType<typeof runChain>> | null;
}

/**
 * Run one refill's planned seeds sequentially through the existing chain and
 * merge them into one canonical track set.
 *
 * Mirrors the catalog service's bound structure exactly: a request-level
 * `AbortSignal.timeout`, the caller's abort folded in with `AbortSignal.any`,
 * at most {@link RADIO_SEED_CONCURRENCY} chains in flight, a per-seed budget of
 * {@link RADIO_SEED_TIMEOUT_MS}, and a plan-ordered merge so neither the
 * diagnostics nor the resulting order depends on which seed settled first. Only
 * caller cancellation escapes; any other per-seed failure degrades into
 * `seedsFailed`, and a seed the request budget stops is reported in
 * `seedsSkipped`.
 */
async function runSeeds(
  seeds: readonly RadioSeed[],
  limit: number,
  signal: AbortSignal | undefined,
  options: RadioOptions,
  diagnostics: RadioDiagnostics,
): Promise<RadioTrack[]> {
  if (seeds.length === 0) return [];

  const seedBudgetMs = options.budgetMs ?? RADIO_SEED_TIMEOUT_MS;
  // The refill's own wall clock: it decides how long this request may keep
  // *starting* seeds, and it is the only reason a planned seed can go
  // unattempted.
  const requestSignal = AbortSignal.timeout(options.requestBudgetMs ?? RADIO_REQUEST_BUDGET_MS);
  // A seed dies with the request, so one slow seed cannot overrun the budget by
  // its own budget on top of it.
  const seedSignal = signal ? AbortSignal.any([signal, requestSignal]) : requestSignal;

  // Indexed by plan position so the merge stays in plan order regardless of
  // which worker finished first: `undefined` means "never attempted".
  const attempts: Array<SeedAttempt | undefined> = new Array<SeedAttempt | undefined>(seeds.length);
  let nextSeed = 0;
  let stopped = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextSeed;
      nextSeed += 1;
      if (index >= seeds.length || stopped) return;
      // The request budget is spent: this seed is never attempted, so it cannot
      // be reported as a provider failure.
      if (requestSignal.aborted) return;
      const seed = seeds[index];
      try {
        attempts[index] = {
          seed,
          result: await runChain(
            { query: seed.query, limit, signal: seedSignal },
            { ...options, budgetMs: seedBudgetMs },
          ),
        };
      } catch (error) {
        // Only caller cancellation escapes the chain; re-throw it so the route
        // can answer 499, and stop the remaining workers from starting seeds.
        if (signal?.aborted) {
          stopped = true;
          throw signal.reason ?? error;
        }
        // This request's own deadline cut the seed short: a budget outcome, not
        // an upstream failure, so it is reported as skipped rather than failed.
        if (requestSignal.aborted) {
          stopped = true;
          return;
        }
        attempts[index] = { seed, result: null };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(RADIO_SEED_CONCURRENCY, seeds.length)) }, () =>
      worker(),
    ),
  );

  const scored: RadioTrack[] = [];
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
      // query the chain used), so a merged refill is ordered exactly like one
      // search result.
      scored.push({ ...track, qualityScore: qualityScore(track, seed.query) });
    }
  }
  diagnostics.seedsTried = seeds.length - diagnostics.seedsSkipped.length;

  return dedupeTracks(sortTracks(filterTracks(scored))).slice(0, limit);
}

const defaultCache = createTtlCache<RadioSuccess>({
  ttlMs: RADIO_CACHE_TTL_MS,
  maxEntries: RADIO_CACHE_MAX_ENTRIES,
});
const defaultInflight = createInflightDedup<RadioResolution>();

/** The process-wide service state the route uses (documented shared state). */
export const defaultRadioDeps: RadioDeps = {
  cache: defaultCache,
  inflight: defaultInflight,
};

/**
 * Resolve one radio refill: plan at most two seeds from the caller's `variant`,
 * run them sequentially through the fixed tier chain, merge, and apply the
 * caller's exclusion list to the merged result.
 *
 * Validation happens **before** any provider contact, so an out-of-bounds
 * request — including an exclusion list longer than
 * {@link RADIO_MAX_EXCLUDE} — is answered `invalid_request` with nothing sent
 * upstream. A request that named no usable identity, or whose every resolved
 * track was excluded, is answered `unresolvable`: the endpoint reports an
 * empty result rather than substituting material outside the requested
 * identity. A request whose every seed exhausted its chain is answered
 * `upstream`.
 *
 * Successes are cached for {@link RADIO_CACHE_TTL_MS} and reported with
 * `cached: true`; failures are never cached, so a retry re-queries upstream.
 * Only caller cancellation throws, so the route can answer 499.
 */
export async function resolveRadio(
  request: RadioRequest,
  deps: RadioDeps = defaultRadioDeps,
): Promise<RadioResolution> {
  if (!RADIO_KINDS.includes(request.kind)) return reject("invalid_request");

  const variant = request.variant;
  if (
    variant !== undefined &&
    (!Number.isInteger(variant) || variant < 0 || variant > RADIO_MAX_VARIANT)
  ) {
    return reject("invalid_request");
  }

  const limit = request.limit ?? RADIO_TRACK_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > RADIO_MAX_LIMIT) {
    return reject("invalid_request");
  }

  // A longer list is rejected, never truncated: silently dropping ids the
  // caller asked to exclude would quietly re-serve already-played tracks.
  const excluded = normalizedExclusions(request.exclude);
  if (
    excluded.length > RADIO_MAX_EXCLUDE ||
    excluded.some((id) => id.length > RADIO_MAX_EXCLUDE_ID_LENGTH)
  ) {
    return reject("invalid_request");
  }

  const title = present(request.title);
  const artist = present(request.artist);
  // No usable identity for the requested kind: nothing to resolve, and nothing
  // may stand in for it.
  if (request.kind === "artist" ? artist === undefined : title === undefined) {
    return reject("unresolvable");
  }

  const key = radioCacheKey(request);
  return deps.inflight.run(key, async () => {
    const cached = deps.cache.get(key);
    if (cached) {
      return { ...cached, diagnostics: { ...cached.diagnostics, cached: true } };
    }

    const diagnostics = freshDiagnostics();
    const seeds = planRadioSeeds({
      kind: request.kind,
      ...(title !== undefined ? { title } : {}),
      ...(artist !== undefined ? { artist } : {}),
      ...(variant !== undefined ? { variant } : {}),
    });
    const merged = await runSeeds(
      seeds,
      limit,
      request.signal,
      deps.chainOptions ?? {},
      diagnostics,
    );
    if (merged.length === 0) {
      return { ok: false, reason: reasonFor(diagnostics, seeds), diagnostics };
    }

    // Excluded after the merge, so it holds for every tier and for a result
    // served from the cache.
    const tracks = applyExclusions(merged, excluded);
    if (tracks.length === 0) {
      // Everything resolved was already played. That is an empty answer, not a
      // reason to serve material outside the requested identity.
      diagnostics.resultCount = 0;
      return { ok: false, reason: "unresolvable", diagnostics };
    }
    diagnostics.resultCount = tracks.length;

    const success: RadioSuccess = {
      ok: true,
      tracks,
      variant: normalizedVariant(variant),
      diagnostics,
    };
    deps.cache.set(key, success);
    return success;
  });
}
