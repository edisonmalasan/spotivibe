import type { TasteProfile } from "@/features/personalization/tasteProfile";
import { isHonestMixName, NEUTRAL_MIX_NAME } from "@/features/mixes/mixNaming";
import { languageName, normalizeLanguageCodes } from "@/lib/languages";

/**
 * Named mix identities for Home (M17; spec: `home-mixes` — "Mix cards start
 * playback and name honestly"; `mixes` — "Mix identity and naming"; design
 * decisions 1 and 2).
 *
 * A card is a **view over a mix the one generator produces**: this module holds
 * an identity, its seed strategy, and its honest name, and nothing else. The
 * tracks arrive from `generateMix` on activation, so a Home that renders six
 * cards composes nothing (spec: "Cards are not composed on render").
 *
 * Two properties are structural here rather than left to review:
 *
 * 1. **A seed strategy is a profile.** `generateMix` takes a `TasteProfile` and
 *    reads `profile.seedTerms`, so an identity here *cannot* be anything other
 *    than a choice of seed terms over the listener's own profile. There is no
 *    second composer to disagree with the Smart Mixes shelf, and no identity can
 *    smuggle a request shape past the shared generator.
 * 2. **A name is a taste claim, never a clock claim.** A card's only evidence
 *    before it is composed is the term its strategy leads with, so that term is
 *    the name — gated by `isHonestMixName`, falling back to `NEUTRAL_MIX_NAME`.
 *    This is why the cards are *not* called "Top Mix": `isHonestMixName("Top
 *    Mix")` is false by construction ("top" is a ranking word), so a card may
 *    claim the taste it can support and nothing more. The identity is still
 *    `top`; only its display name is honest.
 *
 * Pure and deterministic: the same profile and languages always yield the same
 * plans, in the same order, and no input is mutated.
 */

/** The four named identities, in the order their cards are presented. */
export const NAMED_MIX_KINDS = ["top", "discovery", "chill", "night"] as const;

export type NamedMixKind = (typeof NAMED_MIX_KINDS)[number];

/** Either the four named identities or a per-language card. */
export type MixCardKind = NamedMixKind | "language";

/**
 * How many seed terms one strategy may contribute.
 *
 * `generateMix` reads at most four (`profile.seedTerms.slice(0, 4)`), so a longer
 * strategy would be silently truncated; bounding it here keeps the strategy and
 * the generator in agreement instead of leaving one to discover the other's
 * ceiling.
 */
export const MAX_MIX_CARD_SEEDS = 4;

/**
 * How many per-language cards are offered at most.
 *
 * Spelled out rather than left to whatever the preference list happens to contain
 * (spec: "Language mixes are bounded"). The catalog allows eight selected
 * languages, and a language card's own term is a *word*, which competes with the
 * other cards for the same row — six of them would bury the named cards rather
 * than extend them.
 */
export const MAX_LANGUAGE_MIX_CARDS = 2;

/**
 * The calmer half of the shared genre lexicon, as `chill` reads it.
 *
 * Keys of `features/personalization/tasteProfile`'s lexicon — deliberately not a
 * second vocabulary. A card may only ask for a mood the rest of the app already
 * recognises, which is the same reason `bandSelectsTrack` matches through that
 * lexicon instead of a text matcher of its own.
 */
const CALM_GENRE_KEYS: readonly string[] = [
  "ambient",
  "classical",
  "jazz",
  "new age",
  "soul",
  "neon soul",
  "folk",
  "reggae",
];

/** The darker half of the same lexicon, for `night`. */
const NIGHT_GENRE_KEYS: readonly string[] = [
  "ambient",
  "classical",
  "electronic",
  "house",
  "metal",
  "heavy metal",
  "punk",
  "classic rock",
  "jazz",
];

/** One named mix card: its identity, the name it may claim, and its seed strategy. */
export interface MixCardIdentity {
  /** Stable id — the card's `data-mix-id` and its React key. */
  readonly id: string;
  /** Which strategy this card runs. */
  readonly kind: MixCardKind;
  /**
   * The card's display name: its leading taste word as a mix name, or
   * `NEUTRAL_MIX_NAME` when that word would claim more than the mix knows.
   */
  readonly name: string;
  /** The taste word the strategy leads with — the card's own evidence. */
  readonly term: string;
  /** The single language a language card is scoped to; absent otherwise. */
  readonly language?: string;
}

/** A card identity plus the profile its strategy resolves to. */
export interface MixCardPlan {
  readonly identity: MixCardIdentity;
  /** The seed strategy, as the profile `generateMix` will be handed. */
  readonly profile: TasteProfile;
}

/** One strategy's output: the terms it selects, and any language it is scoped to. */
interface Strategy {
  readonly terms: string[];
  readonly language?: string;
}

/**
 * A readable label for a lowercase lexicon key: `"k-pop"` → `"K-Pop"`,
 * `"neon soul"` → `"Neon Soul"`. Deliberately local rather than a shared export
 * from `mixNaming`: the naming rule there is about what a mix may be *called*,
 * and a second capitalisation rule is not worth a cross-feature dependency.
 */
