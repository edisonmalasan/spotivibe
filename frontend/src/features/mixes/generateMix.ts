import type { MixRecord, NewMix, Track } from "@/data/repositories";
import { getLocalData } from "@/data/localData";
import {
  fetchDiscoveryFeed,
  type DiscoveryFeed,
  type DiscoveryError,
} from "@/features/home/discoveryApi";
import { buildTasteProfile, type TasteProfile } from "@/features/personalization/tasteProfile";
import { localDayKey } from "@/features/insights/buildStats";
import { deriveMixName } from "@/features/mixes/mixNaming";

/**
 * Smart Mix generation (M11; spec: `mixes` — "Smart Mix generation", design
 * decisions 4 and 5).
 *
 * A mix is composed from the provider feed the product **already has** — the M8
 * discovery `mix` kind — across a bounded number of rounds seeded by the local
 * profile. No new route, no new provider capability, and nothing derived from the
 * listener beyond the seed terms the feed already accepts (the M10
 * `personalization` contract: the profile ranks locally, the request carries the
 * identity).
 *
 * Every bound here exists so a mix cannot spend unbounded provider work: rounds
 * are capped, each round asks for a page, and a round that yields nothing new
 * ends generation rather than retrying.
 */

/** Roadmap target: "20+ track target where provider data supports it". */
export const MIX_TARGET_TRACKS = 20;
/** How many feed rounds generation may spend trying to reach the target. */
export const MIX_MAX_ROUNDS = 3;
/** Tracks requested per round; one page per round is the whole cost model. */
export const MIX_ROUND_LIMIT = 20;
/** How many recently played tracks exclude a candidate. */
export const MIX_EXCLUDE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type MixOutcome =
  | { status: "created"; mix: MixRecord }
  /** The local profile holds no taste signal, so there is nothing to build from. */
  | { status: "no-signal" }
  /** The feed produced nothing usable (not a provider error — a real answer). */
  | { status: "empty" }
  | { status: "unavailable"; message: string };

export interface GenerateMixInput {
  profile: TasteProfile;
  languages: readonly string[];
  /** Track ids played within `MIX_EXCLUDE_WINDOW_MS`; never leaves the device. */
  playedIds?: readonly string[];
  /** `now`, supplied so the mix's period and the recency window are testable. */
  now: number;
  /** Ids already in the mix being refreshed, so a refresh adds rather than repeats. */
  existingIds?: readonly string[];
  /** How many feed rounds to spend (bounded by `MIX_MAX_ROUNDS`). */
  maxRounds?: number;
  signal?: AbortSignal;
  /** Injected for tests; defaults to the real discovery feed. */
  fetchFeed?: (request: Parameters<typeof fetchDiscoveryFeed>[0]) => Promise<DiscoveryFeed>;
}

/** The identity key a mix is generated under, so a refresh finds the same mix. */
export function mixIdentityKey(seeds: readonly string[], period: string): string {
  const normalized = seeds.map((seed) => seed.trim().toLowerCase()).filter((seed) => seed !== "");
  return `mix:${period}:${normalized.slice(0, 4).join("|")}`;
}

/** Tracks played inside the recency window, as a candidate filter. */
function recentlyPlayedIds(
  events: readonly { trackId: string; playedAt: number }[],
  now: number,
): Set<string> {
  const cutoff = now - MIX_EXCLUDE_WINDOW_MS;
  return new Set(events.filter((event) => event.playedAt >= cutoff).map((event) => event.trackId));
}

/** A composed but not yet persisted mix. */
export interface MixDraft {
  name: string;
  generatedAt: number;
  period: string;
  seeds: string[];
  tracks: Track[];
}

type ComposeOutcome =
  | { status: "composed"; draft: MixDraft }
  | { status: "no-signal" }
  | { status: "empty" }
  | { status: "unavailable"; message: string };

/**
 * Collect the tracks for a mix. Composition is deliberately **separate from
 * persistence**: `generateMix` composes and creates, while `refreshMix` composes
 * and patches an existing record. Without that split a refresh would write a
 * brand-new record first and patch it second — briefly replacing the very name
 * the refresh is required to preserve, and resurrecting a mix that had been
 * deleted in the meantime.
 */
