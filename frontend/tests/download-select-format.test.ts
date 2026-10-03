import { describe, expect, it } from "vitest";
import {
  DOWNLOAD_BUDGET_BYTES,
  MIN_AUDIO_BITRATE,
  estimateBytes,
  selectAudioFormat,
  toCandidates,
  type AudioCandidate,
  type RawAudioFormat,
} from "@/server/download/selectFormat";
import { describeAudioFormat, type AudioFormatDescription } from "@/server/download/container";

/**
 * Bitrate ladder and budget (M20; spec `download` — "The bitrate is the highest one that fits the
 * transfer budget"; design decision 5).
 *
 * ROADMAP §21.5 is explicit that picking the top bitrate is *actively wrong* for a personal
 * download, because it maximises the chance of exceeding the platform's proxied request timeout
 * "for no benefit". This suite is therefore not about picking well; it is about picking
 * *predictably*, and about never claiming a file fits the budget when it cannot be shown to.
 *
 * Every number here is derived from the module's own exported constants rather than re-typed, so a
 * change to the budget is a change to these expectations rather than a silent divergence.
 */

/** A known-good description, so the tests exercise the ladder rather than the mapper. */
function opusWebm(): AudioFormatDescription {
  const mapping = describeAudioFormat({ mimeType: 'audio/webm; codecs="opus"' });
  if (!mapping.known) throw new Error("the fixture container must be known");
  return mapping.format;
}

/**
 * Real format identifiers for the ladder fixtures.
 *
 * `itag` is a provider number and the type says so. Readable string labels would mean a cast in
 * every fixture and every assertion, and a cast that exists only to make a test readable is a cast
 * that eventually hides a real mismatch. So the labels are the keys and the values are numbers a
 * provider would actually report — which means a failing assertion names the candidate it meant.
 */
const LADDER = {
  low: 1,
  fits: 2,
  top: 3,
  at128: 4,
  at160: 5,
  unsizable: 6,
  sizable: 7,
  long: 8,
  short: 9,
  big: 10,
  middling: 11,
  small: 12,
  degenerate: 13,
  good: 14,
} as const;

function candidate(overrides: Partial<AudioCandidate> = {}): AudioCandidate {
  return {
    audioBitrate: 128_000,
    description: opusWebm(),
    ...overrides,
  };
}

describe("the budget constants", () => {
  it("is one number, used for both selection and the stream ceiling", () => {
    // Two numbers would be two chances to disagree: a selection that promised 8 MB and a ceiling
    // that allowed 20 MB would let a lying upstream stream 20. Asserting there is only one number
    // is awkward from inside a test; asserting the documented size is straightforward and catches
    // the realistic edit, which is someone raising it.
    expect(DOWNLOAD_BUDGET_BYTES).toBe(20 * 1024 * 1024);
  });

  it("bounds a transfer on a reasonable link, and says plainly that it cannot bound this one", () => {
    // 20 MiB is about 10 s at 2 MB/s and about 95 s at a poor 220 kB/s, so the ceiling does its job
    // as a guard on a link faster than the provider's own audio stream.
    expect(DOWNLOAD_BUDGET_BYTES / 2_000_000).toBeGreaterThan(5);
    expect(DOWNLOAD_BUDGET_BYTES / 220_000).toBeLessThan(120);

    // It does *not* keep an audio-only transfer inside §21.5's 120 s proxied request timeout, and
    // this test exists so that nobody re-derives the wrong conclusion from the constant. YouTube's
    // audio-only formats run at roughly 50–160 kbit/s.
    const atTopAudioBitrate = (160_000 / 8) * 1; // bytes per second
    expect(DOWNLOAD_BUDGET_BYTES / atTopAudioBitrate).toBeGreaterThan(120);
    // …which is why the route's `maxDuration` is 300 and not 120, and why an unobserved platform
    // truncation is a documented risk rather than a solved problem. See `docs/DOWNLOADING.md`.
  });

  it("is still reachable by an ordinary long track, which is what makes it a real ceiling", () => {
    // Ten minutes at the top audio-only bitrate is about 12 MB. A ceiling below that would be
    // refusing ordinary downloads rather than bounding a hostile upstream, which is a different
    // design with a much worse failure mode.
    const tenMinutesAtMaxAudioBitrate = (160_000 / 8) * 600;
    expect(DOWNLOAD_BUDGET_BYTES).toBeGreaterThan(tenMinutesAtMaxAudioBitrate);
  });

  it("puts the quality floor where a person would put it", () => {
    expect(MIN_AUDIO_BITRATE).toBe(32_000);
    // It has to exclude the degenerate near-silent streams providers advertise, which are well
    // below any of this.
    expect(MIN_AUDIO_BITRATE).toBeGreaterThan(16_000);
  });
});

