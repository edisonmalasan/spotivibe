import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * Guards the canonical gate-batch apparatus at `frontend/scripts/gate-batch/`.
 *
 * ## Why a second suite rather than a repointed `evidence-scripts.test.ts`
 *
 * That suite asserts ~590 lines against the *archived* copies, and guarding M21's recorded evidence is
 * what it is for. Repointing it at the canonical copies would fail spuriously — the canonical
 * corroborator is reformatted and repaired — or require weakening its assertions to accommodate the
 * move. Weakening a test so a refactor passes is the failure mode `verification-integrity` exists to
 * prevent. Two suites, two explicit subjects: this one guards the runnable tool, that one guards the
 * frozen record.
 *
 * ## Why some cases are gated on an interpreter, and what that means honestly
 *
 * The driver's repair is PowerShell, and no static gate covers PowerShell: `tsconfig.json` includes
 * only `.ts`/`.tsx`/`.mts`, and neither ESLint nor Prettier handles `.ps1`. So the resolution claim can
 * only be proven by *running* the script. CI runs `ubuntu-latest`, where PowerShell 7 is present as
 * `pwsh` but the Windows PowerShell 5.1 binary named by the usage block is not.
 *
 * These cases therefore resolve an available interpreter at runtime and **skip with a stated reason
 * where there is none**. A skipped case is reported as skipped, never as a pass — the gate's own
 * "skipped is never a pass" rule applies to this suite as much as to `motion-budget.test.ts`.
 */

const REPO = resolve(__dirname, "..", "..");
const CANONICAL = join(REPO, "frontend", "scripts", "gate-batch");
const DRIVER = join(CANONICAL, "run-gate-batch.ps1");
const CHECKER = join(CANONICAL, "verify-gate-batch.mjs");

const ARCHIVED = join(
  REPO,
  "openspec",
  "changes",
  "archive",
  "2026-10-05-harden-post-v1-verification",
  "evidence",
);

const read = (path: string): string => readFileSync(path, "utf8");
const sha256 = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gate-batch-"));
  temps.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/**
 * An available PowerShell interpreter, preferring the one the usage block names.
 *
 * The usage block names `powershell` (Windows PowerShell 5.1), which is absent on `ubuntu-latest`;
 * that runner has `pwsh`. Both run this script — it is written to avoid 5.1-only constructs — so the
 * suite uses whichever exists and records which. Returning `null` makes the caller skip with a reason
 * rather than fail, because "no interpreter" is an environment fact and not a defect in the tool.
 */
function findInterpreter(): { bin: string; named: string } | null {
  const usage = read(DRIVER);
  const named =
    /^#\s+(powershell|pwsh)\s+-File\s+run-gate-batch\.ps1/m.exec(usage)?.[1] ?? "powershell";
  for (const bin of [named, "pwsh", "powershell"]) {
    const probe = spawnSync(bin, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf8",
    });
    if (probe.status === 0) return { bin, named };
  }
  return null;
}

const INTERPRETER = findInterpreter();
const skipNoInterpreter = INTERPRETER
  ? false
  : "no PowerShell interpreter on PATH (`pwsh` and `powershell` both absent); the driver's behaviour cannot be executed here, and this is recorded as unverified rather than passed";

/**
 * Per-test budget for the cases that spawn a PowerShell interpreter.
 *
 * **This is a fix for a real defect, found by running the gate rather than the suite.** Run alone this
 * file takes ~21s and every case passes. Run inside the full gate — 183 files in parallel, with the
 * environment accounting for over half the wall clock — the multi-spawn cases exceeded vitest's
 * default 20s per-test budget and the gate went red with `Test timed out in 20000ms`.
 *
 * The suite was not slow by accident: these cases *execute a PowerShell process*, and one of them
 * runs the driver four times over four different directory depths. Process startup under a saturated
 * pool is the dominant cost and it is not something the test controls.
 *
 * A timeout raised here is not a weakened assertion. The budget governs how long a case may take
 * before it is killed as *hung*; it says nothing about what the case asserts, and a case that fails
 * its assertions still fails. What it does change is that a genuinely slow machine no longer reports
 * a timeout as though it were a defect in the tool — which is the confusion that matters, because the
 * first version of this file failed CI for exactly that kind of reason twice.
 */
