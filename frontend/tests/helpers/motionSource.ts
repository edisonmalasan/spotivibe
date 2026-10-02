import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reading the source tree for the M19 motion checks (spec `motion`; tasks 1.2, 2.2,
 * 3.6, 4.1).
 *
 * **The coverage is walked, never typed.** `home-m17-no-motion.test.ts` — the guard
 * M19 generalises — learned the hard way that a hand-written module list is a report
 * rather than a check: M18's verification found a module it never looked at. So this
 * module returns *everything* under `src/`, and every rule is written against that set
 * rather than against a list somebody remembered to update. A new file is covered the
 * moment it exists.
 *
 * **What counts as motion here, and what does not.** The hard part of a motion
 * detector in a TypeScript codebase is that the word "transition" is also ordinary
 * English: `playerStore` writes "the same transition a failed refill uses", and
 * `usePrefersReducedMotion`'s own documentation is full of the word. Comments are
 * stripped first, so prose can neither satisfy nor fail a rule; and only **string
 * literals** are inspected, because a Tailwind utility can reach the DOM only through
 * a literal — inline, or hoisted into a module constant — and a matching rule applied
 * to arbitrary code would match its own detector.
 */

// Keep the literal in a variable — Vite rewrites an inline `new URL(".", import.meta.url)`
// into a non-`file:` URL under the jsdom environment, and `fileURLToPath` rejects it.
const testsRel = "..";
const FRONTEND = join(fileURLToPath(new URL(testsRel, import.meta.url)), "..");

/** `frontend/`, resolved from this file rather than from the working directory. */
export const FRONTEND_ROOT = FRONTEND;

/** `frontend/src`. */
export const SRC_ROOT = join(FRONTEND, "src");

export interface SourceFile {
  /** Path relative to `src`, always with forward slashes. */
  readonly path: string;
  readonly source: string;
}

/** Every source and stylesheet under `src`, discovered rather than listed. */
export function sourceFiles(): SourceFile[] {
  const found: SourceFile[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|css)$/.test(entry.name)) {
        found.push({
          path: relative(SRC_ROOT, full).split(sep).join("/"),
          source: readFileSync(full, "utf8"),
        });
      }
    }
  };
  walk(SRC_ROOT);
  return found.sort((left, right) => left.path.localeCompare(right.path));
}

/** One module, read by its `src`-relative path. */
export function readSource(relativeToSrc: string): string {
  return readFileSync(join(SRC_ROOT, ...relativeToSrc.split("/")), "utf8");
}

/**
 * Comments removed, so prose can neither satisfy nor fail a rule.
 *
 * `//` is only treated as a comment when it is not the body of a URL, which is why
 * the negative lookbehind is there: stripping `https://…` would concatenate the two
 * halves of a line and hide a real declaration behind it.
 */
export function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Every string literal in a module: double-quoted, single-quoted, or template. */
export function stringLiterals(source: string): string[] {
  const literals: string[] = [];
  for (const match of code(source).matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    literals.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return literals;
}

/**
 * The Tailwind motion-utility families, plus the vocabulary's own classes.
 *
 * **A family, not a spelling.** Matching `transition-` alone would miss a bare
 * `transition` — which is what most of this repository actually wrote — and matching
 * `animate-` alone would miss `animate-pulse`. Each family is recorded with the
 * *value* that followed it, so `duration-200` (Tailwind's own scale, 200 ms) is
 * reported separately from `transition-colors` and cannot hide inside it.
 *
 * `motion` is this milestone's own three classes, so a rule can tell a vocabulary
 * class from a raw Tailwind utility by the family alone.
 */
export const MOTION_FAMILIES = [
  "transition",
  "animate",
  "duration",
  "ease",
  "delay",
  "motion",
] as const;

export type MotionFamily = (typeof MOTION_FAMILIES)[number];

/** True for the three classes the vocabulary owns, false for everything Tailwind ships. */
export function isVocabularyMarker(marker: string): boolean {
  return MOTION_FAMILIES.includes("motion") && marker.startsWith("motion-");
}

/** True for a Tailwind transition or animation, which the vocabulary replaces. */
export function isRawMotionUtility(marker: string): boolean {
  return /^(transition|animate)(-|$)/.test(marker);
}

/**
 * A motion utility found in a class vocabulary.
 *
 * `marker` is the whole matched utility (`transition-colors`, `duration-[220ms]`) and
 * `family` is which axis it belongs to, so a caller can apply a rule per axis: a
 * `duration-*` utility is a duration invented outside the vocabulary, and a
 * `transition-*` utility is a raw Tailwind transition.
 */
export interface MotionUtility {
  readonly marker: string;
  readonly family: MotionFamily;
  /** The class vocabulary the marker was found in, so a failure names what it was written on. */
  readonly literal: string;
}

/**
 * One motion utility per distinct marker, in source order.
 *
 * The value arm accepts a bracketed arbitrary value so `duration-[220ms]` is reported
 * whole. That is not cosmetic: the reported marker is what a failure names, and
 * `duration` alone would point at the wrong spelling of the defect.
 */
const UTILITY =
  /(?<![a-zA-Z0-9_-])((?:[a-z0-9-]+:)*(transition|animate|duration|ease|delay|motion)(?:-[a-zA-Z0-9]*|\[[^\]]*\])*)/g;

