/**
 * Container and codec honesty (M20; spec `download` — "The delivered file is named for what it
 * actually contains").
 *
 * One pure function turns the media type an extractor reported into the extension and MIME type
 * the listener's browser will be told about. It is the only place in the application that decides
 * what a downloaded file is called, and it exists because the obvious shortcut is a lie.
 *
 * ## Why this module is worth its own file
 *
 * The shortcut is `filename = "track.mp3"`, because that is what a download button is expected to
 * produce and because every extractor advertises several containers. A track downloaded from
 * YouTube at the highest quality is, most of the time, **Opus in a WebM container**. Naming that
 * `.mp3` writes a file that some players will refuse, that others will play, and that lies to
 * whoever opens the folder. ROADMAP §2.5's clause "Do not implement YouTube-to-MP3" is permanent,
 * and this function is where that clause is kept rather than restated.
 *
 * ## Unknown is a failure, not a guess
 *
 * A container this table does not cover returns `unknown` and the route refuses. The tempting
 * alternative is to default to `.mp3`, on the reasoning that a download button that does not
 * deliver an MP3 looks broken. That reasoning is what produces the mislabelled file: an
 * unrecognised container is far more likely to be something exotic than it is to be MP3, and
 * refusing costs one 502 while guessing costs a file on someone's disk that is not what its name
 * says.
 *
 * ## Pure, and never guesses from an extension
 *
 * There are no imports and no I/O, so every claim above is testable without a network, a provider,
 * or a browser. The container comes from the media type's own `type/subtype`; the codec comes from
 * the `codecs=` parameter. They are read separately because `audio/webm` names a container that can
 * carry either Vorbis or Opus, and only the second fact distinguishes them.
 */

/** Containers this application is willing to name a file after. */
export type AudioContainer = "webm" | "mp4" | "ogg" | "mpeg";

/** The audio codecs this application can tell apart inside those containers. */
export type AudioCodec = "opus" | "vorbis" | "aac" | "mp3";

export interface AudioFormatDescription {
  /** The container the bytes are actually in. */
  container: AudioContainer;
  /** The codec the bytes are actually encoded with. */
  codec: AudioCodec;
  /** The file extension, including the dot, derived from the container and codec. */
  extension: string;
  /** The media type to serve, derived from the container. */
  mime: string;
}

/**
 * What this module can and cannot say about a media type.
 *
 * A discriminated union rather than an optional field, so "we know the container but not the
 * codec" and "we do not know what this is" are different states in the type — and only the first
 * is still honest enough to serve.
 */
export type AudioFormatMapping =
  { known: true; format: AudioFormatDescription } | { known: false; reason: string };

/** What an extractor hands over: the media type as the provider wrote it, plus the codec separately. */
export interface MediaTypeInput {
  /** e.g. `audio/webm` or `audio/webm; codecs="opus"`. */
  mimeType?: string | undefined;
  /** e.g. `opus`, `mp4a.40.2`, `vorbis`. Optional, because not every extractor reports it. */
  codec?: string | undefined;
}

/**
 * Strip parameters off a media type.
 *
 * `audio/webm; codecs="opus"` is a media type with a parameter, not a media type. Splitting on `;`
 * is the whole of RFC 9110's parameter handling that this application needs, and doing it here
 * means no caller has to remember.
 */
function baseType(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return base;
}

/**
 * The codec, from the `codecs=` parameter when the extractor did not split it out.
 *
 * Only consulted when the caller gave no codec of its own. A caller that *did* pass one is taken at
 * its word, because an extractor that knows the codec says so rather than re-deriving it.
 */
function codecFromMediaType(mimeType: string): string | undefined {
  const match = /;\s*codecs\s*=\s*"?([^";]+)"?/i.exec(mimeType);
  const value = match?.[1]?.trim().toLowerCase();
  if (value === undefined || value === "") return undefined;
  // A codecs parameter may list several, e.g. `mp4a.40.2, mp4a.6b`. The first is the primary
  // stream this file is being named after.
  return (value.split(",")[0] ?? "").trim();
}

