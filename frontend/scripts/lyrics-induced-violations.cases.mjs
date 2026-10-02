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
    test: "tests/motion-scope.test.ts",
    why: "A hover transition on a new control is the piece of motion M19 is most likely to inherit, and it is invisible in review because one transition utility among a dozen classes reads as house style. Design decision 6 exists so M19 can standardise one vocabulary rather than four.",
  },

  // ---------------------------------------------------------------- M18 ---------
  // Global keyboard shortcuts. The milestone's central correctness claim is that no
  // shortcut can fire while a key already means something local, and the four cases
  // below are the four ways that claim is broken while everything still looks fine:
  // the guard stops matching one surface type, and the resulting keypress is
  // indistinguishable from a working shortcut. Each names the sweep that crosses the
  // whole binding table with one surface, because a guard that quietly stopped
  // covering `input` cannot be seen by a test that only exercises a slider.

  {
    name: "a binding fires inside a text field",
    file: "src/features/shortcuts/localMeaning.ts",
    from: 'const TEXT_ENTRY_TAGS = ["input", "textarea", "select"] as const;',
    to: 'const TEXT_ENTRY_TAGS = ["textarea", "select"] as const;',
    test: "tests/shortcut-bindings.test.ts",
    why: "Typing a playlist name would pause playback, seek, and change the volume on every keystroke - and `Space` is the key a name is full of, so the most ordinary thing anyone does in this application would stop working while looking like a bug in the player rather than in the shortcut. Nothing else in the app would notice: the field still receives the key, because a global handler that does not call `preventDefault` for letters cannot take it away.",
  },
  {
    name: "a binding fires inside a dialog",
    file: "src/features/shortcuts/localMeaning.ts",
    from: "const DIALOG_SELECTOR = '[role=\"dialog\"]';",
    to: "const DIALOG_SELECTOR = '[data-spotivibe-dialog]';",
    test: "tests/shortcut-bindings.test.ts",
    why: "The five hand-rolled dialogs stop `Escape` themselves, so `Escape` would keep working while they were open - which is exactly what makes this invisible. Every *other* key is the exposure: a delete confirmation open, and the volume slider behind it is adjusted by whatever arrows the dialog itself does not consume.",
  },
  {
    name: "a binding fires while a slider has focus",
    file: "src/features/shortcuts/localMeaning.ts",
    from: "const SLIDER_SELECTOR = '[role=\"slider\"]';",
    to: "const SLIDER_SELECTOR = '[data-spotivibe-slider]';",
    test: "tests/shortcut-bindings.test.ts",
    why: "`ProgressSlider` reads `ArrowLeft`/`ArrowRight` for five seconds and calls `preventDefault`, but not `stopPropagation`, so the global ten-second seek runs on the same press and the position moves fifteen. A listener scrubbing to the chorus hears the track jump past it, and both handlers look correct in isolation.",
  },
  {
    name: "a binding fires inside a menu",
    file: "src/features/shortcuts/localMeaning.ts",
    from: "const MENU_SELECTOR = '[role=\"menu\"]';",
    to: "const MENU_SELECTOR = '[data-spotivibe-menu]';",
    test: "tests/shortcut-bindings.test.ts",
    why: "`ResultMenu` is the one surface that does *not* stop propagation, so its `Escape` really does reach the global listener. Without this rule the menu closes and the global handler acts on the same press - so a listener dismissing a context menu also toggles mute or likes a track they did not choose.",
  },
  {
    name: "M fakes mute by writing the volume instead of toggling the real muted state",
    file: "src/features/shortcuts/bindings.ts",
    from: "    run: () => usePlayerStore.getState().toggleMute(),",
    to: "    run: () => {\n      const player = usePlayerStore.getState();\n      player.setVolume(player.muted ? 70 : 0);\n      player.toggleMute();\n    },",
    test: "tests/shortcut-bindings.test.ts",
    why: "This is Lyrix's shortcut, and the reason it is on this list rather than in a comment: `muted` still flips, so every assertion about the flag passes, while the listener's own volume is destroyed on the first press and replaced with a hardcoded 70 on the second. The listener hears their music change volume without touching anything.",
  },
  {
    name: "ArrowUp raises the volume without unmuting",
    file: "src/features/shortcuts/bindings.ts",
    from: "  if (player.muted) player.toggleMute();\n",
    to: "  // Mute is left exactly as the store holds it: volume and mute are independent.\n",
    test: "tests/shortcut-bindings.test.ts",
    why: "`setVolume` deliberately does not clear `muted` - that is the store's contract, not an oversight - so without this line `ArrowUp` on a muted player changes a number the listener cannot hear and the keypress looks broken. Design decision 3 exists to make it stated behaviour rather than a surprise, and the only evidence it is implemented is this assertion.",
  },
  {
    name: "L likes with no track playing",
    file: "src/features/shortcuts/bindings.ts",
    from: "  const track = usePlayerStore.getState().currentTrack;\n  if (!track) return;\n  void useLibraryStore.getState().toggleLike(track);",
    to: '  const track =\n    usePlayerStore.getState().currentTrack ??\n    ({ id: "youtube:none", source: "youtube", providerId: "none", title: "Nothing playing", artists: [], artwork: [], category: "music", capabilities: { stream: false, offlineDownload: false } } as Track);\n  void useLibraryStore.getState().toggleLike(track);',
    test: "tests/shortcut-bindings.test.ts",
    why: "The guard is the whole behaviour, and the shape that removes it is the plausible one: a shortcut wants *something* to act on, so it supplies a placeholder. With nothing loaded, `L` then writes a like into Liked Songs for a track nobody chose - persisted, exported, and visible, so the library is wrong on every device it syncs to and the mistake is not visible until someone opens Liked Songs.",
  },
  {
    name: "the dialog does not trap focus",
    file: "src/components/design-system/Dialog.tsx",
    from: '    if (event.key !== "Tab") return;',
    to: '    if (event.key !== "Tab") return;\n    // No trap: the browser is left to move focus where it would anyway.\n    if (event.key === "Tab") return;',
    test: "tests/dialog.test.tsx",
    why: "This is the defect all five hand-rolled dialogs in this repository have, and it is invisible for the same reason jsdom makes it easy to assert wrongly: jsdom does not move focus on `Tab` at all, so a containment-only check ('focus never left the panel') passes on a dialog with no trap whatsoever. The test asserts the *cycle* - last to first, first to last, repeatedly - and only that can fail here.",
  },
  {
    name: "the dialog does not restore focus on close",
    file: "src/components/design-system/Dialog.tsx",
    from: "      if (previouslyFocused?.isConnected) previouslyFocused.focus();",
    to: "      // The invoker is not restored: focus is left wherever the browser put it.\n      void previouslyFocused;",
    test: "tests/dialog.test.tsx",
    why: "Opening help by pointer and closing it drops the listener at the top of the document, so the next `Tab` starts from the banner instead of returning to the control they pressed. It is the same class of defect as the missing trap and is asserted separately because it is a different line and a different failure: a dialog that traps but does not restore traps the listener inside a surface they can no longer leave by the key they used to enter it.",
  },
  {
    name: "the help list drifts from the binding table",
    file: "src/features/shortcuts/ShortcutHelpDialog.tsx",
    from: "        {SHORTCUT_BINDINGS.map((binding) => (",
    to: '        {/* The list is filtered here rather than derived from the table. */}\n        {SHORTCUT_BINDINGS.filter((binding) => binding.id !== "mute").map((binding) => (',
    test: "tests/shortcut-listener.test.tsx",
    why: "Filtering or reordering the rows is the ordinary way a help dialog starts lying - a binding gets excluded because someone thought the row was redundant, or the list is sorted by a second hand-written order. The dialog still looks complete and every row still renders, so only a comparison against the table can see it; that comparison is the test, and this case is what proves the comparison is not vacuous.",
  },

  // ------------------------------------------------------ M18: search suggestions --
  // The suggestion lane is the milestone's first genuinely concurrent surface: two
  // request lanes that are *supposed* to be independent, mounted on one keystroke
  // stream, with a popup that renders whatever it is handed. Every case below is a
  // way that goes wrong while the popup still looks completely fine - a lane that
  // quietly shares state with the other one, a stale answer rendered against the
  // query being typed, a hint list that reaches the provider, and a combobox whose
  // roles quietly stop being a combobox.

  {
    name: "a suggestion request cancels the controller's results request",
    file: "src/features/search/useSearchSuggestions.ts",
    from: "      setSettled({ query: forQuery, items: deriveSuggestions(forQuery, history) });\n",
    to: '      setSettled({ query: forQuery, items: deriveSuggestions(forQuery, history) });\n      // The field is kept in step with what the popup offers, so a completion\n      // fills it as the popup settles.\n      if (history.length > 0 && forQuery !== "")\n        useSearchStore.setState({ query: history[0].normalizedQuery });\n',
    test: "tests/search-suggestions.test.tsx",
    why: "This is the only way a suggestion request *can* reach the search controller in this architecture, and it is therefore the whole of case 1: the two lanes share nothing but the search store, so any lane that writes the query re-runs the controller's effect, and that effect cancels the in-flight results request. The listener then watches their results blink away every time the popup opens, and because the popup itself is unharmed nothing else notices. Design decision 5 is the claim that the two lanes are independent, and this is the only edit that could break it.",
  },
  {
    name: "a superseded suggestion response overwrites the newest one",
    file: "src/features/search/useSearchSuggestions.ts",
    from: "      if (!isCurrent(seq, controller)) return; // superseded or cancelled: renders nothing",
    to: "      // The response is rendered as it arrives; only a failure checks the lane.",
    test: "tests/search-suggestions.test.tsx",
    why: "The lane's monotonic sequence and its abort signal are the *only* thing standing between a slow read for 'kar' and the popup for 'karma'. Drop the guard and a late response replaces the settled set derived for the query being typed - here the popup goes empty rather than showing the wrong text, because the newest answer was thrown away, which is the same defect wearing a different hat.",
  },
  {
    name: "the suggestion lane fires on every keystroke",
    file: "src/features/search/useSearchSuggestions.ts",
    from: "    }, SUGGESTION_DEBOUNCE_MS);",
    to: "    }, 0);",
    test: "tests/search-suggestions.test.tsx",
    why: "Design decision 5 is that the lane runs on *its own* debounce as well as its own abort, and a debounce nobody can measure is not a debounce. Setting it to zero looks like a latency improvement and is invisible in every rendered assertion: the popup still appears, with the same suggestions, from the same local read. What it costs is a storage read per character typed, which is the one cost this lane exists to avoid - it is the surface that fires on every keystroke, so an undebounced suggestion list is the most expensive read path in the application wearing the cheapest-looking change.",
  },
  {
    name: "suggestions are derived from a provider request",
    file: "src/features/search/useSearchSuggestions.ts",
    from: "        history = await loadSearchHistory(SUGGESTION_HISTORY_LIMIT);",
    to: "        history = await loadSearchHistory(SUGGESTION_HISTORY_LIMIT);\n        // Suggestions come from the catalogue, like every other search surface.\n        const found = (await (await fetch(`/api/search?q=${forQuery}&limit=6`)).json()) as {\n          tracks?: Array<{ title: string }>;\n        };\n        history = [\n          ...history,\n          ...(found.tracks ?? []).map((entry) => ({\n            query: entry.title,\n            normalizedQuery: entry.title.toLowerCase(),\n            searchedAt: 0,\n          })),\n        ];",
    test: "tests/search-suggestions.test.tsx",
    why: "The obvious way to make suggestions useful - ask the catalogue - and the reason it is forbidden. The popup fires on every keystroke, so this turns typing into provider traffic, makes the hint list's usefulness depend on network latency, and quietly sends the listener's half-typed query outward dozens of times per search. The local-first boundary this repository treats as inviolable, entered through a surface nobody would think to check because the results still look right.",
  },
  {
    name: "the search field stops being a combobox",
    file: "src/features/search/SearchCombobox.tsx",
    from: '        role="combobox"\n        aria-expanded={open}\n        aria-controls={LISTBOX_ID}\n        aria-activedescendant={activeOptionId}\n',
    to: "        aria-expanded={open}\n        aria-controls={LISTBOX_ID}\n",
    test: "tests/search-suggestions.test.tsx",
    why: "The field still *looks* like a field, still takes focus, still opens a popup on typing, and still navigates on commit - every one of those assertions passes. What is gone is the part that makes it usable without sight: a screen reader is no longer told there is a listbox, that it is open, or which option is active, so arrow-key navigation becomes an unannounced hunt through a list the listener cannot hear. This is the repository's first combobox, which is exactly why the pattern has to be pinned by a test rather than by review.",
  },
  {
    name: "the suggestion popup is not a listbox",
    file: "src/features/search/SearchCombobox.tsx",
    from: '          role="listbox"\n',
    to: '          role="group"\n',
    test: "tests/search-suggestions.test.tsx",
    why: "The options and the keyboard handling both survive, so this is a one-word change with no visible effect. It removes the popup's relationship to the field's `aria-controls`, which is what turns a list of suggestions into an announced popup with a position, and it leaves assistive technology with a group of list items the arrow keys move through in silence.",
  },
  {
    name: "a committed suggestion updates the field but not the URL",
    file: "src/features/search/SearchCombobox.tsx",
    from: "  function commit(next: string): void {\n    onCommit(next);",
    to: '  function commit(next: string): void {\n    // A commit is not a keystroke: the field shows what was chosen and the page\n    // is left to catch up on the next edit.\n    const field = wrapperRef.current?.querySelector("input") as HTMLInputElement | null;\n    if (field !== null) field.value = next;\n    setDismissed(true);\n    setActiveIndex(-1);\n    return;',
    test: "tests/search-suggestions.test.tsx",
    why: "Reading a commit as 'the user typed this' rather than 'the user chose this' is the natural mistake, because the field visibly fills in either way and the listener sees a working search. It is only the *link* that breaks - the address bar keeps the old query, so the search they are looking at cannot be shared, bookmarked, or reloaded, and the difference between typing and choosing is invisible until they try to send someone what they found.",
  },

  // ------------------------------------------------------- M18: the search controller --
  // The last two cases target the controller this milestone promised not to change.
  // They are here because 'unchanged' is the kind of claim that is only true until
  // the next person decides a constant or a line is not load-bearing.

  {
    name: "the search controller's debounce is removed",
    file: "src/features/search/useSearchController.ts",
    from: "    }, SEARCH_DEBOUNCE_MS);",
    to: "    }, 0);",
    test: "tests/search-controller.test.tsx",
    why: "A 300 ms debounce is what turns a typed word into one request instead of one per character, and removing it looks like a performance improvement while typing. It is also the controller's published contract - SEARCH_DEBOUNCE_MS is imported by this milestone's own suggestion tests to schedule around it - and the cost lands on the shared outbound limiter rather than on the keyboard, where it looks like lag.",
  },
  {
    name: "the search controller stops aborting a superseded request",
    file: "src/features/search/useSearchController.ts",
    from: "      abortRef.current?.abort();\n      abortRef.current = null;",
    to: "      // A superseded request is left to finish; its sequence guard drops it.\n      abortRef.current = null;",
    test: "tests/search-controller.test.tsx",
    why: "Dropping the abort looks free, because the sequence guard still throws the stale response away - the results on screen are identical. What changes is the wire: the request that was already superseded keeps running to completion against the provider's concurrency budget, so a fast typist's abandoned queries queue up behind the one they actually want. The abort is a resource decision the sequence guard cannot make, and it is invisible in every assertion about what is rendered.",
  },

  // -------------------------------------------------------------- M18: sharing --
  // Sharing's whole claim is that it is honest on a browser without the Web Share
  // API, and that a cancelled share is not a failure. Both are easy to state and
  // easy to lose: an extra line turns the cancellation into an error, a convenient
  // 'remember this' turns an act into a record, and a provider URL is the one link
  // shape that looks most like sharing.

  {
    name: "a dismissed share is reported as a failure",
    file: "src/features/sharing/useShare.ts",
    from: '    return dismissed ? "dismissed" : "copied";',
    to: '    return dismissed ? "unavailable" : "copied";',
    test: "tests/share-transports.test.tsx",
    why: "The most common rejection a share sheet produces is a listener closing it, and mapping that to 'unavailable' tells them the feature is broken when they used it exactly as intended - while the clipboard copy that actually succeeded is never mentioned. It also inverts the requirement's reasoning: cancelling is not failing, and a UI whose dismissal path reads as an error teaches people not to dismiss.",
  },
  {
    name: "a share persists the link it shared",
    file: "src/features/sharing/useShare.ts",
    from: '      await platformShare({ title, url });\n      return "shared";',
    to: '      await platformShare({ title, url });\n      // Remember the last share so it can be offered again.\n      window.localStorage.setItem("spotivibe:last-share", url);\n      return "shared";',
    test: "tests/share-transports.test.tsx",
    why: "'Remember what I just shared' is a small, friendly feature and it is why sharing would become a record. The cost is that a share is the one action a listener takes *about someone else* - the link is the thing they were going to send to a person - and writing it into device storage turns their gesture into a row in a list they never asked for and cannot see. It is also the first step toward a share history, which this repository's accountless, local-first product does not have and does not want.",
  },
  {
    name: "a track shares a provider URL",
    file: "src/features/sharing/trackShare.ts",
    from: "    url: buildSearchUrl(query),",
    to: "    url: `https://music.youtube.com/watch?v=${track.providerId}&list=${encodeURIComponent(query)}`,",
    test: "tests/share-links.test.tsx",
    why: "The track's provider id is the one identifier that is exact rather than lossy, so reaching for it is the obvious way to share a track precisely - and it produces a link that resolves on somebody else's service, in an account-bound player, for a URL this application neither owns nor can keep alive. It is also the shape that silently breaks the moment the deployment address changes, and the shape that leaks the provider relationship into every message a listener sends.",
  },
  {
    name: "a playlist URL is concatenated at the call site",
    file: "src/features/playlists/PlaylistDetailView.tsx",
    from: "          url={playlistHref(playlistId)}",
    to: "          url={`/playlist/${playlistId}`}",
    test: "tests/share-links.test.tsx",
    why: "The copy produces a byte-identical link for every id this application generates - playlist ids are uuids, so nothing needs encoding - which is precisely why it survives review and why an equality assertion on the shared URL passes on either. What it removes is the only place that could encode an id that *did* need it, so the day an id carries a slash or a question mark the link navigates somewhere else. This is also the case that proves the structural sweep is not vacuous: without it the detector would be a rule nobody had ever seen reject anything.",
  },
  {
    name: "a share action has no accessible name",
    file: "src/features/sharing/ShareButton.tsx",
    from: "      <IconButton label={`Share ${name}`} size={size} disabled={busy} onClick={share}>",
    to: '      <IconButton label={"Share"} size={size} disabled={busy} onClick={share}>',
    test: "tests/share-transports.test.tsx",
    why: "A column of identically-labelled share buttons is the failure this requirement names, and it is what a 'Share' string constant looks like after somebody tidies it. Nothing else changes: the control is still focusable, still has a title tooltip, still shares the right link, and a screen-reader user now hears 'Share' eight times in a result list with no way to tell which track. A name that identifies what it shares is the only thing separating the icon from the thing it acts on.",
  },
  {
    name: "shift is treated as a platform chord, so the help key cannot open help",
    file: "src/features/shortcuts/bindings.ts",
    from: "return event.ctrlKey || event.metaKey || event.altKey;",
    to: "return event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;",
    test: "tests/shortcut-bindings.test.ts",
    why: "The help key is Shift+/: '?' arrives as key '?' with shiftKey true on every current engine, so this mutation does not merely violate a scenario, it makes the ONLY way to discover that the other shortcuts exist unreachable — the feature removes its own documentation. A capitalised letter arrives with shiftKey true too, so 'M' and 'L' break for anyone holding shift. This case was added after a review proved the mutation left all 2750 tests green: a rule nobody can violate has no test, and this one had no case.",
  },
  {
    name: "a chord answers a shortcut",
    file: "src/features/shortcuts/bindings.ts",
    from: "  if (hasPlatformModifier(event)) return null;",
    to: "  // the chord rule was dropped",
    test: "tests/shortcut-bindings.test.ts",
    why: "The chord rule lives in the lookup rather than in the dispatcher, so removing one call is what makes Cmd+M and Ctrl+L answer a global shortcut instead of minimising a window and focusing the address bar. The whole-table sweep is what catches it: the first version of this test named only M and L, and an independent review found the other seven bindings uncovered — which is the exact defect this milestone exists to prevent, reappearing inside its own evidence. A binding added later is the one nobody checks by hand.",
  },
  {
    name: "editable content stops suppressing shortcuts",
    file: "src/features/shortcuts/localMeaning.ts",
    from: '  const host = element.closest("[contenteditable]");',
    to: '  const host = null as ReturnType<Element["closest"]>;',
    test: "tests/shortcut-local-meaning.test.ts",
    why: "contenteditable occurs nowhere in src today, so the selector looks like dead code and reads as safe to simplify. It is the one piece of non-trivial logic in the guard: a future rich-text surface inherits the claim automatically, and without this case the simplification would pass every suite while turning any editor added later into a surface where Space types a space AND pauses playback.",
  },
  {
    name: "a spinbutton stops suppressing shortcuts",
    file: "src/features/shortcuts/localMeaning.ts",
    from: "  if (element.closest(SPINBUTTON_SELECTOR)) return true;",
    to: "  // a spinbutton is not a text field",
    test: "tests/shortcut-local-meaning.test.ts",
    why: "Same shape, different selector: no spinbutton exists in the application yet either, which is precisely why a reviewer would not notice it being removed. Arrow keys on a spinbutton belong to the spinbutton, and the guard exists so a global volume or seek binding never takes them.",
  },

  // ---------------------------------------------------------------- M19 ---------
  // Motion and interaction polish. The milestone's claims are all about *declarations*:
  // one vocabulary, one reduced-motion floor, motion on a named set of surfaces and
  // nowhere else, and a client bundle that does not grow. A declaration is invisible in
  // review — one `137ms` among a dozen classes, or a fourth transition utility in a
  // control that already had one, reads as house style — so each case below removes the
  // declaration a milestone rule depends on and requires that rule to notice.

  {
    name: "a motion declares a duration of its own",
    file: "src/styles/motion.css",
    from: "  .motion-feedback {\n    transition:\n      transform var(--motion-feedback) var(--motion-ease-out),\n      opacity var(--motion-feedback) var(--motion-ease-out);\n  }",
    to: "  .motion-feedback {\n    transition:\n      transform 137ms linear,\n      opacity 137ms linear;\n  }",
    test: "tests/motion-vocabulary.test.ts",
    why: "The whole point of the vocabulary is that a component cannot choose its own number. This is the shape such a choice takes — `137ms` reads as a deliberate decision by someone who wants a control to feel slightly crisper than the 120 ms the system uses, and nothing about it looks like a second system until every surface has drifted.",
  },
  {
    name: "motion appears outside the named surfaces",
    file: "src/features/sharing/ShareButton.tsx",
    from: '    <div className="flex shrink-0 flex-col items-end gap-1">',
    to: '    <div className="motion-feedback flex shrink-0 flex-col items-end gap-1">',
    test: "tests/motion-scope.test.ts",
    why: "M18's verification found that the no-motion guard covered only `features/home`, and this is the same hole arriving again in the feature M18 added: one transition utility on a share control, in a directory the old guard never walked. The milestone's own non-goal is animating everything, so this is the case most worth keeping.",
  },
  {
    name: "a component gates its motion on the reduced-motion preference",
    file: "src/components/design-system/IconButton.tsx",
    from: "      className={`motion-feedback inline-flex items-center justify-center rounded-buttons disabled:pointer-events-none",
    to: '      className={`motion-feedback ${reducedMotion ? "opacity-90" : ""} inline-flex items-center justify-center rounded-buttons disabled:pointer-events-none',
    test: "tests/motion-vocabulary.test.ts",
    why: "A second mechanism, written out of good intentions: the global floor already collapses every declared duration, so a per-component gate can only be narrower, and once one exists the next component copies it. This is also the shape a future author reaches for when a motion 'looks wrong' for one person.",
  },
  {
    name: "a motion transitions a layout property",
    file: "src/styles/motion.css",
    from: "    transition:\n      transform var(--motion-reveal) var(--motion-ease-out),\n      opacity var(--motion-reveal) var(--motion-ease-out);",
    to: "    transition:\n      height var(--motion-reveal) var(--motion-ease-out),\n      opacity var(--motion-reveal) var(--motion-ease-out);",
    test: "tests/motion-vocabulary.test.ts",
    why: "The one thing this milestone cannot measure for itself — a transition on `height` or `top` is how motion starts costing a layout pass on every frame, and no test here can see a frame. Animating a card's height open instead of its opacity is also the most natural-looking request anyone can make, which is exactly why the rule has to be structural.",
  },
  {
    name: "the dialog's exit never runs",
    file: "src/components/design-system/Dialog.tsx",
    from: "      data-motion-state={phase}",
    to: '      data-motion-state="open"',
    test: "tests/motion-surfaces.test.tsx",
    why: "The exit is the whole argument for not taking a 41 kB dependency, so losing it is losing the milestone's central decision. It is also invisible: a dialog that never leaves is not a crash, it is a dialog that pops out of existence instead of fading — and it is a *reduction*, so every check that only tests the enter still passes.",
  },
  {
    name: "an animation library is added to the manifest",
    file: "package.json",
    from: '    "vitest": "^5.0.2"',
    to: '    "framer-motion": "^12.0.0",\n    "vitest": "^5.0.2"',
    test: "tests/motion-budget.test.ts",
    why: "The dependency decision has to be reversible only on evidence, and this is what reversibility without evidence looks like: a line in a manifest, committed alongside an unrelated change, costing +41.4 kB on the first screen. The measured ceiling would catch it too, but only after a build — this rule fires on every run.",
  },
];
