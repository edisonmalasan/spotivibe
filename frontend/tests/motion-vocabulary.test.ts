import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INHERITED_MOTION,
  MAX_MOTION_STEPS,
  MOTION_ALLOWED,
  MOTION_CLASSES,
  MOTION_DISCRETE_PROPERTIES,
  MOTION_PROPERTIES,
  MOTION_STEPS,
  MOTION_STEP_ORDER,
} from "@/styles/motionTokens";
import {
  code,
  cssMotionDeclarations,
  declaredSteps,
  inventedTimes,
  inventedTimesInMotion,
  motionUtilities,
  referencedSteps,
  sourceFiles,
} from "./helpers/motionSource";

/**
 * M19 section 1 and section 2: one motion vocabulary, and a reduced-motion floor that
 * holds by construction.
 *
 * The four requirements under test are claims about *declarations*, so the checks read
 * declarations. There is no browser here, so nothing here observes a computed style or
 * a rendered frame — that limit is recorded rather than papered over. What is asserted
 * is the stronger structural claim the design makes: that the global floor collapses
 * every duration **because** each duration is written into a `transition` declaration
 * the `!important` longhand then overrides, with no per-component gate anywhere.
 *
 * Every check names the file it failed on, because a vocabulary rule that reports
 * "motion is inconsistent" without a path is a report, not a rule.
 */

/** The one file allowed to declare motion values, and the one file allowed to define the floor. */
const VOCABULARY_CSS = "styles/motion.css";
const VOCABULARY_CONTRACT = "styles/motionTokens.ts";
const GLOBALS_CSS = "app/globals.css";

const files = sourceFiles();
const css = files.filter((file) => file.path.endsWith(".css"));
const modules = files.filter((file) => file.path.endsWith(".ts") || file.path.endsWith(".tsx"));

/** Every file under `src`, as one joined blob — for "is it declared *anywhere* else" rules. */
const wholeTree = files.map((file) => `${file.path}\n${file.source}`).join("\n");

// Keep the literals in variables — Vite rewrites inline `new URL("...", import.meta.url)`
// into a non-`file:` URL under the jsdom environment, and `fileURLToPath` rejects it.
const motionCssRel = "../src/styles/motion.css";
const globalsCssRel = "../src/app/globals.css";
const vocabularyCss = readFileSync(fileURLToPath(new URL(motionCssRel, import.meta.url)), "utf8");
const globalsCss = readFileSync(fileURLToPath(new URL(globalsCssRel, import.meta.url)), "utf8");