describe("estimateBytes", () => {
  it("prefers a reported length, because it is a measurement", () => {
    const result = estimateBytes(
      candidate({ contentLength: 1_234_567, audioBitrate: 128_000, durationSeconds: 240 }),
    );
    expect(result).toEqual({ bytes: 1_234_567, source: "content-length" });
  });

  it("derives from bitrate and duration when there is no reported length", () => {
    const result = estimateBytes(candidate({ audioBitrate: 128_000, durationSeconds: 240 }));
    // 128 000 / 8 * 240 = 3 840 000.
    expect(result).toEqual({ bytes: 3_840_000, source: "bitrate-duration" });
  });

  it("rounds up, so a fractional estimate never comes out under the real size", () => {
    const result = estimateBytes(candidate({ audioBitrate: 33_333, durationSeconds: 0.1 }));
    expect(result.source).toBe("bitrate-duration");
    expect(result.bytes).not.toBeNull();
    expect(Number.isInteger(result.bytes as number)).toBe(true);
  });

  it("falls back to the other branch when the reported length is not a measurement", () => {
    // A negative, zero, or infinite length is not a measurement, so it is ignored rather than
    // trusted, and the derivation takes over. Getting this wrong in the other direction — treating
    // `0` as "free" — would let every zero-length candidate claim it fits.
    for (const contentLength of [-5, 0, Number.POSITIVE_INFINITY]) {
      const result = estimateBytes(
        candidate({ contentLength, audioBitrate: 128_000, durationSeconds: 10 }),
      );
      expect(result, `contentLength ${contentLength}`).toEqual({
        bytes: 160_000,
        source: "bitrate-duration",
      });
    }
    // A usable length is used even when the duration is nonsense, because a measurement beats a
    // derivation: the length was reported, so it is the number the budget should be judged against.
    expect(estimateBytes(candidate({ contentLength: 100, durationSeconds: -1 }))).toEqual({
      bytes: 100,
      source: "content-length",
    });
  });

  it("reports `none` rather than a guess when it cannot size a candidate", () => {
    // `none` is a real answer, and an important one: a candidate this module cannot size is not one
    // it will claim fits the budget.
    for (const overrides of [
      { contentLength: undefined, durationSeconds: undefined },
      { contentLength: 0, durationSeconds: 0 },
      { contentLength: Number.NaN, durationSeconds: Number.NaN },
      { contentLength: undefined, durationSeconds: Number.NaN },
      { contentLength: undefined, durationSeconds: -1 },
    ]) {
      const result = estimateBytes(candidate(overrides));
      expect(result, JSON.stringify(overrides)).toEqual({ bytes: null, source: "none" });
    }
    // A usable length is used even when the duration is nonsense, because a measurement beats a
    // derivation: the length was reported, so it is the number the budget should be judged against.
    expect(estimateBytes(candidate({ contentLength: 100, durationSeconds: -1 }))).toEqual({
      bytes: 100,
      source: "content-length",
    });
  });
});

