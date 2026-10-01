/**
 * The induced violations for M16, as data (spec `lyrics`, `app-shell`).
 *
 * Kept in its own module, and imported by both the harness that applies them and the guard test that
 * checks them, so there is exactly one copy. The first version had the harness hold the array and the
 * guard test *parse it out of the harness's source with a regex* — which found 4 of the 11 cases and
 * reported it as "4 of 11" rather than reporting that its own parser was broken. A detector that
 * reads another file's text is the fragile kind, and this repository has already paid for that twice.
 *
 * Each entry breaks exactly ONE production behaviour and names the test that must catch it. The
 * `from` anchor must be text that exists verbatim in the target file; a case whose anchor has moved
 * is a case that would otherwise skip, which is why the guard test asserts every anchor resolves.
 */

/**
 * @typedef {{name: string, file: string, from: string, to: string, test: string, why: string}} Violation
 */

/** @type {Violation[]} */
export const CASES = [
  {
    name: "parser drops the timestamp fraction's precision",
    file: "src/features/lyrics/lyricsTiming.ts",
    from: 'const fraction = match[3] === undefined ? "" : match[3].padEnd(3, "0");',
    to: 'const fraction = match[3] === undefined ? "" : String(Number(match[3]));',
    test: "tests/lyrics/lyricsTiming.test.ts",
    why: '`Number("5") / 1000` makes `[00:12.5]` 12.005 instead of 12.5 — the naive coercion this parser exists to avoid.',
  },
  {
    name: "active line selects the first line strictly after the position",
    file: "src/features/lyrics/lyricsTiming.ts",
    from: "    if (lines[mid].time <= positionSeconds) {",
    to: "    if (lines[mid].time < positionSeconds) {",
    test: "tests/lyrics/lyricsTiming.test.ts",
    why: "Returning the *next* line rather than the last one at or before the position. A position exactly on a timestamp must select that line.",
  },
  {
    name: "an empty timed line is rendered as a lyric",
    file: "src/features/lyrics/lyricsTiming.ts",
    from: '    if (text === "") continue;',
    to: "",
    test: "tests/lyrics/lyricsTiming.test.ts",
    why: "An instrumental gap marked `[00:20]` with no text would become an empty row that is then highlighted as the active lyric.",
  },
  {
    name: "unavailable is reported as a provider error",
    file: "src/app/api/lyrics/route.ts",
    from: '  if (result.kind === "unavailable") return unavailableResponse();',
    to: '  if (result.kind === "unavailable")\n    return errorResponse(503, "upstream_unavailable", "Lyrics are temporarily unavailable.");',
    test: "tests/lyrics-route.test.ts",
    why: "Collapsing “no lyrics” into “could not reach the provider” — the distinction the whole route exists to preserve.",
  },
  {
    name: "a provider failure is cached as a permanent miss",
    file: "src/server/lyrics/lyricsService.ts",
    from: '    else if (result.kind === "unavailable") caches.misses.set(input.videoId, result);',
    to: "    else caches.misses.set(input.videoId, result);",
    test: "tests/lyrics/lyricsService.test.ts",
    why: "A one-off outage would then hide lyrics for the whole miss TTL — a day — for a track that has them.",
  },
  {
    name: "the miss TTL is as long as the hit TTL",
    file: "src/server/lyrics/lyricsService.ts",
    from: "export const LYRICS_MISS_TTL_MS = 24 * 60 * 60 * 1000;",
    to: "export const LYRICS_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;",
    test: "tests/lyrics/lyricsService.test.ts",
    why: "The asymmetry is the design: a miss is worth retrying sooner than a hit is worth distrusting.",
  },
  {
    name: "concurrent requests for one track are not de-duplicated",
    file: "src/server/lyrics/lyricsService.ts",
    from: "  return caches.inflight.run(input.videoId, async () => {",
    to: "  return (async () => {",
    test: "tests/lyrics/lyricsService.test.ts",
    why: "Five simultaneous opens of one track would issue five provider queries against a free service that asks clients to be polite.",
  },
  {
    name: "a superseded response is accepted",
    file: "src/features/lyrics/useLyricsPanel.ts",
    from: "  const current = settled !== null && settled.key === requestKey ? settled.resolution : null;",
    to: "  const current = settled !== null ? settled.resolution : null;",
    test: "tests/lyrics/lyricsPanel.test.tsx",
    why: "Without the key tag, a slow response for the previous track lands under the new track's title.",
  },
  {
    name: "the active line becomes an aria-live region",
    file: "src/features/lyrics/LyricsPanel.tsx",
    from: '    <section\n      aria-label="Lyrics"',
    to: '    <section\n      aria-live="polite"\n      aria-label="Lyrics"',
    test: "tests/lyrics/lyricsPanel.test.tsx",
    why: "Position advances about once a second, so a live region announces a new line every second — noise, not information.",
  },
  {
    name: "reduced motion does not change the scroll behaviour",
    file: "src/hooks/usePrefersReducedMotion.ts",
    from: '  return reducedMotion ? "auto" : "smooth";',
    to: '  return "smooth";',
    test: "tests/lyrics/lyricsPanel.test.tsx",
    why: 'The requirement is worded "SHALL NOT use smooth scrolling", so the behaviour is asserted, not merely the knowledge of the preference.',
  },
  {
    name: "following never suspends",
    file: "src/features/lyrics/LyricsPanel.tsx",
    from: "    reportScroll(isActiveLineLive());",
    to: "    reportScroll(true);",
    test: "tests/lyrics/lyricsPanel.test.tsx",
    why: "Reading ahead would be fought by the player — the exact defect the position-based live-band rule exists to prevent.",
  },
  {
    name: "the lyrics panel is positioned over the player region",
    file: "src/features/lyrics/LyricsPanel.tsx",
    from: '      className="flex min-h-0 flex-col gap-2"',
    to: '      className="fixed inset-0 z-50 flex min-h-0 flex-col gap-2"',
    test: "tests/nowplaying-lyrics.test.tsx",
    why: "An overlay, which the `app-shell` spec forbids outright.",
  },
  {
    name: "the route reads a taste-profile parameter",
    file: "src/app/api/lyrics/route.ts",
    from: '    videoId: params.get("videoId") ?? undefined,',
    to: '    videoId: params.get("videoId") ?? undefined,\n    profile: params.get("profile") ?? undefined,',
    test: "tests/lyrics-route.test.ts",
    why: "A profile parameter would be local taste leaving the device — the local-first boundary this repository treats as inviolable.",
  },
  {
    name: "a malformed video id is not rejected",
    file: "src/app/api/lyrics/route.ts",
    from: '    .regex(VIDEO_ID_PATTERN, "videoId must be an 11-character YouTube video id"),',
    to: "",
    test: "tests/lyrics-route.test.ts",
    why: "Malformed input must never reach a provider — the spec's first validation requirement.",
  },
  {
    name: "the lyrics retry label collides with the radio's",
    file: "src/features/lyrics/LyricsPanel.tsx",
    from: '            retryLabel="Try lyrics again"',
    to: '            retryLabel="Try again"',
    test: "tests/radio-entry-points.test.tsx",
    why: "Two identically-labelled retry buttons on one screen leave the listener no way to tell which thing they are retrying. This was found by an existing test, not invented here.",
  },
];