describe("the vocabulary is declared in one place (task 1.1, spec motion)", () => {
  it("reaches every module under src, so a file nobody listed is still checked", () => {
    // The M17 guard this replaces walked one directory and was told the module list by
    // hand; M18's verification found a module it never saw. The walk is the coverage.
    expect(files.length, "the walker must reach the source tree").toBeGreaterThan(150);
    expect(modules.map((file) => file.path)).toContain("features/home/HomeView.tsx");
    expect(css.map((file) => file.path)).toEqual(
      [VOCABULARY_CSS, "styles/tokens.css", GLOBALS_CSS].sort(),
    );
  });

  it("declares every step exactly once, in the vocabulary stylesheet", () => {
    const elsewhere = files.filter(
      (file) => file.path !== VOCABULARY_CSS && declaredSteps(file.source).size > 0,
    );
    expect(
      elsewhere.map((file) => `${file.path}: ${[...declaredSteps(file.source).keys()].join(", ")}`),
      "a motion value written outside styles/motion.css is a second vocabulary",
    ).toEqual([]);
  });

  it("declares every step the contract names, with a value, and nothing extra", () => {
    const declared = declaredSteps(vocabularyCss);
    expect([...declared.keys()].sort()).toEqual(Object.keys(MOTION_STEPS).sort());

    for (const name of Object.keys(MOTION_STEPS)) {
      const value = declared.get(name);
      expect(value, `${name} must have a value in ${VOCABULARY_CSS}`).toBeTruthy();
      expect(
        value,
        `${name} must be a single literal, not a reference to something else`,
      ).not.toContain("var(");
    }
  });

  it("is a vocabulary rather than a catalogue", () => {
    // The bound is what makes "small" checkable. Without it, a milestone that needed
    // one duration per surface would pass by adding steps until someone noticed.
    const count = Object.keys(MOTION_STEPS).length;
    expect(count, "the vocabulary must stay a vocabulary").toBeLessThanOrEqual(MAX_MOTION_STEPS);
    expect(count).toBeGreaterThanOrEqual(4);
  });

  it("names every step for what it is for, never for how long it is", () => {
    // A duration named `--motion-120ms` has encoded its own number into its identity,
    // which is how a vocabulary becomes a lookup table of habits. This is the check
    // that keeps the *naming* rule real rather than aspirational.
    for (const [name, step] of Object.entries(MOTION_STEPS)) {
      expect(name, "a step is named --motion-<what it is for>").toMatch(/^--motion-[a-z-]+$/);
      expect(name, "a step name may not contain a number").not.toMatch(/\d/);
      expect(step.purpose.length, `${name} must state what it is for`).toBeGreaterThan(10);
      expect(step.purpose, `${name} must not restate its own value`).not.toMatch(/\d/);
    }
  });

  it("gives every step one of the three kinds, and pairs each with what it may animate", () => {
    for (const [name, step] of Object.entries(MOTION_STEPS)) {
      expect(["duration", "easing", "travel", "floor"], name).toContain(step.kind);
      // Task 1.3, first half: the pairing exists, and it is a subset of the properties
      // that cannot trigger layout. A step with an empty pairing is either an easing or
      // a distance (neither is ever written into a `transition`) — or a duration that
      // forgot to say what it animates, which is checked below.
      for (const property of step.permitted) {
        expect(
          MOTION_PROPERTIES as readonly string[],
          `${name} may only pair real properties`,
        ).toContain(property);
      }
    }
  });

  it("pairs every duration with at least one property, so none is declared for nothing", () => {
    for (const [name, step] of Object.entries(MOTION_STEPS)) {
      if (step.kind !== "duration") continue;
      expect(
        step.permitted.length,
        `${name} is a duration, so it must say what it animates`,
      ).toBeGreaterThan(0);
    }
  });

  it("only refers to steps it declares, so a typo cannot silently disable a motion", () => {
    const declared = new Set(declaredSteps(vocabularyCss).keys());
    for (const stylesheet of css) {
      const unknown = referencedSteps(stylesheet.source).filter((name) => !declared.has(name));
      expect(unknown, `${stylesheet.path} refers to steps the vocabulary does not declare`).toEqual(
        [],
      );
    }
  });

  it("uses every step it declares, so the set cannot accumulate dead vocabulary", () => {
    // A declared step nothing uses is the beginning of a catalogue: the next motion
    // reaches for it, then for another one, and the bound above is the only thing left
    // saying the set is meant to be small. `--motion-floor` is the one step used from
    // another file — `app/globals.css` is where the floor is *applied* — so the search
    // spans every stylesheet rather than only the vocabulary.
    const referenced = new Set(css.flatMap((stylesheet) => referencedSteps(stylesheet.source)));
    for (const name of declaredSteps(vocabularyCss).keys()) {
      expect(referenced, `${name} is declared but nothing uses it`).toContain(name);
    }
  });
});

