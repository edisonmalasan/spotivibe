import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";

import {
  cascadeReason,
  dependencyTreeState,
  isShortCircuited,
  prepareDependencies,
  promoteStagedInstall,
  stageInstall,
} from "../../openspec/changes/archive/2026-09-30-add-release-validation-and-deployment/evidence/lib/install.mjs";
import {
  beginRouting,
  createReadiness,
  pausedAction,
  PAUSED_ACTION,
} from "../../openspec/changes/archive/2026-09-30-add-release-validation-and-deployment/evidence/lib/router.mjs";
import {
  classifyPausedRequest,
  fallbackPlan,
  pausedRequestHandlers,
  PAUSED_OUTCOME,
  resolvePausedRequest,
} from "../../openspec/changes/archive/2026-09-30-add-release-validation-and-deployment/evidence/lib/harness.mjs";

/**
 * The release gate's dependency preparation.
 *
 * M21 replaced a `npm ci` that deleted `node_modules` before installing. The recorded failure was
 * an `EPERM` on a native module held by a running dev server, which left 19 packages, no `.bin`,
 * and a `next` without its `package.json` — after which every later gate item failed for a reason
 * that was not the code.
 *
 * ## Why this file exists at all
 *
 * The gate is 780 lines and had **no tests whatsoever**. That is the same defect class as everything
 * else M21 found: a mechanism whose correctness is asserted in prose. A replacement for a
 * destructive step, written without tests, is a replacement that is trusted because it reads
 * carefully.
 *
 * ## Why the fixtures are built from a name list written here
 *
 * `BINARIES` and `PACKAGES` below are this file's own belief about what the later gate steps
 * invoke. They are deliberately **not** imported from the module under test: a fixture derived from
 * the implementation's own list would keep passing if that list were wrong, which is precisely the
 * failure the completeness check exists to catch. If the module later requires something this file
 * does not know about, the "a complete tree needs no install" test fails — a real signal rather than
 * a silent agreement.
 *
 * ## Why nothing here touches the repository
 *
 * Every fixture is built under the system temporary directory. A test in this repository that wrote
 * into `frontend/src/` collided with the guard that walks that tree, and M21's other half is the
 * fix for exactly that. Writing the tests to the same standard they are asserting is the least
 * defensible thing available.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, "..");
const EVIDENCE = join(
  FRONTEND,
  "..",
  "openspec",
  "changes",
  "archive",
  "2026-09-30-add-release-validation-and-deployment",
  "evidence",
);

/** What the gate's later steps invoke: lint, format, typecheck, test, build, and its own test items. */
const BINARIES = ["eslint", "prettier", "tsc", "next", "vitest"];

/**
 * Packages whose manifest must be readable.
 *
 * `next` is here because the recorded failure broke it while leaving its bin shim, so a check on
 * the binary alone would have called that tree complete.
 */
const PACKAGES = ["next", "vitest", "eslint"];

const shim = (name: string): string => (process.platform === "win32" ? `${name}.cmd` : name);

/** A temporary directory removed after each test, so a failed test does not leak a whole tree. */
const scratch: string[] = [];
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gate-install-test-"));
  scratch.push(dir);
  return dir;
}
afterEach(() => {
  while (scratch.length > 0) {
    rmSync(scratch.pop()!, { recursive: true, force: true });
  }
});

/** Build a `node_modules` containing exactly what a usable dependency tree would contain. */
function populateModules(root: string): string {
  const modules = join(root, "node_modules");
  mkdirSync(join(modules, ".bin"), { recursive: true });
  for (const name of BINARIES) {
    writeFileSync(join(modules, ".bin", shim(name)), "@echo off\r\n", "utf8");
  }
  for (const name of PACKAGES) {
    mkdirSync(join(modules, name), { recursive: true });
    writeFileSync(join(modules, name, "package.json"), '{"name":"x"}\n', "utf8");
  }
  return modules;
}

/** A frontend directory with a lockfile and a dependency tree in the given condition. */
function frontend(
  condition: "complete" | "no-modules" | "no-bin" | "no-next-manifest" | "empty-manifest",
) {
  const root = scratchDir();
  writeFileSync(join(root, "package.json"), '{"name":"frontend"}\n', "utf8");
  writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}\n', "utf8");

  switch (condition) {
    case "complete":
      populateModules(root);
      break;
    case "no-modules":
      break;
    case "no-bin":
      populateModules(root);
      rmSync(join(root, "node_modules", ".bin", shim("tsc")));
      break;
    case "no-next-manifest":
      populateModules(root);
      rmSync(join(root, "node_modules", "next", "package.json"));
      break;
    case "empty-manifest":
      populateModules(root);
      // An interrupted `npm ci` leaves this behind, and `existsSync` calls it present.
      writeFileSync(join(root, "node_modules", "next", "package.json"), "", "utf8");
      break;
  }
  return root;
}

/**
 * A byte-level record of a directory tree, so "untouched" is a measurement rather than a hope.
 */
function fingerprint(root: string): string {
  const entries: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else entries.push(`${full.slice(root.length)}:${readFileSync(full).toString("base64")}`);
    }
  };
  walk(root);
  return entries.join("\n");
}

/**
 * Source with every comment removed, so a source assertion cannot match a comment.
 *
 * ## Why this exists, and why it is the second time in one commit
 *
 * Two of this file's own assertions failed on first run, both for the same reason, and it is the
 * same defect this change exists to fix. `startRouting`'s ordering assertion compared the index of
 * `routerPaused = true` against the index of `Fetch.enable` — and the **explanatory comment
 * written to describe that very bug** mentions `Fetch.enable` first, so the check was reading the
 * prose. The second failed because the comment quotes the original broken guard verbatim
 * (`if (sessionId !== pageSession() || !routerPaused) return;`), so the assertion meant to prove the
 * drop was gone matched the sentence recording that it once was.
 *
 * A guard that matches the documentation instead of the code is a guard that passes on a comment
 * saying the opposite of what it claims to check. M20 found this three times, in arms that matched
 * a token as the documentation spelled it. It is not a subtle failure and it is not rare.
 *
 * Comments are removed rather than avoided, because a check that only works while nobody explains
 * the code stops being runnable the first time somebody does.
 *
 * String literals are preserved, so a `//` inside a URL is not mistaken for a comment — a real
 * risk in this repository, which contains many of them.
 */
