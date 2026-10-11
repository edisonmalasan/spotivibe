import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * No test file may list a directory with `readdirSync`.
 *
 * ## What this forbids, and why forbidding is the only decidable form
 *
 * `verification-integrity` requires every reader of the application source tree to tolerate a file that
 * vanished between being listed and being read, and to report each one while the caller asserts none was
 * reported. That requirement was true for four milestones and discharged by **one** of fourteen readers:
 * M25 built `readTree` and applied it to `architecture.test.ts`, the single file it was shown, and thirteen
 * other readers kept listing a tree and reading each listed file with a bare `readFileSync`. M31 then hit
 * the consequence for real — `ENOENT ... ProbeM19Motion.tsx` inside `branding.test.tsx`.
 *
 * The obvious guard infers "does this read depend on a listing?" and that inference was attempted **five
 * times** before this file was written. Every attempt was correct about what it could see and blind to
 * the next thing:
 *
 *   1. text search for `ENOENT` — called three readers tolerant; all three mentions were **comments**
 *   2. TypeScript comment scanner — stopped after 12,767 tokens and never reached line 3401, so the
 *      comment it was stripping survived, restoring the very hole it was added to close
 *   3. AST, "calls readdirSync" — flagged a log-directory walk because the file mentions `src` somewhere
 *   4. AST, "read inside a loop" — counted loops over **constant arrays** as listings, and missed reads
 *      reached through a helper function
 *   5. transitive resolution through local bindings and helpers — missed `branding.test.tsx`, the reader
 *      that failed live, because its `files` const is function-local
 *
 * That is M21's twelve rounds arriving from a different direction, so this guard does not infer it.
 *
 * ## The rule instead
 *
 * Two rules, because one of them does not cover the requirement on its own.
 *
 * **Rule 1 — `readdirSync` may not appear in a test file at all.** List a tree through `readTree`/
 * `readTreeStrict` from `tests/helpers/sourceTree.ts`. Then a reader that rolls its own walker is caught
 * **by construction** rather than by analysis, and the check reduces to one AST question — is there a
 * `readdirSync` call expression — with no dataflow, no constant folding and no name resolution, therefore
 * nothing a decoy can manipulate.
 *
 * **Rule 2 — a file that imports `walk` may not `readFileSync` inside a loop.** Rule 1 alone leaves a hole
 * that matters: `walk` lists paths *without* tolerance, so a file could list through it and then read each
 * entry itself, skipping whatever vanished and recording nothing. That is exactly the second failure the
 * requirement names — a reader that tolerates the race **without reporting it** — and a skip that is never
 * reported is indistinguishable from a reader that never listed the file at all.
 *
 * The rule was first written as "imports `walk` and calls `readFileSync` **anywhere**", and that was
 * immediately too broad: `encoding-integrity.test.ts` reads one named file for an unrelated assertion, the
 * rule cannot tell that from "reads every entry the walk returned", and the only way to satisfy it was to
 * route a named read through a directory listing it had no business using. The loop is what makes this a
 * decision rather than a heuristic — list-then-read-each-entry is a read in a loop; reading a path you
 * already knew is not, and is not in the race class.
 *
 * A handful of genuine non-reads remain, each listed below with its reason. They are **exemptions with a
 * stated reason, not a silent skip**, because a guard that exempts a category quietly is how the previous
 * milestone's gap survived four of them.
 *
 * ## What this guard does not detect (stated, not implied)
 *
 * A listing obtained by importing a walker from a **new** module is not traced: the checks are on the call
 * and on the named import, not on the data. `helpers/sourceTree.ts` and `helpers/motionSource.ts` are the two
 * places a listing currently enters a test, and both are inside `helpers/`, which this guard does not scan.
 * A future helper that lists and returns paths could reintroduce the race without tripping either rule — so
 * Rule 2 is why `walk` may not be re-exported from a second module without this file being updated with it.
 */

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");
const TESTS = join(FRONTEND, "tests");

/**
 * `file:line` of a listing that is allowed to remain, and **why**.
 *
 * Every entry is a site that does not read the entries it lists. A site that reads one per listed entry is
 * a bug, not an exemption, and adding one here to silence this guard is the failure mode to watch for —
 * which is why each reason is asserted to be non-empty rather than merely present.
 */
