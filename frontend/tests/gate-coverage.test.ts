import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import * as prettier from "prettier";
import { describe, expect, it } from "vitest";

/**
 * The gate's own coverage, asserted rather than described.
 *
 * **The defect this exists to close.** `scripts/gate-batch/run-gate-batch.ps1` is the script that
 * runs the gate, and until `ps:check` existed no gate step read it. Measured on this tree before
 * that step was added:
 *
 * ```
 * npx eslint scripts/gate-batch/run-gate-batch.ps1
 *   exit=0
 *   0:0  warning  File ignored because no matching configuration was supplied
 * ```
 *
 * ESLint did not merely stay silent. It returned **success** over a file it never opened, and
 * `prettier --check .` never asked about it at all, because Prettier has no parser for `.ps1`. A
 * green gate over an unread file is the failure mode this file turns into a failing test.
 *
 * **Coverage means a gate step's own invocation would examine the file** — not that a tool would
 * accept it if handed the path. Those are different questions and the difference is load-bearing:
 * ESLint's `isPathIgnored` returns `false` for `../scripts/sync-m19.prove.mjs`, so the API will
 * happily accept it, yet no step ever passes it, because `lint` is a bare `eslint` and
 * `format:check` is `prettier --check .`, both scoped by working directory to `frontend/`. A file
 * can be acceptable to every tool and examined by none of them.
 *
 * **Every predicate asks the tool. None of them reads configuration.** Reading `eslint.config.mjs`
 * globs would re-implement each tool's matcher, and a mismatch between the re-implementation and
 * the tool is indistinguishable from real coverage. `design.md` D2 rejected that.
 *
 * **Exit codes are never a signal here.** ESLint exits 0 for a file it declined. That is the bug.
 */

/** Walk up to the directory containing `frontend/package.json`, so this resolves from either half. */
function findRepoRoot(): string {
  let cursor = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(cursor, "frontend", "package.json"))) {
    const parent = dirname(cursor);
    if (parent === cursor) {
      throw new Error(`no frontend/package.json above ${fileURLToPath(import.meta.url)}`);
    }
    cursor = parent;
  }
  return cursor;
}

const REPO = findRepoRoot();
const FRONTEND = join(REPO, "frontend");

/** The gate's working directory. Every static step runs with this as its cwd. */
const GATE_CWD = "frontend/";