function code(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const char = source[i]!;
    if (quote) {
      out += char;
      if (char === "\\") {
        out += source[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      out += char;
      i += 1;
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      // An unterminated block comment would otherwise swallow the rest of the file and make every
      // later assertion vacuously true — which is the failure mode this function exists to avoid,
      // so it refuses rather than guesses.
      if (end === -1) throw new Error("unterminated block comment");
      out += "\n".repeat((source.slice(i, end).match(/\n/g) ?? []).length);
      i = end + 2;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/**
 * The source text of one node of `source`, located by a real parse rather than by a pattern.
 *
 * **Round 9's W1: the two windows this replaces were `/id:\s*"gates-install"[\s\S]*?\n  \},/` and
 * `/if \(isShortCircuited…\{[\s\S]*?\n {2}\}/`, and a regex cannot say how far it went.** Round 7 answered
 * that with an *extent anchor* — exactly one `id:` key — and round 9 defeated the anchor in both directions:
 *
 *   - **widening, falsely counted.** An `id:` inside a *string value*, or a second `id:`-shaped token that
 *     is not an item boundary, increments the count, so the window can cover two items and still read 1.
 *   - **narrowing, not counted at all.** The anchor was a *lower* bound, so a window cut short passed. The
 *     `gates-install` item ends at `how: "install"` — everything after it is comments, which `code()` strips
 *     — so truncating anywhere after `how:` satisfies every content assertion. Measured: **168 characters of
 *     a 1358-character item, and the assertion whose stated purpose is "the extracted window must cover
 *     exactly the gates-install item" reported that it did.**
 *
 * A second anchor was rejected on purpose. Round 7's lesson says an anchor must test **extent**, not
 * content — so the *extent itself* has to stop being a guess. `typescript` is already a dependency of the
 * type check, and a parse gives the node's own span: the item's text is the object's text, by construction,
 * with no pattern that can stop early or run on.
 *
 * `code()` strips comment bodies but replaces each with newlines, so line structure survives and the spans
 * below index the same text the assertions read.
 */
function nodeSource(file: ts.SourceFile, node: ts.Node): string {
  return file.text.slice(node.getStart(file), node.getEnd());
}

/**
 * The parsed gate source.
 *
 * One parse, shared by everything below. The first version of `itemSource` parsed the module here *and*
 * inside `namedArrayLiterals`, kept the second `SourceFile` in a variable it never read, and eslint said
 * so — which is the correct answer to an unused value. Two parses of one file is not a style problem
 * here: **two answers about one document is the shape every finding in this change has had**, and a
 * helper that locates a thing by name should be handed the document, not re-derive it.
 */
function parseGate(source: string): ts.SourceFile {
  return ts.createSourceFile(
    "release-gate.mjs",
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
}

/** Every `const <name> = [ … ]` array literal in the file, by name. Refuses a duplicate name. */
function namedArrayLiterals(file: ts.SourceFile): Map<string, ts.ArrayLiteralExpression> {
  const found = new Map<string, ts.ArrayLiteralExpression>();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (!ts.isArrayLiteralExpression(declaration.initializer)) continue;
      const name = declaration.name.text;
      if (found.has(name)) {
        throw new Error(
          `refusing to read '${name}': the file declares it twice. A name that does not identify one ` +
            "thing cannot be used to locate it, and taking the first would be choosing by position.",
        );
      }
      found.set(name, declaration.initializer);
    }
  }
  return found;
}

/**
 * The text of the element of the `arrayName` array whose `id:` is `id`.
 *
 * Refuses rather than guesses at both levels, for the reason `helpers/yaml.ts` now refuses at every level:
 * zero matches is `null`, two or more is a throw naming them. An element is found by the value of its `id`
 * key **within that array**, so an unrelated object literal elsewhere in the file carrying the same `id`
 * cannot stand in for the item.
 */
function itemSource(source: string, arrayName: string, id: string): string {
  const file = parseGate(source);
  const array = namedArrayLiterals(file).get(arrayName);
  if (array === undefined) {
    throw new Error(
      `refusing to read '${arrayName}': no top-level array of that name is declared in the file.`,
    );
  }

  const matching = array.elements.filter((element) => {
    if (!ts.isObjectLiteralExpression(element)) return false;
    const property = element.properties.find(
      (candidate) =>
        ts.isPropertyAssignment(candidate) &&
        ts.isIdentifier(candidate.name) &&
        candidate.name.text === "id",
    );
    return (
      property !== undefined &&
      ts.isPropertyAssignment(property) &&
      ts.isStringLiteral(property.initializer) &&
      property.initializer.text === id
    );
  });

  if (matching.length === 0) {
    throw new Error(
      `refusing to read item '${id}': ${arrayName} has no element whose id is that. Every assertion ` +
        "about it would be vacuous, which is the failure this milestone exists to remove.",
    );
  }
  if (matching.length > 1) {
    throw new Error(
      `refusing to read item '${id}': ${matching.length} elements of ${arrayName} carry it (elements ` +
        `${matching.map((element) => array.elements.indexOf(element)).join(", ")}). The id does not ` +
        "identify one item, so reading the first would be choosing by position.",
    );
  }

  return nodeSource(file, matching[0]);
}

/**
 * The text of the single `if` statement whose condition mentions `marker`, or `null` if there is none.
 *
 * Same discipline as `itemSource`: zero is `null`, two or more throws naming them. The cascade assertions
 * are about one branch, and "the first `if` mentioning this" would be the round-9 defect wearing a
 * different hat.
 */
function branchSource(source: string, marker: string): string | null {
  const file = parseGate(source);

  const matching: ts.IfStatement[] = [];
  const visit = (node: ts.Node): void => {
    // `IfStatement.expression` is the condition; `condition` belongs to `IfExpression`, the ternary-like
    // node. Reaching for the wrong one is what made this fail to type-check the first time.
    if (ts.isIfStatement(node) && node.expression.getText(file).includes(marker))
      matching.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);

  if (matching.length === 0) return null;
  if (matching.length > 1) {
    throw new Error(
      `refusing to read the branch guarded by '${marker}': ${matching.length} 'if' statements name it ` +
        `(lines ${matching.map((node) => file.getLineAndCharacterOfPosition(node.getStart()).line + 1).join(", ")}). ` +
        "Which one the assertions below are about is not decidable from the file.",
    );
  }
  return nodeSource(file, matching[0]);
}

/** A `run` that pretends to install, by writing a usable tree into whatever staging directory it is given. */
function fakeInstall(fail = false) {
  return vi.fn((_command: string, _args: string[], cwd: string) => {
    if (fail) return { code: 1, output: "npm error code EPERM\nnpm error errno -4048" };
    populateModules(cwd);
    return { code: 0, output: "added 445 packages in 4s" };
  });
}

describe("dependencyTreeState", () => {
  it("reports a complete tree as complete, with nothing missing", () => {
    const state = dependencyTreeState(frontend("complete"));
    expect(state).toEqual({ complete: true, missing: [] });
  });

  it("names the directory rather than fifteen binaries when it is absent", () => {
    // Listing every missing binary when the directory itself is gone is noise, and a reader told
    // fifteen names would look for fifteen separate problems.
    expect(dependencyTreeState(frontend("no-modules"))).toEqual({
      complete: false,
      missing: ["node_modules/"],
    });
  });

  it("names a missing binary", () => {
    const state = dependencyTreeState(frontend("no-bin"));
    expect(state.complete).toBe(false);
    expect(state.missing).toEqual([`node_modules/.bin/${shim("tsc")}`]);
  });

  it("names a package whose manifest is gone, even when its binary survives", () => {
    // This is the recorded incident: `next` without its `package.json`. A check on the binary
    // alone calls that tree complete, and every later gate item then fails for a reason that is
    // not the code.
    const state = dependencyTreeState(frontend("no-next-manifest"));
    expect(state.complete).toBe(false);
    expect(state.missing).toContain("node_modules/next/package.json");
  });

  it("names an empty manifest, which existsSync reports as present", () => {
    const state = dependencyTreeState(frontend("empty-manifest"));
    expect(state.complete).toBe(false);
    expect(state.missing).toContain("node_modules/next/package.json (empty)");
  });

  it("is proven able to fail", () => {
    // Without this, every expectation above could hold against a function that always returns
    // `complete: true`, which is a plausible implementation of this check.
    const complete = dependencyTreeState(frontend("complete"));
    const broken = dependencyTreeState(frontend("no-bin"));
    expect(complete.complete).toBe(true);
    expect(broken.complete).toBe(false);
    expect(broken.missing).not.toEqual(complete.missing);
  });
});

describe("stageInstall", () => {
  it("copies only the two files that define the install", () => {
    // Copying the package directory wholesale would copy the `node_modules` this exists to avoid
    // depending on.
    const root = frontend("no-modules");
    writeFileSync(join(root, "next.config.ts"), "export default {};\n", "utf8");
    const run = fakeInstall();

    const staged = stageInstall({ frontendDir: root, run });

    expect(staged.ok).toBe(true);
    expect(existsSync(join(staged.stagedDir, "package.json"))).toBe(true);
    expect(existsSync(join(staged.stagedDir, "package-lock.json"))).toBe(true);
    expect(existsSync(join(staged.stagedDir, "next.config.ts"))).toBe(false);
  });

  it("installs into a directory outside the working tree", () => {
    const root = frontend("no-modules");
    const staged = stageInstall({ frontendDir: root, run: fakeInstall() });
    expect(staged.stagedDir.startsWith(root)).toBe(false);
    expect(staged.stagedDir).not.toContain(`${root}/`);
  });

  it("removes the staging directory when the install fails", () => {
    // Left behind, a failed gate leaks a full copy of the dependency tree into the system
    // temporary directory, and the caller's own cleanup does not run if it throws first.
    const staged = stageInstall({ frontendDir: frontend("no-modules"), run: fakeInstall(true) });
    expect(staged.ok).toBe(false);
    expect(existsSync(staged.stagedDir)).toBe(false);
  });

  it("carries the installer's own output, so the failure is diagnosable", () => {
    const staged = stageInstall({ frontendDir: frontend("no-modules"), run: fakeInstall(true) });
    expect(staged.output).toContain("EPERM");
  });
});

describe("promoteStagedInstall", () => {
  it("puts the staged tree in place", () => {
    const root = frontend("no-modules");
    const staged = stageInstall({ frontendDir: root, run: fakeInstall() });
    const promoted = promoteStagedInstall({ stagedDir: staged.stagedDir, frontendDir: root });

    expect(promoted.ok).toBe(true);
    expect(dependencyTreeState(root).complete).toBe(true);
    rmSync(staged.stagedDir, { recursive: true, force: true });
  });

  it("leaves the previous tree in place when there is nothing to promote", () => {
    // The failure mode this guards is "the gate destroyed the working tree and then failed". A
    // rename-aside with a restore is what makes that unreachable; a delete-then-copy is not.
    const root = frontend("complete");
    const before = fingerprint(join(root, "node_modules"));

    const promoted = promoteStagedInstall({
      stagedDir: join(scratchDir(), "absent"),
      frontendDir: root,
    });

    expect(promoted.ok).toBe(false);
    expect(promoted.error).toContain("nothing was changed");
    expect(fingerprint(join(root, "node_modules"))).toBe(before);
    expect(dependencyTreeState(root).complete).toBe(true);
  });

  it("leaves no backup directory behind on success", () => {
    const root = frontend("no-modules");
    const staged = stageInstall({ frontendDir: root, run: fakeInstall() });
    promoteStagedInstall({ stagedDir: staged.stagedDir, frontendDir: root });
    expect(existsSync(`${join(root, "node_modules")}.gate-backup`)).toBe(false);
    rmSync(staged.stagedDir, { recursive: true, force: true });
  });

  it("replaces a leftover backup rather than failing on it", () => {
    // `rename` onto an existing directory fails on Windows. A backup from an interrupted earlier
    // run would otherwise report an install failure that has nothing to do with this run.
    const root = frontend("complete");
    mkdirSync(`${join(root, "node_modules")}.gate-backup/stale`, { recursive: true });

    const staged = stageInstall({ frontendDir: root, run: fakeInstall() });
    const promoted = promoteStagedInstall({ stagedDir: staged.stagedDir, frontendDir: root });

    expect(promoted.ok).toBe(true);
    rmSync(staged.stagedDir, { recursive: true, force: true });
  });
});

describe("prepareDependencies", () => {
  it("does not run any command at all when the tree is already complete", () => {
    // The regression this whole module exists to prevent, asserted directly: a usable tree is left
    // exactly as it is, so there is no window in which it is not.
    const run = fakeInstall();
    const prepared = prepareDependencies({ frontendDir: frontend("complete"), run });

    expect(prepared.ok).toBe(true);
    expect(prepared.installed).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(prepared.detail).toContain("nothing was reinstalled or deleted");
  });

  it("installs from the lockfile when the tree is unusable", () => {
    const root = frontend("no-modules");
    const run = fakeInstall();
    const prepared = prepareDependencies({ frontendDir: root, run });

    expect(prepared.ok).toBe(true);
    expect(prepared.installed).toBe(true);
    expect(run).toHaveBeenCalledWith("npm", ["ci", "--no-audit", "--no-fund"], expect.any(String));
    expect(dependencyTreeState(root).complete).toBe(true);
  });

  it("leaves the working tree byte-identical when the staged install fails", () => {
    // The recorded incident, asserted as the property that would have prevented it.
    const root = frontend("no-bin");
    const before = fingerprint(root);

    const prepared = prepareDependencies({ frontendDir: root, run: fakeInstall(true) });

    expect(prepared.ok).toBe(false);
    expect(fingerprint(root)).toBe(before);
    expect(prepared.installed).toBe(false);
  });

  it("reports the install's own error, so the reader is not left guessing", () => {
    const prepared = prepareDependencies({
      frontendDir: frontend("no-modules"),
      run: fakeInstall(true),
    });
    expect(prepared.output).toContain("EPERM");
    expect(prepared.detail).toContain("left untouched");
  });

  it("fails when the install claims success but the tree is still incomplete", () => {
    // `npm ci` exiting `0` is not evidence the tree is usable — the recorded failure did exactly
    // that. So the result is re-inspected rather than believed.
    const root = frontend("no-modules");
    const prepared = prepareDependencies({
      frontendDir: root,
      run: (_c, _a, cwd) => {
        mkdirSync(join(cwd, "node_modules", ".bin"), { recursive: true });
        return { code: 0, output: "added 445 packages" };
      },
    });

    expect(prepared.ok).toBe(false);
    expect(prepared.detail).toContain("reported success but the tree is still incomplete");
  });

  it("removes the staging directory on every path", () => {
    const tmpRoot = scratchDir();
    for (const run of [fakeInstall(), fakeInstall(true)]) {
      prepareDependencies({ frontendDir: frontend("no-modules"), run, tmpRoot });
      // The staging directory is a sibling of `tmpRoot`, created by mkdtemp inside it.
      expect(readdirSync(tmpRoot)).toEqual([]);
    }
  });

  it("is proven able to fail", () => {
    expect(prepareDependencies({ frontendDir: frontend("complete"), run: fakeInstall() }).ok).toBe(
      true,
    );
    expect(
      prepareDependencies({ frontendDir: frontend("no-modules"), run: fakeInstall(true) }).ok,
    ).toBe(false);
  });
});

describe("the AST extraction that replaced the two lazy windows", () => {
  // Round 9's W1 is not that the two windows were unanchored. It is that an anchor added to a window
  // whose extent is *inferred from text* is a guess about a guess, and a one-sided guess reads as a
  // symmetric one. Round 7's anchor — exactly one `id:` — counted a second `id:`-shaped token as a
  // second item, and could not see a window truncated after `how:` because the anchor was a lower bound.
  // These four assert the two properties the old mechanism could not have had.

  it("cannot be shortened or lengthened by text that only looks like a boundary", () => {
    // Two `  },` sequences now sit inside the item: one inside a template literal, one real. They are
    // indistinguishable to a line-based reader, which is why the lazy regex stopped at the first and
    // covered 168 characters of a 1358-character item while every content assertion still held.
    const withBrace = [
      "const ITEMS = [",
      '  { id: "two", requirement: "second", how: "install", note: `a brace',
      "  },`",
      " },",
      '  { id: "three", how: "command", command: "npm", args: ["ci"] },',
      "];",
    ].join("\n");

    const item = itemSource(withBrace, "ITEMS", "two");
    // Not shortened: the field *after* the fake boundary is still here.
    expect(item).toContain("note: `a brace");
    // Not lengthened: the next element is not here. It is given `args: ["ci"]` on purpose — the field
    // the assertion below forbids — so that a window which ran on to it would fail on the *content* check
    // too, not merely on a marker. The first version of this witness put `args: ["run", "lint"]` there,
    // which no assertion objected to, and a witness that cannot fail is not a witness.
    expect(item).not.toContain('id: "three"');
    // And the claim the assertions are actually about survives both.
    expect(item).toMatch(/how:\s*"install"/);
    expect(item).not.toMatch(/args:\s*\[\s*"ci"/);
  });

  it("scopes the search to the named array, so an identical id elsewhere cannot stand in", () => {
    // `UNRELATED` carries `id: "two"` as well. A search that walked every object literal in the file
    // would find two candidates and refuse — or, resolving by position, report the wrong one. Either
    // way the assertions below would stop being about the item. Scoping is what makes that impossible,
    // and this is the row that witnesses the doc comment's claim rather than restating it.
    const source = [
      "const ITEMS = [",
      '  { id: "two", requirement: "second", how: "install" },',
      "];",
      'const UNRELATED = { id: "two" };',
    ].join("\n");

    const item = itemSource(source, "ITEMS", "two");
    expect(item).toMatch(/how:\s*"install"/);
    expect(item).not.toContain("UNRELATED");
    expect(() => itemSource(source, "NO_SUCH_ARRAY", "two")).toThrow(/no top-level array/);
  });

  it("refuses an ambiguous item rather than reading the first", () => {
    const duplicated = [
      "const ITEMS = [",
      '  { id: "same", how: "install" },',
      '  { id: "same", how: "command", command: "npm", args: ["run", "lint"] },',
      "];",
    ].join("\n");

    // Zero is not an error — `itemSource` throws for zero too, because every assertion about an item
    // that was not found is vacuous. Both are refusals rather than guesses.
    expect(() => itemSource(duplicated, "ITEMS", "absent")).toThrow(/no element whose id/);
    expect(() => itemSource(duplicated, "ITEMS", "same")).toThrow(/2 elements of ITEMS carry it/);
  });

  it("refuses an ambiguous branch rather than reading the first, and reports zero as null", () => {
    const single = ["if (isShortCircuited(item, environmentBroken)) {", "  report();", "}"].join(
      "\n",
    );

    // Exactly one: the returned text is that statement's own span, so `toBe` on the whole statement is
    // the extent assertion — the one thing the old `\n {2}\}` regex could not make.
    expect(branchSource(single, "isShortCircuited(item, environmentBroken)")).toBe(single);
    expect(
      branchSource("if (other()) { report(); }", "isShortCircuited(item, environmentBroken)"),
    ).toBeNull();

    // Two: refused, and the refusal names how many and where.
    const duplicated = `${single}\n${single}`;
    expect(() => branchSource(duplicated, "isShortCircuited(item, environmentBroken)")).toThrow(
      /2 'if' statements name it \(lines 1, 4\)/,
    );
  });
});

describe("the gate script itself", () => {
  // Comments removed for the same reason as the router assertions below.
  const gate = code(readFileSync(join(EVIDENCE, "release-gate.mjs"), "utf8"));

  it("no longer runs npm ci over the working tree", () => {
    // A guard on the guard. The replacement logic lives in `lib/install.mjs` and is tested above;
    // without this, deleting the `how: "install"` branch and restoring `command: "npm",
    // args: ["ci"]` would leave every one of those tests green while the gate went back to
    // destroying the tree.
    // **Round 9's W1 replaced this extraction outright.** It used to be a lazy
    // `/id:\s*"gates-install"[\s\S]*?\n  \},/`, whose extent was unknowable — see `itemSource`.
    //
    // What is left is *one* anti-vacuity statement, and it is now a statement about a **refusal**: the
    // helper throws when no element of `ITEMS` carries that id, or when two do. Round 7 answered the same
    // hole with an extent anchor (count exactly one `id:`), and round 9 defeated that anchor in both
    // directions — a second `id:`-shaped token counted as a second item, and a window truncated after
    // `how:` satisfied it because the anchor was a lower bound. There is no second anchor here to
    // mis-fire, because the extent is no longer inferred from the text.
    const installItem = itemSource(gate, "ITEMS", "gates-install");
    expect(
      installItem,
      "the gates-install item could not be located, so every assertion about it would be vacuous",
    ).toContain('id: "gates-install"');
    expect(installItem).not.toMatch(/args:\s*\[\s*"ci"/);
    expect(installItem).toMatch(/how:\s*"install"/);
  });

  it("reports a broken environment once rather than as a failure per item", () => {
    // ## What this replaced, and why it was not a check
    //
    // The three lines below used to be:
    //
    //     expect(gate).toMatch(/environmentBroken/);
    //     expect(gate).toMatch(/NOT RUN/);
    //     expect(gate).toContain("the environment is broken");
    //
    // Independent verification showed that replacing the cascade's *assignment* —
    // `environmentBroken = prepared.detail` → `environmentBroken = 'install reported success'` —
    // left all 39 tests green, and so did renaming every occurrence of the identifier. Those lines
    // could not fail for a reason worth the name: they never looked at what the variable was
    // assigned, only at whether its spelling appeared somewhere in the file. A cascade wired to
    // nothing at all would have satisfied them.
    //
    // The cascade has two halves and only one of them was in a testable function. Both are now.

    // **Half one, behaviourally.** What the cascade reason is, given an install outcome. This is the
    // half the old check was blind to: `ok: false` must yield the install's own detail, because that
    // string is what the first line of output shows, and `ok: true` must yield exactly `null` — which
    // is the value `isShortCircuited` reads as "nothing is broken". A reason of `undefined` would make
    // `environmentBroken === null` false and short-circuit *every* item, including the install itself.
    expect(cascadeReason({ ok: false, detail: "node_modules/.bin is empty" })).toBe(
      "node_modules/.bin is empty",
    );
    expect(cascadeReason({ ok: true, detail: "installed" })).toBeNull();

    // The falsy-shape cases, because `null` and `undefined` are not interchangeable here and only one
    // of them means "the environment is fine".
    expect(cascadeReason({ ok: true })).toBeNull();
    expect(cascadeReason({ ok: false, detail: "" })).not.toBeNull();

    // **Half two, structurally.** The gate must actually *call* it. Narrow on purpose: the behaviour
    // lives in the function and is pinned above, so this only has to notice the gate stopping the
    // call — which is the one thing the unit tests cannot see, because they do not run the gate.
    expect(gate).toContain("environmentBroken = cascadeReason(prepared);");
    expect(gate).not.toMatch(/environmentBroken\s*=\s*(?!cascadeReason)["'`]/);

    // And the presentation, which is the half a reader sees. `NOT RUN` rather than `FAIL`, because a
    // missing `tsc` is not a finding about the code and recording it as one would put a defect in the
    // tally that does not exist.
    //
    // **Scoped to the cascade branch, because unscoped these two were not checks.** Independent
    // verification changed that branch's `status: "NOT RUN"` to `status: "FAIL"` and all 57 tests
    // stayed green: `toMatch(/NOT RUN/)` was satisfied by the file's three *other* not-run sites
    // (the skipped-browser item, the unresolved item, and the printer's own handling), and
    // `toContain("the environment is broken")` still matched the `detail` line the mutation left
    // intact. Both assertions were about the file rather than the branch, so a mutation inside the
    // branch could not reach them.
    //
    // The block is extracted first, and the extraction is itself asserted — a regex that matched
    // nothing would make every assertion below vacuously true, which is the failure this milestone
    // exists to remove, so the extraction is checked for content and the assertions are made
    // *negative* as well as positive.
    const cascade = branchSource(gate, "isShortCircuited(item, environmentBroken)");
    expect(
      cascade,
      "the cascade branch could not be located, so every assertion about it would be vacuous",
    ).toContain("isShortCircuited(item, environmentBroken)");
    expect(cascade).toContain('status: "NOT RUN"');
    expect(cascade).toContain("the environment is broken");
    // The direction that matters, stated as its own assertion: the branch must not report a failure.
    // `FAIL` in this branch would put sixteen defects in the tally where there is one, which is the
    // thing `release-gate.mjs`'s own comment above the branch says it is avoiding.
    expect(cascade).not.toContain('status: "FAIL"');
    // Round 7 added an extent anchor here (exactly one `isShortCircuited(`) and round 9 replaced the
    // extraction instead: `branchSource` locates the one `if` statement whose condition names the helper
    // and takes that statement's own span, so the window can neither widen past the branch nor stop
    // inside it. The anchor was a lower bound, which cannot detect stopping early — a defect the
    // verifier inferred for this window from its shape and did not measure. With no regex, there is no
    // extent left to infer.
    // And the reason must travel with the skip, or "not run" is an omission rather than a result.
    expect(cascade).toMatch(/steps:\s*\[[\s\S]*?Repair the dependency tree/);
  });

  it("parses, and its helper modules parse", () => {
    for (const file of [
      "release-gate.mjs",
      join("lib", "install.mjs"),
      join("lib", "harness.mjs"),
    ]) {
      const outcome = spawnSync(process.execPath, ["--check", join(EVIDENCE, file)], {
        encoding: "utf8",
      });
      expect(`${file}: ${outcome.stderr}`).toBe(`${file}: `);
    }
  });
});

describe("the end-to-end fixture router's readiness", () => {
  it("continues a request that arrives before interception is enabled", () => {
    // The window. For the duration of the `Fetch.enable` round trip the domain is intercepting
    // while a flag set *after* the await still says it is not; the original handler then discarded
    // every request paused in that window. A paused request that is neither continued nor failed
    // does not error — it hangs — so the caller waited out its own timeout and the run failed
    // somewhere downstream of the real cause. That is why it presented as intermittent.
    const readiness = createReadiness();
    expect(readiness.ready).toBe(false);
    expect(pausedAction(readiness, true)).toBe(PAUSED_ACTION.CONTINUE);
  });

  it("routes a request once interception is enabled", () => {
    const readiness = createReadiness();
    readiness.claim();
    expect(pausedAction(readiness, true)).toBe(PAUSED_ACTION.ROUTE);
  });

  it("has no outcome that leaves a request unresolved", () => {
    // The strongest form of "never drop": every combination resolves to one of the three actions,
    // and none of them is "do nothing". Enumerated rather than spot-checked because a spot check
    // would miss a fourth branch added later.
    for (const ready of [false, true]) {
      for (const isPage of [false, true]) {
        const readiness = createReadiness();
        if (ready) readiness.claim();
        expect(Object.values(PAUSED_ACTION)).toContain(pausedAction(readiness, isPage));
      }
    }
  });

  it("continues again after readiness is released, rather than reverting to dropping", () => {
    const readiness = createReadiness();
    readiness.claim();
    expect(pausedAction(readiness, true)).toBe(PAUSED_ACTION.ROUTE);
    readiness.release();
    expect(readiness.ready).toBe(false);
    expect(pausedAction(readiness, true)).toBe(PAUSED_ACTION.CONTINUE);
  });

  it("leaves another target's request entirely alone", () => {
    // A service worker or the browser's own requests share the CDP connection. Continuing those
    // would interfere with a session this router does not own.
    const readiness = createReadiness();
    readiness.claim();
    expect(pausedAction(readiness, false)).toBe(PAUSED_ACTION.IGNORE);
  });

  it("claims readiness before enabling interception, and enables exactly once", async () => {
    // Ordering as an observed call sequence rather than as a comparison of string indices. The
    // index version of this assertion was **unchecked** — the mutation proof showed restoring the
    // original order left the suite green, because a comment in the file mentioned `Fetch.enable`
    // before the code did.
    const calls: string[] = [];
    const readiness = createReadiness();
    const send = async (method: string) => {
      calls.push(method);
      // Observed from inside the enable call, which is the moment the original bug lived.
      expect(readiness.ready).toBe(true);
    };

    await beginRouting({ send, readiness, patterns: [{ urlPattern: "*" }] });

    expect(calls).toEqual(["Fetch.enable"]);
    expect(readiness.ready).toBe(true);
  });

  it("releases readiness when enabling interception fails", () => {
    // Leaving it claimed would make the handler *continue* requests it has no interception
    // configured to intercept — a quieter version of the same bug reached by another route.
    const readiness = createReadiness();
    const send = async () => {
      throw new Error("Fetch.enable failed");
    };

    return expect(beginRouting({ send, readiness, patterns: [{ urlPattern: "*" }] }))
      .rejects.toThrow("Fetch.enable failed")
      .then(() => {
        expect(readiness.ready).toBe(false);
      });
  });

  it("propagates an enabling failure rather than swallowing it", () => {
    // A swallowed failure would report a router that is intercepting and is not, which is the
    // original bug's outcome arriving by a different path.
    const readiness = createReadiness();
    const send = async () => {
      throw new Error("boom");
    };
    return expect(beginRouting({ send, readiness, patterns: [] })).rejects.toThrow("boom");
  });

  it("the harness routes its handler through this decision", () => {
    // One guard, on the fact that the extracted decision is actually the one in use. Without it the
    // extraction could be inert — the functions tested above real, and the hang still present.
    const harness = code(readFileSync(join(EVIDENCE, "lib", "harness.mjs"), "utf8"));
    const handler = /on\("Fetch\.requestPaused"[\s\S]*?\n {4}\}\);/.exec(harness)?.[0] ?? "";
    expect(handler).toContain("pausedAction(readiness, sessionId === pageSession())");
    expect(handler).toContain("classifyPausedRequest(");
    // The dispatch itself, not just the classification. Mutation verification found the previous
    // version of this guard was satisfied by a handler that classified and then did nothing with
    // the plan: the library was real, the hang was still in the file, and the suite was green.
    // So the call, and the context it is handed, are both asserted — an extraction that is not
    // the one in use is inert, and inertness is the failure mode a source check cannot see.
    expect(handler).toContain("await resolvePausedRequest(plan, context);");
    // Each context method must actually reach the browser. The unit tests above pin what each
    // outcome *sends*; these three pin that the CDP handler hands it something that sends.
    expect(handler).toMatch(/continueRequest: \(\) =>[\s\S]*?"Fetch\.continueRequest"/);
    expect(handler).toMatch(/failRequest: \(errorReason\) =>[\s\S]*?"Fetch\.failRequest"/);
    expect(handler).toMatch(
      /fulfillRequest: \(responseCode, body\) =>[\s\S]*?"Fetch\.fulfillRequest"/,
    );
    // And the bare-drop guard must be gone from executable text, not merely from the comments.
    expect(handler).not.toMatch(/!routerPaused/);
    // The error path is a tested decision too, and the handler must be the one taking it — see
    // `fallbackPlan` for why it is not two inline lines. Without this, `fallbackPlan` could be a
    // correct function the handler never calls, which is the inert-extraction shape twice over.
    expect(handler).toContain("plan = fallbackPlan(error, consoleErrors);");
  });
});

/**
 * The fixture router's dispatch.
 *
 * ## What was wrong here, in one sentence
 *
 * Independent verification reduced the not-ready branch of `Fetch.requestPaused` to a bare
 * `return`, and all 39 tests stayed green — restoring the silent request drop that the branch's
 * own comment claimed was impossible.
 *
 * ## Why a green suite was the correct outcome for that mutation
 *
 * A dropped CDP request does not fail; it hangs. The browser waits for a response that never
 * comes, the run takes longer, and the gate's exit code is still 0. There was no assertion that
 * could have caught it, because the branch was seven lines of inline `sendTo` guarded by a source
 * check that its identifier appeared in the file.
 *
 * So the fix is not a better assertion about the old shape — it is a shape in which the mistake
 * cannot be written. Deciding is separated from sending, and every send is a one-line named
 * handler that a test invokes directly against a stub context.
 */
describe("classifyPausedRequest", () => {
  const request = (url: string) => ({ url, requestId: "1", method: "GET" });

  /**
   * Confirm a plan's outcome, and return it with its fields readable.
   *
   * Which fields a plan carries depends on its outcome — a fulfilment has a status and a body, a
   * transport failure has a reason — so `plan.body` is `string | undefined` until the outcome is
   * known. Reading it before then is a cast, and this is the assertion that would justify one: the
   * outcome is checked first, and only then are the fields read. Written as a narrowing helper
   * rather than repeated inline so the ordering is stated once.
   */
  const fulfilled = (plan: {
    outcome: string;
    errorReason?: string;
    responseCode?: number;
    body?: string;
  }) => {
    expect(plan.outcome, `expected a fulfilment, got ${plan.outcome}`).toBe(PAUSED_OUTCOME.FULFILL);
    return plan as { outcome: string; errorReason: string; responseCode: number; body: string };
  };

  it("ignores a request the router does not own", () => {
    expect(
      classifyPausedRequest({
        action: PAUSED_ACTION.IGNORE,
        request: request("https://example.test/api/x"),
        routes: [{ path: "/api/x", body: {} }],
      }),
    ).toEqual({ outcome: PAUSED_OUTCOME.IGNORE });
  });

  it("continues a not-ready request without consulting any route", () => {
    // A matcher that throws must not be able to strand a request the router was not ready for.
    // The throw case is covered below; what matters here is that routes are never read, which is
    // proved by a route whose own `match` would explode if it were evaluated.
    const exploding = {
      path: "/never",
      match: {
        test() {
          throw new Error("a not-ready request must not consult routes");
        },
      },
    };
    expect(
      classifyPausedRequest({
        action: PAUSED_ACTION.CONTINUE,
        request: request("https://example.test/never"),
        routes: [exploding],
      }),
    ).toEqual({ outcome: PAUSED_OUTCOME.CONTINUE });
  });

  it("continues a ready request that matches no route", () => {
    expect(
      classifyPausedRequest({
        action: PAUSED_ACTION.ROUTE,
        request: request("https://example.test/assets/app.css"),
        routes: [{ path: "/api/x", body: {} }],
      }),
    ).toEqual({ outcome: PAUSED_OUTCOME.CONTINUE });
  });

  it("fails a route that declares a transport failure, and carries its reason", () => {
    expect(
      classifyPausedRequest({
        action: PAUSED_ACTION.ROUTE,
        request: request("https://example.test/api/x"),
        routes: [{ path: "/api/x", transport: "failed", errorReason: "ConnectionRefused" }],
      }),
    ).toEqual({ outcome: PAUSED_OUTCOME.FAIL, errorReason: "ConnectionRefused" });
  });

  it("defaults a transport failure's reason rather than sending undefined", () => {
    const plan = classifyPausedRequest({
      action: PAUSED_ACTION.ROUTE,
      request: request("https://example.test/api/x"),
      routes: [{ path: "/api/x", transport: "failed" }],
    });
    expect(plan.errorReason).toBe("Failed");
  });

  it("fulfils a matched route with its declared status", () => {
    const plan = classifyPausedRequest({
      action: PAUSED_ACTION.ROUTE,
      request: request("https://example.test/api/x"),
      routes: [{ path: "/api/x", status: 503, body: { error: "unavailable" } }],
    });
    expect(plan.outcome).toBe(PAUSED_OUTCOME.FULFILL);
    // A non-2xx body is *not* a transport failure — modelling that distinction is the reason
    // `transport: "failed"` exists separately, and conflating them again would make the
    // `ok: false` fixtures dead data.
    expect(fulfilled(plan).responseCode).toBe(503);
    expect(Buffer.from(fulfilled(plan).body, "base64").toString("utf8")).toBe(
      '{"error":"unavailable"}',
    );
  });

  it("defaults a route's status to 200", () => {
    const plan = classifyPausedRequest({
      action: PAUSED_ACTION.ROUTE,
      request: request("https://example.test/api/x"),
      routes: [{ path: "/api/x", body: { ok: true } }],
    });
    expect(fulfilled(plan).responseCode).toBe(200);
  });

  it("evaluates regex routes against the path, and the first match wins", () => {
    // `find` returns the first match, so a scenario cannot override a route registered earlier.
    // The harness's own doc comment claimed the opposite — "Later routes win" — and no test
    // contradicted it, because nothing tested it. The comment was the only statement of intent
    // and it was false; it has been corrected to match the code rather than the code changed to
    // match the comment, because nothing here demonstrates which order a scenario needs.
    const plan = classifyPausedRequest({
      action: PAUSED_ACTION.ROUTE,
      request: request("https://example.test/api/search?q=a"),
      routes: [
        { match: /^\/api\//, body: { from: "first" } },
        { match: /^\/api\/search/, body: { from: "second" } },
      ],
    });
    expect(Buffer.from(fulfilled(plan).body, "base64").toString("utf8")).toBe('{"from":"first"}');
  });

  it("gives a body function the URL and serializes its return value", () => {
    // Returning an object used to throw a `TypeError` that the handler's outer catch turned into
    // a continue-to-the-network: a fixture that looked installed and was silently not. A plain
    // body object was stringified, so the two paths disagreed.
    const plan = classifyPausedRequest({
      action: PAUSED_ACTION.ROUTE,
      request: request("https://example.test/api/search?q=b"),
      routes: [{ path: "/api/search", body: (url: URL) => ({ q: url.searchParams.get("q") }) }],
    });
    expect(Buffer.from(fulfilled(plan).body, "base64").toString("utf8")).toBe('{"q":"b"}');
  });

  it("sends a string body verbatim, from either a value or a function", () => {
    // The one case where JSON-encoding would be wrong: a body that is already a document.
    for (const body of ["<html>ok</html>", () => "<html>ok</html>"]) {
      const plan = classifyPausedRequest({
        action: PAUSED_ACTION.ROUTE,
        request: request("https://example.test/page"),
        routes: [{ path: "/page", body }],
      });
      expect(Buffer.from(fulfilled(plan).body, "base64").toString("utf8")).toBe("<html>ok</html>");
    }
  });

  it("fulfils an absent body as an empty document rather than failing", () => {
    const plan = classifyPausedRequest({
      action: PAUSED_ACTION.ROUTE,
      request: request("https://example.test/api/empty"),
      routes: [{ path: "/api/empty" }],
    });
    expect(plan.outcome).toBe(PAUSED_OUTCOME.FULFILL);
    expect(Buffer.from(fulfilled(plan).body, "base64").toString("utf8")).toBe("");
  });
});

describe("resolvePausedRequest", () => {
  function stub() {
    const calls: string[] = [];
    return {
      calls,
      context: {
        continueRequest: async () => {
          calls.push("continue");
        },
        failRequest: async (errorReason: string) => {
          calls.push(`fail:${errorReason}`);
        },
        fulfillRequest: async (responseCode: number, body: string) => {
          calls.push(`fulfill:${responseCode}:${Buffer.from(body, "base64").toString("utf8")}`);
        },
      },
    };
  }

  it("continues the request — this is the assertion the mutation defeated", async () => {
    // This one line is the whole point. The mutation verification applied — reducing the not-ready
    // branch to a bare `return` — left 39 tests green because nothing here existed. Now the arm
    // that forgets to send is a failing test rather than a stalled browser.
    const { calls, context } = stub();
    await resolvePausedRequest({ outcome: PAUSED_OUTCOME.CONTINUE }, context);
    expect(calls).toEqual(["continue"]);
  });

  it("fails the request with the planned reason", async () => {
    const { calls, context } = stub();
    await resolvePausedRequest(
      { outcome: PAUSED_OUTCOME.FAIL, errorReason: "ConnectionRefused" },
      context,
    );
    expect(calls).toEqual(["fail:ConnectionRefused"]);
  });

  it("fulfils the request with the planned status and body", async () => {
    const { calls, context } = stub();
    const body = Buffer.from('{"ok":true}', "utf8").toString("base64");
    await resolvePausedRequest(
      { outcome: PAUSED_OUTCOME.FULFILL, responseCode: 503, body },
      context,
    );
    expect(calls).toEqual(['fulfill:503:{"ok":true}']);
  });

  it("sends nothing at all for an ignored request, and does not throw", async () => {
    // The one arm where sending nothing is correct. It is asserted rather than left implicit, so
    // that "ignore" cannot later be spelled as "continue".
    const { calls, context } = stub();
    await resolvePausedRequest({ outcome: PAUSED_OUTCOME.IGNORE }, context);
    expect(calls).toEqual([]);
  });

  it("resolves the fallback plan, which is the only way out of the error path", async () => {
    // The assertion the mutation defeated: changing the fallback's outcome from `CONTINUE` to
    // `IGNORE` left all 57 tests green, because every other test in this file feeds the classifier
    // and the handlers inputs that *succeed*. `IGNORE` is the silent hang — the request is never
    // continued — so this line is what stops the error path from being the unguarded one.
    const errors: string[] = [];
    const plan = fallbackPlan(new Error("matcher exploded"), errors);
    expect(plan.outcome).toBe(PAUSED_OUTCOME.CONTINUE);

    // And the decision is *resolved*, not merely returned: an outcome nothing handles would throw,
    // which turns a fixture's bug into a stalled run instead of a reported failure.
    const { calls, context } = stub();
    await resolvePausedRequest(plan, context);
    expect(calls).toEqual(["continue"]);
  });

  it("records why it fell back, so a fixture's bug is not silent", () => {
    // Two reasons this is asserted rather than assumed. A fallback that continues without saying
    // why leaves a scenario that mysteriously behaves like the real network, which is the worst
    // kind of fixture failure to diagnose. And the diagnostic must name the throwable's text, or
    // it names a variable and saves the reader nothing.
    const errors: string[] = [];
    fallbackPlan(new Error("route matcher threw on /api/search"), errors);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("fixture router:");
    expect(errors[0]).toContain("route matcher threw on /api/search");
  });

  it("appends rather than replacing, so two fixture failures are both reported", () => {
    // Overwriting would make the count of fixture bugs always exactly one, which is the kind of
    // number that looks reassuring and means nothing.
    const errors: string[] = [];
    fallbackPlan(new Error("first"), errors);
    fallbackPlan(new Error("second"), errors);
    expect(errors).toHaveLength(2);
    expect(errors.join("\n")).toContain("first");
    expect(errors.join("\n")).toContain("second");
  });

  it("handles a throwable that is not an Error", () => {
    // A fixture may `throw "string"` or `throw { code: 1 }`. `String(...)` on both gives something
    // printable, so the diagnostic is never `[object Object]`-shaped-and-empty by accident.
    const errors: string[] = [];
    expect(fallbackPlan("just a string", errors).outcome).toBe(PAUSED_OUTCOME.CONTINUE);
    expect(errors[0]).toContain("just a string");
  });

  it("throws on an outcome it has no handler for, rather than continuing", async () => {
    // Falling through to the network here would reinstate the exact failure this refactor
    // removes: a typo becomes a hang instead of a stack trace.
    const { calls, context } = stub();
    await expect(resolvePausedRequest({ outcome: "continute" }, context)).rejects.toThrow(
      'no handler for paused request outcome "continute"',
    );
    expect(calls).toEqual([]);
  });

  it("has a handler for every outcome it can be given", async () => {
    // Derived, not enumerated: the set of outcomes comes from running the classifier over
    // inputs that reach every branch, so adding a branch without a handler fails here without
    // anyone editing this list.
    const request = { url: "https://example.test/api/x", requestId: "1" };
    const produced = new Set<string>();
    // Each route set is separate rather than one list, because `find` takes the first match: a
    // list holding both a body route and a transport-failure route for the same path would never
    // reach the failure branch, and this test would report coverage it does not have.
    const routeSets: { path: string; body?: unknown; transport?: string }[][] = [
      [],
      [{ path: "/api/x", body: { ok: true } }],
      [{ path: "/api/x", transport: "failed" }],
    ];
    for (const action of Object.values(PAUSED_ACTION)) {
      for (const routes of routeSets) {
        produced.add(classifyPausedRequest({ action, request, routes }).outcome);
      }
    }

    expect([...produced].sort()).toEqual(
      [...new Set([...produced, ...Object.values(PAUSED_OUTCOME)])].sort(),
    );
    for (const outcome of produced) {
      expect(Object.keys(pausedRequestHandlers)).toContain(outcome);
    }
  });

  it("resolves every outcome the classifier can produce, by running them all", async () => {
    // Belt and braces on the set above: rather than trusting that a handler *exists*, drive it
    // and observe what it sent. A handler reduced to a bare `return` sends nothing, and only
    // `ignore` is allowed to send nothing.
    const request = { url: "https://example.test/api/x", requestId: "1" };
    const matrix = [
      { action: PAUSED_ACTION.IGNORE, routes: [{ path: "/api/x", body: {} }] },
      { action: PAUSED_ACTION.CONTINUE, routes: [{ path: "/api/x", body: {} }] },
      { action: PAUSED_ACTION.ROUTE, routes: [] },
      { action: PAUSED_ACTION.ROUTE, routes: [{ path: "/api/x", body: { ok: true } }] },
      { action: PAUSED_ACTION.ROUTE, routes: [{ path: "/api/x", transport: "failed" }] },
    ];
    for (const { action, routes } of matrix) {
      const plan = classifyPausedRequest({ action, request, routes });
      const { calls, context } = stub();
      await resolvePausedRequest(plan, context);
      if (plan.outcome === PAUSED_OUTCOME.IGNORE) {
        expect(calls, `outcome ${plan.outcome}`).toEqual([]);
      } else {
        expect(calls.length, `outcome ${plan.outcome} sent nothing`).toBe(1);
      }
    }
  });
});

describe("the broken-environment cascade", () => {
  it("short-circuits every item once the install has failed", () => {
    expect(isShortCircuited({ how: "command" }, "the tree is broken")).toBe(true);
    expect(isShortCircuited({ how: "test" }, "the tree is broken")).toBe(true);
    expect(isShortCircuited({ how: "install" }, "the tree is broken")).toBe(false);
  });

  it("short-circuits nothing when the install worked", () => {
    for (const how of ["install", "command", "test", "manual"]) {
      expect(isShortCircuited({ how }, null)).toBe(false);
    }
  });

  it("never short-circuits the item that decides whether the environment is broken", () => {
    // Otherwise the gate reports no install result at all and the cascade has no cause.
    expect(isShortCircuited({ how: "install" }, "anything")).toBe(false);
  });

  it("is a returned value, not a condition at the call site", () => {
    // The condition was inline and unchecked: replacing it with `false` left the suite green while
    // the gate went back to reporting sixteen failures where there is one.
    const gate = code(readFileSync(join(EVIDENCE, "release-gate.mjs"), "utf8"));
    expect(gate).toContain("isShortCircuited(item, environmentBroken)");
    expect(gate).not.toMatch(/environmentBroken !== null && item\.how/);
  });
});

describe("the comment stripper", () => {
  it("strips comments rather than losing the code they sat on", () => {
    // `code()` is load-bearing for the source assertions above, so it is itself checked: a stripper
    // that removed everything would make them vacuously green, which is the failure this file
    // exists to avoid repeating.
    const sample = 'const a = 1; // gone\nconst url = "https://x/y"; /* also gone */const b = 2;';
    const stripped = code(sample);
    expect(stripped).toContain("const a = 1;");
    expect(stripped).toContain('"https://x/y"');
    expect(stripped).toContain("const b = 2;");
    expect(stripped).not.toContain("gone");
  });

  it("refuses to guess at an unterminated block comment", () => {
    // Swallowing the rest of the file would make every later source assertion vacuously true.
    expect(() => code("/* never closed\nconst a = 1;")).toThrow("unterminated block comment");
  });
});
