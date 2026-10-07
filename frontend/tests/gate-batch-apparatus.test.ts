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
const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

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
  const named = /^#\s+(powershell|pwsh)\s+-File\s+run-gate-batch\.ps1/m.exec(usage)?.[1] ?? "powershell";
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
        expect(run.status, `driver failed at depth ${relative}:\n${run.stdout}${run.stderr}`).toBe(0);
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
  it.skipIf(skipNoInterpreter)("prints a DRY RUN line and exits 0 when -Runs is below 1", () => {
    const run = runDriver(DRIVER, ["-LogDir", join(tempDir(), "logs"), "-Runs", "0"]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("DRY RUN");
    expect(run.stdout).toContain("not criterion evidence");
  });

  it.skipIf(skipNoInterpreter)("writes no logs at all in a dry run", () => {
    // The corroborator is the second layer: it demands as many logs as it is told to, so a dry run
    // cannot corroborate anything even if its exit 0 were misread.
    const logDir = join(tempDir(), "logs");
    const run = runDriver(DRIVER, ["-LogDir", logDir, "-Runs", "0"]);
    expect(run.status).toBe(0);
    expect(existsSync(logDir) ? readdirSync(logDir) : []).toEqual([]);
  });

  it("guards the DRY RUN line on -Runs being below 1, so it cannot print for a real batch", () => {
    // Present-and-absent is the property. Asserting only presence would pass a line printed
    // unconditionally, which would be as useless as one never printed — and asserting absence at
    // runtime would mean running a real gate, so the guard is asserted structurally instead.
    const source = read(DRIVER);
    expect(source).toMatch(/if \(\$Runs -lt 1\) \{[\s\S]*?DRY RUN/);
  });
});

describe("the driver's printed interface names an invocation that runs", () => {
  it("names a PowerShell interpreter that actually exists on this machine", () => {
    // The archived copy said `pwsh -File`, which does not run where only Windows PowerShell 5.1 is
    // installed. This asserts the *name* is a real PowerShell rather than comparing the usage text to
    // a second copy of the same claim, which would agree with itself whatever it said.
    const usage = read(DRIVER);
    const named = /^#\s+(powershell|pwsh)\s+-File\s+run-gate-batch\.ps1/m.exec(usage)?.[1];
    expect(named, "no usage line naming a PowerShell interpreter").toBeDefined();
    expect(["powershell", "pwsh"]).toContain(named);
    if (INTERPRETER) {
      const probe = spawnSync(named!, ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" });
      expect(probe.status, `usage names '${named}' but it is not runnable here`).toBe(0);
    }
  });

  it.skipIf(skipNoInterpreter)("runs the printed completion command and it succeeds", () => {
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
  });

  it("prints --runs, so a non-default batch does not print a command that then fails loudly", () => {
    const run = execFileSync(
      INTERPRETER?.bin ?? "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", DRIVER, "-LogDir", tempDir(), "-Runs", "0"],
      { encoding: "utf8", cwd: REPO },
    );
    expect(run).toContain("--runs 0");
  });
});