/**
 * Recognise an audio codec from the vocabulary the two extractors actually emit.
 *
 * The substrings are deliberately short and deliberately partial, because the identifiers are
 * dotted and versioned (`mp4a.40.2`, `mp4a.6b`) and pinning them whole would miss a format the day
 * the provider renumbers one.
 */
function recogniseCodec(raw: string | undefined): AudioCodec | undefined {
  if (raw === undefined) return undefined;
  const codec = raw.trim().toLowerCase();
  if (codec === "") return undefined;
  // Order matters: `mp4a` covers AAC (`mp4a.40.2`) and MP3-in-MP4 (`mp4a.6b`), so the two
  // distinguishing prefixes are tested before the generic `mp4a`.
  if (codec.startsWith("mp4a.6b") || codec.startsWith("mp3")) return "mp3";
  if (codec.startsWith("mp4a") || codec.startsWith("aac")) return "aac";
  if (codec.startsWith("opus")) return "opus";
  if (codec.startsWith("vorbis")) return "vorbis";
  return undefined;
}

/**
 * The table.
 *
 * Every row is a container/codec pair this application will name a file after. `mpeg` as a
 * *container* is only reachable from a `audio/mpeg` media type, which is rare for adaptive audio
 * and common for the dedicated legacy stream — and which genuinely is MP3, so it is the one place
 * `.mp3` is honest.
 */
const TABLE: Record<
  AudioContainer,
  { mime: string; byCodec: Partial<Record<AudioCodec, string>> }
> = {
  webm: { mime: "audio/webm", byCodec: { opus: ".webm", vorbis: ".webm" } },
  mp4: { mime: "audio/mp4", byCodec: { aac: ".m4a", mp3: ".mp3" } },
  ogg: { mime: "audio/ogg", byCodec: { opus: ".opus" } },
  mpeg: { mime: "audio/mpeg", byCodec: { mp3: ".mp3" } },
};

/**
 * Map a media type to the file it should be delivered as.
 *
 * Returns `known: false` — never a guess — for a container this application does not recognise or a
 * recognised container whose codec it cannot tell apart. Callers turn that into a structured
 * failure; see the module header for why.
 */
export function describeAudioFormat(input: MediaTypeInput): AudioFormatMapping {
  const mimeType = input.mimeType?.trim();
  if (mimeType === undefined || mimeType === "") {
    return { known: false, reason: "the extractor reported no media type" };
  }

  const base = baseType(mimeType);
  const codec = recogniseCodec(input.codec ?? codecFromMediaType(mimeType));

  const container: AudioContainer | undefined = (Object.keys(TABLE) as AudioContainer[]).find(
    (candidate) => TABLE[candidate].mime === base,
  );

  if (container === undefined) {
    return { known: false, reason: `unrecognised media type "${base}"` };
  }
  if (codec === undefined) {
    return { known: false, reason: `unrecognised audio codec in "${base}"` };
  }

  const extension = TABLE[container].byCodec[codec];
  if (extension === undefined) {
    // A real pair this application declines to name, e.g. Vorbis in an Ogg container: the codec is
    // understood and the combination is uncommon, so it is refused rather than guessed at.
    return { known: false, reason: `${codec} in a ${container} container is not offered` };
  }

  return {
    known: true,
    format: { container, codec, extension, mime: TABLE[container].mime },
  };
}

/**
 * The sanitised *stem* of a download filename, with no extension.
 *
 * Split out from {@link downloadFilename} so the two `Content-Disposition` halves can be built from
 * one sanitiser rather than by stripping a suffix off a finished string: the `filename` half is
 * ASCII-only by specification and the `filename*` half is not, so they legitimately differ, and
 * string surgery to recover the stem from the combined name would be a guess about where the title
 * ended and the extension began.
 *
 * Note that `\p{L}` is Unicode-wide, so this stem may contain Greek, Cyrillic, CJK or Arabic. That
 * is correct for `filename*` and wrong for `filename`; see {@link asciiDispositionFilename}.
 *
 * @param title the track title, used only as the stem
 */
