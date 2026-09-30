import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * M14 task 4.3: the design tokens' own contrast, computed rather than eyeballed.
 *
 * The browser audit in `evidence/audit.mjs` measures contrast on rendered pages, which
 * is the property that matters - but it only sees the pairs a route happens to paint,
 * at the viewport it happens to use. An earlier version of this test listed pairs from
 * memory and three of them failed, and every failure was the *test's* fault rather than
 * the palette's: DESIGN.md assigns Steel and Signal Red to borders and decorative
 * details, and never uses them for text.
 *
 * So the rule here is about **usage**, which is checkable and cannot rot:
 *
 * 1. A token used for readable text - an element carrying one of the type-scale
 *    utilities - must meet WCAG AA (4.5:1) against every page surface.
 * 2. A token that is not on the declared text list may still colour icons, borders,
 *    and disabled controls, and its role is named in DESIGN.md.
 *
 * Writing `<span className="text-caption text-fog">` fails rule 1. That is exactly the
 * defect this milestone fixed: the compact shell's inactive navigation label was
 * painted in fog at 4.16:1 on carbon, and the desktop-viewport audit could not see it
 * because the compact shell does not render at 1280px.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, "..");
const SRC = join(FRONTEND, "src");
const TOKENS = readFileSync(join(SRC, "styles", "tokens.css"), "utf8");

/** Every `--color-*` the token layer declares. */
function tokens(): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of TOKENS.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    found.set(match[1], match[2]);
  }
  return found;
}

/**
 * The surfaces text is painted on, taken from the token layer rather than assumed.
 *
 * `smoke` matters as much as the page background: it is the hover surface, so text
 * painted on it is text a person reads while hovering.
 */
const SURFACES = ["carbon", "void-black", "graphite", "smoke"] as const;

/**
 * Tokens the interface may paint readable text with.
 *
 * Each is documented for text in DESIGN.md, and each clears AA on every surface. A
 * token absent from this list is a border, an icon, or a decorative accent - its role
 * is DESIGN.md's, and rule 1 keeps it out of text.
 */
const TEXT_TOKENS = ["pure-white", "mist", "spotify-green"] as const;

/**
 * Utilities that share the `text-` prefix without naming a colour.
 *
 * Without this list the rule would report `text-left` and `text-nowrap` as unreadable
 * text in a token called "left", which is how a check like this gets ignored.
 */
const LAYOUT_UTILITIES = new Set([
  "left",
  "right",
  "center",
  "justify",
  "start",
  "end",
  "wrap",
  "nowrap",
  "ellipsis",
  "balance",
  "pretty",
  "sm",
  "base",
  "lg",
  "xs",
  "xl",
]);

/** The type-scale utilities, which mark an element as one that holds readable text. */
const SIZE_UTILITIES = [
  "text-caption",
  "text-body",
  "text-body-lg",
  "text-label",
  "text-title-lg",
  "text-h1",
];

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(bbackgroundGuard(background))].sort(
    (a, b) => b - a,
  );
  return (light + 0.05) / (dark + 0.05);
}

/** Accept either a raw hex value or a token name, so callers read clearly. */
function bbackgroundGuard(background: string): string {
  return background.startsWith("#") ? background : (tokens().get(background) ?? "#000000");
}

function componentFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if ([".tsx"].includes(extname(entry.name))) found.push(full);
    }
  };
  walk(dir);
  return found;
}

describe("the declared text tokens meet their minimums (task 4.3)", () => {
  const declared = tokens();

  it("reads the tokens the rules depend on", () => {
    // A guard on the guard: an unreadable token file would make every rule below pass
    // for the wrong reason.
    expect(declared.size).toBeGreaterThan(8);
    for (const name of [...TEXT_TOKENS, ...SURFACES]) {
      expect(declared.has(name), name).toBe(true);
    }
  });

  it("clears AA on every surface a page can paint text over", () => {
    const failures: string[] = [];
    for (const name of TEXT_TOKENS) {
      const foreground = declared.get(name);
      if (!foreground) {
        failures.push(`${name}: token not declared`);
        continue;
      }
      for (const surface of SURFACES) {
        const background = declared.get(surface);
        if (!background) {
          failures.push(`${surface}: surface token not declared`);
          continue;
        }
        const ratio = contrastRatio(foreground, background);
        if (ratio < 4.5) {
          failures.push(`${name} on ${surface}: ${ratio.toFixed(2)}:1, needs 4.5:1`);
        }
      }
    }
    expect(failures, "every declared text token must clear AA on every surface").toEqual([]);
  });
});

