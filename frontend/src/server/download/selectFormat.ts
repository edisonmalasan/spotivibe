/**
 * Choosing *which* audio format to download (M20; spec `download` — "The bitrate is the highest
 * one that fits the transfer budget").
 *
 * Pure and synchronous. No network, no provider, no clock. That is the point: the decision that
 * decides what the listener ends up holding on their disk is the decision most worth being able to
 * test exhaustively, and it must not need a network to test.
 *
 * ## Highest *suitable*, not highest available
 *
 * ROADMAP §21.5 is unusually explicit that picking the top bitrate is **actively wrong** here: it
 * "maximises the chance of exceeding the 120 s proxy timeout for no benefit to a personal
 * download". So the ladder is walked from the top and the first candidate that fits is taken. A
 * thirty-second clip therefore still gets the best format available, while a long one walks down
 * rather than being handed a file that dies halfway through a proxy timeout.
 *
 * ## One number governs selection and the stream ceiling
 *
 * `DOWNLOAD_BUDGET_BYTES` is both the size selection fits *within* and the ceiling the stream is
 * cancelled *at*. Two numbers would be two chances to disagree: a selection that promised 8 MB and
 * a ceiling that allowed 20 MB would let a lying upstream stream 20. One number cannot disagree with
 * itself. Read the constant's own documentation before changing its value — it explains what the
 * number does and does not bound, which is not obvious from the arithmetic.
 */

import { describeAudioFormat, type AudioFormatDescription } from "./container";

/**
 * The ceiling, in bytes, for one downloaded track.
 *
 * ## What this number can and cannot do
 *
 * 20 MiB is 10 s of transfer at 2 MB/s and 95 s at a poor 220 kB/s, so it comfortably bounds a
 * download on a *reasonable* link. It does **not** bound one on the link this route actually uses:
 * YouTube's audio-only formats run at roughly 50–160 kbit/s, which is 6–20 kB/s, and at those rates
 * 20 MiB is 17 minutes of transfer. A ten-minute track at the top audio bitrate is about 12 MB, so
 * the ceiling is reachable by an ordinary long track rather than only by a pathological one.
 *
 * That is stated here rather than glossed because ROADMAP §21.5's own table calls Vercel's 120 s
 * proxied request timeout "the real ceiling", and this number does not fit inside it at realistic
 * audio-only bitrates. The consequences are:
 *
 * - `maxDuration = 300` in the route is the ceiling this design actually bets on, not 120 s.
 * - A transfer that runs past the platform's own limit is cut by the platform, not by anything in
 *   this repository, and that is reported to the listener as a failed download rather than as a
 *   completed file — the byte ceiling here cancels the stream and errors the body, and a truncated
 *   platform response does the same thing at the socket. The listener does not get a short file that
 *   looks whole.
 * - **Neither number has been observed.** Both the production origin and every Preview origin sit
 *   behind Vercel Deployment Protection, so §21.5's figures are documented constraints this code is
 *   designed against, not measurements. See `frontend/docs/DOWNLOADING.md`.
 *
 * What the ceiling *is* good for: bounding what a hostile or broken upstream can push into a
 * function instance, and keeping the ordinary case well clear of the platform limit on a link that
 * is faster than the provider's own audio stream. A ceiling that is not reachable in practice is a
 * ceiling that protects against the wrong threat; 20 MiB is reachable enough to do that job and
 * large enough that it is not the routine constraint.
 */
export const DOWNLOAD_BUDGET_BYTES = 20 * 1024 * 1024;

/**
 * Below this bitrate a download is not worth delivering.
 *
 * 32 kbit/s is the bottom of what anyone would choose to keep, and it is high enough to exclude the
 * degenerate formats a provider occasionally advertises for streams that are effectively silent.
 *
 * The floor is applied to **every** branch, not only to the "nothing fitted" fallback. That is the
 * obvious place for it — a fallback is where quality is being sacrificed — and it is the wrong place
 * on its own: a 16 kbit/s format fits the budget trivially, so a selector that only checked the floor
 * after the ladder had failed would happily deliver the degenerate stream in the common case. A
 * quality floor that the cheap path can walk past is not a floor.
 */