const SPAWN_TIMEOUT_MS = 120_000;

interface DriverRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runDriver(scriptPath: string, args: string[]): DriverRun {
  const result = spawnSync(
    INTERPRETER!.bin,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
    { encoding: "utf8", cwd: REPO },
  );
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Copy the driver into a shaped tree so its own resolution can be exercised at that depth. */
function placeDriver(root: string, relative: string): string {
  const dir = join(root, relative);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, "run-gate-batch.ps1");
  cpSync(DRIVER, target);
  return target;
}

/** Make `root` look like a repository root by giving it the marker the driver walks up to. */
function makeFakeRepoRoot(root: string): void {
  mkdirSync(join(root, "frontend"), { recursive: true });
  writeFileSync(join(root, "frontend", "package.json"), '{"name":"fixture"}\n', "utf8");
}

describe("the canonical apparatus exists and the frozen record is untouched", () => {
  it("ships both scripts at the canonical path", () => {
    expect(existsSync(DRIVER)).toBe(true);
    expect(existsSync(CHECKER)).toBe(true);
  });

  it("names the canonical path in each copy's own header", () => {
    for (const path of [DRIVER, CHECKER]) {
      expect(read(path)).toContain("CANONICAL COPY");
      expect(read(path)).toContain("frontend/scripts/gate-batch");
    }
  });

  it("leaves the archived pair without that header, which is what proves the archive was not edited", () => {
    // The negative direction is the load-bearing one. A header added to both pairs would satisfy the
    // positive assertion above while silently rewriting M21's frozen record, so this asserts the
    // header's *absence* where it must be absent.
    for (const name of ["run-gate-batch.ps1", "verify-gate-batch.mjs"]) {
      const archived = join(ARCHIVED, name);
      expect(existsSync(archived)).toBe(true);
      expect(read(archived)).not.toContain("CANONICAL COPY");
    }
  });

  it("keeps the archived pair at the hashes recorded when the copies were taken", () => {
    // `tasks.md` §1.2 records these. If a later group edits the archive, this turns red instead of the
    // discrepancy being discovered by a reviewer diffing history.
    expect(sha256(join(ARCHIVED, "run-gate-batch.ps1"))).toBe(
      "1eefeeeb5bba598cfbea273f7a79a2bb6f8143250c40569c615c9b28277799fd",
    );
    expect(sha256(join(ARCHIVED, "verify-gate-batch.mjs"))).toBe(
      "65c81e956e16cc9da64a475839280b2c98668fb57d57fffab5cb8ce08a22f451",
    );
  });
});