describe("readable text only ever uses a token that clears AA (task 4.3)", () => {
  it("finds the text elements in the components", () => {
    // The same guard on the guard: a walker that stopped finding text elements would
    // make the rule below vacuous.
    const files = componentFiles(SRC);
    expect(files.length, "the walker must reach the components").toBeGreaterThan(30);
    const withText = files.filter((file) =>
      SIZE_UTILITIES.some((utility) => readFileSync(file, "utf8").includes(utility)),
    );
    expect(withText.length, "components using the type scale").toBeGreaterThan(10);
  });

  it("paints no readable text in a token that fails its minimum", () => {
    const palette = tokens();
    const offenders: string[] = [];
    for (const file of componentFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      const where = relative(SRC, file).replace(/\\/g, "/");
      // One className attribute at a time, so a colour on a parent and a size on a
      // child are not mistaken for one element.
      for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const attribute = source.slice(0, match.index);
        const classNames = `${match[1] ?? ""} ${match[2] ?? ""}`;
        if (!SIZE_UTILITIES.some((utility) => classNames.includes(utility))) continue;

        // A decorative element is not readable text. The whole opening tag is
        // considered, because `aria-hidden` sits before the className on the same tag.
        const openingTag = source.slice(source.lastIndexOf("<", match.index), match.index);
        if (/aria-hidden/.test(openingTag)) continue;

        // Each quoted string inside the className is one *branch* of the element's
        // styling - a ternary's arms, or a variant list. Pairing a colour with a
        // background across branches invents combinations that never render: the
        // search mode toggle's inactive arm is `bg-carbon text-mist`, and reading the
        // template as one list paired it with the active arm's `bg-pure-white` and
        // reported 2.10:1 for text that is never painted that way.
        const branches = [...classNames.matchAll(/"([^"]*)"/g)].map((entry) => entry[1]);
        if (branches.length === 0) branches.push(classNames);

        for (const branch of branches) {
          const backgrounds = [...branch.matchAll(/\bbg-([a-z][a-z-]*)\b/g)].map((m) => m[1]);
          for (const tokenMatch of branch.matchAll(/\btext-([a-z][a-z-]*)\b/g)) {
            const token = tokenMatch[1];
            // A size utility, an alignment utility, or a colour of a different element.
            if (SIZE_UTILITIES.includes(`text-${token}`)) continue;
            if (LAYOUT_UTILITIES.has(token)) continue;

            // Text painted on its own background - `bg-pure-white text-void-black` - is
            // checked as the pair it is, against the background it is actually paired
            // with. This is how the search mode toggle and the accent buttons work.
            const paired = backgrounds.find(
              (background) => palette.has(background) && palette.has(token),
            );
            if (paired !== undefined) {
              const ratio = contrastRatio(palette.get(token)!, palette.get(paired)!);
              if (ratio < 4.5) {
                offenders.push(`${where}: text-${token} on bg-${paired} is ${ratio.toFixed(2)}:1`);
              }
              continue;
            }

            if (TEXT_TOKENS.includes(token as never)) continue;
            if (!palette.has(token)) {
              // A class that matches no token paints nothing at all, which is how a dead
              // utility hides a real defect: two role="alert" paragraphs carried
              // `text-error`, which has no token, and rendered in the inherited colour.
              offenders.push(`${where}: text-${token} matches no declared token`);
              continue;
            }
            offenders.push(
              `${where}: readable text in text-${token}, which is not a declared text token`,
            );
          }
        }
      }
    }
    expect(offenders, "readable text must use a token that clears AA").toEqual([]);
  });

  it("names the tokens DESIGN.md assigns to non-text roles", () => {
    // The rule above excludes these by omission, which would quietly permit a border
    // token to become body text later. Naming them here keeps the exclusion deliberate:
    // each is documented in DESIGN.md for borders, icon fills, or decorative detail.
    const design = readFileSync(join(FRONTEND, "docs", "DESIGN.md"), "utf8");
    for (const [token, role] of [
      ["steel", "secondary borders"],
      ["fog", "secondary icon fills"],
      ["signal-red", "decorative"],
    ] as const) {
      const row = design.split("\n").find((line) => line.includes(`\`#`) && line.includes(token));
      expect(row, `${token} must still be documented in DESIGN.md`).toBeDefined();
      // The role is asserted rather than assumed, so a later retokenizing has to update
      // this test and say why.
      expect(design.toLowerCase()).toContain(role.toLowerCase());
    }
  });
});

/** Token names present in the token layer, for the usage rule's validation. */
function declaredTokens(): Set<string> {
  return new Set(tokens().keys());
}