export const MIN_AUDIO_BITRATE = 32_000;

/** The shape both extractors are normalised into before selection sees them. */
export interface RawAudioFormat {
  /** Provider format identifier, carried through for the extractor's own use. Never used to rank. */
  itag?: number | undefined;
  /** The media type as the provider wrote it, e.g. `audio/webm; codecs="opus"`. */
  mimeType?: string | undefined;
  /** The codec, when the extractor reports it separately from the media type. */
  audioCodec?: string | undefined;
  /** Audio bitrate in bits per second. */
  audioBitrate: number;
  /** Reported size in bytes, when the extractor knows one. */
  contentLength?: number | undefined;
}

/** One candidate, reduced to what selection actually reads. */
export interface AudioCandidate {
  /** Provider format identifier. Carried through for the extractor's own use; not used to rank. */
  readonly itag?: number | undefined;
  /** Audio bitrate in bits per second. */
  readonly audioBitrate: number;
  /** Reported size in bytes, when the extractor knows one. */
  readonly contentLength?: number | undefined;
  /** Track duration in seconds, used when there is no reported size. */
  readonly durationSeconds?: number | undefined;
  /** What the container/codec mapping made of this format. Already filtered to `known: true`. */
  readonly description: AudioFormatDescription;
}

/** Where an estimate came from, so a test can prove both branches were exercised. */
export type EstimateSource = "content-length" | "bitrate-duration" | "none";

/**
 * Estimate a candidate's size.
 *
 * The reported content length when there is one, because that is a measurement rather than a
 * derivation. Otherwise bitrate × duration, which is arithmetic about the same stream and is close
 * enough for a budget decision. `none` when neither is available, and `none` is a real answer: a
 * candidate this module cannot size is not one it will claim fits.
 */
export function estimateBytes(candidate: AudioCandidate): {
  bytes: number | null;
  source: EstimateSource;
} {
  const reported = candidate.contentLength;
  if (typeof reported === "number" && Number.isFinite(reported) && reported > 0) {
    return { bytes: Math.ceil(reported), source: "content-length" };
  }
  const duration = candidate.durationSeconds;
  const bitrate = candidate.audioBitrate;
  if (
    typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration > 0 &&
    typeof bitrate === "number" &&
    Number.isFinite(bitrate) &&
    bitrate > 0
  ) {
    return { bytes: Math.ceil((bitrate / 8) * duration), source: "bitrate-duration" };
  }
  return { bytes: null, source: "none" };
}

/**
 * Reduce an extractor's formats to candidates, dropping anything this application will not name a
 * file after.
 *
 * Filtering here is what makes the selector's input honest by construction: it can only ever choose
 * between files whose names are already true, so no later stage can accidentally select a format
 * with no honest name.
 *
 * @param formats the extractor's formats
 * @param durationSeconds the track's duration, feeding the bitrate-derived estimate
 */
export function toCandidates(
  formats: readonly RawAudioFormat[],
  durationSeconds: number | undefined,
): AudioCandidate[] {
  const candidates: AudioCandidate[] = [];
  for (const format of formats) {
    const mapping = describeAudioFormat({
      mimeType: format.mimeType,
      codec: format.audioCodec,
    });
    if (!mapping.known) continue;
    if (!Number.isFinite(format.audioBitrate) || format.audioBitrate <= 0) continue;
    candidates.push({
      itag: format.itag,
      audioBitrate: format.audioBitrate,
      contentLength: format.contentLength,
      durationSeconds,
      description: mapping.format,
    });
  }
  return candidates;
}

/**
 * Rank candidates best-first.
 *
 * Bitrate descending, then **sizability ascending with unsizable last** — a candidate whose size
 * can be checked is preferred to one of the same bitrate whose size cannot, because preferring it
 * means the ladder can actually make the decision it is built to make. `Array.prototype.sort` is
 * stable, so equal candidates keep their input order and the result is deterministic.
 */