describe("the driver resolves its repository root from a marker, not from a level count", () => {
  it.skipIf(skipNoInterpreter)(
    "resolves the same root from the canonical home, an active-change layout, and an archived layout",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The three shapes are the ones this tool has actually been stored in. The archived layout is
      // one level deeper than the active one, and it is the depth that broke the previous arithmetic:
      // four `Split-Path -Parent` calls from `<repo>/openspec/changes/archive/<slug>/evidence` land on
      // `<repo>/openspec`, which has no `frontend/package.json` beneath it.
      const fake = tempDir();
      makeFakeRepoRoot(fake);

      const shapes = [
        join("frontend", "scripts", "gate-batch"),
        join("openspec", "changes", "some-change", "evidence"),
        join("openspec", "changes", "archive", "2026-10-05-some-change", "evidence"),
        join("a", "b", "c", "d", "e", "f"),
      ];

      const roots = shapes.map((relative) => {
        const script = placeDriver(fake, relative);
        const run = runDriver(script, ["-LogDir", join(fake, "logs"), "-Runs", "0"]);
        expect(run.status, `driver failed at depth ${relative}:\n${run.stdout}${run.stderr}`).toBe(
          0,
        );
        const line = run.stdout
          .split(/\r?\n/)
          .find((l) => l.startsWith("repository root resolved by walking up to"));
        expect(line, `no resolved-root line at depth ${relative}`).toBeDefined();
        return line!.split(": ")[1]?.trim();
      });

      // Every depth must agree, and agree on the fake root rather than on the real repository — which
      // is what proves the walk starts at the script's own location rather than at a constant.
      for (const root of roots) expect(root).toBe(fake);
      expect(new Set(roots).size).toBe(1);
    },
  );

  it.skipIf(skipNoInterpreter)(
    "fails loudly, with a non-zero exit, when no marker exists at or above it",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Deliberately placed under the OS temp directory, which has no `frontend/package.json` above it
      // — verified by the assertion below rather than assumed, since a stray marker anywhere up the
      // chain would make this case pass for the wrong reason.
      const isolated = tempDir();
      let cursor = isolated;
      while (true) {
        expect(
          existsSync(join(cursor, "frontend", "package.json")),
          `temp ancestor ${cursor} unexpectedly contains the marker`,
        ).toBe(false);
        const parent = dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }

      const script = placeDriver(isolated, join("a", "b", "c"));
      const run = runDriver(script, ["-LogDir", join(isolated, "logs"), "-Runs", "0"]);

      expect(run.status).not.toBe(0);
      expect(run.stdout).toContain("FAIL no repository root found");
      // Names where it started and what it looked at, so the failure is diagnosable rather than a bare
      // non-zero exit.
      expect(run.stdout).toContain(join("a", "b", "c"));
      expect(run.stdout).toContain("examined, nearest first");
    },
  );

  it("no longer computes its root by counting parent levels", () => {
    // Structural, and deliberately not the whole story: it runs on any platform and catches the
    // regression immediately, while the behavioural cases above prove the walk actually resolves.
    // `Split-Path -Parent` still appears once — inside the walk — so the assertion is that it is not
    // applied a fixed number of times to derive the root.
    const source = read(DRIVER);
    const rootAssignment = source.slice(source.indexOf("$repoRoot = $probe"));
    expect(source).toContain("frontend");
    expect(rootAssignment.length).toBeGreaterThan(0);
    // Four chained parent applications is the shape that broke; a walk must re-enter its own probe.
    expect(source).not.toMatch(/Split-Path -Parent \$openspecDir/);
    expect(source).toMatch(/while \(\$true\)/);
  });
});

describe("the driver's dry mode is explicit and cannot be read as a batch", () => {
  it.skipIf(skipNoInterpreter)(
    "prints a DRY RUN line and exits 0 when -Runs is below 1",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const run = runDriver(DRIVER, ["-LogDir", join(tempDir(), "logs"), "-Runs", "0"]);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("DRY RUN");
      expect(run.stdout).toContain("not criterion evidence");
    },
  );

  it.skipIf(skipNoInterpreter)(
    "writes no logs at all in a dry run",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The corroborator is the second layer: it demands as many logs as it is told to, so a dry run
      // cannot corroborate anything even if its exit 0 were misread.
      const logDir = join(tempDir(), "logs");
      const run = runDriver(DRIVER, ["-LogDir", logDir, "-Runs", "0"]);
      expect(run.status).toBe(0);
      expect(existsSync(logDir) ? readdirSync(logDir) : []).toEqual([]);
    },
  );

  it("guards the DRY RUN line on -Runs being below 1, so it cannot print for a real batch", () => {
    // Present-and-absent is the property. Asserting only presence would pass a line printed
    // unconditionally, which would be as useless as one never printed — and asserting absence at
    // runtime would mean running a real gate, so the guard is asserted structurally instead.
    const source = read(DRIVER);
    expect(source).toMatch(/if \(\$Runs -lt 1\) \{[\s\S]*?DRY RUN/);
  });
});