function titleCase(key: string): string {
  return key.replace(/(^|[\s-])([a-z])/gu, (_match, separator: string, letter: string) => {
    return separator + letter.toUpperCase();
  });
}

/**
 * The name a leading taste word earns: `"Aurora mix"`, or the neutral label when
 * that word would claim a ranking or an editorial selection.
 *
 * The check is why this function exists: a strategy's leading term is the only
 * evidence a card has before it is composed, and `isHonestMixName` is the gate
 * that keeps the name from outrunning it.
 */
function nameForTerm(term: string): string {
  const name = `${titleCase(term)} mix`;
  return isHonestMixName(name) ? name : NEUTRAL_MIX_NAME;
}

/** Trim, cap, and dedupe — the bounds `generateMix` would apply anyway. */
function boundedTerms(raw: readonly string[]): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (terms.length === MAX_MIX_CARD_SEEDS) break;
    const term = value.trim();
    const identity = term.toLowerCase();
    if (term === "" || seen.has(identity)) continue;
    seen.add(identity);
    terms.push(term);
  }
  return terms;
}

/**
 * The profile handed to the generator: the same profile with different seed
 * terms, and nothing else.
 *
 * `hasSignal`, the weights, and the genre order are deliberately untouched — a
 * strategy chooses *what to ask for*, never *whether there is anything to build
 * from*, so a cold device still gets M11's "no signal, no mix" and the stored
 * mix's own name still comes from the listener's genre weights.
 */
function withSeedTerms(profile: TasteProfile, terms: readonly string[]): TasteProfile {
  return { ...profile, seedTerms: boundedTerms(terms) };
}

/**
 * What one named identity asks for.
 *
 * Each strategy reads a different slice of the *same* profile, which is what
 * makes agreement between these cards and the Smart Mixes shelf structural: they
 * cannot disagree about taste, because they are all reading it out of one
 * derivation. `chill` and `night` are the two that may legitimately select
 * nothing — a listener whose profile has no calm or dark genre has no honest
 * material for either card.
 */
function strategyFor(kind: NamedMixKind, profile: TasteProfile): Strategy {
  const genres = profile.genres.map((entry) => entry.key);
  switch (kind) {
    case "top":
      return { terms: profile.seedTerms };
    case "discovery":
      return { terms: genres };
    case "chill":
      return { terms: genres.filter((key) => CALM_GENRE_KEYS.includes(key)) };
    case "night":
      return { terms: genres.filter((key) => NIGHT_GENRE_KEYS.includes(key)) };
  }
}

/** A named card's identity, given the terms its strategy selects. */
function identityFor(kind: NamedMixKind, terms: readonly string[]): MixCardIdentity {
  const term = terms[0] ?? "";
  return {
    id: kind,
    kind,
    name: term === "" ? NEUTRAL_MIX_NAME : nameForTerm(term),
    term,
  };
}

/** A language card's identity: the language's own name is the honest label. */
function languageIdentity(code: string): MixCardIdentity {
  const label = languageName(code);
  const name = nameForTerm(label);
  return { id: `language:${code}`, kind: "language", name, term: label, language: code };
}

/**
 * The cards Home offers for a profile and a language selection.
 *
 * A card appears only when its strategy actually selects a term. That is the
 * shelf-level half of "an empty mix is explained rather than silently inert": a
 * card with no seed could only ever answer "no signal", so it is not offered in
 * the first place — and the composition-time explanation below it still covers
 * the case that genuinely arises, where the signal disappears between rendering
 * the card and activating it.
 *
 * The named cards come first and are never displaced: the language bound is
 * applied to the language cards alone, so a listener with eight selected
 * languages still gets the same four named cards.
 */
export function mixCardPlans(input: {
  /** The local profile every strategy is derived from. */
  profile: TasteProfile;
  /** The selected catalog language codes, normalized through the shared catalog. */
  languages: readonly string[];
}): MixCardPlan[] {
  // A plan whose profile carries no taste signal could only ever answer "no
  // signal", so no plan is derived at all. Deciding it here rather than in each
  // surface means a caller cannot offer a card it knows cannot compose — and the
  // language cards, whose own term comes from the preference rather than from
  // taste, are held to the same rule as the named ones.
  if (!input.profile.hasSignal) return [];

  const plans: MixCardPlan[] = [];

  for (const kind of NAMED_MIX_KINDS) {
    const terms = boundedTerms(strategyFor(kind, input.profile).terms);
    if (terms.length === 0) continue;
    plans.push({
      identity: identityFor(kind, terms),
      profile: withSeedTerms(input.profile, terms),
    });
  }

  const codes = normalizeLanguageCodes(input.languages);
  const languages = codes.slice(0, MAX_LANGUAGE_MIX_CARDS);
  for (const code of languages) {
    const identity = languageIdentity(code);
    plans.push({ identity, profile: withSeedTerms(input.profile, [identity.term]) });
  }

  return plans;
}