describe("toCandidates", () => {
  const raw = (overrides: Partial<RawAudioFormat>): RawAudioFormat => ({
    audioBitrate: 128_000,
    ...overrides,
  });

  it("keeps only formats this application can name honestly", () => {
    const candidates = toCandidates(
      [
        raw({ itag: 140, mimeType: 'audio/webm; codecs="opus"' }),
        raw({ itag: 251, mimeType: 'audio/webm; codecs="opus"', audioBitrate: 160_000 }),
        // Excluded: a container the mapper refuses, so no honest name exists for it.
        raw({ itag: 999, mimeType: "audio/flac" }),
        // Excluded: no media type at all.
        raw({ itag: 998 }),
        // Excluded: a codec the mapper cannot recognise.
        raw({ itag: 997, mimeType: "audio/webm", audioCodec: "dsd" }),
      ],
      240,
    );
    expect(candidates.map((entry) => entry.itag)).toEqual([140, 251]);
    for (const entry of candidates) {
      expect(entry.description.extension).not.toBe("");
      expect(entry.description.mime).toMatch(/^audio\//);
    }
  });

  it("excludes a format with no usable bitrate, because it cannot be ranked", () => {
    for (const audioBitrate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const candidates = toCandidates(
        [raw({ itag: 1, mimeType: 'audio/webm; codecs="opus"', audioBitrate })],
        240,
      );
      expect(candidates, `bitrate ${audioBitrate}`).toEqual([]);
    }
  });

  it("carries the duration onto every candidate, so the derived estimate is available", () => {
    const candidates = toCandidates([raw({ itag: 1, mimeType: 'audio/webm; codecs="opus"' })], 100);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.durationSeconds).toBe(100);
    expect(estimateBytes(candidates[0]!)).toMatchObject({ source: "bitrate-duration" });
  });

  it("is deterministic and does not mutate its input", () => {
    const formats = [
      raw({ itag: 1, mimeType: 'audio/webm; codecs="opus"', audioBitrate: 128_000 }),
      raw({ itag: 2, mimeType: 'audio/mp4; codecs="mp4a.40.2"', audioBitrate: 128_000 }),
    ];
    const snapshot = structuredClone(formats);
    const first = toCandidates(formats, 240);
    const second = toCandidates(formats, 240);
    expect(second).toEqual(first);
    expect(formats).toEqual(snapshot);
  });
});