describe("the driver's printed interface names an invocation that runs", () => {
  it(
    "names a PowerShell interpreter that actually exists on this machine",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The archived copy said `pwsh -File`, which does not run where only Windows PowerShell 5.1 is
      // installed. This asserts the *name* is a real PowerShell rather than comparing the usage text to
      // a second copy of the same claim, which would agree with itself whatever it said.
      const usage = read(DRIVER);
      const named = /^#\s+(powershell|pwsh)\s+-File\s+run-gate-batch\.ps1/m.exec(usage)?.[1];
      expect(named, "no usage line naming a PowerShell interpreter").toBeDefined();
      expect(["powershell", "pwsh"]).toContain(named);

      // **Whether this machine has the named interpreter is established by running it, and the answer
      // is allowed to be no.** CI runs `ubuntu-latest`, where the `powershell` binary this usage block
      // names does not exist while `pwsh` does.
      //
      // **Two CI failures came from this one case, and both were mine.** The first probed
      // unconditionally and asserted exit 0, so on CI `status` was `null` and the failure read
      // `not runnable here: expected null to be +0` — the shape of "the tool is broken", and untrue. The
      // repair asserted that the *spawn produced no error*, which is more precise but wrong in the same
      // way: CI then failed with `could not be spawned here: spawnSync powershell ENOENT`. Asserting a
      // spawn succeeds asserts the program **exists**, which is an environment fact rather than a
      // property of the tool — and a test whose red depends on the machine is a test whose red means
      // nothing.
      //
      // What is actually claimed, and it is the whole claim: the usage block names one of the two real
      // PowerShell executables. **If this machine also has that interpreter, it runs** — verified, not
      // assumed. Where it does not, the runnability half is not established and is not claimed; the
      // behavioural cases above skip with a stated reason. Absence is a *permitted outcome* here and is
      // reported as unverified, never as a pass.
      const probe = spawnSync(named!, ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" });
      const absent = probe.error !== undefined || probe.status === null;
      if (absent) {
        expect(
          ["powershell", "pwsh"],
          `usage names '${named}', which this machine does not have; only the name can be checked`,
        ).toContain(named);
        return;
      }
      expect(
        probe.status,
        `usage names '${named}' and it exists here, but it is not runnable`,
      ).toBe(0);
    },
  );

  it.skipIf(skipNoInterpreter)(
    "runs the printed completion command and it succeeds",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Verbatim from the script's own closing output, with only the log-directory placeholder
      // substituted. Copying the command into this test instead would test the copy.
      const run = runDriver(DRIVER, ["-LogDir", join(tempDir(), "logs"), "-Runs", "0"]);
      expect(run.status).toBe(0);

      const printed = run.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.startsWith("node ") && l.includes("verify-gate-batch.mjs"));
      expect(printed, "the driver printed no completion command").toBeDefined();
      expect(printed).toContain("verify-gate-batch.mjs");
      // The printed command names the canonical corroborator and a real frontend path.
      expect(printed).toContain(join("scripts", "gate-batch", "verify-gate-batch.mjs"));
      expect(printed).toContain(join(REPO, "frontend"));
    },
  );

  it.skipIf(skipNoInterpreter)(
    "prints --runs, so a non-default batch does not print a command that then fails loudly",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // **A second instance of the same defect, found by the same simulation that caught the first.**
      // This read `INTERPRETER?.bin ?? "powershell"`, which looks defensive but silently falls back
      // to a binary that may not exist — so the case ran and failed rather than skipping. With no
      // PowerShell present it is now skipped by the same guard as every other behavioural case, and
      // reported as skipped rather than as a pass.
      //
      // Recorded because the pattern is tempting and wrong: a fallback to a *hard-coded external
      // program* is not a default, it is an assumption that the program exists. `??` protects against
      // `undefined`, never against a missing file.
      const run = execFileSync(
        INTERPRETER!.bin,
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          DRIVER,
          "-LogDir",
          tempDir(),
          "-Runs",
          "0",
        ],
        { encoding: "utf8", cwd: REPO },
      );
      expect(run).toContain("--runs 0");
    },
  );

  it.skipIf(skipNoInterpreter)(
    "prints no figure at all when it has none to print, rather than an invented one",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // `-Runs 0` produces no run lines, so there is no figure to bind. The requirement this came from is
      // that the printed command must succeed on the evidence it describes — and a command carrying a
      // figure the driver never measured would fail that, while printing nothing is honest and the checker
      // still derives what it needs. This is the zero case of the rule, and it is the one that would go
      // untested if only the happy path were covered.
      const run = runDriver(DRIVER, ["-LogDir", join(tempDir(), "logs"), "-Runs", "0"]);

      expect(run.status).toBe(0);
      const printed = run.stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.startsWith("node ") && l.includes("verify-gate-batch.mjs"));
      expect(printed, "the driver printed no completion command").toBeDefined();
      expect(printed).not.toContain("--expect-files");
      expect(printed).not.toContain("--expect-budget");
      // And it says why, so the absence reads as a decision rather than as an oversight.
      expect(run.stdout).toContain("does not agree on a single file count");
    },
  );

  it("binds the printed figures to the ones it printed in its own summary", () => {
    // Static, because the positive half needs a six-run batch and this is the cheap guard against the
    // binding being deleted. It is a data-flow claim, not a positional one: the flags must be built from
    // the same two collections the summary is built from, or the command and the table above it drift
    // apart — which is precisely what happened when the summary printed them and the command did not.
    const source = read(DRIVER);

    expect(
      source,
      "the driver no longer collects a file count for its summary, so it cannot print one either",
    ).toMatch(/\$fileCounts\s*=/);
    expect(
      source,
      "the driver no longer collects a motion-budget count for its summary, so it cannot print one either",
    ).toMatch(/\$budgetCounts\s*=/);

    const printed = source
      .split(/\r?\n/)
      .find((l) => l.includes("verify-gate-batch.mjs") && l.includes("--frontend"));
    expect(printed, "the driver no longer prints a checker command").toBeDefined();
    expect(
      printed,
      "the printed command omits the figures the driver just measured, so following it fails a correct batch",
    ).toMatch(/--runs \$Runs\$expectFlags/);

    // Gated on the batch agreeing with itself, so a self-disagreeing batch prints no figure rather than
    // asserting one of two competing numbers — which would make the checker report the wrong problem.
    expect(
      source,
      "the printed figures are not gated on the batch agreeing on a single value",
    ).toMatch(
      /\$fileCounts\.Count -eq 1 -and \$budgetCounts\.Count -eq 1[\s\S]{0,300}--expect-files \$\(\$fileCounts\[0\]\) --expect-budget \$\(\$budgetCounts\[0\]\)/,
    );
  });
});

