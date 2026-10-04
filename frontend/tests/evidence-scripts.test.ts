import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const CHANGE = join(REPO, "openspec", "changes", "harden-post-v1-verification");
const EVIDENCE = join(CHANGE, "evidence");
const DRIVER = join(EVIDENCE, "run-gate-batch.ps1");
const CHECKER = join(EVIDENCE, "verify-gate-batch.mjs");
const TASKS = join(CHANGE, "tasks.md");

const read = (path: string): string => readFileSync(path, "utf8");

/**
 * Round 11's NIT 4, which the verifier graded **not acceptable as it stands**.
 *
 * These two files are the only artefacts in this change a reader is asked to *execute*. Everything else in
 * the repository is covered by `prettier`, `eslint`, `tsc` and `vitest`; these two sit outside `frontend/`
 * and so outside all four. That is not a theoretical gap: round 10 found two defects in them *after* they
 * shipped, round 11 found five more, and not one of those seven would have been caught by the gate. The
 * defence offered in the records — that they had been corrected several times — is an argument for a gate,
 * not against one.
 *
 * Four assertions, each of which the seven defects above defeated individually:
 *
 *  1. both files exist and the `.mjs` **parses** — `node --check`, the cheapest possible proof that a file a
 *     reader is told to run is not a syntax error;
 *  2. the checker **requires** a `gate exit` line, and the driver **writes** one. This is a wiring
 *     assertion between two files, and it is here because that exact pairing was WARNING 3: the criterion
 *     says six *green* runs and the exit status had no artefact in either file;
 *  3. neither file hard-codes a machine path. `--runs` appears in the driver's printed command (NIT 1: the
 *     printed interface was correct only for the default, which is not what an interface is for);
 *  4. `tasks.md` never names a checker that is not in the repository without saying so — closing WARNING 6,
 *     which was a *correction* that asserted a fact about the file which the file did not bear out.
 */