describe("no component invents a duration (task 1.2, spec motion)", () => {
  it("holds no time literal in any stylesheet but the vocabulary", () => {
    const offenders: string[] = [];
    for (const stylesheet of css) {
      if (stylesheet.path === VOCABULARY_CSS) continue;
      for (const literal of inventedTimes(stylesheet.source)) {
        offenders.push(`${stylesheet.path}: ${literal}`);
      }
    }
    // `app/globals.css` used to hold `0.01ms` and `14s`; both are now `var(--motion-floor)`
    // and `var(--motion-marquee)`. This is the assertion that keeps them there.
    expect(offenders, "a time value outside the vocabulary is a second vocabulary").toEqual([]);
  });

  it("holds no time literal in the vocabulary that is not a declared step's own value", () => {
    // The narrower rule the first one cannot make, because the vocabulary is where a time
    // value is *allowed*. Only the nine `--motion-*` declarations may hold one, so
    // `transform 137ms linear` inside a class is caught even though it sits in the right
    // file. This is the shape a component invents its own duration in when it reaches for
    // the stylesheet directly.
    const declaredValues = new Set([...declaredSteps(vocabularyCss).values()]);
    const stray = inventedTimes(vocabularyCss).filter((literal) => !declaredValues.has(literal));
    expect(stray, "only a --motion-* declaration may hold a time value").toEqual([]);
  });

  it("holds no Tailwind duration, easing, or delay utility anywhere in the application", () => {
    // Tailwind's `duration-200`, `ease-in-out`, and `delay-150` each resolve to a real
    // time value that the vocabulary does not own. They look like house style and are
    // invisible in review, which is exactly why the rule is a sweep rather than a note.
    const offenders: string[] = [];
    for (const file of modules) {
      if (file.path === VOCABULARY_CONTRACT) continue;
      for (const utility of motionUtilities(file.source)) {
        if (
          utility.family === "duration" ||
          utility.family === "ease" ||
          utility.family === "delay"
        ) {
          offenders.push(`${file.path}: ${utility.marker}`);
        }
      }
    }
    expect(offenders, "no component may choose its own duration, easing, or delay").toEqual([]);
  });

  it("holds no time literal anywhere a motion utility is written", () => {
    // The arbitrary-value shapes — `duration-[220ms]`, `transition-[300ms]` — are the
    // same defect as `duration-200` and would otherwise pass the sweep above. Inline
    // styles are read here too, because an inline `style` is a source file declaring a
    // `transition` in exactly the sense the scenario names, and it was the one declaration
    // site this sweep did not look at.
    const offenders: string[] = [];
    for (const file of modules) {
      for (const literal of inventedTimesInMotion(file.source)) {
        offenders.push(`${file.path}: ${literal}`);
      }
    }
    expect(offenders, "a motion may not carry a duration of its own").toEqual([]);
  });

  it("catches a duration written inline, in every form a component writes one", () => {
    // The scenario says *every source file declaring a `transition` or an `animation`*, and
    // an inline style is one. It was invisible: `inventedTimes` only ever runs on
    // stylesheets, and the class-vocabulary sweep only read `className`, so a component
    // could write `transitionDuration: "220ms"` inline and every rule here stayed green.
    // Each of the three is a shape this repository could plausibly adopt — the first with
    // a literal class, the second with a computed one, the third as raw CSS text.
    expect(
      inventedTimesInMotion(
        '<li className="motion-feedback" style={{ transitionDuration: "220ms" }} />',
      ),
      "an inline object style beside a literal class vocabulary",
    ).toEqual(["transition-duration: 220ms"]);
    expect(
      inventedTimesInMotion('<li className={c} style={{ transitionDuration: "220ms" }} />'),
      "an inline object style beside a computed class vocabulary",
    ).toEqual(["transition-duration: 220ms"]);
    expect(
      inventedTimesInMotion('<li className={c} style="transition-duration: 220ms" />'),
      "an inline CSS text style, whose class vocabulary is computed",
    ).toEqual(["transition-duration: 220ms"]);

    // The shorthands and the delay longhand reach the DOM the same way.
    expect(inventedTimesInMotion('<div style={{ transition: "opacity 220ms" }} />')).toEqual([
      "transition: 220ms",
    ]);
    expect(inventedTimesInMotion('<div style={{ animationDelay: "1s" }} />')).toEqual([
      "animation-delay: 1s",
    ]);

    // And the negative cases, which are what keep the sweep worth running. A reference to
    // a declared step is the only legitimate way an inline style carries a duration…
    expect(
      inventedTimesInMotion('<div style={{ transitionDuration: "var(--motion-feedback)" }} />'),
      "a reference to a declared step",
    ).toEqual([]);
    expect(
      inventedTimesInMotion('<div style="transition-duration: var(--motion-feedback)" />'),
      "the same reference in CSS text",
    ).toEqual([]);
    // …an inline style that declares no motion is none of this rule's business, however
    // long its values are, and the application has three of them today.
    expect(
      inventedTimesInMotion('<div style={{ width: `${percent}%`, height: "120ms-ish" }} />'),
      "a layout value is not a duration",
    ).toEqual([]);
    expect(
      inventedTimesInMotion("<span style={accentWhen(shuffle)} />"),
      "an indirect style expression resolves to nothing here, and that is stated",
    ).toEqual([]);
    // And a data attribute that happens to be named `style` is not the attribute.
    expect(inventedTimesInMotion('<div data-style="transition-duration: 220ms" />')).toEqual([]);
  });

  it("confirms the detector can fail on every shape, so it is a check and not a report", () => {
    // Each shape is one a component could plausibly write. A rule proved only against
    // the phrasing its own author chose proves much less than it appears to.
    expect(inventedTimes("--motion-feedback: 120ms;"), "the vocabulary itself declares").toEqual([
      "120ms",
    ]);
    expect(
      inventedTimes("transition-duration: var(--motion-feedback);"),
      "a reference is not a value",
    ).toEqual([]);
    expect(inventedTimes("transition-duration: 220ms;")).toEqual(["220ms"]);
    expect(inventedTimes("animation: spin 1s linear infinite;")).toEqual(["1s"]);
    expect(inventedTimes("/* 300ms was tried here */\n.a { opacity: 1; }"), "prose").toEqual([]);
    expect(
      inventedTimes("setTimeout(retry, 250);"),
      "a number without a unit is not a duration",
    ).toEqual([]);

    // The class-name shapes, which is where a component actually writes one. Every one
    // of these is inside a real class vocabulary, so the sweep cannot be satisfied by a
    // matcher that only reads string literals.
    expect(
      motionUtilities('const cardClassName = "transition-colors";').map((u) => u.marker),
    ).toEqual(["transition-colors"]);
    expect(
      motionUtilities('const cardClassName = "rounded-cards bg-carbon motion-feedback";').map(
        (u) => u.marker,
      ),
    ).toEqual(["motion-feedback"]);
    expect(motionUtilities('const b = "hover:bg-graphite";').map((u) => u.marker)).toEqual([]);
    // A bare `transition` — which is what most of this repository actually wrote — is
    // caught, because the family matches without a value.
    expect(
      motionUtilities('const pillClassName = "rounded-buttons transition hover:scale-105";').map(
        (u) => u.marker,
      ),
    ).toEqual(["transition"]);
    // And prose that is not a class vocabulary is not a motion utility, however many
    // family words it contains. This is the pair of mistakes a literal-only matcher
    // makes in both directions.
    expect(
      motionUtilities('const message = "duration must be an integer";').map((u) => u.marker),
    ).toEqual([]);
    expect(
      motionUtilities("const label = `${formatClock(duration)} of ${x}`;").map((u) => u.marker),
    ).toEqual([]);

    expect(inventedTimesInMotion('const cClassName = "duration-[220ms]";')).toEqual([
      "duration-[220ms]: 220ms",
    ]);
    expect(
      inventedTimesInMotion(
        'const dClassName = "motion-feedback duration-[var(--motion-reveal)]";',
      ),
    ).toEqual([]);

    // The underscore-separated arbitrary value. Tailwind writes `_` where CSS has a space,
    // so `transition-[height_220ms]` is how a component spells "this transition, and this
    // is how long it takes" — and it is *two* defects in one class: a transition on a
    // layout property, and a duration the vocabulary does not own. `_` is a word character,
    // so the time pattern read the `220ms` as part of an identifier and reported nothing.
    expect(inventedTimesInMotion('const eClassName = "transition-[height_220ms]";')).toEqual([
      "transition-[height_220ms]: 220ms",
    ]);
    // The same shape with a declared step is the corrected spelling of that class, and it
    // is not reported — the sweep reads the duration, not the underscore.
    expect(
      inventedTimesInMotion(
        'const fClassName = "motion-feedback transition-[height_var(--motion-surface)]";',
      ),
    ).toEqual([]);

    // An inline style is a declaration site too, and these are its two forms.
    expect(
      inventedTimesInMotion('<li className="a" style={{ transitionDuration: "220ms" }} />'),
    ).toEqual(["transition-duration: 220ms"]);
    expect(
      inventedTimesInMotion('<li className={c} style="transition-duration: 220ms" />'),
    ).toEqual(["transition-duration: 220ms"]);
  });
});