/**
 * The text a balanced JSX or JavaScript expression occupies, starting at `from`.
 *
 * A class name can be written inline (`className="a transition-colors b"`), in a
 * container expression (`className={cond ? "a" : "b transition-colors"}`), or hoisted
 * into a constant. Reading the *whole* expression rather than one literal is what makes
 * all three visible, and it is what keeps an error message like
 * `"duration must be an integer"` out of the results: that string is not in a class
 * vocabulary at all.
 */
function balanced(source: string, from: number): string {
  const opener = source[from];
  if (opener === undefined) return "";
  // A quoted literal ends at its matching quote. Handled before the container scan
  // below, because the first version let the container logic see its own opening quote
  // and skip straight past the closing one — which turned every `className="…"` into
  // "the rest of the file", and every rest of the file into a class vocabulary.
  if (opener === '"' || opener === "'" || opener === "`") {
    for (let index = from + 1; index < source.length; index += 1) {
      if (source[index] === "\\") {
        index += 1;
        continue;
      }
      if (source[index] === opener) return source.slice(from, index + 1);
    }
    return source.slice(from);
  }
  if (opener !== "{") return "";
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    const character = source[index];
    // A nested literal inside a container is skipped whole, so a brace inside a
    // string cannot unbalance the scan.
    if (character === '"' || character === "'" || character === "`") {
      for (let quote = index + 1; quote < source.length; quote += 1) {
        if (source[quote] === "\\") {
          quote += 1;
          continue;
        }
        if (source[quote] === character) {
          index = quote;
          break;
        }
      }
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(from, index + 1);
    }
  }
  return source.slice(from);
}

/**
 * An identifier that names a class vocabulary: `pillButtonClassName`, `itemClass`.
 *
 * Two details, both found by the detector failing on real files:
 *
 * - the value may be a quoted literal **or** a container expression, and a matcher that
 *   only accepted `{` missed `const railClassName =\n  "motion-reveal grid …"` — which
 *   is exactly the shape the shelf rail uses;
 * - the optional type annotation may not span `;`, `{`, `}`, or a newline. Without
 *   that, the annotation after the first `track: Track;` in a `ResultMenuProps`
 *   interface greedily reached the next `=` in the file — `const itemClassName =` —
 *   swallowed it, and the shelf rail's own class name went unread.
 */
