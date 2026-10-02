import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * M17 task 6.4 (design decision 6 — "No motion in M17").
 *
 * The claim is that this milestone introduces **no animation**, so that M19 can
 * establish one motion vocabulary deliberately instead of standardising four.
 *
 * This is the one test in the change that reads source rather than behaviour, and
 * it is worth being explicit about why. A DOM walk cannot answer the question: the
 * `Shelf`, `Button`, and `ShelfTrackCard` primitives this milestone reuses *do*
 * carry motion utilities, so an element inside a new surface is not evidence about
 * anything the milestone wrote. The property is about the vocabulary the new
 * modules *declare*, and the only instrument that can see a declaration is the
 * declaration itself. The alternative — asserting that nothing in a rendered
 * subtree carries a utility — would either fail on inherited primitives or need an
 * allowlist, and an allowlist that grows is exactly the drift M19 has to inherit.
 *
 * The check is deliberately wider than "class names": it looks at **every** string
 * literal in the new modules. A motion utility can only reach the DOM through a
 * literal — inline, or through a module-level constant — so a wider net cannot
 * miss one, and it costs nothing. Comments are stripped first, so a module is still
 * free to explain the decision in prose.
 *
 * **The coverage is discovered, not typed.** The previous version of this file held
 * a hand-written list of nine modules, and its own coverage assertion walked one
 * directory — so dropping `src/features/home/ProbeM17Motion.tsx` containing
 * `export const PROBE = "animate-pulse";` into the tree left the guard 4/4 green.
 * A detector that only sees the modules somebody remembered to list is a report,
 * not a check. The milestone's whole source surface is `src/features/home`, so
 * that tree is walked recursively and the set is the walk's result: a module added
 * there cannot be left out, which is the property the previous version lacked.
 *
 * Two modules in that tree predate M17 and keep the motion utilities they already
 * had — {@link REUSED_WITH_MOTION}. They are named *with the exact utilities they
 * carry*, so the list cannot absorb a new module: adding a clean one fails, and so
 * does adding motion to one of them. That is what keeps "the milestone reused
 * these" checkable rather than assumed, without an open-ended allowlist.
 */

// Keep the literal in a variable — Vite rewrites an inline `new URL("<literal>")`.
const srcRel = "..";
const frontendDir = fileURLToPath(new URL(srcRel, import.meta.url));
const srcDir = join(frontendDir, "src");

/**
 * Modules outside `features/home` the milestone edited.
 *
 * `Shelf` gained the one typed attribute the band-aware shelf needs; it is listed so
 * the milestone's coverage does not stop at the directory boundary, and it declares
 * no motion today, which the rule below enforces.
 */
const ALSO_EDITED = ["components/recommendations/Shelf.tsx"] as const;

/**
 * Modules in the milestone's scope that predate it, with the exact motion utilities
 * they already carried.
 *
 * `HomeView.tsx` is the M8 genre tile's `hover:bg-graphite` and `ShelfTrackCard.tsx`
 * is the shared shelf card's own; M17 reused both without touching either. Pinning
 * the utilities rather than merely the fact of them is deliberate: a milestone that
 * added `animate-` to either would fail here instead of passing on a stale note.
 */
const REUSED_WITH_MOTION: Readonly<Record<string, readonly string[]>> = {
  "features/home/HomeView.tsx": ["transition-"],
  "features/home/ShelfTrackCard.tsx": ["transition-"],
};

/** Tailwind motion utilities, in the spellings this project uses. */
const MOTION_UTILITIES = ["transition-", "animate-"];

/**
 * Every module the milestone added or touched, as paths relative to `src`.
 *
 * `features/home` walked recursively plus {@link ALSO_EDITED}: derived from the tree
 * the milestone wrote in, so nothing can be added there and left unchecked.
 */
function M17_MODULES(): string[] {
  const root = join(srcDir, "features", "home");
  const inTree = readdirSync(root, { withFileTypes: true, recursive: true }).flatMap((entry) => {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    return [relative(srcDir, join(entry.parentPath, entry.name)).replace(/\\/g, "/")];
  });
  return [...new Set([...inTree, ...ALSO_EDITED])].sort();
}

/** The modules that must declare no motion utility at all. */
function M17_NEW_MODULES(): string[] {
  return M17_MODULES().filter((module) => !(module in REUSED_WITH_MOTION));
}

/** Read one module by its `src`-relative path. */
function read(relativeToSrc: string): string {
  return readFileSync(join(srcDir, ...relativeToSrc.split("/")), "utf8");
}

/** Comments removed, so prose can neither satisfy nor fail the rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Every string literal in a module: inline attributes and module constants alike. */
function stringLiterals(source: string): string[] {
  const code = stripComments(source);
  const literals: string[] = [];
  for (const match of code.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    // Module specifiers cannot carry a class, and the one URL-shaped literal these
    // modules hold is a test id.
    if (/^[@./]/.test(value) && !value.includes(" ")) continue;
    literals.push(value);
  }
  return literals;
}

