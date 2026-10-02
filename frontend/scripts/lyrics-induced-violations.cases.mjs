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
    // This case used to remove the request-key comparison, and it **escaped** — legitimately.
    // Reset-on-track-change is now enforced by the `key={providerId}` remount in `LyricsPanel`, so
    // dropping the key tag leaves defence-in-depth intact and nothing observable changes. The
    // violation therefore now targets the mechanism that actually does the work.
    name: "a superseded response is accepted (the remount is what prevents it)",
    file: "src/features/lyrics/LyricsPanel.tsx",
    from: "  return <LyricsForTrack key={currentTrack.providerId} track={currentTrack} />;",
    to: "  return <LyricsForTrack track={currentTrack} />;",
    test: "tests/lyrics/lyricsPanel.test.tsx",
    why: "The `key` is the reset: it remounts the controller per track, so the previous track's lyrics, active line, scroll position and follow flag all start fresh with no reset code. Remove it and a slow response for the previous track can land under the new track's title.",
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
    // The wrapper, not the panel. The first version of this case changed `LyricsPanel`'s own
    // className — which the test *did* catch, so it looked like coverage. It was not: a `fixed`
    // wrapper added in `page.tsx` is the more likely place for the bug, and it would have passed
    // that test untouched. The case now breaks the element the test reads.
    name: "the lyrics slot is positioned over the player region",
    file: "src/app/now-playing/page.tsx",
    from: '        className="flex max-h-[40vh] w-full max-w-3xl min-h-0 flex-col"',
    to: '        className="fixed inset-0 z-50 flex max-h-[40vh] w-full max-w-3xl min-h-0 flex-col"',
    test: "tests/nowplaying-lyrics.test.tsx",
    why: "An overlay, which the `app-shell` spec forbids outright.",
  },
  {
    name: "the lyrics slot loses its height bound",
    file: "src/app/now-playing/page.tsx",
    from: "max-h-[40vh] w-full max-w-3xl",
    to: "w-full max-w-3xl",
    test: "tests/nowplaying-lyrics.test.tsx",
    why: "An unbounded column lets a track with eighty lyric lines push More Like This off screen — the displacement the `app-shell` requirement exists to prevent.",
  },
  {
    name: "the transport is disabled while lyrics load",
    file: "src/app/now-playing/page.tsx",
    from: '<IconButton label="Queue" onClick={() => router.push("/queue")}>',
    to: '<IconButton label="Queue" disabled onClick={() => router.push("/queue")}>',
    test: "tests/nowplaying-lyrics.test.tsx",
    why: "A presence-only assertion lets a panel that disables the transport pass. Plausible to build, since “lyrics must not interfere with playback” invites a guard that is too broad.",
  },
  {
    name: "the lyrics provider bypasses the shared outbound limiter",
    file: "src/server/lyrics/lyricsService.ts",
    from: "  const release = await limiter.acquire(input.signal);",
    to: "  const release = () => undefined; void limiter;",
    test: "tests/lyrics/lyricsService.test.ts",
    why: "The design document claimed this milestone inherited M3's shared outbound limiter; `fetchJson` supplies a timeout and an abort, and nothing else had ever acquired `outboundLimiter`, so lyrics was the one provider call with no concurrency ceiling.",
  },
  {
    // Found by the fourth verification pass: task 4.1 claimed "unavailable and error are different
    // text", and setting the error copy to the unavailable string left all 2495 tests green — the two
    // states were separate *containers*, and a container difference cannot fail a check on *words*.
    name: "the error message repeats the unavailable message",
    file: "src/features/lyrics/LyricsPanel.tsx",
    from: 'title="Lyrics couldn\'t be loaded"',
    to: 'title="No lyrics available for this track."',
    test: "tests/lyrics/lyricsPanel.test.tsx",
    why: "The spec requires two distinguishable messages, not one. Telling a listener a track has no lyrics when the provider was unreachable is a false claim about the track, and the retry action makes no sense with it.",
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
    // A *relaxation*, not a deletion. The first version of this case deleted the line, which took
    // the trailing comma with it and turned the route into a parse error: the suite reported 0 tests,
    // and the harness called that an escape — accusing a correct test of being dead when the truth
    // was that nothing had run. The replacement keeps the file valid and genuinely weakens the
    // check, so the route accepts a short or over-long id and returns 200 where it must return 400.
    to: '    .regex(/^.{1,64}$/, "videoId shape not strictly enforced"),',
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
  {
    // Added after the third verification pass found that removing `transition-colors` entirely left
    // the whole suite green. The *code* had been fixed in pass 2; nothing had been added to keep the
    // fix true, which is the harness's own standard turned against it.
    name: "the line colour stops transitioning",
    file: "src/features/lyrics/LyricsPanel.tsx",
    from: "`${isActive ? ACTIVE_LINE_CLASSES : LINE_CLASSES} transition-colors`",
    to: "`${isActive ? ACTIVE_LINE_CLASSES : LINE_CLASSES}`",
    test: "tests/lyrics/lyricsPanel.test.tsx",
    why: "Task 4.4 claims reduced motion neutralises a colour transition. With no transition there is nothing to neutralise, so the requirement would be silently unmet while every test passed.",
  },
  {
    name: "the visible artwork is replaced by an empty box",
    file: "src/app/now-playing/page.tsx",
    from: '              data-testid="now-playing-artwork-image"\n',
    to: "",
    test: "tests/nowplaying-lyrics.test.tsx",
    why: "The `app-shell` scenario names the artwork among the things that must survive every lyrics state. A previous assertion read `now-playing-background` — the blurred aria-hidden backdrop — so deleting the cover image left all four state tests green.",
  },
  {
    name: "the volume control is removed from the surface",
    file: "src/app/now-playing/page.tsx",
    from: "          <VolumeControls />",
    to: "",
    test: "tests/nowplaying-lyrics.test.tsx",
    why: 'Volume is named in the same scenario. `getAllByRole("slider").length >= 1` is satisfied by the progress slider alone, so the volume control could vanish without a single test failing.',
  },

  // ---------------------------------------------------------------- M17 ---------
  // Home discovery enrichment. Each case below breaks one of the properties the
  // milestone's design decisions are load-bearing for, and names the test that must
  // notice. The two easiest ones to fake coverage for are here on purpose: a mix
  // card that quietly stops composing, and a Quick Pick whose target no longer
  // resolves — either renders a perfectly plausible card.

  {
    // The band's whole effect is the terms it selects. With the mood word trailing
    // instead of leading, a listener whose taste already fills the term bound trims
    // the band's own word away and the band does nothing — while every case that
    // only looks at a lightly-seeded listener still passes.
    name: "the band's mood word is dropped instead of leading the seeds",
    file: "src/features/home/timeBands.ts",
    from: "  const terms: string[] = [mood];",
    to: "  const terms: string[] = [];",
    test: "tests/home-time-bands.test.ts",
    why: "`seedTermsForBand` leads with the band's mood word precisely so the band always has an effect. Emptying the list first makes every band ask for the same terms, so 'the band influences only seed selection' quietly becomes 'the band influences nothing'.",
  },
  {
    name: "a card activation composes nothing",
    file: "src/features/home/mixes/MixCards.tsx",
    from: "        onClick={() => {\n          onPlay(plan);\n        }}",
    to: "        onClick={() => {\n          void plan;\n        }}",
    test: "tests/home-mix-cards.test.tsx",
    why: "A card whose button never calls the generator still renders a cover, a name, and a hover state, and still satisfies every assertion about the row being present. The composition path is the only thing that separates a card from a tile.",
  },
  {
    name: "the mix feed is reached from beside the card, not through the generator",
    file: "src/features/home/mixes/MixCards.tsx",
    from: 'import { deriveMixCollage, type MixCollage } from "@/features/home/mixes/collage";',
    to: 'import { fetchDiscoveryFeed } from "@/features/home/discoveryApi";\nimport { deriveMixCollage, type MixCollage } from "@/features/home/mixes/collage";\nvoid fetchDiscoveryFeed;',
    test: "tests/home-mix-cards.test.tsx",
    why: "A card-specific composer would have to reach the mix feed itself, because that is the only thing that builds a mix. Design decision 1 exists so there is exactly one composition path; naming the transport beside the cards is the second one, whatever it is called.",
  },
  {
    name: "a card composes its mix while Home renders",
    file: "src/features/home/mixes/MixCards.tsx",
    from: "  const plans = useMemo(() => mixCardPlans({ profile, languages }), [profile, languages]);",
    to: "  const plans = useMemo(() => { void generateMix({ profile, languages, now }); return mixCardPlans({ profile, languages }); }, [profile, languages, now]);",
    test: "tests/home-mix-cards.test.tsx",
    why: "'Cards are not composed on render' is the reason Home's request count does not grow with the number of cards. Six cards each firing a mix feed on mount is the exact regression the requirement names, and the row still looks identical afterwards.",
  },
  {
    name: "a card name skips the honest-naming check",
    file: "src/features/home/mixes/namedMixes.ts",
    from: "  return isHonestMixName(name) ? name : NEUTRAL_MIX_NAME;",
    to: "  return name;",
    test: "tests/home-named-mixes.test.ts",
    why: 'A leading term like "Topshelf" becomes "Topshelf mix", which claims a ranking the mix cannot support. Without the check the card renders a name its own seeds do not justify, and every case using an innocuous artist name still passes.',
  },
  {
    name: "a filter presents a shelf it was not asked for",
    file: "src/features/home/homeFilter.ts",
    from: "  return filters.includes(filter);",
    to: "  return true;",
    test: "tests/home-filter.test.ts",
    why: "The filter is a *selection* over one section model. A predicate that always answers true is not a filter, and the drift it hides is a shelf appearing under the wrong filter — invisible until a listener sees it.",
  },
  {
    name: "an unrecognised filter presents nothing",
    file: "src/features/home/homeFilter.ts",
    from: "  if (!isHomeFilter(filter)) return true;",
    to: "  if (!isHomeFilter(filter)) return false;",
    test: "tests/home-filter.test.ts",
    why: "The spec asks for an unrecognised value to present everything rather than nothing. Failing closed renders an empty Home because of a bad value, which is a worse failure than ignoring it — and no case that uses only real filter values can see it.",
  },
  {
    name: "a Quick Pick with an unresolvable target is still derived",
    file: "src/features/home/quickPicks.ts",
    from: "  if (quickPickHref(pick) === null) return;",
    to: "",
    test: "tests/home-quick-picks.test.tsx",
    why: "Design decision 5 exists so nothing in this shelf is a dead end. Without the resolvability gate an entry whose target resolves to nothing is still derived, and a shelf that looks like it recommends things it cannot deliver is worse than no shelf.",
  },

  // ------------------------------------------------------ M17: the time shelf's action --
  // `ROADMAP.md` scopes the band to "a seed set and query construction only", so the
  // time-aware shelf grew a play action that composes through the one shared
  // generator. Each case below breaks one of the things that makes that honest, and
  // all six are shapes a plausible refactor takes that no review catches: a memo
  // that starts composing, an onClick that quietly stops calling through, a spread
  // that flattens the band back onto the base profile, a convenience that rides a
  // label along in the request, an attribute that never reaches the DOM, and a hover
  // class nobody remembers is motion.

  {
    name: "the time shelf composes its mix while the page renders",
    file: "src/features/home/TimeShelf.tsx",
    from: "  const tracks = useMemo(\n    () => selectBandTracks(band, [...likedTracks, ...events.map((event) => event.track)]),\n    [band, events, likedTracks],\n  );",
    to: "  const tracks = useMemo(() => {\n    void generateMix({ profile, languages, now });\n    return selectBandTracks(band, [...likedTracks, ...events.map((event) => event.track)]);\n  }, [band, events, languages, likedTracks, now, profile]);",
    test: "tests/home-time-shelf.test.tsx",
    why: "'Cards are not composed on render' is the reason Home's request count does not grow with its surfaces, and the time shelf inherited that rule when it gained its action. Composing inside a memo is the natural-looking place to put work that reads as 'obviously cheap', and the rendered shelf is identical afterwards — only the request log changes.",
  },
  {
    name: "the time shelf's activation composes nothing",
    file: "src/features/home/TimeShelf.tsx",
    from: "          onClick={() => {\n            void play();\n          }}",
    to: "          onClick={() => {\n            void TIME_SHELF_ACTION_LABEL;\n          }}",
    test: "tests/home-time-shelf.test.tsx",
    why: "A control that renders, is focusable, has an accessible name and a hover state, and then does nothing still satisfies every assertion that the shelf is present and interactive. Composition is the only thing that separates the action from a decorative button.",
  },
  {
    name: "the band's seeds are dropped from the composed profile",
    file: "src/features/home/timeBands.ts",
    from: "{ ...base, seedTerms: seedTermsForBand(band, input).slice(0, MAX_BAND_QUERY_SEEDS) }",
    to: "{ ...base, seedTerms: base.seedTerms }",
    test: "tests/home-time-bands.test.ts",
    why: "Spreading the base profile and *then* overwriting the seeds is a shape that reads like 'use the band's terms' — so flattening it back onto the base's own terms compiles, keeps every other field identical, and reduces the band to a label. The shelf still selects the right local tracks and still names the right band; only the composed query changes.",
  },
  {
    name: "the band's label rides along in the request",
    file: "src/features/home/TimeShelf.tsx",
    from: "profile, languages, now: clock() }",
    to: "profile: { ...profile, seedTerms: [...profile.seedTerms, TIME_BAND_LABELS[band]] }, languages, now: clock() }",
    test: "tests/home-time-shelf.test.tsx",
    why: "Appending the band's display name to the seed terms is the obvious 'helpful' shortcut: the provider now knows what the mix is for. It is also exactly what the `discovery` scenario forbids — a request that names a part of the day — and it puts a local-time fact on the wire permanently.",
  },
  {
    name: "the band's data-band attribute never reaches the DOM",
    file: "src/components/recommendations/Shelf.tsx",
    from: "data-band={band}\n    ",
    to: "",
    test: "tests/home-time-shelf.test.tsx",
    why: "This is the defect as it shipped: the attribute was passed, type-checked cleanly, and never rendered, because a hyphenated JSX attribute name is invisible to TypeScript and the primitive rendered a fixed set. Only a rendered assertion can see it, and once it is gone there is no evidence hook left for band verification at all.",
  },
  {
    name: "the time shelf's action carries a motion utility",
    file: "src/features/home/TimeShelf.tsx",
    from: '          className="w-full justify-start"',
    to: '          className="w-full justify-start transition-colors"',
    test: "tests/home-m17-no-motion.test.ts",
    why: "A hover transition on a new control is the piece of motion M19 is most likely to inherit, and it is invisible in review because one transition utility among a dozen classes reads as house style. Design decision 6 exists so M19 can standardise one vocabulary rather than four.",
  },
];