const CLASS_NAME_BINDING = /\b([A-Za-z_$][\w$]*)\s*(?::[^=;{}\n]+)?=\s*(?=\{|["'`])/g;

/** Every class vocabulary in a module: `className`/`class` attributes and class constants. */
export function classVocabularies(source: string): string[] {
  const stripped = code(source);
  const spans: string[] = [];
  const skipSpace = (from: number): number => {
    let index = from;
    while (index < stripped.length && /\s/.test(stripped[index])) index += 1;
    return index;
  };
  for (const match of stripped.matchAll(/\b(?:className|class)\s*=\s*/g)) {
    spans.push(balanced(stripped, skipSpace(match.index + match[0].length)));
  }
  for (const match of stripped.matchAll(CLASS_NAME_BINDING)) {
    const name = match[1] ?? "";
    if (!/(?:ClassName|ClassNames|Class|Classes|CLASS)$/.test(name)) continue;
    spans.push(balanced(stripped, skipSpace(match.index + match[0].length)));
  }
  return spans.filter((span) => span !== "");
}

/** Every motion utility a module's class vocabularies declare. */
export function motionUtilities(source: string): MotionUtility[] {
  const found = new Map<string, MotionUtility>();
  for (const vocabulary of classVocabularies(source)) {
    for (const match of vocabulary.matchAll(UTILITY)) {
      const marker = match[1] ?? "";
      if (marker === "") continue;
      if (!found.has(marker)) {
        found.set(marker, {
          marker,
          family: match[2] as MotionFamily,
          // The vocabulary itself is kept whole rather than truncated: one rule matches a
          // motion marker whose *class list* also mentions the reduced-motion preference,
          // and a 120-character window would have hidden that pairing on the longest
          // control in the application.
          literal: vocabulary,
        });
      }
    }
  }
  return [...found.values()];
}

/** Just the markers, sorted — the shape a pin is compared against. */
export function motionMarkers(source: string): string[] {
  return motionUtilities(source)
    .map((utility) => utility.marker)
    .sort();
}

/**
 * A time literal: `120ms`, `14s`, `.22s`, `0.01ms`.
 *
 * The leading `_` arm is load-bearing. Tailwind writes a multi-value arbitrary value with
 * `_` where CSS would have a space, so `transition-[height_220ms]` is the shape a component
 * actually writes when it reaches for a duration on something the vocabulary forbids — and
 * `_` is a word character, so the original `[^\w.-]` guard read that `220ms` as part of an
 * identifier rather than as a time and let it through. `220ms` is now reported, and
 * `transition-[height_var(--motion-surface)]` still is not, because its duration is a
 * reference to a declared step rather than a value of its own.
 */
const TIME = /(?:^|[^\w.-]|_)(\d*\.?\d+)(ms|s)\b/g;

/** `style={{ … }}` or `style="…"`. The lookbehind keeps `data-style="…"` out. */
const INLINE_STYLE_BINDING = /(?<![\w-])style\s*=\s*/g;

/**
 * Every `style` attribute in a module, as the expression it holds.
 *
 * `style={{ … }}` and `style="…"` are the only two ways an inline style reaches the DOM
 * from a component, and they are written interchangeably by whoever writes the component.
 * Neither was read before, which is how a component could invent a duration — the scenario
 * says *every source file declaring a `transition` or `animation`*, and an inline style is
 * exactly that — while every sweep in `motion-vocabulary.test.ts` stayed green:
 * {@link inventedTimes} is only ever called on stylesheets, and
 * {@link inventedTimesInMotion} only read class vocabularies.
 *
 * `style={someHelper(flag)}` — the indirect form, `PlaybackControls`' `accentWhen` — is
 * deliberately returned with no declarations rather than resolved. Resolving it would mean
 * evaluating the module, which is not what a source reader does, and the helper's own body
 * is a string literal in the same file, so a duration written into it is still visible to a
 * rule that reads string literals.
 */
function inlineStyleExpressions(source: string): string[] {
  const stripped = code(source);
  const found: string[] = [];
  for (const match of stripped.matchAll(INLINE_STYLE_BINDING)) {
    let index = match.index + match[0].length;
    while (index < stripped.length && /\s/.test(stripped[index])) index += 1;
    const opener = stripped[index];
    if (opener !== "{" && opener !== '"' && opener !== "'") continue;
    const expression = balanced(stripped, index);
    if (expression !== "") found.push(expression);
  }
  return found;
}

/** `transitionDuration` → `transition-duration`, so both spellings read the same. */
function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

/**
 * The properties an inline `style` can name that declare a motion.
 *
 * `transitionProperty` and `animationIterationCount` are included and harmlessly empty of
 * time values; excluding them would only be a way for `transition-property: display` to be
 * written in an inline style and go unread.
 */
const INLINE_MOTION_PROPERTY = /^(?:transition|animation)(?:-[a-z-]+)?$/;

/**
 * `name: value`, `name: "value"`, and `name: 'value'`, in one pass.
 *
 * The name allows `-` so the CSS-text form (`style="transition-duration: 220ms"`) and the
 * object form (`style={{ transitionDuration: "220ms" }}`) are one shape rather than two
 * patterns; the lookbehind stops a match from starting part-way through an identifier.
 */
const INLINE_DECLARATION =
  /(?<![\w$-])([A-Za-z][A-Za-z0-9-]*)\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^,}]*))/g;

/**
 * Every time literal an inline `style` writes on a motion property of its own.
 *
 * The negative check is {@link inventedTimesInMotion}'s: a duration inside a
 * `var(--motion-…)` is a reference to a declared step, which is the only legitimate way an
 * inline style carries one. Each finding is named by the CSS property it was written on, in
 * CSS spelling, so a failure says *what* was written rather than only that a number was.
 */