const EXEMPT: ReadonlyArray<{ at: string; why: string }> = [
  {
    at: "architecture.test.ts",
    why:
      "Lists ONLY frontend/ top level, non-recursively, for next.config.* — and frontend/ contains " +
      "node_modules, so routing it through the RECURSIVE readTree was tried and made the suite 312s and " +
      "red. The probe that races is written inside src/, which this listing never sees, so there is " +
      "nothing here that can vanish. This file's MAIN source-tree reading already goes through readTree.",
  },
  {
    at: "source-tree-readers.test.ts",
    why:
      "This file. A detector necessarily contains the patterns it detects: it lists tests/ to find test " +
      "files, and its synthetic fixtures are literal source containing readdirSync( and an import of " +
      "walk. Exempting it is correct rather than convenient — the alternative would be to weaken the " +
      "detector until it could not see itself, which is the defect this whole change exists to close.",
  },
  {
    at: "motion-scope.test.ts",
    why:
      "The writer, not a reader. It lists src/features/sharing to assert its own probe is on disk, then " +
      "reads that one named file. The requirement's own scenario requires the probe to sit where the " +
      "guard under test walks it, so this site cannot be made race-tolerant and must not be.",
  },
  {
    at: "evidence-scripts.test.ts",
    why:
      "Lists directory NAMES to locate the archived change directory, then reads a small set of fixed " +
      "paths. Nothing writes to openspec/changes/archive at test time, so there is no race to tolerate.",
  },
  {
    at: "gate-batch-apparatus.test.ts",
    why:
      "Asserts a log directory is EMPTY: expect(existsSync(logDir) ? readdirSync(logDir) : []).toEqual([]). " +
      "No read follows, and an assertion about emptiness cannot itself race.",
  },
  {
    at: "release-gate-install.test.ts",
    why:
      "Asserts an mkdtemp scratch directory is EMPTY: expect(readdirSync(tmpRoot)).toEqual([]). No read " +
      "follows. The same file's OTHER listing (line 207) does read every entry and was converted.",
  },
];

function testFiles(dir: string = TESTS): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "helpers" ? [] : testFiles(full);
    return /\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Parse once per file; both checks read the same tree.
 *
 * A regex on the raw text would also match a `readdirSync` inside a comment or a string — and M21's
 * CRITICAL C1 is exactly that: `expect(source).toContain("...")` is satisfied by a comment, so commenting
 * out the code leaves the suite green. Two of this repository's own test files discuss ENOENT in prose, so
 * the hole is not hypothetical here.
 *
 * Rather than strip comments (a TypeScript comment scanner was tried and silently gave up on a long file),
 * this reads the syntax tree: a comment is not a node, so there is nothing to misread.
 */
function parse(source: string): ts.SourceFile {
  return ts.createSourceFile(
    "guard.ts",
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
}

/** Line numbers of `readdirSync` call expressions, found as syntax rather than as text. */
function listingLines(sf: ts.SourceFile): number[] {
  const found: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "readdirSync"
    ) {
      found.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * Whether `source` imports `walk` from the helper, or calls `readFileSync` **inside a loop**.
 *
 * Both are syntax-level questions, so neither depends on where anything is used.
 */
function importsWalk(source: string): boolean {
  return /import\s*\{[^}]*\bwalk\b[^}]*\}\s*from\s*["'][^"']*helpers\/sourceTree["']/.test(source);
}

/**
 * `readFileSync` calls nested inside a loop.
 *
 * **The loop is what makes this a decision rather than a heuristic.** An earlier version of this rule was
 * "imports `walk` AND calls `readFileSync` anywhere", and it immediately cost real work:
 * `encoding-integrity.test.ts` reads one named file (`selectFormat.ts`) for an unrelated assertion, and
 * the rule cannot tell that read from "reads every entry the walk returned". Converting it was the only way
 * to satisfy the rule, so a named read was routed through a directory listing it had no business using.
 *
 * That is the shape of defect this repository keeps paying for: a rule broad enough to be simple, punishing
 * a correct file so it stops tripping. Reading *in a loop* is the shape of the actual defect — list, then
 * read each listed entry — and a single top-level read of a named file is not in the race class at all.
 */