export function downloadStem(title: string): string {
  const stem = title
    .normalize("NFKD")
    // Anything that is not a letter, a number, a space, or a dash collapses to a single dash.
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    // Leading and trailing dashes, last. A title like `" #1 Song "` sanitises to `"-1-Song-"`, and
    // a title that was nothing but punctuation sanitises to `"-"` — a filename of `-.webm` that
    // every browser shows as `.webm` and the listener cannot identify. Trimming here is what lets
    // the `track` fallback below mean "the title carried no usable characters".
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/^-+|-+$/g, "");
  return stem === "" ? "track" : stem;
}

/**
 * A download filename for a track, built from the *selected* format.
 *
 * The extension comes from {@link describeAudioFormat} and from nowhere else. The stem is
 * sanitised rather than trusted: a title is caller-visible text that ends up in a header the
 * browser writes to disk, and a quote or a path separator in it would either break the header or
 * produce a filename the listener did not ask for.
 *
 * @param title the track title, used only as the stem
 * @param extension the extension from the selected format, including the dot
 */
export function downloadFilename(title: string, extension: string): string {
  return `${downloadStem(title)}${extension}`;
}

/**
 * The `filename` half of a `Content-Disposition`, as opposed to the `filename*` half.
 *
 * The distinction is not cosmetic and it is not a style choice. RFC 6266's `filename` parameter is
 * **latin1**, while `filename*` is UTF-8 and percent-encoded. A browser reads whichever it
 * understands, so a name has to survive both: the true one in `filename*`, and something legal in
 * `filename`.
 *
 * This function exists because of a real failure. `downloadFilename` keeps every `\p{L}`, which is
 * Unicode-wide, so a Greek, Cyrillic, CJK or Arabic title produced a stem such as `Ωmega-Track` —
 * perfectly valid, and carried correctly in the `filename*` half. But the `filename="…"` half is
 * emitted **raw**, and `new Response(body, { headers })` coerces header values to `ByteString`,
 * which throws on any character above U+00FF. The result was a `TypeError` before a single byte was
 * sent, so every listener whose track title was not Latin-1 got a 500 on every download. Existing
 * tests missed it because their fixture title, `Sigur Rós`, happens to be Latin-1: NFKD already
 * decomposes `ó` to `o` plus a combining mark, and the mark is stripped.
 *
 * So: decompose as far as Unicode will go, drop the combining marks, and whatever is *still* not
 * ASCII has no ASCII spelling — drop it rather than guess at a transliteration. Greek `Ω` becomes
 * nothing, which is ugly but honest; a wrong transliteration would silently write the wrong name to
 * disk. `filename*` still carries the full title for any browser that reads it.
 *
 * @param stem the stem from {@link downloadFilename}, which may contain any script
 * @param extension the extension from the selected format, including the dot — always ASCII, and
 *   re-appended *after* stripping so that a fully non-Latin title does not collapse to a filename of
 *   just `.webm`, which every browser shows as hidden and the listener cannot identify
 * @returns an ASCII-only name, falling back to `track` if no usable stem survives
 */
export function asciiDispositionFilename(stem: string, extension: string): string {
  const ascii = stem
    .normalize("NFKD")
    // Combining marks are what NFKD leaves behind after decomposing an accented Latin letter. They
    // are not letters in their own right, and every one of them is non-ASCII.
    .replace(/\p{M}/gu, "")
    // Anything left is a script with no ASCII spelling. Removed, then the leftover separators
    // collapsed so a title that was entirely non-Latin does not become a run of dashes.
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${ascii === "" ? "track" : ascii}${extension}`;
}