export function inventedTimesInInlineStyles(source: string): string[] {
  const found: string[] = [];
  for (const expression of inlineStyleExpressions(source)) {
    for (const match of expression.matchAll(INLINE_DECLARATION)) {
      const property = kebab(match[1] ?? "");
      if (!INLINE_MOTION_PROPERTY.test(property)) continue;
      const value = match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
      for (const time of code(value).matchAll(TIME)) {
        const literal = `${time[1]}${time[2]}`;
        const before = time[0].slice(0, time[0].indexOf(literal));
        if (/var\(\s*$/.test(before)) continue;
        found.push(`${property}: ${literal}`);
      }
    }
  }
  return [...new Set(found)];
}

/**
 * Every time literal in the module that is **not** a `var(--motion-…)` reference.
 *
 * The negative check matters: `--motion-feedback: 120ms` is the vocabulary
 * *declaring* a step and is the one legitimate place a number appears. Everything
 * else is a component choosing its own duration, which is the defect this catches.
 */
export function inventedTimes(source: string): string[] {
  const found: string[] = [];
  for (const match of code(source).matchAll(TIME)) {
    const literal = `${match[1]}${match[2]}`;
    // A duration inside a `var()` is a reference to a declared step, not a new one.
    const before = match[0].slice(0, match[0].indexOf(literal));
    if (/var\(\s*$/.test(before)) continue;
    found.push(literal);
  }
  return [...new Set(found)];
}

/**
 * Every time literal a module writes where it is declaring motion for itself.
 *
 * The narrow form of {@link inventedTimes}: `setTimeout(retry, 120)` is not motion,
 * and `"120ms"` as an arbitrary Tailwind value on some unrelated property is not
 * either. A time literal only matters when it appears alongside a motion utility,
 * because that is the shape a component inventing its own duration takes.
 *
 * **Two places, not one.** A class vocabulary is where most of this repository writes
 * motion, and it was the only place read — so `style={{ transitionDuration: "220ms" }}`
 * passed, which is a component choosing its own duration through the one route the
 * vocabulary rule does not mention. The inline styles are read here for that reason, and
 * the same sweep names the file they were found in.
 */
export function inventedTimesInMotion(source: string): string[] {
  const found: string[] = [];
  for (const utility of motionUtilities(source)) {
    for (const match of utility.literal.matchAll(TIME)) {
      const literal = `${match[1]}${match[2]}`;
      const before = match[0].slice(0, match[0].indexOf(literal));
      if (/var\(\s*$/.test(before)) continue;
      found.push(`${utility.marker}: ${literal}`);
    }
  }
  return [...new Set([...found, ...inventedTimesInInlineStyles(source)])];
}

/** One CSS motion declaration, with the value that was written. */
export interface CssMotionDeclaration {
  readonly property: string;
  readonly value: string;
}

/**
 * The CSS motion declarations in a stylesheet.
 *
 * Scoped to the motion properties rather than to "anything with a colon in it",
 * because a naive `property: value` scan reads `a:hover` as a declaration named `a`.
 * The property list is the one this project writes, and it includes every longhand of
 * both shorthands — so `transition-property: height` cannot slip past a check that
 * only looked for `transition:`.
 */
const CSS_MOTION_PROPERTY =
  /\b(transition|transition-property|transition-duration|transition-delay|transition-behavior|animation|animation-name|animation-duration|animation-delay|animation-iteration-count|animation-timing-function)\s*:\s*([^;{}]+)/g;

export function cssMotionDeclarations(source: string): CssMotionDeclaration[] {
  const found: CssMotionDeclaration[] = [];
  for (const match of code(source).matchAll(CSS_MOTION_PROPERTY)) {
    const property = match[1] ?? "";
    const value = (match[2] ?? "").trim();
    // A selector's own pseudo-class carries a colon but no value; a declaration does.
    if (property === "" || value === "") continue;
    found.push({ property, value });
  }
  return found;
}

/** The `var(--motion-…)` names a stylesheet references. */
export function referencedSteps(source: string): string[] {
  return [
    ...new Set([...code(source).matchAll(/var\(\s*(--motion-[a-z-]+)/g)].map((m) => m[1] ?? "")),
  ].filter((name) => name !== "");
}

/** The `--motion-…` custom properties a stylesheet declares, with their values. */
export function declaredSteps(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of code(source).matchAll(/(--motion-[a-z-]+)\s*:\s*([^;{}]+)/g)) {
    const name = match[1] ?? "";
    if (name === "" || found.has(name)) continue;
    found.set(name, (match[2] ?? "").trim());
  }
  return found;
}