function readsInLoop(sf: ts.SourceFile): boolean {
  const isRead = (node: ts.Node): boolean =>
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "readFileSync";

  let found = false;
  /** Methods whose first argument is a callback invoked once per element, so it iterates. */
  const ITERATORS = new Set(["forEach", "map", "flatMap", "filter", "some", "every", "reduce"]);

  const visit = (node: ts.Node, iterating: boolean): void => {
    if (found) return;

    if (iterating && isRead(node)) {
      found = true;
      return;
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callback = node.arguments[0];
      if (ITERATORS.has(node.expression.name.text) && callback && ts.isArrowFunction(callback)) {
        // Only the callback body counts as iterating. The enclosing arguments are not part of the
        // iteration, so a `.filter(...)` whose *predicate* reads is not a read-per-entry — the earlier
        // version flagged the call itself and so tripped on `readTreeStrict(dir).filter(predicate)`.
        ts.forEachChild(callback.body, (child) => visit(child, true));
        // Walk this call's remaining arguments without the iterating flag.
        for (const argument of node.arguments) {
          if (argument !== callback) visit(argument, false);
        }
        return;
      }
    }

    const inLoop =
      iterating ||
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node);
    ts.forEachChild(node, (child) => visit(child, inLoop));
  };
  visit(sf, false);
  return found;
}

/**
 * Every test file, analysed **once**.
 *
 * The seven tests below each need most of this, and the first version re-read and re-parsed all ~190
 * files on every one of them — seven full parses of the test tree, which is the kind of load that pushes a
 * neighbouring suite over its timeout on a busy machine rather than showing up as this file being slow.
 * Parsing is the expensive half; the results do not depend on which test asked.
 */
interface Analysis {
  file: string;
  listings: number[];
  importsWalk: boolean;
  readsInLoop: boolean;
}

let cache: Analysis[] | undefined;

function analysed(): Analysis[] {
  if (cache) return cache;
  cache = testFiles().map((file) => {
    const source = readFileSync(file, "utf8");
    const sf = parse(source);
    return {
      file: file.slice(TESTS.length + 1).replace(/\\/g, "/"),
      listings: listingLines(sf),
      importsWalk: importsWalk(source),
      readsInLoop: readsInLoop(sf),
    };
  });
  return cache;
}

function exempt(name: string): boolean {
  return EXEMPT.some((entry) => entry.at === name);
}

