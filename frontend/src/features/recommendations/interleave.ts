import type { Track } from "@/data/repositories";

/**
 * Language mixing for multi-language discovery shelves (spec: `discovery` —
 * "Language mixing in multi-language feeds"; design §4).
 *
 * Ordering is a *presentation* concern, so it lives here as a pure function
 * over the canonical `Track.language` the server stamped from the seed that
 * produced each result (design §3) rather than in the cacheable API. The
 * attribution is not ground truth, which is exactly why this is presentation-
 * only and why the rule has to be deterministic and testable: the same shelf
 * results must always render in the same order.
 */

/** Normalize a language code: trimmed, with blank codes treated as absent. */
function normalizeCode(value: string | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Round-robin a shelf's results across the *selected* languages so no single
 * language dominates the rendered order.
 *
 * One pass takes one track from each selected language, in the order the user
 * selected them, then repeats until every attributed track is placed. Buckets
 * are walked by the selection rather than by their size, so a language that
 * returned only a couple of results still surfaces next to the majority
 * instead of being crowded out behind it; an exhausted language is simply
 * skipped in later passes.
 *
 * With exactly one selected language this degenerates into that language's
 * provider order, which is the spec's single-language case.
 *
 * Tracks whose language is missing, blank, or outside the selection are not
 * dropped and not mixed in: they form one trailing bucket appended in original
 * order (the server may attribute a result to no seed). The result is therefore
 * lossless — every input track appears exactly once, by identity — and the
 * input array is never mutated.
 */
export function interleaveByLanguage(
  tracks: readonly Track[],
  languages: readonly string[],
): Track[] {
  // A repeated code would be walked twice and duplicate its bucket; a blank
  // code would claim a bucket nothing can be attributed to.
  const selected = [...new Set(languages.map(normalizeCode))].filter((code) => code !== "");
  const isSelected = new Set(selected);

  const buckets = new Map<string, Track[]>();
  const unattributed: Track[] = [];
  for (const track of tracks) {
    const language = normalizeCode(track.language);
    if (language === "" || !isSelected.has(language)) {
      unattributed.push(track);
      continue;
    }
    const bucket = buckets.get(language);
    if (bucket === undefined) buckets.set(language, [track]);
    else bucket.push(track);
  }

  const interleaved: Track[] = [];
  // Bounded by the number of attributed tracks: each pass places at least one,
  // and the loop stops on the first pass that places none.
  for (let pass = true; pass;) {
    pass = false;
    for (const language of selected) {
      const next = buckets.get(language)?.shift();
      if (next === undefined) continue;
      interleaved.push(next);
      pass = true;
    }
  }

  return [...interleaved, ...unattributed];
}