function gitLsFiles(args: string[]): string[] {
  return execFileSync("git", ["ls-files", ...args], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function extensionOf(repoRelative: string): string {
  return repoRelative.slice(repoRelative.lastIndexOf("."));
}

/** A gate step, and the single question it is asked about one file. */
interface Step {
  /** The npm script name, which is also the name used in the coverage report. */
  name: string;
  /** The command `npm run <name>` actually executes, for the report. */
  command: string;
  /** True when this step's own invocation would examine `repoRelative`. */
  covers: (repoRelative: string) => Promise<boolean>;
}

const eslint = new ESLint({ cwd: FRONTEND });

/**
 * ESLint's verdict, resolved once per extension rather than once per file.
 *
 * `isPathIgnored` costs ~4.6 ms because it resolves configuration per call: 505 files is 2.3 s, and
 * `lintFiles(".")` — which would be exact — costs 13.6 s. So the bulk path asks once per extension.
 *
 * **That is only sound while an extension's verdict is uniform**, which is what the
 * "ESLint's coverage is uniform per extension" suite asserts. Without it, a directory-scoped ignore
 * would make the sample unrepresentative and the exemption table would be built on a lie — which is
 * the defect this whole file is about, so it is asserted rather than assumed. The uniformity suite
 * runs after the bulk one, which is acceptable because it fails loudly rather than silently: a
 * non-uniform extension cannot reach a green result, it only reaches a red one first.
 */
const lintVerdictByExtension = new Map<string, Promise<boolean>>();

function eslintCovers(repoRelative: string): Promise<boolean> {
  const ext = extensionOf(repoRelative);
  let verdict = lintVerdictByExtension.get(ext);
  if (verdict === undefined) {
    verdict = eslint.isPathIgnored(repoRelative.slice(GATE_CWD.length)).then((ignored) => !ignored);
    lintVerdictByExtension.set(ext, verdict);
  }
  return verdict;
}

/**
 * Prettier coverage.
 *
 * **`ignorePath` is required and its absence is a third instance of the same defect.** Without it
 * `getFileInfo` ignores `.prettierignore` entirely and reports `{ ignored: false, inferredParser:
 * "markdown" }` for a file `.prettierignore` excludes — disagreeing with the CLI that reads the
 * same file. Measured:
 *
 * ```
 * getFileInfo("AGENTS.md")                                  -> { ignored: false, inferredParser: "markdown" }
 * getFileInfo("AGENTS.md", { ignorePath: ".prettierignore" }) -> { ignored: true,  inferredParser: null }
 * ```
 *
 * A file the formatter declines is not a file it checked, so both conditions must hold.
 */
async function prettierCovers(repoRelative: string): Promise<boolean> {
  if (!repoRelative.startsWith(GATE_CWD)) return false;
  const info = await prettier.getFileInfo(repoRelative.slice(GATE_CWD.length), {
    ignorePath: ".prettierignore",
  });
  return !info.ignored && info.inferredParser !== null;
}

const STEPS: Step[] = [
  {
    name: "lint",
    command: "eslint",
    // `lint` is a bare `eslint`, so it walks the working directory and examines everything it is
    // not configured to ignore. A file outside `frontend/` is therefore uncovered by construction.
    covers: async (f) => f.startsWith(GATE_CWD) && eslintCovers(f),
  },
  {
    name: "format:check",
    command: "prettier --check .",
    covers: prettierCovers,
  },
  {
    name: "typecheck",
    command: "next typegen && tsc --noEmit",
    // `tsconfig.json` includes `**/*.ts` and `**/*.tsx` relative to `frontend/`.
    covers: async (f) => f.startsWith(GATE_CWD) && [".ts", ".tsx"].includes(extensionOf(f)),
  },
  {
    name: "ps:check",
    command: "node scripts/powershell-parse-check.mjs",
    // Every tracked `.ps1` outside a frozen root, which is what the script itself enumerates.
    covers: async (f) => extensionOf(f) === ".ps1" && !isFrozen(f),
  },
  {
    name: "icons:check",
    command: "node scripts/generate-icons.mjs --check",
    // Checked against the generator's output, so it asserts the icons rather than their bytes.
    // Scoped to `public/icons/`, which is what the generator owns.
    covers: async (f) => f.startsWith(`${GATE_CWD}public/icons/`) && extensionOf(f) === ".png",
  },
];

/**
 * Roots whose contents are historical records rather than live gate tooling.
 *
 * `pin` is the difference between a declaration and a live assertion. The archive is not pinned:
 * every archived change adds files to it, so pinning it would make each archive step a test edit,
 * which is cost without benefit. The repository-root `scripts/` directory IS pinned, because that is
 * the one place where live-looking tooling accumulates — which is exactly why blanket-exempting a
 * directory is how new code hides in it.
 */
const FROZEN_ROOTS: { prefix: string; reason: string; pin: boolean }[] = [
  {
    prefix: "openspec/changes/archive/",
    reason:
      "archived change evidence, held for byte-exact provenance; added to by every archive step, so not file-pinned",
    pin: false,
  },
  {
    prefix: "scripts/",
    reason:
      "one-off M16-M19 milestone provers whose headers state they copy the tree into a temp directory and never write to the repository; nothing in any manifest or test references them",
    pin: true,
  },
];

const PINNED_ROOT_SCRIPTS = [
  "scripts/sync-m16-lyrics.mjs",
  "scripts/sync-m17-home.mjs",
  "scripts/sync-m17-home.prove.mjs",
  "scripts/sync-m18-interactions.mjs",
  "scripts/sync-m18-interactions.prove.mjs",
  "scripts/sync-m19.prove.mjs",
];

function isFrozen(repoRelative: string): boolean {
  return FROZEN_ROOTS.some((root) => repoRelative.startsWith(root.prefix));
}

/**
 * Files no step examines, each with the reason it is acceptable that no step examines it.
 *
 * **A reason is mandatory and an unused entry fails.** An exemption with no reason is a silent
 * exemption, and an exemption matching nothing is a policy claim about a file that no longer
 * exists — the same class of defect as M29's hard-coded `182`, which stayed correct until the tree
 * moved past it. Both are asserted, so neither can rot unnoticed.
 */
const EXEMPTIONS: { match: RegExp; reason: string }[] = [
  {
    match: /\.gitkeep$/,
    reason:
      "zero-byte directory placeholders (all 26 measured at 0 bytes); there is no content to check",
  },
  {
    match: /^frontend\/tests\/fixtures\//,
    reason:
      "raw captured provider fixtures held for byte-exact provenance; `.prettierignore` excludes tests/fixtures/ so they are never reformatted",
  },
  {
    match: /\.md$/,
    reason:
      "prose; `.prettierignore` states formatting is intentionally untouched. ESLint has no Markdown config",
  },
  {
    match: /^frontend\/\.env\.example$/,
    reason:
      "committed placeholder for an environment file; it holds no secrets and no gate parses it",
  },
  {
    match: /^frontend\/package-lock\.json$/,
    reason:
      "generated by npm and owned by it; `.prettierignore` excludes it because reformatting a lockfile is npm's business, not a human's. ESLint has no JSON config",
  },
  {
    match: /^frontend\/\.(gitignore|prettierignore)$/,
    reason: "VCS and formatter ignore files; Prettier infers no parser for either name",
  },
  {
    match: /\.svg$/,
    reason:
      "static image asset; no gate step parses SVG, and a malformed one fails at render rather than at commit",
  },
];

function globToRegExp(pattern: RegExp): RegExp {
  return pattern;
}

/** Pure decision, so the rule can be witnessed on synthetic inputs before it meets the real tree. */
async function classify(
  repoRelative: string,
  steps: Step[] = STEPS,
  exemptions: { match: RegExp; reason: string }[] = EXEMPTIONS,
): Promise<{ coveredBy: string[]; exemption: string | null }> {
  const coveredBy: string[] = [];
  for (const step of steps) {
    if (await step.covers(repoRelative)) coveredBy.push(step.name);
  }
  const exemption = exemptions.find((e) => globToRegExp(e.match).test(repoRelative)) ?? null;
  return { coveredBy, exemption: exemption?.reason ?? null };
}

/**
 * Measured cost of asking the tools rather than reading their configuration.
 *
 * ESLint's **first** `isPathIgnored` call costs ~1705 ms — resolving and loading
 * `eslint-config-next` — and every subsequent call is 0-30 ms. Prettier's `getFileInfo` with an
 * `ignorePath` costs ~0.7 ms per file, so 505 files is ~355 ms. Total ~1.9 s, dominated by one
 * unavoidable config load.
 *
 * That 1.7 s is the price of D2, and paying it is the point: reading `eslint.config.mjs` instead
 * would be instant and would re-implement ESLint's matcher, which is the defect this file exists to
 * catch. The tests below therefore declare explicit timeouts rather than inheriting the suite's 5 s
 * default and hoping. Recorded against tasks 5.3 rather than reinterpreted as acceptable.
 */
const COVERAGE_TIMEOUT_MS = 60_000;

/** One extension's first-and-last probe, which stands in for every file of that extension. */
interface ExtensionSample {
  ext: string;
  first: string;
  last: string;
  firstVerdict: boolean;
  lastVerdict: boolean;
}

/**
 * Pure, so the sampling rule can be witnessed on a heterogeneous extension before it is trusted
 * with the real tree. On a uniform tree the uniformity assertion is *satisfied*, which means
 * disabling it changes nothing — an unbreakable mutation, and an unguarded clause wearing a test.
 * Only a synthetic disagreement makes the comparison prove itself.
 */
function findNonUniformExtensions(samples: ExtensionSample[]): string[] {
  return samples
    .filter((s) => s.firstVerdict !== s.lastVerdict)
    .map((s) => `${s.ext}: ${s.first} vs ${s.last}`);
}

describe("every tracked file in the gate's reach is covered by a gate step", () => {
  const trackedInGate = gitLsFiles(["--", GATE_CWD]);

  it("has files to check", () => {
    // Without this, an empty enumeration would satisfy every assertion below vacuously — which is
    // precisely how a guard that checks nothing reports green.
    expect(trackedInGate.length).toBeGreaterThan(400);
  });

  it(
    "covers every one of them, or exempts it with a stated reason",
    async () => {
      const uncovered: string[] = [];
      for (const file of trackedInGate) {
        const { coveredBy, exemption } = await classify(file);
        if (coveredBy.length === 0 && exemption === null) uncovered.push(file);
      }
      expect(
        uncovered,
        uncovered.length > 0
          ? [
              `${uncovered.length} tracked file(s) under ${GATE_CWD} are read by no gate step and have no`,
              "recorded exemption. Either extend the gate to reach them, or add an entry to EXEMPTIONS",
              "with the reason it is acceptable that nothing reads them.",
              "",
              ...uncovered.map((file) => `  ${file}`),
            ].join("\n")
          : "",
      ).toEqual([]);
    },
    COVERAGE_TIMEOUT_MS,
  );
});

describe("the exemption table is a record, not a blanket", () => {
  const trackedInGate = gitLsFiles(["--", GATE_CWD]);

  it("gives every entry a reason", () => {
    for (const entry of EXEMPTIONS) {
      expect(
        entry.reason.trim(),
        `the exemption ${String(entry.match)} must state why nothing reading it is acceptable`,
      ).not.toBe("");
    }
  });

  it("has no entry that matches nothing, which would be a claim about a file that has gone", () => {
    for (const entry of EXEMPTIONS) {
      const matched = trackedInGate.filter((f) => entry.match.test(f));
      expect(
        matched.length,
        `the exemption ${String(entry.match)} matches no tracked file under ${GATE_CWD}. ` +
          "Remove it: a policy entry about a file that no longer exists cannot be re-read.",
      ).toBeGreaterThan(0);
    }
  });

  it(
    "exempts no file that a gate step already covers",
    async () => {
      // Otherwise the table grows a catch-all that quietly stops new files being checked, which is
      // the same failure as a tool reporting success over a file it declined.
      const masked: string[] = [];
      for (const file of trackedInGate) {
        const { coveredBy, exemption } = await classify(file);
        if (exemption !== null && coveredBy.length > 0)
          masked.push(`${file} <- ${coveredBy.join(", ")}`);
      }
      expect(
        masked,
        masked.length > 0
          ? [
              "these files ARE covered by a gate step, so exempting them hides checked work:",
              ...masked.map((line) => `  ${line}`),
            ].join("\n")
          : "",
      ).toEqual([]);
    },
    COVERAGE_TIMEOUT_MS,
  );
});

describe("ESLint's coverage is uniform per extension, because the guard samples it", () => {
  // `lint` coverage is probed once per extension rather than once per file, because the exact
  // alternative is far worse: `lintFiles(".")` was measured at 13.6 s and per-file `isPathIgnored`
  // at 2.3 s, against ~1.9 s for the extension cache. Sampling is only sound while an extension's
  // verdict is uniform, which is what this asserts. A directory-scoped ignore would make it
  // non-uniform and stop the sample representing the class it is standing in for.
  const trackedInGate = gitLsFiles(["--", GATE_CWD]);

  it(
    "reaches the same verdict for the first and last file of every extension",
    async () => {
      const sampled: ExtensionSample[] = [];
      const byExtension = new Map<string, string[]>();
      for (const file of trackedInGate) {
        const ext = extensionOf(file);
        if (!byExtension.has(ext)) byExtension.set(ext, []);
        byExtension.get(ext)?.push(file);
      }
      for (const [ext, files] of [...byExtension.entries()].sort()) {
        if (files.length < 2) continue;
        const sorted = [...files].sort();
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        sampled.push({
          ext,
          first,
          last,
          firstVerdict: !(await eslint.isPathIgnored(first.slice(GATE_CWD.length))),
          lastVerdict: !(await eslint.isPathIgnored(last.slice(GATE_CWD.length))),
        });
      }

      const nonUniform = findNonUniformExtensions(sampled);
      expect(
        nonUniform,
        nonUniform.length > 0
          ? [
              "ESLint's verdict differs within these extensions, so one probe per extension cannot",
              "represent them and the exemption table would be built on a sample that lies:",
              ...nonUniform.map((line) => `  ${line}`),
            ].join("\n")
          : "",
      ).toEqual([]);
    },
    COVERAGE_TIMEOUT_MS,
  );
});

describe("live gate tooling cannot accumulate outside the gate's working directory", () => {
  const TOOLING_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".ps1"];

  it("finds every tooling file outside frontend/ under a declared frozen root", () => {
    const stray = gitLsFiles([])
      .filter((f) => !f.startsWith(GATE_CWD))
      .filter((f) => TOOLING_EXTENSIONS.includes(extensionOf(f)))
      .filter((f) => !isFrozen(f));

    expect(
      stray,
      stray.length > 0
        ? [
            "these files look like gate tooling but sit outside the gate's working directory, so no",
            "step examines them. Move them under frontend/, or declare the directory as a frozen",
            "root in FROZEN_ROOTS with its reason.",
            ...stray.map((f) => `  ${f}`),
          ].join("\n")
        : "",
    ).toEqual([]);
  });

  it("pins the frozen root where live-looking tooling accumulates", () => {
    const actual = gitLsFiles(["--", "scripts/"]).sort();
    expect(
      actual,
      "the repository-root scripts/ directory is declared frozen and pinned, so a new file there is " +
        "a deliberate decision. Cover it, move it, or remove the pin with a reason.",
    ).toEqual([...PINNED_ROOT_SCRIPTS].sort());
  });
});

describe("the .ps1 driver is covered by a step that exists and runs", () => {
  // The mutation that matters most: if `ps:check` were deleted while the table still claimed `.ps1`
  // was covered, this file would pass over a file no gate reads — the original defect, rebuilt.
  // Filtered rather than addressed with a `*.ps1` pathspec: git resolves a bare pathspec against the
  // repository root, so it also matched the archived copy, which `ps:check` deliberately does not read.
  const scripts = gitLsFiles(["--", `${GATE_CWD}scripts/`]).filter(
    (f) => extensionOf(f) === ".ps1",
  );

  it("finds the tracked PowerShell driver in the gate's reach", () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts)("records %s as covered by ps:check and by nothing else", async (file) => {
    const { coveredBy } = await classify(file);
    expect(coveredBy, `${file} must be covered by ps:check specifically`).toContain("ps:check");
    expect(
      coveredBy.filter((s) => s !== "ps:check"),
      `${file} unexpectedly reaches other steps; the exemption table's story about it would be stale`,
    ).toEqual([]);
  });

  it("wires ps:check into the application, the root proxy, the gate, and CI", () => {
    const application = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const root = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(application.scripts?.["ps:check"], "the application must define ps:check").toBe(
      "node scripts/powershell-parse-check.mjs",
    );
    expect(root.scripts?.["ps:check"], "the root must proxy ps:check").toMatch(
      /npm --prefix frontend run ps:check/,
    );
    expect(root.scripts?.gate, "the gate must run ps:check or it is not a gate").toContain(
      "run ps:check",
    );
    expect(readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8")).toMatch(
      /npm run ps:check/,
    );
  });
});

describe("the limitation is stated as a checked claim rather than as prose", () => {
  // `verification-integrity` requires a documented limitation to be a checked fact, because a
  // limitation nobody re-reads stops being true while the description still claims it is. M29 wrote
  // the paragraph this replaces; M30 made it a claim something fails on.
  const agents = readFileSync(join(REPO, "AGENTS.md"), "utf8");

  it("documents ps:check among the verified commands", () => {
    expect(agents).toMatch(/npm run ps:check\s+#/);
    expect(agents, "the gate's own order must list the step it runs").toMatch(
      /npm run gate[^\n]*ps:check[^\n]*build -> test/,
    );
  });

  it("no longer claims the driver has no static gate", () => {
    expect(agents).not.toMatch(/have no static gate/);
  });

  it("states that a missing interpreter is reported rather than passed", () => {
    expect(agents).toMatch(/reports rather than passes when no interpreter is found/);
  });
});

describe("this guard is proven able to fail", () => {
  // Every other assertion here compares a computed verdict against a table. A predicate that always
  // returned `true` would satisfy the lot, so the rule itself is witnessed on synthetic inputs
  // before it is trusted with the real tree.
  const alwaysCovers: Step = { name: "always", command: "-", covers: async () => true };

  it("passes a file a step covers", async () => {
    const { coveredBy, exemption } = await classify("frontend/src/thing.ts", [alwaysCovers], []);
    expect(coveredBy).toEqual(["always"]);
    expect(exemption).toBeNull();
  });

  it("fails a file nothing covers and nothing exempts", async () => {
    const neverCovers: Step = { name: "never", command: "-", covers: async () => false };
    const { coveredBy, exemption } = await classify("frontend/src/thing.zzz", [neverCovers], []);
    expect(coveredBy).toEqual([]);
    expect(
      exemption,
      "an unexempted, uncovered file is the failure this file exists to report",
    ).toBeNull();
  });

  it("names the reason an exemption applies", async () => {
    const neverCovers: Step = { name: "never", command: "-", covers: async () => false };
    const { exemption } = await classify("frontend/src/x.gitkeep", [neverCovers], EXEMPTIONS);
    expect(exemption).toMatch(/zero-byte/);
  });

  it("does not let a step cover a file outside the gate's working directory", async () => {
    // The regression that killed D2's original wording: asking ESLint about `../scripts/...` returns
    // `false`, but no step passes it, because both steps are scoped to `frontend/` by cwd.
    const { coveredBy } = await classify("scripts/sync-m19.prove.mjs", [
      { name: "lint", command: "eslint", covers: STEPS[0].covers },
      { name: "format:check", command: "prettier --check .", covers: STEPS[1].covers },
    ]);
    expect(coveredBy, "a file outside the gate's cwd is uncovered by construction").toEqual([]);
  });

  it("asks Prettier with the ignore path, and reports a difference when it is omitted", async () => {
    // Without this, a future edit that drops `ignorePath` would silently report every ignored file
    // as covered — and the exemption table would stop matching what the CLI actually does.
    const withIgnore = await prettier.getFileInfo("AGENTS.md", { ignorePath: ".prettierignore" });
    const without = await prettier.getFileInfo("AGENTS.md");
    expect(withIgnore.ignored, "AGENTS.md is excluded by .prettierignore").toBe(true);
    expect(
      without.ignored,
      "this assertion documents the API's default disagreeing with the CLI; if prettier changes it, " +
        "the ignorePath argument still has to be asserted",
    ).toBe(false);
  });

  it("detects an extension whose two probes disagree", () => {
    // The uniformity assertion is satisfied on the real tree, so without this it could not fail.
    const heterogeneous = findNonUniformExtensions([
      { ext: ".ts", first: "a.ts", last: "z.ts", firstVerdict: true, lastVerdict: true },
      { ext: ".md", first: "a.md", last: "docs/z.md", firstVerdict: true, lastVerdict: false },
    ]);
    expect(heterogeneous).toEqual([".md: a.md vs docs/z.md"]);
  });

  it("reports a uniform extension as uniform, so the detector is not trivially non-empty", () => {
    expect(
      findNonUniformExtensions([
        { ext: ".ts", first: "a.ts", last: "z.ts", firstVerdict: true, lastVerdict: true },
      ]),
    ).toEqual([]);
  });
});