describe("no test file lists a directory with readdirSync", () => {
  it("finds no listing outside the declared exemptions", () => {
    const offenders = analysed()
      .filter((entry) => entry.listings.length > 0 && !exempt(entry.file))
      .map((entry) => `${entry.file}:${entry.listings.join(",")}`);

    expect(
      offenders,
      "these test files list a directory with readdirSync and read what they listed. Route the read " +
        "through readTreeStrict from tests/helpers/sourceTree.ts so a file that vanishes is reported " +
        "rather than thrown — or add an exemption with a stated reason if the listing reads nothing.",
    ).toEqual([]);
  });

  it("no file lists through the untolerated walk and then reads the listing itself", () => {
    // Rule 2, and the hole Rule 1 leaves. `walk` returns paths without tolerating a file that vanished, so
    // reading through it reproduces the original defect with the listing imported rather than written — and
    // a skip that records nothing is the failure the requirement names second.
    const offenders = analysed()
      .filter((entry) => entry.importsWalk && entry.readsInLoop && !exempt(entry.file))
      .map((entry) => entry.file);

    expect(
      offenders,
      "these files list with walk() and read each listed entry themselves, so a file that vanishes is " +
        "skipped without being reported. Use readTreeStrict, which reports and fails.",
    ).toEqual([]);
  });

  it("has an exemption list that is non-vacuous and every entry justified", () => {
    // A guard whose exemptions were deleted must fail, and so must one whose exemption reasons were
    // emptied. Otherwise the list can be emptied to make the guard pass, which is the same as having no
    // guard — and it would pass silently.
    expect(EXEMPT.length).toBeGreaterThan(0);
    expect(
      new Set(EXEMPT.map((entry) => entry.at)).size,
      "a duplicated exemption hides the other",
    ).toBe(EXEMPT.length);
    for (const entry of EXEMPT) {
      expect(entry.why.trim().length, `${entry.at} must state why`).toBeGreaterThan(40);
    }
  });

  it("names only files that exist, and no exemption is stale", () => {
    // The other direction of the same trap: an exemption naming a file that no longer lists anything is a
    // hole left open by a rename. If a future refactor makes an exempt site compliant, the exemption
    // should have been deleted rather than left to cover nothing.
    //
    // **A line-number snapshot was considered and rejected.** The obvious stronger version records the
    // line each exemption covers, and that fails the moment anyone adds a line above it — training people
    // to edit the exemption list rather than read it, which is the failure this whole change exists to
    // stop. The property that actually matters is "this file still lists something".
    const byName = new Map(analysed().map((entry) => [entry.file, entry]));
    for (const entry of EXEMPT) {
      const found = byName.get(entry.at);
      expect(found, `${entry.at} no longer exists`).toBeDefined();
      expect(
        found!.listings.length,
        `${entry.at} is exempt but no longer lists anything — delete the exemption`,
      ).toBeGreaterThan(0);
    }
  });

  it("would classify the real readers as it classifies synthetic ones", () => {
    // Witnessed on inputs, not asserted by inspection. Each case is classified by the SAME function the
    // guard uses, so a bug in `listingLines` shows up here rather than as a guard that silently passes.
    const cases: Array<[string, number[]]> = [
      ["// readdirSync(dir)\nexport const a = 1;", []],
      ["const x = readdirSync(dir);", [1]],
      ['const s = "readdirSync(dir)";', []],
      ["for (const n of readdirSync(d, { withFileTypes: true })) {}", [1]],
      ["/*\n * readdirSync(dir)\n */\nexport const b = 2;", []],
    ];
    for (const [source, expected] of cases) {
      expect(listingLines(parse(source))).toEqual(expected);
    }
  });

  it("classifies the walk/read pairing the same way on synthetic input", () => {
    // Rule 2's detector, witnessed rather than asserted by inspection. The third column is the property
    // this rule was narrowed to keep: a read that is NOT in a loop is a read of a named file, which is not
    // in the race class and must not be punished.
    const cases: Array<[string, boolean, boolean]> = [
      [
        'import { walk } from "./helpers/sourceTree";\nexport const f = walk("src");\n' +
          'export const s = readFileSync(f, "utf8");',
        true,
        false, // a single named read: allowed, and the case that cost real churn when it was not
      ],
      [
        'import { walk } from "./helpers/sourceTree";\n' +
          'for (const f of walk("src")) {\n  readFileSync(f, "utf8");\n}',
        true,
        true, // reads every listed entry: the original defect, now written with an imported listing
      ],
      [
        'import { walk } from "./helpers/sourceTree";\n' +
          'for (const f of walk("src")) {\n  try { readFileSync(f, "utf8"); } catch {}\n}',
        true,
        true, // tolerates and reports nothing
      ],
      [
        'import { walk } from "./helpers/sourceTree";\n' +
          "for (const f of walk('src')) {\n  // readFileSync(f) only in a comment\n}",
        true,
        false,
      ],
      [
        'import { readTreeStrict } from "./helpers/sourceTree";\nexport const s = "x";',
        false,
        false,
      ],
      [
        // A `.filter` whose PREDICATE is a read-per-entry is iterating; one whose arguments merely mention
        // a read is not. Conflating the two is what flagged `encoding-integrity.test.ts`, whose
        // `readTreeStrict(dir, {extensions}).filter(({file}) => ...)` selects names rather than reading.
        'import { walk } from "./helpers/sourceTree";\n' +
          'export const kept = walk("src").filter((f) => readFileSync(f, "utf8") !== "");',
        true,
        true,
      ],
      [
        'import { walk } from "./helpers/sourceTree";\n' +
          'export const kept = walk("src").filter((f) => f.endsWith(".ts"));',
        true,
        false,
      ],
      [
        'import { walk } from "./other/helpers";\n' +
          'for (const f of walk("src")) {\n  readFileSync(f, "utf8");\n}',
        false, // a listing from a DIFFERENT module is not traced; stated, not implied
        true,
      ],
    ];
    for (const [source, wantsWalk, wantsLoopedRead] of cases) {
      const label = source.split("\n")[0]!.slice(0, 44);
      expect(importsWalk(source), `walk import in: ${label}`).toBe(wantsWalk);
      expect(readsInLoop(parse(source)), `read in loop in: ${label}`).toBe(wantsLoopedRead);
    }
  });

  it("finds a comment-shaped read as no read, because a comment is not a node", () => {
    // M21's CRITICAL C1 asserted directly against this guard's second rule: a `readFileSync` in prose must
    // not count as one, or the rule can be satisfied by writing about compliance instead of complying.
    const prose =
      'import { walk } from "./helpers/sourceTree";\n' +
      "// This file would call readFileSync(f) if it wanted to.\n" +
      "/*\n * for (const f of walk('src')) readFileSync(f)\n */\n";
    expect(importsWalk(prose)).toBe(true);
    expect(readsInLoop(parse(prose))).toBe(false);
  });
});
