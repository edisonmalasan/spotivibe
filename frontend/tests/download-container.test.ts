import { describe, expect, it } from "vitest";
import { describeAudioFormat, downloadFilename } from "@/server/download/container";

/**
 * Container and codec honesty (M20; spec `download` — "The delivered file is named for what it
 * actually contains").
 *
 * This is the suite that holds ROADMAP §2.5 clause 1 ("Do not implement YouTube-to-MP3") in place
 * for the one place that could break it. The honest behaviour of a download button is to say what
 * it delivered; YouTube's highest-quality audio is most often Opus in a WebM container, so the
 * button's file is most often `.webm`, and the module under test exists to make that the normal
 * case rather than an exception.
 *
 * The tests below are written so that the module's most likely future edits each have a named,
 * failing test: defaulting `unknown` to `.mp3`; trusting a caller's `codec` over the media type's
 * own `codecs=` parameter; deriving the extension from the codec alone rather than from the
 * container; and letting the title through unescaped into a header.
 */

describe("describeAudioFormat", () => {
  it("names a container this application recognises", () => {
    const mapping = describeAudioFormat({ mimeType: 'audio/webm; codecs="opus"' });
    expect(mapping.known).toBe(true);
    if (!mapping.known) throw new Error("expected a known mapping");
    expect(mapping.format).toEqual({
      container: "webm",
      codec: "opus",
      extension: ".webm",
      mime: "audio/webm",
    });
  });

  /**
   * The table, stated rather than sampled.
   *
   * An exhaustive table is the honest form of this test: the claim being made is "these are the
   * only pairs this application will name a file after", and a sampled test cannot make a claim
   * about what it did not look at. Each row also carries the *reason* the extension is what it is,
   * because `.m4a` is the row most likely to be "corrected" later by someone who has forgotten
   * what MP4 with AAC actually is.
   */
  it("maps exactly the documented container/codec pairs", () => {
    const rows: ReadonlyArray<{
      mimeType: string;
      codec?: string;
      container: string;
      codecName: string;
      extension: string;
      mime: string;
      why: string;
    }> = [
      {
        mimeType: 'audio/webm; codecs="opus"',
        container: "webm",
        codecName: "opus",
        extension: ".webm",
        mime: "audio/webm",
        why: "YouTube's default audio-only format. Naming it .mp3 is the canonical lie.",
      },
      {
        mimeType: 'audio/webm; codecs="vorbis"',
        container: "webm",
        codecName: "vorbis",
        extension: ".webm",
        mime: "audio/webm",
        why: "Same container, so the same extension; the codec alone does not name the file.",
      },
      {
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        container: "mp4",
        codecName: "aac",
        extension: ".m4a",
        mime: "audio/mp4",
        why: "AAC in MP4 is an .m4a file, not an .mp3 and not an .mp4.",
      },
      {
        mimeType: 'audio/mp4; codecs="mp4a.6b"',
        container: "mp4",
        codecName: "mp3",
        extension: ".mp3",
        mime: "audio/mp4",
        why: "The one place .mp3 is right inside MP4: the payload really is MP3.",
      },
      {
        mimeType: 'audio/ogg; codecs="opus"',
        container: "ogg",
        codecName: "opus",
        extension: ".opus",
        mime: "audio/ogg",
        why: "Opus in Ogg is its own container, so it is named separately from Opus in WebM.",
      },
      {
        mimeType: "audio/mpeg",
        codec: "mp3",
        container: "mpeg",
        codecName: "mp3",
        extension: ".mp3",
        mime: "audio/mpeg",
        why: "The dedicated legacy stream, which genuinely is MP3 when the extractor says so.",
      },
    ];

    for (const row of rows) {
      const mapping = describeAudioFormat({ mimeType: row.mimeType, codec: row.codec });
      expect(mapping.known, `${row.mimeType} (${row.why})`).toBe(true);
      if (!mapping.known) continue;
      expect(mapping.format.container, row.mimeType).toBe(row.container);
      expect(mapping.format.codec, row.mimeType).toBe(row.codecName);
      expect(mapping.format.extension, `${row.mimeType} (${row.why})`).toBe(row.extension);
      expect(mapping.format.mime, row.mimeType).toBe(row.mime);
    }
  });

  it("never answers .mp3 for Opus in WebM, whatever the casing or parameter order", () => {
    // The exact bytes a provider is most likely to hand over, in the shapes it is most likely to
    // hand them over in. All of them are the same file, and all of them must be `.webm`.
    const variants = [
      'audio/webm; codecs="opus"',
      "audio/webm; codecs=opus",
      'audio/webm;codecs="opus"',
      'AUDIO/WEBM; CODECS="OPUS"',
      '  audio/webm  ;  codecs = "opus"  ',
      'audio/webm; codecs="opus, mp4a.40.2"',
      "audio/webm; codecs=opus; somethingelse=1",
    ];
    for (const mimeType of variants) {
      const mapping = describeAudioFormat({ mimeType });
      expect(mapping.known, mimeType).toBe(true);
      if (!mapping.known) continue;
      expect(mapping.format.extension, `${mimeType} must not be named .mp3`).toBe(".webm");
      expect(mapping.format.extension, mimeType).not.toBe(".mp3");
    }
  });

  it("reads the first codec of a list, because that is the primary stream being named", () => {
    const mapping = describeAudioFormat({ mimeType: 'audio/mp4; codecs="mp4a.40.2, mp4a.6b"' });
    expect(mapping.known).toBe(true);
    if (!mapping.known) throw new Error("expected a known mapping");
    expect(mapping.format.codec).toBe("aac");
    expect(mapping.format.extension).toBe(".m4a");
  });

  it("takes an explicitly reported codec at its word, because an extractor that knows it says so", () => {
    // ytdl and Invidious both report the codec separately from the media type. Re-deriving it here
    // would be second-guessing a value the caller had direct access to.
    const mapping = describeAudioFormat({ mimeType: "audio/webm", codec: "opus" });
    expect(mapping.known).toBe(true);
    if (!mapping.known) throw new Error("expected a known mapping");
    expect(mapping.format).toMatchObject({ container: "webm", codec: "opus", extension: ".webm" });
  });

  describe("refusals, each of which must stay a refusal", () => {
    it("refuses a media type it does not recognise", () => {
      for (const mimeType of [
        "audio/flac",
        "audio/wav",
        "audio/aiff",
        "video/webm",
        "application/octet-stream",
        "audio/webm-ish",
        "webm",
        "",
        "   ",
      ]) {
        const mapping = describeAudioFormat({ mimeType });
        expect(mapping.known, `${mimeType} must not be named`).toBe(false);
        if (mapping.known) continue;
        expect(mapping.reason).not.toBe("");
      }
    });

    it("refuses a recognised container whose codec it cannot tell apart", () => {
      // `audio/webm` alone is genuinely ambiguous: the container carries either Vorbis or Opus, and
      // the extension is the same for both, but this module refuses rather than assuming, because
      // the same rule has to hold for a pair where the extension would differ.
      for (const mimeType of ["audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg"]) {
        const mapping = describeAudioFormat({ mimeType });
        expect(mapping.known, `${mimeType} without a codec must be refused`).toBe(false);
        if (!mapping.known) expect(mapping.reason).toMatch(/codec/i);
      }
    });

    it("refuses a codec it does not recognise", () => {
      for (const codec of ["dsd", "alac", "pcm_s16le", "ec-3", ""]) {
        const mapping = describeAudioFormat({ mimeType: "audio/webm", codec });
        expect(mapping.known, `${codec} must not be named`).toBe(false);
      }
    });

    it("refuses a real pair it declines to offer, rather than falling back to a neighbour", () => {
      // Vorbis in an Ogg container is understood but not offered. The tempting fallback is `.ogg`,
      // which is arguably right and is not this application's decision to make; the other
      // fallback, `.webm`, would be actively wrong.
      const mapping = describeAudioFormat({ mimeType: 'audio/ogg; codecs="vorbis"' });
      expect(mapping.known).toBe(false);
      if (mapping.known) throw new Error("expected a refusal");
      expect(mapping.reason).toMatch(/not offered/i);
    });

    it("refuses an absent media type with a reason that says so", () => {
      for (const input of [{}, { mimeType: undefined }, { codec: "opus" }]) {
        const mapping = describeAudioFormat(input);
        expect(mapping.known).toBe(false);
        if (!mapping.known) expect(mapping.reason).toMatch(/no media type/i);
      }
    });
  });

  /**
   * The property the whole module exists for.
   *
   * Exhaustive over the table rather than sampled: `.mp3` must be reachable from a media type only
   * when the codec is genuinely MP3. If a future row is added to `TABLE` without the test noticing,
   * this still holds — and if a row is added whose extension is `.mp3` for a non-MP3 codec, this
   * fails with the pair's name rather than with "something is wrong somewhere".
   */
  it("answers .mp3 only when the payload really is MP3", () => {
    const observed: Array<{ input: string; extension: string; codec: string }> = [];
    const mediaTypes = [
      "audio/webm",
      "audio/mp4",
      "audio/ogg",
      "audio/mpeg",
      "audio/flac",
      "audio/wav",
    ];
    const codecs = ["opus", "vorbis", "mp4a.40.2", "mp4a.6b", "aac", "mp3", "flac", "pcm_s16le"];
    for (const mimeType of mediaTypes) {
      for (const codec of codecs) {
        const mapping = describeAudioFormat({ mimeType, codec });
        if (mapping.known) observed.push({ input: `${mimeType} / ${codec}`, ...mapping.format });
      }
    }

    expect(observed.length, "the sweep must actually reach known mappings").toBeGreaterThan(5);
    for (const row of observed) {
      if (row.extension !== ".mp3") continue;
      expect(row.codec, `${row.input} is named .mp3, so its codec must be mp3`).toBe("mp3");
    }
    // And stated positively, because "never .mp3 unless mp3" alone would also be satisfied by a
    // table that named nothing at all.
    const mp3Rows = observed.filter((row) => row.extension === ".mp3");
    expect(mp3Rows.map((row) => row.input).sort()).toEqual([
      "audio/mp4 / mp3",
      "audio/mp4 / mp4a.6b",
      "audio/mpeg / mp3",
      "audio/mpeg / mp4a.6b",
    ]);
  });

  it("is pure: the same input always gives the same output, and no input is mutated", () => {
    const input = { mimeType: 'audio/webm; codecs="opus"' };
    const first = describeAudioFormat(input);
    const second = describeAudioFormat(input);
    expect(second).toEqual(first);
    expect(input).toEqual({ mimeType: 'audio/webm; codecs="opus"' });
  });

  it("does not fall back to a guess when the container is unknown", () => {
    // The specific failure mode this module was written to prevent: an unrecognised container
    // defaulting to `.mp3` on the reasoning that a download button producing anything else looks
    // broken. Asserted as a property over every unknown input, not as one example.
    const unknown = ["audio/flac", "audio/wav", "audio/x-flac", "application/ogg", "", "nonsense"];
    for (const mimeType of unknown) {
      const mapping = describeAudioFormat({ mimeType, codec: "mp3" });
      expect(mapping.known, `${mimeType} must be refused even when the codec is known`).toBe(false);
    }
  });
});

