import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const CHANGE = join(REPO, "openspec", "changes", "harden-post-v1-verification");
const EVIDENCE = join(CHANGE, "evidence");
const DRIVER = join(EVIDENCE, "run-gate-batch.ps1");
const CHECKER = join(EVIDENCE, "verify-gate-batch.mjs");
const TASKS = join(CHANGE, "tasks.md");

const read = (path: string): string => readFileSync(path, "utf8");

/** Executable text only. A needle satisfied by a comment is not an assertion about behaviour. */
function stripComments(source: string, markers: readonly string[]): string {
  return source
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (markers.some((marker) => trimmed.startsWith(marker))) return "";
      for (const marker of markers) {
        const at = line.search(new RegExp(`\\s${marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
        if (at !== -1) return line.slice(0, at);
      }
      return line;
    })
    .join("\n");
}

const POWERSHELL = ["#", "*"] as const;
const JAVASCRIPT = ["//", "*"] as const;

// ---------------------------------------------------------------------------------------------
// The harness. Everything below asserts on what the checker DOES, by running it.
//
// Round 11 replaced this file's predecessor with four assertions on literal substrings of the
// checker's and driver's own diagnostic messages. Round 12 measured what that was worth: disabling the
// enforcement while leaving the message in place (`if (!allDistinct)` -> `if (false && !allDistinct)`)
//// left the suite green at 6/6, and the shipped checker then printed
//
//     FAIL log digests across the logs: 1 distinct of 6
//     corroborated: all 6 logs are distinct runs, each green, ...
//
// on consecutive lines and exited **0**. That is this checker's own recorded defect 6 - "A phase that
// could not run was counted as a pass, and the word 'corroborated' was printed under it" - reintroduced
// by the repair written for it. The worse half is easy to miss: the gate was green when the checker was
// **correct** too, because a test that greps a file for strings it wrote has no opinion about behaviour
// either way.
//
// So every case below is a negative case, and a negative case is its own proof the checker can fail:
// there is nothing to mutate, because the assertion *is* the mutation.
// ---------------------------------------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), "evidence-gate-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A log carrying every figure the checker asserts, plus nothing it objects to. */
function greenLog(run: number): string {
  return [
    "gate exit0",
    " Test Files  182 passed (182)",
    "      Tests  3326 passed (3326)",
    " ✓ tests/motion-budget.test.ts (21 tests) 1200ms",
    `   Duration  ${170 + run}.44s`,
    "",
  ].join("\n");
}

function writeLogs(dir: string, bodies: readonly string[]): string {
  mkdirSync(dir, { recursive: true });
  bodies.forEach((body, index) => writeFileSync(join(dir, `run${index + 1}.log`), body, "utf8"));
  return dir;
}

/**
 * A stub frontend, so the enumeration phase returns a figure we control. It is `node` and a directory:
 * no package is installed, which is also why this suite can run the checker on a machine that has never
 * run an install.
 */
function stubFrontend(name: string, templates: number): string {
  const dir = join(scratch, name);
  mkdirSync(join(dir, "node_modules/vitest"), { recursive: true });
  writeFileSync(join(dir, "package.json"), '{"name":"stub","private":true}\n', "utf8");
  writeFileSync(
    join(dir, "node_modules/vitest/vitest.mjs"),
    `for (let i = 0; i < ${templates}; i += 1) process.stdout.write(\`tests/x.test.ts > t\${i}\\n\`);\n`,
    "utf8",
  );
  return dir;
}

interface Verdict {
  exit: number | null;
  corroborated: boolean;
  digestLine: string;
  problems: string | null;
}

function runChecker(logDir: string, frontend: string, extra: readonly string[] = []): Verdict {
  const result = spawnSync(
    process.execPath,
    [CHECKER, logDir, "--frontend", frontend, "--runs", "6", ...extra],
    { encoding: "utf8", env: process.env },
  );
  const output = ((result.stdout ?? "") + (result.stderr ?? "")).replace(/\x1b\[[0-9;]*m/g, "");
  return {
    exit: result.status,
    corroborated: /^corroborated:/m.test(output),
    digestLine: (output.split("\n").find((line) => /log digests/.test(line)) ?? "").trim(),
    problems: /(\d+) problem\(s\) unresolved/.exec(output)?.[1] ?? null,
  };
}

describe("the shipped checker corroborates a real batch", () => {
  it("accepts six green, distinct logs and says so", () => {
    // The control. Without it, every case below could be green because the checker refuses everything.
    const dir = writeLogs(
      join(scratch, "control"),
      [1, 2, 3, 4, 5, 6].map((run) => greenLog(run)),
    );
    const verdict = runChecker(dir, stubFrontend("fe-control", 3003));

    expect(verdict.exit, `the control must pass; digest line was: ${verdict.digestLine}`).toBe(0);
    expect(verdict.corroborated, "the control must reach the corroborated verdict").toBe(true);
  });
});

describe("the shipped checker refuses what round 11's gate could only grep for", () => {
  // Each `it` below is a case the checker must reject. If one of these passes silently, the checker has
  // a false green - which is the defect this whole change exists to remove.

  it("refuses six byte-identical logs: agreement between copies is not stability", () => {
    // Round 11's NIT 3. Round 12's R7b disabled this enforcement and the gate stayed green while the
    // checker printed `corroborated` and exited 0 over its own printed FAIL.
    const dir = writeLogs(
      join(scratch, "copies"),
      Array.from({ length: 6 }, () => greenLog(1)),
    );
    const verdict = runChecker(dir, stubFrontend("fe-copies", 3003));

    expect(verdict.exit, `six copies were corroborated: ${verdict.digestLine}`).not.toBe(0);
    expect(verdict.corroborated, "six copies must never reach the corroborated verdict").toBe(
      false,
    );
  });

  it("refuses a log that carries no exit status, because the criterion is six GREEN runs", () => {
    // Round 11's W3. The exit status had no artefact anywhere; the driver's `$exitCode` went to the
    // console while the log received the gate's stdout and nothing else.
    const dir = writeLogs(
      join(scratch, "no-exit"),
      [1, 2, 3, 4, 5, 6].map((run) => greenLog(run).replace("gate exit0\n", "")),
    );
    const verdict = runChecker(dir, stubFrontend("fe-no-exit", 3003));

    expect(
      verdict.exit,
      "a log with no exit status cannot establish that the run was green",
    ).not.toBe(0);
    expect(verdict.corroborated).toBe(false);
  });

  it("refuses a log whose gate exited non-zero, however green its figures look", () => {
    const dir = writeLogs(
      join(scratch, "nonzero"),
      [1, 2, 3, 4, 5, 6].map((run) => greenLog(run).replace("gate exit0", "gate exit1")),
    );
    const verdict = runChecker(dir, stubFrontend("fe-nonzero", 3003));

    expect(verdict.exit, "a non-zero gate exit is not a green run").not.toBe(0);
    expect(verdict.corroborated).toBe(false);
  });

  it("refuses a log carrying a second, failing verdict", () => {
    // A log with two verdicts is not decidable from the file, so it is refused rather than resolved.
    const dir = writeLogs(
      join(scratch, "two-verdicts"),
      [1, 2, 3, 4, 5, 6].map((run) =>
        run === 1
          ? `${greenLog(run)}\n Test Files  1 failed | 181 passed (182)\n      Tests  1 failed | 3325 passed (3326)\nnpm error code 1\n`
          : greenLog(run),
      ),
    );
    const verdict = runChecker(dir, stubFrontend("fe-two", 3003));

    expect(verdict.exit, "a log holding two verdicts was resolved rather than refused").not.toBe(0);
    expect(verdict.corroborated).toBe(false);
  });

  it("refuses an enumeration anchored to nothing: one test in the tree is not corroboration", () => {
    // Round 11's W2. A `--frontend` holding a single test satisfied `listedIds <= logTotal`, because
    // 1 <= 3326.
    const dir = writeLogs(
      join(scratch, "one-test"),
      [1, 2, 3, 4, 5, 6].map((run) => greenLog(run)),
    );
    const verdict = runChecker(dir, stubFrontend("fe-one", 1));

    expect(verdict.exit, "a tree holding one test was accepted as corroboration").not.toBe(0);
    expect(verdict.corroborated).toBe(false);
  });

  it("refuses an executed total inflated a thousandfold", () => {
    // Round 11's W4. `listedIds <= logTotal` detects an understated total and is blind to an overstated
    // one; six logs claiming 999999 tests were reported as agreeing, with a gap of 997 004 printed on the
    // line above the verdict word.
    const dir = writeLogs(
      join(scratch, "inflated"),
      [1, 2, 3, 4, 5, 6].map((run) =>
        greenLog(run)
          .replace("Tests  3326 passed (3326)", "Tests  999999 passed (999999)")
          .replace("Duration", "Duration"),
      ),
    );
    const verdict = runChecker(dir, stubFrontend("fe-inflated", 3003));

    expect(verdict.exit, "an inflated executed total was accepted as corroboration").not.toBe(0);
    expect(verdict.corroborated).toBe(false);
  });
});

describe("the two evidence scripts are readable by the person told to run them", () => {
  it("both exist, and the checker parses", () => {
    expect(existsSync(DRIVER), `${DRIVER} is missing`).toBe(true);
    expect(existsSync(CHECKER), `${CHECKER} is missing`).toBe(true);

    // `node --check`, not an import: importing would execute the module, and this suite already runs the
    // script properly, with a log directory, further down.
    const checked = spawnSync(process.execPath, ["--check", CHECKER], { encoding: "utf8" });
    expect(
      checked.status,
      `node --check rejected the checker, which is the file a reader is told to run:\n${checked.stderr}`,
    ).toBe(0);
  });

  it("the driver's executable code writes the exit status the checker requires", () => {
    // Round 11 asserted `driver.toContain("gate exit$exitCode")`. Round 12's R6 satisfied that needle by
    // commenting the line out, and the suite stayed green - the same defect class `code()` was written to
    // kill two files over. So the needle is taken from the executable text only.
    const executable = stripComments(read(DRIVER), POWERSHELL);

    expect(executable).toContain("gate exit$exitCode");
    expect(
      executable,
      "the exit status must be written by the WriteAllText call, not merely mentioned near it",
    ).toMatch(/WriteAllText\(\$logPath,\s*"gate exit\$exitCode/);
  });

  it("the driver's printed checker command carries the run count it was given", () => {
    // NIT 1: the printed interface omitted `--runs`, so it was right only for `-Runs 6`.
    const executable = stripComments(read(DRIVER), POWERSHELL);
    const printed = executable
      .split(/\r?\n/)
      .find((line) => line.includes("verify-gate-batch.mjs") && line.includes("--frontend"));

    expect(printed, "the driver no longer prints a checker command").toBeDefined();
    expect(
      printed,
      "the printed command omits --runs, so it is right only for the default",
    ).toContain("--runs $Runs");
  });

  it("neither script hard-codes a machine path, on any platform", () => {
    // Round 11's filter was `/[A-Za-z]:\\|AppData|Temp\\|gateruns\d/` - four Windows shapes. CI is
    // `ubuntu-latest`, and round 12's R9 put `/home/runner/work/...` into the driver and stayed green.
    // The assertion is now the one its name claims: any machine, any platform.
    for (const [path, markers] of [
      [DRIVER, POWERSHELL],
      [CHECKER, JAVASCRIPT],
    ] as const) {
      const offenders = stripComments(read(path), markers)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((line) =>
          /[A-Za-z]:\\|\/home\/|\/Users\/|AppData|gateruns\d|\/var\/folders/.test(line),
        );

      expect(
        offenders,
        `${path} hard-codes a machine-specific path:\n${offenders.join("\n")}`,
      ).toEqual([]);
    }
  });

  it("the checker's documented defaults are the defaults it asserts", () => {
    // Round 12's CRITICAL 4a: the header said the flags "default to 181 and 21" while the code read
    // `?? "182"`, and nothing anywhere compared the two. Commit ed6f9f6 raised the default and left the
    // sentence behind it, which is a false claim in a file a reader runs.
    const checker = read(CHECKER);
    const files = /flags\.get\("expect-files"\)\s*\?\?\s*"(\d+)"/.exec(checker)?.[1];
    const budget = /flags\.get\("expect-budget"\)\s*\?\?\s*"(\d+)"/.exec(checker)?.[1];
    const documented = /default to (\d+) and (\d+)/.exec(checker);

    expect(files, "could not read the --expect-files default out of the checker").toBeDefined();
    expect(budget, "could not read the --expect-budget default out of the checker").toBeDefined();
    expect(
      documented?.[0],
      "the checker's header no longer states its defaults in the form this assertion reads, so the " +
        "sentence and the code can drift apart again without anything noticing",
    ).toBeDefined();
    expect(`${documented![1]} and ${documented![2]}`).toBe(`${files} and ${budget}`);
  });
});

describe("no record in this change claims corroboration from a checker nobody else can run", () => {
  /**
   * Round 11 guarded this with a ±3-line window around a `/verify-gateruns\d*\.mjs/` match. Round 12
   * measured two ways past it: dropping `.mjs` removed the line from the population entirely, and putting
   * the disclaimer on the *neighbouring* entry satisfied a proximity window that was never a reference.
   *
   * So the unit is the **entry** - a blank-line-delimited paragraph - not the line. A mention in an entry
   * requires that entry to say the script is not in the repository, which is the only thing the sentence
   * actually has to communicate to a reader arriving at it alone.
   */
  const entries = read(TASKS)
    .split(/\r?\n\s*\r?\n/)
    .map((entry) => ({ entry, text: entry.replace(/\s+/g, " ") }))
    .filter(({ text }) => /verify-gateruns\d*/.test(text));

  it("finds the entries it is guarding, so the rule below cannot pass vacuously", () => {
    expect(
      entries.length,
      "no entry names a temp-only checker, so the disclaimer rule below cannot fail",
    ).toBeGreaterThan(0);
  });

  it("every entry naming a temp-only checker says in that same entry that it is not in the repository", () => {
    const bare = entries.filter(({ text }) => !/not in the repository|temp director/i.test(text));

    expect(
      bare.map(({ text }) => text.slice(0, 120)),
      "these entries name a checker that is not in the repository without saying so in the same entry, " +
        "so a reader arriving at one of them alone is told a figure was corroborated by a script that " +
        "does not exist",
    ).toEqual([]);
  });
});