describe("the vocabulary transitions only animatable properties (task 1.3, spec motion)", () => {
  it("transitions nothing that triggers layout", () => {
    // The scenario's whole claim. `height`, `width`, `top`, `margin`, `padding`, and
    // `font-size` are the ordinary way motion gets expensive, and each is named here so
    // that adding one is a deliberate act rather than a slip.
    //
    // Only the two declarations that *name properties to animate* are read: a
    // `transition-duration` or an `animation-iteration-count` names no property, and
    // treating its value as one produced three phantom offenders on the first run.
    const offenders: string[] = [];
    const allowed: readonly string[] = [...MOTION_PROPERTIES, ...MOTION_DISCRETE_PROPERTIES];
    for (const stylesheet of css) {
      for (const { property, value } of cssMotionDeclarations(stylesheet.source)) {
        if (property !== "transition" && property !== "transition-property") continue;
        for (const entry of value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)) {
          const animated = entry.split(/\s+/)[0] ?? "";
          if (animated === "all") {
            offenders.push(`${stylesheet.path}: transition-property: all`);
            continue;
          }
          if (!allowed.includes(animated))
            offenders.push(`${stylesheet.path}: ${property}: ${entry}`);
        }
      }
    }
    expect(offenders, "a transition may only be on opacity or transform").toEqual([]);
  });

  it("pairs each declared step with the properties it is actually used on", () => {
    // Task 1.3, second half: the pairing is checked against the stylesheet rather than
    // against itself, so a duration cannot widen its own permissions by being listed
    // more generously in the contract than in the rule that uses it.
    //
    // The `animation` shorthand's first token is the animation's *name*, not a
    // property — reading it as one made `--motion-marquee` look like it was declared to
    // animate `spotivibe-marquee`, which is why the name is skipped rather than checked.
    const declarations = cssMotionDeclarations(vocabularyCss).filter(
      (entry) => entry.property === "transition" || entry.property === "animation",
    );
    expect(declarations.length, "the vocabulary must actually declare transitions").toBeGreaterThan(
      0,
    );

    const seen = new Set<string>();
    for (const { property, value } of declarations) {
      for (const part of value.split(",")) {
        const tokens = part.trim().split(/\s+/).filter(Boolean);
        const steps = tokens.filter((token) => token.startsWith("var(--motion-"));
        if (steps.length === 0) continue;
        const animated = property === "animation" ? "" : (tokens[0] ?? "");
        for (const reference of steps) {
          const name = reference.replace(/^var\(|\)$/g, "");
          const step = MOTION_STEPS[name];
          expect(step, `${name} is used by ${property} but is not a declared step`).toBeTruthy();
          if (!step) continue;
          seen.add(name);
          if (animated === "" || animated === "all") continue;
          // A duration is the only step a `transition` is written for; an easing or a
          // travel value appears *inside* one and inherits its permissions.
          if (step.kind !== "duration") continue;
          if (MOTION_DISCRETE_PROPERTIES.includes(animated as never)) continue;
          expect(
            step.permitted as readonly string[],
            `${name} is written on ${animated}, which it may not animate`,
          ).toContain(animated);
        }
      }
    }
    // Every duration is really used, so "declared and paired" is not vacuously true of a
    // step nothing reached.
    for (const [name, step] of Object.entries(MOTION_STEPS)) {
      if (step.kind !== "duration") continue;
      expect(seen, `${name} is a duration but no declaration uses it`).toContain(name);
    }
  });

  it("gives the discrete property to the discrete-transition route and nothing else", () => {
    // `display` can only appear alongside `allow-discrete`; without it, `display` would
    // flip instantly and the exit it exists for would not happen at all.
    //
    // **The skip is narrowed to `animation`, and the narrowing is the point.** This loop
    // used to `continue` on both shorthands, which is why the spec's SHALL — *"a
    // declaration naming `display` SHALL also declare `allow-discrete`"* — was enforced by
    // nothing: the one place `display` is written in the whole application is *inside* a
    // `transition` shorthand (`styles/motion.css`, `.motion-surface`), so deleting
    // `allow-discrete` there left every assertion in the suite green. The
    // opacity/transform pairing rule above still skips the `transition` shorthand on
    // purpose, and that stays true; this rule is about a different property, and it has to
    // read the shorthand to see it.
    //
    // `animation` is the one shorthand still skipped, and for the reason the sibling rule
    // gives: its first token is the animation's *name*, not a property.
    for (const stylesheet of css) {
      for (const { property, value } of cssMotionDeclarations(stylesheet.source)) {
        if (property === "animation") continue;
        for (const part of value.split(",")) {
          const tokens = part.trim().split(/\s+/).filter(Boolean);
          const animated = tokens[0] ?? "";
          if (!MOTION_DISCRETE_PROPERTIES.includes(animated as never)) continue;
          expect(
            tokens,
            `${stylesheet.path}: ${property}: ${part.trim()} animates a discrete property without allow-discrete`,
          ).toContain("allow-discrete");
        }
      }
    }
  });

  it("writes no transform-based motion that a Tailwind transform utility could shadow", () => {
    // `motion-reveal`'s base rule declares *no* transform on purpose, so it can be added
    // to an element that already carries `scale-110` or `-translate-y-1` without
    // replacing it. Only `@starting-style` names a transform, and only for the arrival.
    const reveal = vocabularyCss.slice(vocabularyCss.indexOf(".motion-reveal {"));
    const base = reveal.slice(0, reveal.indexOf("}"));
    expect(base, "the base rule must not set a transform").not.toMatch(/transform\s*:/);
  });
});