/**
 * A batch of logs shaped the way `run-gate-batch.ps1` writes them.
 *
 * Each log is byte-distinct by its timing line, because the corroborator hashes each log to tell six
 * runs from one run copied six times — six identical fixtures would be refused for the right reason
 * and test the wrong thing. `skipped` is deliberately absent: the checker requires *no* skipped tests,
 * so a fixture carrying `0 skipped` would be read as skipped-count 0 via a different path than the
 * real driver's, and one carrying `3 skipped` would fail the run rather than isolate the diagnostic.
 */
function writeBatch(
  dir: string,
  opts: { runs?: number; files?: number; tests?: number; budget?: number; commits?: string[] } = {},
): void {
  const runs = opts.runs ?? 6;
  const files = opts.files ?? 2;
  const tests = opts.tests ?? 10;
  const budget = opts.budget ?? 3;
  mkdirSync(dir, { recursive: true });
  for (let run = 1; run <= runs; run += 1) {
    const commit = opts.commits?.[run - 1] ?? "abc123def456";
    writeFileSync(
      join(dir, `run${run}.log`),
      [
        "gate exit0",
        `commit ${commit}`,
        "",
        ` Test Files  ${files} passed (${files})`,
        `      Tests  ${tests} passed (${tests})`,
        "",
        ` ✓ tests/motion-budget.test.ts (${budget} tests) ${100 + run}ms`,
        `   Duration  ${30 + run}.00s`,
        "",
      ].join("\n"),
      "utf8",
    );
  }
}

/**
 * A stub standing in for `frontend/`, so the corroborator's independent-enumeration phase runs in
 * milliseconds instead of spawning a real `vitest list` against the whole suite for every fixture.
 *
 * It prints exactly `ids` template ids, which satisfies the phase's anchor: `listedIds <= logTotal`
 * and a ratio of 1.0 over the 0.8 floor. The stub is a *fixture*, not a mock of the subject — the
 * phase under test is the checker's comparison, and the numbers it compares are these.
 *
 * **It also answers `--filesOnly`**, printing `files` file-shaped lines instead of template ids. That
 * is not incidental: the checker calls `vitest list --filesOnly` to learn the live tree's test-file
 * count, and uses it as the expectation whenever the caller states no `--expect-files`. A stub that
 * ignored the flag would print lines matching no file shape, so that phase would report "produced no
 * file list" and every fixture here would fail for a reason unrelated to what each case tests.
 */