describe("the batch evidence scripts are covered, because they are the only files a reader is told to run", () => {
  it("both exist, and the checker parses", () => {
    expect(existsSync(DRIVER), `${DRIVER} is missing`).toBe(true);
    expect(existsSync(CHECKER), `${CHECKER} is missing`).toBe(true);

    // `node --check` rather than importing it: importing would execute the module, and this file's whole
    // subject is a script that must be run deliberately with a log directory. Executing it here would need a
    // fixture of six logs, which is the batch's job and not this suite's.
    const checked = spawnSync(process.execPath, ["--check", CHECKER], { encoding: "utf8" });
    expect(
      checked.status,
      `node --check rejected the checker, which is the file a reader is told to run:\n${checked.stderr}`,
    ).toBe(0);
  });

  it("the driver writes the exit status the checker requires", () => {
    const driver = read(DRIVER);
    const checker = read(CHECKER);

    // WARNING 3, measured both ways: a log carrying every green figure plus `npm error code 1` was
    // corroborated with exit 0, because the criterion's green half had no artefact anywhere.
    expect(driver, "the driver must write the gate's exit status into the log").toContain(
      "gate exit$exitCode",
    );
    expect(checker, "the checker must require that status rather than infer it").toContain(
      "gate exit",
    );

    // And it must *refuse* a log without one. A checker that defaults an absent status to zero has
    // reintroduced the original defect with a default value.
    expect(checker).toContain("the log carries no `gate exit <code>` line");
    // NIT 3: six byte-identical logs were corroborated as six runs, which is the cheapest way to make a
    // stability criterion vacuous. Distinctness is asserted on the bytes.
    expect(checker, "distinct logs must be asserted, not just agreeing figures").toContain(
      "identical logs cannot be six runs",
    );
  });

  it("neither script hard-codes a machine path", () => {
    for (const path of [DRIVER, CHECKER]) {
      // Prose in a comment may legitimately *name* a path while explaining that it must not be hard-coded, so
      // comments are removed before the search rather than excused after it. The first version of this filter
      // stripped only `*` and `//`, which missed PowerShell's `#` — and the assertion then failed on a
      // comment in the driver that says the arrangement was self-reported. A check that fires on prose is
      // worse than no check, because the next person widens the exemption instead of fixing the path.
      //
      // A `#` inside a string literal would be mistaken for a comment, which can only make this assertion
      // miss a real path, never invent one. That is the correct direction to be wrong in.
      const offenders = read(path)
        .split(/\r?\n/)
        .map((line) => {
          const trimmed = line.trim();
          // A comment marker at column 0 has no whitespace before it, so the trailing-comment rule below
          // cannot see it. The driver's header documents the arrangement this change replaced and names the
          // old script while explaining that it must not be relied on — which is prose, not a hard-coded
          // path, and an assertion that reads it as one fires on the very comment that keeps the record
          // honest.
          if (trimmed.startsWith("#") || trimmed.startsWith("*") || trimmed.startsWith("//"))
            return "";
          return line.replace(/\s(#|\/\/|\*).*$/, "").trim();
        })
        .filter((line) => line.length > 0)
        .filter((line) => /[A-Za-z]:\\|AppData|Temp\\|gateruns\d/.test(line));

      expect(
        offenders,
        `${path} hard-codes a machine-specific path:\n${offenders.join("\n")}`,
      ).toEqual([]);
    }
  });

  it("the driver prints a checker command that carries the run count it was given", () => {
    // NIT 1: the printed interface omitted `--runs`, so it was correct only for `-Runs 6` - and a `-Runs 3`
    // batch printed a command that then failed on four unexamined logs. Loud beats silent, so this was a
    // NIT rather than a WARNING, but the interface was wrong for every non-default value.
    const driver = read(DRIVER);
    const printed = driver
      .split(/\r?\n/)
      .find((line) => line.includes("verify-gate-batch.mjs") && line.includes("--frontend"));

    expect(printed, "the driver no longer prints a checker command").toBeDefined();
    expect(
      printed,
      "the printed command omits --runs, so it is right only for the default",
    ).toContain("--runs $Runs");
  });
});

/**
 * Round 11's WARNING 6, closed by a gate rather than by an amendment.
 *
 * The eleventh entry claimed all eleven earlier batch entries "now read as" pointing at the shipped
 * checker. Measured: three still named `verify-gaterunsN.mjs` — a temp-directory file, not in the
 * repository — and three more said "by separate code" with no pointer at all. The correction existed,
 * 600 lines *after* the entries it corrected, which is the wrong direction for anyone reading forward.
 *
 * So the entries are amended in place, and this asserts the amendment holds. The alternative is a
 * correction that is one edit away from the same hole, which is what the eleventh entry was.
 */
describe("no record in this change claims corroboration from a checker nobody else can run", () => {
  const lines = read(TASKS).split(/\r?\n/);
  const mentions = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /verify-gateruns\d*\.mjs/.test(line));

  it("finds the entries it is guarding, so the assertion is not vacuous", () => {
    // The guard below passes trivially if no entry mentions a temp-only checker. That is the same
    // vacuity round 7 found in the yaml reader, and it is closed the same way: assert the population first.
    expect(
      mentions.length,
      "no entry names a temp-directory checker, so the disclaimer rule below cannot fail",
    ).toBeGreaterThan(0);
  });

  it("every mention of a temp-only checker carries its disclaimer nearby", () => {
    const bare = mentions.filter(({ index }) => {
      const window = lines.slice(Math.max(0, index - 3), index + 4).join(" ");
      return !/not in the repository|temp director/i.test(window);
    });

    expect(
      bare.map(({ index, line }) => `line ${index + 1}: ${line.trim().slice(0, 100)}`),
      "these entries name a checker that is not in the repository without saying so, so a reader " +
        "arriving at one of them alone is told a figure was corroborated by a script that does not exist",
    ).toEqual([]);
  });
});