describe("the preference collapses every motion (task 2.1, spec motion)", () => {
  it("declares one application-level rule, on the longhands, with !important", () => {
    // The mechanism, read rather than assumed: `!important` on the longhand beats the
    // `transition` **shorthand** every duration in the vocabulary is written into. That
    // specificity relationship is the whole reason the floor needs no per-component gate.
    const floor = globalsCss.slice(globalsCss.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(floor).toMatch(/animation-duration:\s*var\(--motion-floor\)\s*!important/);
    expect(floor).toMatch(/transition-duration:\s*var\(--motion-floor\)\s*!important/);
    expect(floor).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(floor).toMatch(/scroll-behavior:\s*auto\s*!important/);
    expect(floor, "the floor applies to every element, including pseudo-elements").toMatch(
      /\*,\s*\*::before,\s*\*::after\s*\{/,
    );
  });

  it("collapses a declared step's duration, because every duration is written into a transition", () => {
    // This is the mechanical reason the floor needs no per-component gate: a duration
    // that only ever appears as a custom property *value* would survive the override,
    // and a duration written into a `transition` shorthand cannot. Asserted per step.
    const durations = MOTION_STEP_ORDER.filter((name) => MOTION_STEPS[name]?.kind === "duration");
    expect(durations.length).toBeGreaterThan(0);
    for (const name of durations) {
      const used = new RegExp(`(^|[\\s,])var\\(${name}\\)`, "m").test(vocabularyCss);
      expect(used, `${name} must be written into a transition or animation to be collapsible`).toBe(
        true,
      );
    }
    expect(declaredSteps(vocabularyCss).get("--motion-floor"), "the floor's own value").toMatch(
      /^0\.0\d+ms$/,
    );
  });

  it("lets no rule re-set a duration outside the reduced-motion block, so the floor wins", () => {
    // A single `transition-duration: 220ms !important` outside the floor would beat it
    // and the claim would be false while every other check still passed.
    const offenders: string[] = [];
    for (const stylesheet of css) {
      const outside = code(stylesheet.source).split("@media (prefers-reduced-motion")[0] ?? "";
      for (const { property, value } of cssMotionDeclarations(outside)) {
        if (property === "transition-duration" || property === "animation-duration") {
          offenders.push(`${stylesheet.path}: ${property}: ${value}`);
        }
      }
    }
    expect(offenders, "only the reduced-motion block may set a duration longhand").toEqual([]);
  });

  it("holds the one place the whole tree mentions the preference, besides the contract", () => {
    // Both files are the floor itself. `usePrefersReducedMotion` is a *different* thing
    // and is asserted separately below; this rule is about the media query itself.
    //
    // Comments are stripped before the search, so documentation cannot be counted as a
    // second gate. What remains is three: the floor itself, the hook, and the
    // vocabulary's contract — which names the preference in the `--motion-floor` step's
    // own stated purpose, which is the one place a description *must* say what it does.
    const mentions = files
      .filter((file) => code(file.source).includes("prefers-reduced-motion"))
      .map((file) => file.path)
      .sort();
    expect(mentions).toEqual(
      [GLOBALS_CSS, VOCABULARY_CONTRACT, "hooks/usePrefersReducedMotion.ts"].sort(),
    );
  });
});

describe("the reduced-motion rule cannot be narrowed by a component (task 2.2, spec motion)", () => {
  it("has no component write its own @media rule", () => {
    const offenders = files
      .filter((file) => file.path !== GLOBALS_CSS)
      .filter((file) => /@media[^{]*prefers-reduced-motion/.test(file.source))
      .map((file) => file.path);
    // A second rule is a second mechanism: the global one already collapses every
    // declared duration, so a component rule can only be narrower or contradictory.
    expect(offenders, "the floor is application-level, so no component declares one").toEqual([]);
  });

  it("has no component gate a motion on the preference", () => {
    // A component that reached for `usePrefersReducedMotion` in order to *remove a
    // motion* would be building a second mechanism. The hook exists for the one thing
    // the CSS net genuinely cannot reach: an imperative JavaScript scroll.
    const offenders: string[] = [];
    for (const file of modules) {
      if (file.path === VOCABULARY_CONTRACT) continue;
      for (const utility of motionUtilities(file.source)) {
        if (/reducedMotion|prefersReducedMotion|prefers-reduced-motion/.test(utility.literal)) {
          offenders.push(`${file.path}: ${utility.marker}`);
        }
      }
    }
    expect(offenders, "a motion may not be gated per component").toEqual([]);
  });

  it("leaves the hook for what the global rule cannot reach: a JavaScript-driven scroll", () => {
    // Recorded rather than asserted away: `LyricsPanel` asks the question, and the one
    // thing it does with the answer is choose a `ScrollBehavior`. If a future surface
    // used it to suppress a CSS motion instead, the sweep above fails.
    const hookRel = "../src/hooks/usePrefersReducedMotion.ts";
    const hook = readFileSync(fileURLToPath(new URL(hookRel, import.meta.url)), "utf8");
    expect(hook).toContain("scrollBehaviorFor");
    expect(hook).toMatch(/behavior: "smooth"|"smooth"/);

    const importers = modules
      .filter((file) => /from\s+"@\/hooks\/usePrefersReducedMotion"/.test(file.source))
      .map((file) => file.path)
      .sort();
    expect(importers).toEqual(["features/lyrics/LyricsPanel.tsx"]);

    const panel = modules.find((file) => file.path === "features/lyrics/LyricsPanel.tsx");
    expect(panel).toBeTruthy();
    expect(code(panel!.source), "the answer is used for the scroll and nothing else").toContain(
      "scrollBehaviorFor(reducedMotion)",
    );
  });

  it("holds a reduced-motion string in no module at all, outside the two named files", () => {
    // A belt-and-braces reading of the rule above: a preference queried with a literal
    // instead of the shared hook is still a component asking the question itself.
    const offenders = modules
      .filter((file) => file.path !== "hooks/usePrefersReducedMotion.ts")
      .filter((file) => /(matchMedia|window\.matchMedia)\s*\(/.test(code(file.source)))
      .map((file) => file.path);
    expect(offenders, "matchMedia has one shared answer, in the hook").toEqual([]);
  });
});

describe("the motion surface is finite and self-limiting (tasks 3.6 and 4.1)", () => {
  it("names every module allowed to carry motion, and no module twice", () => {
    const keys = [...MOTION_ALLOWED.keys()];
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size, "a module may appear once").toBe(keys.length);
    for (const path of keys) {
      expect(
        files.map((file) => file.path),
        `${path} must exist`,
      ).toContain(path);
      expect(path, "allowances are src-relative, with forward slashes").not.toMatch(/\\/);
    }
  });

  it("states why every module is in scope, so an entry cannot be added silently", () => {
    for (const [path, allowance] of MOTION_ALLOWED) {
      expect(allowance.why.length, `${path} must record why it may animate`).toBeGreaterThan(40);
      expect(
        allowance.markers.length,
        `${path} must declare the motion it may carry`,
      ).toBeGreaterThan(0);
    }
  });

  it("carries no motion in any module outside the allowance, so the scope cannot widen by omission", () => {
    // Task 3.6. The set of modules that carry motion is the allowance's key set — not a
    // subset, not a superset. A new module with a `transition-*` fails here.
    const offenders: string[] = [];
    for (const file of modules) {
      if (MOTION_ALLOWED.has(file.path)) continue;
      if (file.path === VOCABULARY_CONTRACT) continue;
      for (const utility of motionUtilities(file.source)) {
        // `motion-*` is this milestone's vocabulary; a raw Tailwind transition or
        // animation is the drift the milestone exists to end. Both are offenders here.
        if (
          utility.marker.startsWith("motion-") ||
          utility.family === "transition" ||
          utility.family === "animate"
        ) {
          offenders.push(`${file.path}: ${utility.marker}`);
        }
      }
    }
    expect(offenders, "nothing outside the named surfaces is animated").toEqual([]);
  });

  it("carries exactly the declared motion in every allowed module, and no raw Tailwind motion", () => {
    // Task 4.2, the inverted default. Without this, deleting a milestone's motion from
    // a named surface would leave every rule above green — "no motion anywhere" would
    // pass a milestone whose whole claim is that it added some. So each module must
    // carry exactly its markers: a missing one fails, and an extra one fails.
    const offenders: string[] = [];
    for (const [path, allowance] of MOTION_ALLOWED) {
      const file = files.find((entry) => entry.path === path);
      expect(file, `${path} must be readable`).toBeTruthy();
      const found = new Set(motionUtilities(file!.source).map((utility) => utility.marker));
      // A marker may be satisfied by the module's own source or by the shared shell it renders
      // through (`delegatesTo`), which `tests/motion-scope.test.ts` proves really carries it. Both
      // routes put motion on a row a listener can see; what is forbidden is an allowance whose
      // markers reach nothing.
      const delegatedFile =
        allowance.delegatesTo === undefined
          ? undefined
          : files.find((entry) => entry.path === allowance.delegatesTo);
      if (allowance.delegatesTo !== undefined) {
        expect(delegatedFile, `${path} delegates to a module that must be readable`).toBeTruthy();
      }
      const delegated = new Set(
        delegatedFile ? motionUtilities(delegatedFile.source).map((utility) => utility.marker) : [],
      );

      for (const marker of allowance.markers) {
        expect(
          [...found].includes(marker) || delegated.has(marker),
          `${path} must carry ${marker}`,
        ).toBe(true);
      }
      for (const marker of found) {
        const raw = /^transition-|^animate-/.test(marker);
        const inherited: readonly string[] = Object.values(INHERITED_MOTION);
        if (raw && !inherited.includes(marker)) {
          offenders.push(`${path}: ${marker} (a raw Tailwind motion utility)`);
        }
      }
    }
    expect(offenders, "the milestone's motion is vocabulary-only").toEqual([]);
  });

  it("names the vocabulary classes and the inherited markers as the only legal spellings", () => {
    // The complete set of markers any module may legally declare. Widening it is a
    // one-line edit to a named, reviewed list — which is the point: widening is visible.
    const legal = new Set<string>([...MOTION_CLASSES, ...Object.values(INHERITED_MOTION)]);
    const used = new Set<string>();
    for (const file of modules) {
      for (const utility of motionUtilities(file.source)) used.add(utility.marker);
    }
    const unknown = [...used].filter((marker) => !legal.has(marker));
    expect(unknown, "an unrecognised motion spelling").toEqual([]);
    expect(legal.size, "the legal spellings stay a short list").toBeLessThanOrEqual(8);
  });

  it("bounds how many modules may be in scope, so 'animate everything' cannot creep in", () => {
    // The roadmap's own non-goal, made into a number. Motion was already present in 24
    // modules before this milestone, so a bound of 34 says "these, and no others" without
    // pretending the application has fewer surfaces than it does.
    expect(MOTION_ALLOWED.size).toBeLessThanOrEqual(34);
  });

  it("never loops except on the state-bound indicators this milestone inherited", () => {
    // `Skeleton`'s placeholder and a busy spinner report that something is in flight;
    // they are the only way a listener learns a load is happening, and both are
    // conditional on it. The one *decorative* indefinite animation — the Now Playing
    // marquee — is applied only when the component measured that the title overflows and
    // is cancelled outright under `prefers-reduced-motion`.
    //
    // So the rule is: exactly one stylesheet may declare an indefinite animation, and it
    // is the vocabulary, and the floor's `animation-iteration-count: 1` collapses it.
    const indefinite = css
      .filter((stylesheet) => /animation[^;{}]*\binfinite\b/.test(code(stylesheet.source)))
      .map((stylesheet) => stylesheet.path);
    expect(indefinite, "only the vocabulary declares an indefinite animation").toEqual([
      VOCABULARY_CSS,
    ]);
    expect(vocabularyCss).toMatch(
      /animation:\s*spotivibe-marquee var\(--motion-marquee\) linear infinite/,
    );
    expect(globalsCss).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(globalsCss).toMatch(/\.now-playing-marquee\s*\{\s*animation:\s*none\s*!important/);

    for (const marker of Object.values(INHERITED_MOTION)) {
      const holders = [...MOTION_ALLOWED.entries()]
        .filter(([, allowance]) => allowance.markers.includes(marker))
        .map(([path]) => path);
      expect(
        holders.length,
        `${marker} must be pinned to the modules that carry it`,
      ).toBeGreaterThan(0);
    }
  });
});

describe("the whole tree agrees the motion lives in one place", () => {
  it("lets only three files name a motion step at all", () => {
    // `styles/motion.css` declares them; `styles/motionTokens.ts` is their contract;
    // `app/globals.css` applies `--motion-floor`, because the reduced-motion rule *is*
    // the application-level use of the vocabulary. Any fourth file mentioning a step is
    // a component reaching into the vocabulary instead of applying a class — which is
    // how a component ends up owning a duration after all.
    const mentions = files
      .filter((file) => /--motion-/.test(file.source))
      .map((file) => file.path)
      .sort();
    expect(mentions).toEqual([GLOBALS_CSS, VOCABULARY_CSS, VOCABULARY_CONTRACT].sort());
  });

  it("states the floor's own value in exactly one file, so it cannot drift", () => {
    expect(wholeTree.split("0.01ms").length - 1, "0.01ms appears once, in the vocabulary").toBe(1);
  });
});