function rank(candidates: readonly AudioCandidate[]): AudioCandidate[] {
  return [...candidates].sort((a, b) => {
    if (b.audioBitrate !== a.audioBitrate) return b.audioBitrate - a.audioBitrate;
    const aBytes = estimateBytes(a).bytes;
    const bBytes = estimateBytes(b).bytes;
    // `null` sorts after every number, so an unsizable candidate is the last choice at its bitrate.
    if (aBytes === null && bBytes !== null) return 1;
    if (bBytes === null && aBytes !== null) return -1;
    if (aBytes !== null && bBytes !== null && aBytes !== bBytes) return aBytes - bBytes;
    return 0;
  });
}

export interface SelectionResult {
  readonly format: AudioCandidate;
  /** The selected format's honest file description. Never re-derived. */
  readonly description: AudioFormatDescription;
  /** What the selection believes the file weighs, or `null` when it could not be sized. */
  readonly estimatedBytes: number | null;
  /** Which branch produced the estimate. */
  readonly estimateSource: EstimateSource;
  /** The ceiling the selection was made against. */
  readonly budgetBytes: number;
  /**
   * Whether the budget was exceeded.
   *
   * True only on the fallback branch, and deliberately surfaced rather than logged: the caller sends
   * it in a response header, and the file the listener gets is not the one the top of the ladder
   * promised. A download that quietly gave them less is worse than one that says so.
   */
  readonly budgetExceeded: boolean;
}

export type SelectionOutcome =
  { selected: true; selection: SelectionResult } | { selected: false; reason: string };

/**
 * Select the highest suitable candidate, walking the ladder down.
 *
 * 0. Drop everything below {@link MIN_AUDIO_BITRATE}. Quality is a precondition, not a preference
 *    the budget competes with.
 * 1. Rank what is left best-first.
 * 2. Take the first whose estimated size fits the budget.
 * 3. If nothing fits, take the **lowest** bitrate still above the floor — the smallest thing worth
 *    delivering — and report the overrun.
 * 4. If nothing was above the floor to begin with, refuse. Delivering a file below the floor is
 *    worse than delivering none, because the listener has to discover that themselves after the
 *    download.
 *
 * @param budgetBytes the ceiling; defaults to {@link DOWNLOAD_BUDGET_BYTES}
 */
export function selectAudioFormat(
  candidates: readonly AudioCandidate[],
  budgetBytes: number = DOWNLOAD_BUDGET_BYTES,
): SelectionOutcome {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) {
    throw new Error(`budgetBytes must be a positive finite number, got ${budgetBytes}`);
  }
  const aboveFloor = candidates.filter((format) => format.audioBitrate >= MIN_AUDIO_BITRATE);
  if (aboveFloor.length === 0) {
    return {
      selected: false,
      reason:
        candidates.length === 0
          ? "no audio format was offered for this track"
          : `every audio format offered is below ${MIN_AUDIO_BITRATE} bit/s`,
    };
  }

  const ranked = rank(aboveFloor);
  const describe = (format: AudioCandidate, budgetExceeded: boolean): SelectionResult => {
    const estimate = estimateBytes(format);
    return {
      format,
      description: format.description,
      estimatedBytes: estimate.bytes,
      estimateSource: estimate.source,
      budgetBytes,
      budgetExceeded,
    };
  };

  for (const format of ranked) {
    const { bytes } = estimateBytes(format);
    // A candidate this module cannot size is not one it will claim fits. It may still be reached by
    // the fallback branch below, which reports the overrun rather than hiding it.
    if (bytes !== null && bytes <= budgetBytes) {
      return { selected: true, selection: describe(format, false) };
    }
  }

  // Nothing fits. Take the smallest thing above the floor rather than the largest, because the
  // constraint that produced this branch is a ceiling and the intent is to deliver something.
  const smallest = ranked[ranked.length - 1];
  if (smallest !== undefined) {
    return { selected: true, selection: describe(smallest, true) };
  }

  // Unreachable in practice: `aboveFloor` was non-empty, so `ranked` is too. Present anyway
  // because an unreachable `return undefined` is what turns a future edit into a runtime crash.
  return { selected: false, reason: "no audio format could be selected" };
}
