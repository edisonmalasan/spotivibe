import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CASES } from "../scripts/lyrics-induced-violations.cases.mjs";

/**
 * Guard for the M16 induced-violation harness.
 *
 * `scripts/lyrics-induced-violations.cjs` proves the tests written for the lyrics capability can
 * actually fail: it breaks one production behaviour at a time, runs the test named for that
 * behaviour, and requires it to fail. Fifteen of fifteen were caught; that result is recorded in this
 * change's evidence README.
 *
 * **Why the harness is a script and not a test.** It spawns `vitest`, so running it from inside
 * `vitest` would nest a test runner inside a test runner, and its ~90-second cost is not something to
 * add to every local run or to CI.
 *
 * **Why it then needs a test.** A harness that silently degrades is worse than none. Its cases live
 * in `./lyrics-induced-violations.cases.cjs` — imported here rather than parsed out of the harness's
 * source, because the first version of this guard did exactly that with a regex, matched 4 of the 11
 * cases, and reported "4 of 11" instead of reporting that its own parser was broken. What it must
 * still guarantee is that every anchor resolves, because an unresolved anchor makes a case skip, and
 * a skipped case is counted as neither a pass nor a failure unless someone checks.
 */

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, "..");

describe("the M16 induced-violation harness (spec lyrics)", () => {
  it("carries the fifteen cases the evidence records", () => {
    // A floor rather than an exact count: adding a case is the expected way to grow this, but a
    // harness that has lost its cases must fail rather than report a vacuous pass.
    expect(CASES.length).toBeGreaterThanOrEqual(15);
  });

  it("gives every case a distinct name, so a result identifies which behaviour it broke", () => {
    const names = CASES.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("records why each violation matters", () => {
    // A case with no stated consequence is a case nobody can triage when it unexpectedly passes.
    for (const entry of CASES) {
      expect(entry.why.length, `${entry.name} must record why it matters`).toBeGreaterThan(20);
    }
  });

  it("points every case at a test file that exists", () => {
    for (const entry of CASES) {
      expect(existsSync(join(frontend, entry.test)), `${entry.name} -> ${entry.test}`).toBe(true);
    }
  });

  it("points every case at a source file that exists", () => {
    for (const entry of CASES) {
      expect(existsSync(join(frontend, entry.file)), `${entry.name} -> ${entry.file}`).toBe(true);
    }
  });

  it("resolves every anchor, so no case can silently skip", () => {
    // The one condition the harness cannot check about itself.
    for (const entry of CASES) {
      const source = readFileSync(join(frontend, entry.file), "utf8");
      expect(
        source.includes(entry.from),
        `${entry.name}: anchor not found in ${entry.file}. The harness would skip this case.`,
      ).toBe(true);
    }
  });

  it("changes the source for every case, so no case is a no-op", () => {
    // A case whose `to` equals its `from` would break nothing and could never fail, which would
    // read as a caught violation while testing nothing.
    for (const entry of CASES) {
      expect(entry.to, `${entry.name} must actually change something`).not.toBe(entry.from);
    }
  });

  it("uses a distinct file+anchor for every case, so no case can mask another", () => {
    const targets = CASES.map((entry) => `${entry.file}::${entry.from}`);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("restores every file it modifies, unconditionally", () => {
    // The harness writes production source, so a crash between the violation and the restore would
    // leave a broken tree. Asserting the `finally` makes removing it a deliberate act.
    const harness = readFileSync(
      join(frontend, "scripts", "lyrics-induced-violations.mjs"),
      "utf8",
    );
    expect(harness).toContain("finally {");
    // ESM, so the import is bare rather than `fs.writeFileSync` — the assertion has to name what the
    // file actually says, or it stops being an assertion at all.
    expect(harness).toContain("writeFileSync(file, original);");
  });

  it("exits non-zero when a case escapes or an anchor is unresolved", () => {
    // Otherwise "some violations escaped" is indistinguishable from "all were caught".
    const harness = readFileSync(
      join(frontend, "scripts", "lyrics-induced-violations.mjs"),
      "utf8",
    );
    expect(harness).toContain("process.exit(escaped.length === 0 && skipped.length === 0 ? 0 : 1)");
  });

  it("treats an unresolved anchor as a failure rather than a skip", () => {
    const harness = readFileSync(
      join(frontend, "scripts", "lyrics-induced-violations.mjs"),
      "utf8",
    );
    expect(harness).toContain('"ANCHOR NOT FOUND"');
  });
});