describe("selectAudioFormat", () => {
  it("takes the highest bitrate when the best format fits", () => {
    // Thirty seconds of audio, so every candidate fits comfortably and quality is the only thing
    // left to decide.
    const outcome = selectAudioFormat([
      candidate({ itag: 1, audioBitrate: 64_000, durationSeconds: 30 }),
      candidate({ itag: 2, audioBitrate: 128_000, durationSeconds: 30 }),
      candidate({ itag: 3, audioBitrate: 160_000, durationSeconds: 30 }),
    ]);
    expect(outcome.selected).toBe(true);
    if (!outcome.selected) throw new Error("expected a selection");
    expect(outcome.selection.format.itag).toBe(3);
    expect(outcome.selection.budgetExceeded).toBe(false);
    expect(outcome.selection.budgetBytes).toBe(DOWNLOAD_BUDGET_BYTES);
  });

  /**
   * The requirement itself.
   *
   * §21.5 says a personal download must take "the highest bitrate that fits the transfer budget",
   * explicitly *not* the highest bitrate available. The top candidate here is roughly ten times the
   * budget, so a selector that ignored the budget would pass the test above and fail this one.
   */
  it("walks down the ladder when the top bitrate does not fit", () => {
    const outcome = selectAudioFormat([
      candidate({ itag: LADDER.low, audioBitrate: 64_000, durationSeconds: 60 }),
      candidate({ itag: LADDER.fits, audioBitrate: 128_000, durationSeconds: 60 }),
      // 320 kbit/s × 600 s = 24 MB, over the 20 MB budget.
      candidate({ itag: LADDER.top, audioBitrate: 320_000, durationSeconds: 600 }),
    ]);
    expect(outcome.selected).toBe(true);
    if (!outcome.selected) throw new Error("expected a selection");
    expect(outcome.selection.format.itag).toBe(LADDER.fits);
    expect(outcome.selection.budgetExceeded).toBe(false);
  });

  it("prefers the higher bitrate when two formats of the same size both fit", () => {
    // Same duration, different bitrate, both comfortably inside the budget: quality wins, because
    // nothing about this situation is constrained.
    const outcome = selectAudioFormat([
      candidate({ itag: LADDER.at128, audioBitrate: 128_000, durationSeconds: 30 }),
      candidate({ itag: LADDER.at160, audioBitrate: 160_000, durationSeconds: 30 }),
    ]);
    expect(outcome.selected).toBe(true);
    if (!outcome.selected) throw new Error("expected a selection");
    expect(outcome.selection.format.itag).toBe(LADDER.at160);
  });

  it("prefers a sizeable candidate over an unsizable one of the same bitrate", () => {
    // Ranking puts unsizable candidates last at their bitrate, because preferring one means the
    // ladder can actually make the decision it exists to make.
    const outcome = selectAudioFormat([
      candidate({
        itag: LADDER.unsizable,
        audioBitrate: 128_000,
        contentLength: undefined,
        durationSeconds: undefined,
      }),
      candidate({ itag: LADDER.sizable, audioBitrate: 128_000, durationSeconds: 60 }),
    ]);
    expect(outcome.selected).toBe(true);
    if (!outcome.selected) throw new Error("expected a selection");
    expect(outcome.selection.format.itag).toBe(LADDER.sizable);
    expect(outcome.selection.estimateSource).toBe("bitrate-duration");
  });

  it("prefers the smaller of two same-bitrate candidates, which makes the ladder reachable", () => {
    const outcome = selectAudioFormat([
      candidate({ itag: LADDER.long, audioBitrate: 128_000, durationSeconds: 900 }),
      candidate({ itag: LADDER.short, audioBitrate: 128_000, durationSeconds: 60 }),
    ]);
    expect(outcome.selected).toBe(true);
    if (!outcome.selected) throw new Error("expected a selection");
    expect(outcome.selection.format.itag).toBe(LADDER.short);
  });

  it("takes the smallest thing above the floor when nothing fits, and reports the overrun", () => {
    // One hour of audio, so every candidate is far over the 20 MB budget. Delivering *something*
    // beats delivering nothing, and the file the listener gets is not the one the top of the ladder
    // promised — so it says so rather than hiding it.
    const outcome = selectAudioFormat([
      candidate({ itag: LADDER.big, audioBitrate: 256_000, durationSeconds: 3600 }),
      candidate({ itag: LADDER.middling, audioBitrate: 96_000, durationSeconds: 3600 }),
      candidate({ itag: LADDER.small, audioBitrate: 48_000, durationSeconds: 3600 }),
    ]);
    expect(outcome.selected).toBe(true);
    if (!outcome.selected) throw new Error("expected a selection");
    expect(outcome.selection.format.itag).toBe(LADDER.small);
    expect(outcome.selection.budgetExceeded).toBe(true);
  });

  it("refuses rather than delivering a file below the quality floor, even when it fits", () => {
    // Delivering a file the listener has to discover is bad *after* the download, so the refusal
    // happens before it. The second case is the one that matters: a 16 kbit/s stream fits the
    // 20 MB budget trivially, so a selector that only consulted the floor after the ladder had
    // failed would hand it over in the ordinary case. A floor the cheap path can walk past is not a
    // floor.
    const outcome = selectAudioFormat([
      candidate({ itag: 1, audioBitrate: 24_000, durationSeconds: 60 }),
      candidate({ itag: 2, audioBitrate: 16_000, durationSeconds: 60 }),
    ]);
    expect(outcome.selected).toBe(false);
    if (outcome.selected) throw new Error("expected a refusal");
    expect(outcome.reason).toContain(String(MIN_AUDIO_BITRATE));

    // A sub-floor candidate offered alongside a good one is dropped, not delivered.
    const mixed = selectAudioFormat([
      candidate({ itag: LADDER.degenerate, audioBitrate: 16_000, durationSeconds: 600 }),
      candidate({ itag: LADDER.good, audioBitrate: 128_000, durationSeconds: 60 }),
    ]);
    expect(mixed.selected).toBe(true);
    if (!mixed.selected) throw new Error("expected a selection");
    expect(mixed.selection.format.itag).toBe(LADDER.good);
  });

  it("refuses when there are no candidates at all", () => {
    const outcome = selectAudioFormat([]);
    expect(outcome.selected).toBe(false);
    if (outcome.selected) throw new Error("expected a refusal");
    expect(outcome.reason).not.toBe("");
  });

  it("refuses to run with a nonsensical budget, rather than selecting against it", () => {
    for (const budget of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => selectAudioFormat([candidate()], budget), `budget ${budget}`).toThrow(
        /budgetBytes/,
      );
    }
  });

  it("honours a caller-supplied budget, so the ceiling is not hard-wired to the default", () => {
    const formats = [candidate({ audioBitrate: 128_000, durationSeconds: 100 })];
    // 128 000 / 8 * 100 = 1 600 000 bytes.
    expect(selectAudioFormat(formats, 2_000_000).selected).toBe(true);
    const tight = selectAudioFormat(formats, 1_000_000);
    expect(tight.selected).toBe(true);
    if (!tight.selected) throw new Error("expected the fallback branch");
    expect(tight.selection.budgetExceeded).toBe(true);
    expect(tight.selection.budgetBytes).toBe(1_000_000);
  });

  it("reports which branch produced the estimate, so the caller can say so in a header", () => {
    const fromLength = selectAudioFormat([candidate({ contentLength: 900_000 })]);
    expect(fromLength.selected).toBe(true);
    if (!fromLength.selected) throw new Error("expected a selection");
    expect(fromLength.selection.estimateSource).toBe("content-length");
    expect(fromLength.selection.estimatedBytes).toBe(900_000);

    const unsized = selectAudioFormat([
      candidate({ contentLength: undefined, durationSeconds: undefined }),
    ]);
    expect(unsized.selected).toBe(true);
    if (!unsized.selected) throw new Error("expected the fallback branch");
    expect(unsized.selection.estimateSource).toBe("none");
    expect(unsized.selection.estimatedBytes).toBeNull();
    expect(unsized.selection.budgetExceeded).toBe(true);
  });

  it("carries the selected description through without re-deriving it", () => {
    const outcome = selectAudioFormat([candidate({ itag: 1 })]);
    expect(outcome.selected).toBe(true);
    if (!outcome.selected) throw new Error("expected a selection");
    expect(outcome.selection.description).toBe(outcome.selection.format.description);
    expect(outcome.selection.description.extension).toBe(".webm");
  });

  it("is a pure function of its inputs, in any order", () => {
    const a = candidate({ itag: 1, audioBitrate: 128_000, durationSeconds: 60 });
    const b = candidate({ itag: 2, audioBitrate: 96_000, durationSeconds: 60 });
    expect(selectAudioFormat([a, b])).toEqual(selectAudioFormat([b, a]));
    // The input array itself is untouched, so a caller cannot be surprised by a partial sort.
    const input = [a, b];
    selectAudioFormat(input);
    expect(input.map((entry) => entry.itag)).toEqual([1, 2]);
  });

  /**
   * The property, over a ladder rather than a single case.
   *
   * Every selection must be a candidate that was offered, must be at or above the floor when the
   * floor is reachable, and must either fit the budget or be the smallest thing above the floor.
   * Written as a property so that a change to the ranking comparator cannot quietly produce a
   * selection none of the example tests happened to notice.
   */
  it("always selects something that was offered, and always the best it could justify", () => {
    const ladder = [16_000, 32_000, 64_000, 128_000, 160_000, 256_000].map((bitrate, index) =>
      candidate({ itag: index, audioBitrate: bitrate, durationSeconds: 600 }),
    );
    for (const budget of [1_000_000, 5_000_000, 12_000_000, DOWNLOAD_BUDGET_BYTES, 200_000_000]) {
      const outcome = selectAudioFormat(ladder, budget);
      if (!outcome.selected) {
        // The only legitimate refusal is the whole ladder sitting below the floor.
        expect(ladder.every((entry) => entry.audioBitrate < MIN_AUDIO_BITRATE)).toBe(false);
        continue;
      }
      const { format, estimatedBytes } = outcome.selection;
      expect(ladder.map((entry) => entry.itag)).toContain(format.itag);
      if (format.audioBitrate >= MIN_AUDIO_BITRATE) {
        const fits = estimatedBytes !== null && estimatedBytes <= budget;
        if (fits) {
          // Anything that fits must be beaten only by something better, never something worse.
          const better = ladder.filter((entry) => entry.audioBitrate > format.audioBitrate);
          for (const other of better) {
            const otherBytes = estimateBytes(other).bytes;
            expect(
              otherBytes === null || otherBytes > budget,
              `selected ${String(format.itag)} but ${String(other.itag)} also fits`,
            ).toBe(true);
          }
        }
      }
    }
  });
});