describe("downloadFilename", () => {
  it("appends the extension it was given, and never one of its own", () => {
    expect(downloadFilename("Bohemian Rhapsody", ".webm")).toBe("Bohemian-Rhapsody.webm");
    expect(downloadFilename("track", ".mp3")).toBe("track.mp3");
  });

  it("keeps letters, numbers, spaces, and dashes, and replaces everything else", () => {
    expect(downloadFilename("Track #1 (Remastered)", ".m4a")).toBe("Track-1-Remastered.m4a");
    expect(downloadFilename("AC/DC — Back in Black", ".webm")).toBe("ACDC-Back-in-Black.webm");
    expect(downloadFilename("100% Pure", ".opus")).toBe("100-Pure.opus");
  });

  it("collapses runs of dashes, because the sanitiser can produce them", () => {
    expect(downloadFilename("a  ---  b", ".webm")).toBe("a-b.webm");
    expect(downloadFilename("a - , - b", ".webm")).toBe("a-b.webm");
  });

  it("falls back to a name of its own when the title sanitises to nothing", () => {
    for (const title of ["", "   ", "***", "!!!", "---"]) {
      expect(downloadFilename(title, ".webm")).toBe("track.webm");
    }
  });

  it("cannot be made to emit a path separator, a quote, or a newline", () => {
    // The stem ends up inside a `Content-Disposition` header the browser writes to disk. A quote
    // breaks the header; a separator produces a file in a directory the listener did not choose;
    // a newline is header injection. None of them may survive.
    const hostile = [
      "../../etc/passwd",
      'a"b',
      "a\\b",
      "a\nb",
      "a\r\nContent-Type: text/html",
      'x"; filename="evil.mp3',
      "‮gnp.exe",
      "a\u0000b",
      "%2e%2e%2f",
    ];
    for (const title of hostile) {
      const name = downloadFilename(title, ".webm");
      expect(name, `${JSON.stringify(title)} produced ${name}`).not.toMatch(/[/\\]/);
      expect(name, `${JSON.stringify(title)} produced ${name}`).not.toMatch(/["\r\n]/);
      expect(name.endsWith(".webm"), name).toBe(true);
      // The one thing it is allowed to contain is the extension it was handed, at the end.
      expect(name.slice(0, -".webm".length)).not.toMatch(/\./);
    }
  });

  it("bounds the stem so a title cannot become a very long filename", () => {
    const name = downloadFilename("a".repeat(500), ".webm");
    expect(name.length).toBeLessThanOrEqual(80 + ".webm".length);
    expect(name.endsWith(".webm")).toBe(true);
  });

  it("is deterministic", () => {
    const title = "Sigur Rós — Hoppípolla";
    expect(downloadFilename(title, ".opus")).toBe(downloadFilename(title, ".opus"));
    // …and stable across a normalisation-sensitive round trip, which matters because the browser
    // writes this exact string to the filesystem.
    expect(downloadFilename(title.normalize("NFC"), ".opus")).toBe(
      downloadFilename(title, ".opus"),
    );
  });

  it("leaves non-Latin titles usable rather than empty", () => {
    // The sanitiser keeps `\p{L}`, so a CJK or Cyrillic title survives as itself. An earlier
    // ASCII-only version would have produced "track.opus" for every such track, which is a
    // functional download but a useless filename.
    expect(downloadFilename("千本桜", ".webm")).toBe("千本桜.webm");
    expect(downloadFilename("Композитор", ".opus")).toBe("Композитор.opus");
  });
});