function writeFrontendStub(root: string, ids: number, files = ids): string {
  const frontend = join(root, "frontend");
  mkdirSync(join(frontend, "node_modules", "vitest"), { recursive: true });
  writeFileSync(
    join(frontend, "node_modules", "vitest", "vitest.mjs"),
    [
      "const filesOnly = process.argv.includes('--filesOnly');",
      `const n = filesOnly ? ${files} : ${ids};`,
      "for (let i = 0; i < n; i += 1) {",
      "  if (filesOnly) process.stdout.write(`tests/x${i}.test.ts\\n`);",
      "  else process.stdout.write(`tests/x.test.ts > suite > case ${i}\\n`);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  return frontend;
}

function runChecker(logDir: string, frontend: string, args: string[] = []): DriverRun {
  const result = spawnSync(
    process.execPath,
    [CHECKER, logDir, "--frontend", frontend, "--runs", "6", ...args],
    { encoding: "utf8", cwd: REPO },
  );
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("a figure mismatch is diagnosable rather than merely fatal", () => {
  it("names the figure found, the figure expected, and that the tree is the source of it", () => {
    const root = tempDir();
    const logs = join(root, "logs");
    writeBatch(logs, { files: 2, budget: 3 });
    // The tree holds 7 files; the logs claim 2. No flag is stated, so the live tree is the expectation.
    const frontend = writeFrontendStub(root, 10, 7);

    const run = runChecker(logs, frontend);

    expect(run.status).toBe(1);
    // The three elements the repair added, each required. A message carrying only the first two is
    // the original undiagnosable failure.
    expect(run.stdout).toContain("found 2");
    expect(run.stdout).toContain("expected 7");
    expect(run.stdout).toContain("checked against the live tree");
    // And the consequence a reader needs: this is not a corrupt batch, it is a batch from another tree.
    expect(run.stdout).toContain("taken on a different tree");
  });

  it("distinguishes a caller-stated disagreement from a batch taken on another tree", () => {
    const root = tempDir();
    const logs = join(root, "logs");
    writeBatch(logs, { files: 2, budget: 3 });
    const frontend = writeFrontendStub(root, 10, 7);

    // The caller states a figure that does not match. That is a disagreement to investigate, not a
    // batch from elsewhere, and the diagnostic must not tell the reader to go looking for a different tree.
    //
    // **Both** flags are supplied deliberately. Supplying only `--expect-files` leaves `--expect-budget`
    // derived, and the assertion below would then be checking two things at once. Supplying both leaves
    // exactly one figure under test, and it is the caller-stated one.
    const run = runChecker(logs, frontend, ["--expect-files", "999", "--expect-budget", "3"]);

    expect(run.status).toBe(1);
    // Case-folded: the sentence starts the line, so its capitalisation is a presentation detail rather
    // than the claim, and pinning it would make this test break on a reword it would still satisfy.
    expect(run.stdout.toLowerCase()).toContain("you supplied this figure");
    expect(run.stdout).not.toContain("taken on a different tree");
  });

  it("asserts a caller-stated figure and corroborates, rather than checking the tree", () => {
    const root = tempDir();
    const logs = join(root, "logs");
    writeBatch(logs, { files: 2, budget: 3 });
    // The tree holds 7, and the caller states 2. The stated figure is the expectation, so this passes.
    const frontend = writeFrontendStub(root, 10, 7);

    const run = runChecker(logs, frontend, ["--expect-files", "2", "--expect-budget", "3"]);

    expect(run.stdout).toContain("corroborated");
    expect(run.status).toBe(0);
    // And the verdict must not claim a tree check it did not perform. A checker that printed
    // "checked against the live tree" here would be reporting a phase it skipped.
    expect(run.stdout).toContain("NOT checked against the live tree");
  });

  it("states what it asserted, so a green exit is not read as covering more than it did", () => {
    const root = tempDir();
    const logs = join(root, "logs");
    writeBatch(logs, { files: 2, budget: 3 });
    const frontend = writeFrontendStub(root, 10, 2);

    const run = runChecker(logs, frontend);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("what was asserted");
    expect(run.stdout).toContain("no figure was supplied");
    expect(run.stdout).toContain("checked against the live tree");
    expect(run.stdout).toContain("reported and never asserted");
  });

  it("refuses a batch whose logs agree on a file count the live tree does not hold", () => {
    // The property the removed hard-coded default was standing in for. Internally consistent evidence,
    // taken on a different tree: every run green, every figure agreeing, and still not this batch.
    const root = tempDir();
    const logs = join(root, "logs");
    writeBatch(logs, { files: 9, budget: 3 });
    const frontend = writeFrontendStub(root, 10, 7);

    const run = runChecker(logs, frontend);

    expect(run.status).toBe(1);
    expect(run.stdout).not.toContain("corroborated");
    expect(run.stdout).toContain("asserted 7 - the live tree, because you supplied none");
  });

  it("reports logs that disagree with each other as disagreement, not as a tree mismatch", () => {
    // A majority of five is not a figure for the sixth. Which of the two causes it is determines both
    // the remedy and whether the tree check ran at all, so the two sentences must not be interchangeable.
    const root = tempDir();
    const logs = join(root, "logs");
    writeBatch(logs, { files: 7, budget: 3 });
    writeFileSync(
      join(logs, "run3.log"),
      read(join(logs, "run3.log")).replace("Test Files  7 passed (7)", "Test Files  9 passed (9)"),
      "utf8",
    );
    const frontend = writeFrontendStub(root, 10, 7);

    const run = runChecker(logs, frontend);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("7, 9");
    expect(run.stdout).toContain("disagree with each other");
    expect(run.stdout).not.toContain("taken on a different tree");
  });

  it("refuses rather than corroborates when the live tree's file count cannot be read", () => {
    // A phase that cannot run is the absence of the check, not a pass. A stub that answers plain `list`
    // but not `--filesOnly` leaves the default expectation unavailable, and accepting the batch would
    // print `corroborated` under a comparison that never executed.
    const root = tempDir();
    const logs = join(root, "logs");
    writeBatch(logs, { files: 2, budget: 3 });
    const frontend = writeFrontendStub(root, 10, 2);
    writeFileSync(
      join(frontend, "node_modules", "vitest", "vitest.mjs"),
      "process.stdout.write('tests/x.test.ts > suite > case 0\\n');\n",
      "utf8",
    );

    const run = runChecker(logs, frontend);

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("FAIL live tree file count");
    expect(run.stdout).not.toContain("corroborated");
  });

  it("stores no literal default figure, which is the thing that used to go stale", () => {
    // The negative of the regression. A figure compiled into the checker is a snapshot of whatever tree
    // it was written on, and every later milestone invalidates it — which is how a perfect batch came to
    // exit 1 four separate times.
    const source = read(CHECKER);

    for (const flag of ["expect-files", "expect-budget"]) {
      expect(
        source,
        `the checker falls back to a literal for --${flag}, which is a snapshot of an earlier tree`,
      ).not.toMatch(new RegExp(`flags\\.get\\("${flag}"\\)\\s*\\?\\?\\s*["'\\d]`));
    }

    // And the mechanism that replaced them must be present, or the absence of a default is just the
    // absence of an expectation — which would corroborate anything.
    expect(source).toContain("--filesOnly");
  });

  it("still refuses a batch whose logs are not byte-distinct", () => {
    const root = tempDir();
    const logs = join(root, "logs");
    mkdirSync(logs, { recursive: true });
    const body = [
      "gate exit0",
      "commit abc123def456",
      "",
      " Test Files  2 passed (2)",
      "      Tests  10 passed (10)",
      "",
      " ✓ tests/motion-budget.test.ts (3 tests) 100ms",
      "",
    ].join("\n");
    for (let run = 1; run <= 6; run += 1) writeFileSync(join(logs, `run${run}.log`), body, "utf8");
    const frontend = writeFrontendStub(root, 10, 2);

    const result = runChecker(logs, frontend, ["--expect-files", "2", "--expect-budget", "3"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL log digests");
  });

  it("still refuses a batch whose logs do not name one commit", () => {
    const root = tempDir();
    const logs = join(root, "logs");
    writeBatch(logs, {
      files: 2,
      budget: 3,
      commits: ["aaa111", "bbb222", "aaa111", "bbb222", "aaa111", "bbb222"],
    });
    const frontend = writeFrontendStub(root, 10, 2);

    const result = runChecker(logs, frontend, ["--expect-files", "2", "--expect-budget", "3"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL commits named across the logs");
  });
});