/** The motion utilities a module's literals declare. */
function motionUtilities(source: string): string[] {
  const found = new Set<string>();
  for (const literal of stringLiterals(source)) {
    for (const utility of MOTION_UTILITIES) {
      if (literal.includes(utility)) found.add(utility);
    }
  }
  return [...found];
}

describe("M17 adds no motion vocabulary", () => {
  it("declares no motion utility in any new module", () => {
    const offenders: Array<{ file: string; utilities: string[] }> = [];
    for (const relative of M17_NEW_MODULES()) {
      const utilities = motionUtilities(read(relative));
      if (utilities.length > 0) offenders.push({ file: relative, utilities });
    }
    // M19 owns motion; a utility here would be motion it then has to standardise
    // or remove, which is the same mistake as a second mix generator, one layer
    // down.
    expect(offenders, "M17 must not introduce animation").toEqual([]);
  });

  it("covers every module the milestone added or touched", () => {
    const modules = M17_MODULES();
    expect(modules.length).toBeGreaterThan(0);

    // The discovered set contains the milestone's own surfaces, asserted rather than
    // assumed — a walk that returned nothing would otherwise satisfy every rule here.
    for (const expected of [
      "features/home/TimeShelf.tsx",
      "features/home/timeBands.ts",
      "features/home/homeFilter.ts",
      "features/home/HomeFilterBar.tsx",
      "features/home/quickPicks.ts",
      "features/home/QuickPicksShelf.tsx",
      "features/home/mixes/MixCards.tsx",
      "features/home/mixes/namedMixes.ts",
      "features/home/mixes/collage.ts",
      ...ALSO_EDITED,
    ]) {
      expect(modules, `${expected} must be checked for motion`).toContain(expected);
    }

    // Every file named as pre-existing is really in the walked tree, so a rename
    // cannot quietly turn a reused module into an unchecked one.
    for (const reused of Object.keys(REUSED_WITH_MOTION)) {
      expect(modules, `${reused} must still be discovered`).toContain(reused);
    }

    // The pure modules are in the scope too: a class vocabulary can only belong in a
    // component, and asserting the derivations declare none keeps that true rather
    // than assumed.
    expect(modules.filter((module) => !module.endsWith(".tsx"))).toContain(
      "features/home/timeBands.ts",
    );
  });

  it("confirms the reused modules carry exactly the motion they already had", () => {
    // The list of pre-existing modules is pinned to the *utilities*, not to a fact.
    // Without that it could absorb a brand-new module, and the rule above would stop
    // being a rule — this is what makes the allowlist finite and self-limiting.
    for (const [module, utilities] of Object.entries(REUSED_WITH_MOTION)) {
      expect(motionUtilities(read(module)), `${module} must keep only its own motion`).toEqual([
        ...utilities,
      ]);
    }

    // And the flip side, stated as one equality rather than a loop: the reused list
    // is *exactly* the set of scoped modules that carry motion. A new module with a
    // utility fails here and in the rule above; a clean one cannot be added to the
    // list, because the pin above would reject it.
    const carrying = M17_MODULES().filter((module) => motionUtilities(read(module)).length > 0);
    expect(carrying.sort()).toEqual(Object.keys(REUSED_WITH_MOTION).sort());
  });

  it("confirms the detector can fail, so it is a check and not a report", () => {
    // The two shapes a utility can take: inline on the element, and hoisted into a
    // module constant and interpolated. Both must be caught.
    expect(motionUtilities('const a = "transition-colors";')).toEqual(["transition-"]);
    expect(
      motionUtilities(
        'export const CARD = "rounded-cards bg-carbon animate-pulse";\n<a className={CARD} />;',
      ),
    ).toEqual(["animate-"]);
    expect(motionUtilities('const b = "hover:bg-graphite";')).toEqual([]);

    // A module is still free to *explain* the decision in prose, and a template
    // literal's motion utility is still caught inside it.
    expect(motionUtilities("// no transition- or animate- utility here\nconst c = 1;")).toEqual([]);
    expect(motionUtilities("const d = `flex ${x} transition-all`;")).toEqual(["transition-"]);

    // And the scoped modules all pass, or the rule would be reporting noise.
    for (const relative of M17_NEW_MODULES()) {
      expect(motionUtilities(read(relative)), relative).toEqual([]);
    }
  });

  it("still allows the reused primitives to carry their own motion", () => {
    // Stated so the scope of the rule is on the record: this milestone did not
    // touch the design system, and the primitives the new surfaces reuse keep the
    // utilities they already had.
    const shelf = readFileSync(
      join(frontendDir, "src", "components", "recommendations", "Shelf.tsx"),
      "utf8",
    );
    const button = readFileSync(
      join(frontendDir, "src", "components", "design-system", "Button.tsx"),
      "utf8",
    );
    expect(motionUtilities(shelf).length + motionUtilities(button).length).toBeGreaterThan(0);
  });
});