async function composeMix(input: GenerateMixInput): Promise<ComposeOutcome> {
  // Decision 5: no signal, no mix. M10's `hasSignal` already ignores a mere
  // default language, so this is not "a fresh install with one language".
  if (!input.profile.hasSignal) return { status: "no-signal" };

  const seeds = input.profile.seedTerms.slice(0, 4);
  if (seeds.length === 0) return { status: "no-signal" };

  const rounds = Math.max(1, Math.min(input.maxRounds ?? MIX_MAX_ROUNDS, MIX_MAX_ROUNDS));
  const fetchFeed = input.fetchFeed ?? fetchDiscoveryFeed;

  let data: Awaited<ReturnType<typeof getLocalData>> | undefined;
  try {
    data = await getLocalData();
  } catch {
    // Local storage being unavailable is not a provider failure; the mix simply
    // cannot be persisted, and a mix that cannot be persisted has no identity.
    return { status: "unavailable", message: "Local data is unavailable." };
  }
  const events = await data.listeningHistory.list();
  const excluded = new Set([...recentlyPlayedIds(events, input.now), ...(input.existingIds ?? [])]);

  const collected: Track[] = [];
  const seen = new Set<string>();
  const perRound = Math.ceil(MIX_TARGET_TRACKS / rounds);
  for (let round = 0; round < rounds; round += 1) {
    let feed: DiscoveryFeed;
    try {
      // Each round is a different *page* of the same profile-seeded feed, capped
      // by what the previous rounds already collected: no new capability, no
      // unbounded spend, and a round that adds nothing ends generation.
      const already = collected.length;
      feed = await fetchFeed({
        kind: "mix",
        languages: input.languages,
        seeds,
        limit: Math.max(1, Math.min(MIX_ROUND_LIMIT, perRound + already)),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (error: unknown) {
      const failure = error as Partial<DiscoveryError>;
      if (collected.length > 0) break;
      return { status: "unavailable", message: failure.message ?? "The mix could not be built." };
    }
    const before = collected.length;
    for (const track of feed.tracks) {
      if (collected.length >= MIX_TARGET_TRACKS) break;
      if (seen.has(track.id) || excluded.has(track.id)) continue;
      seen.add(track.id);
      collected.push(track);
    }
    // No new material in this round: another identical request would not help.
    if (collected.length === before) break;
  }

  if (collected.length === 0) return { status: "empty" };

  return {
    status: "composed",
    draft: {
      name: deriveMixName({ tracks: collected, profile: input.profile }),
      generatedAt: input.now,
      period: localDayKey(input.now),
      seeds,
      tracks: collected,
    },
  };
}

/**
 * Build a mix from the local profile, or explain why there is nothing to build.
 *
 * `no-signal` is deliberately distinct from `unavailable`: with no taste signal
 * a "mix" would be a trending feed wearing the listener's name, and saying
 * "nothing to build from yet" is the honest answer.
 */
export async function generateMix(input: GenerateMixInput): Promise<MixOutcome> {
  const outcome = await composeMix(input);
  if (outcome.status !== "composed") return outcome;
  const data = await getLocalData();
  const mix: NewMix = {
    id: mixIdentityKey(outcome.draft.seeds, outcome.draft.period),
    ...outcome.draft,
    updatedAt: outcome.draft.generatedAt,
  };
  return { status: "created", mix: await data.mixes.create(mix) };
}

/**
 * Refresh a mix: the same identity and name, contents re-derived.
 *
 * Returns `undefined` when the mix no longer exists — a refresh is not a
 * creation, because recreating it would hand the listener a *different* mix under
 * a name they already recognize. The stored record is the source of truth for
 * that decision, not the `mix` the caller happens to be holding, which may be a
 * stale copy from before a delete or a concurrent refresh.
 */
export async function refreshMix(
  mix: MixRecord,
  input: Omit<GenerateMixInput, "existingIds">,
): Promise<MixRecord | undefined> {
  const data = await getLocalData();
  const existing = await data.mixes.get(mix.id);
  if (existing === undefined) return undefined;

  const outcome = await composeMix({
    ...input,
    existingIds: existing.tracks.map((track) => track.id),
  });
  // A refresh that cannot get new material leaves the mix exactly as it was: an
  // empty or unresolvable answer is not a reason to empty somebody's mix.
  if (outcome.status !== "composed") return undefined;

  // `name` and `generatedAt` are intentionally not part of the refresh patch:
  // the identity *and* the name the listener recognizes both survive a refresh,
  // even when the new contents would name the mix differently.
  return data.mixes.refresh(mix.id, {
    tracks: outcome.draft.tracks,
    seeds: outcome.draft.seeds,
    period: outcome.draft.period,
  });
}

/** Build the taste profile a mix is generated from, from the local datasets. */
export async function buildMixProfile(now: number): Promise<TasteProfile | null> {
  const data = await getLocalData();
  const [liked, events, preferences] = await Promise.all([
    data.likedTracks.list(),
    data.listeningHistory.list(),
    data.preferences.get(),
  ]);
  return buildTasteProfile({
    likedTracks: liked.map((record) => record.track),
    events,
    languages: preferences.languages,
    now,
  });
}
