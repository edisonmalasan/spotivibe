// Prove `sync-m17-home.mjs` can actually refuse, before it is trusted with a real merge.
//
// Why this exists: the M16 sync script was written, read once, and merged. A guard that has only ever
// been seen to pass is a claim, not a guard — and `sync-m16-lyrics.mjs` carries `SPOTIVIBE_REPO`
// specifically so its refusal path can be exercised against a copy. This does that for the M17 script.
//
// Each case copies the real `openspec/` tree into a temp directory, mutates the COPY, runs the sync
// against it, and requires a non-zero exit whose message names the defect. The real repository is
// never written to.
//
// Usage, from the repository root:  node scripts/sync-m17-home.prove.mjs
//
// Run with Node 24. ESM only: `require` is a lint error in this repository's `.mjs` scripts.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SYNC = resolve("scripts", "sync-m17-home.mjs");
const REPO = process.cwd();

/** A throwaway copy of the OpenSpec tree, so no case can touch the record of truth. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "spotivibe-m17-sync-"));
  cpSync(join(REPO, "openspec"), join(dir, "openspec"), { recursive: true });
  return dir;
}

/** Run the sync against a sandbox and return { code, out }. */
function run(dir, ...args) {
  try {
    const stdout = execFileSync(process.execPath, [SYNC, ...args], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, SPOTIVIBE_REPO: dir },
      stdio: "pipe",
    });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/** Edit one file inside a sandbox by replacing `from` with `to`. Throws if the anchor is absent. */
function edit(dir, relative, from, to) {
  const path = join(dir, relative);
  const before = readFileSync(path, "utf8");
  if (!before.includes(from))
    throw new Error(`anchor not found in ${relative}: ${JSON.stringify(from)}`);
  writeFileSync(path, before.replace(from, to), "utf8");
}

/** As `edit`, but with a regex anchor. `String.replace` with a RegExp needs the `g` flag. */
function editRegex(dir, relative, pattern, replacement) {
  const path = join(dir, relative);
  const before = readFileSync(path, "utf8");
  if ([...before.matchAll(pattern)].length === 0) {
    throw new Error(`regex anchor matched nothing in ${relative}: ${pattern}`);
  }
  writeFileSync(path, before.replace(pattern, replacement), "utf8");
}

const CHANGE_DISCOVERY = "openspec/changes/m17-home-discovery/specs/discovery/spec.md";
const CHANGE_MIXES = "openspec/changes/m17-home-discovery/specs/mixes/spec.md";
const CHANGE_MIXES_CAP = "openspec/changes/m17-home-discovery/specs/home-mixes/spec.md";
const RECORD_DISCOVERY = "openspec/specs/discovery/spec.md";
const RECORD_MIXES = "openspec/specs/mixes/spec.md";

const CASES = [
  {
    // The case M17's first delta actually hit: every scenario NAME kept, every body weakened. The
    // name-only guard this script inherited from M16 passed it, because a reworded body is invisible
    // to a name comparison. This is why the body check exists.
    name: "a reworded scenario body is refused even though the name is kept",
    expect: "REWRITES the body",
    mutate: (dir) =>
      edit(
        dir,
        CHANGE_DISCOVERY,
        "with no liked-track, playlist, or history payload",
        "and whatever else is handy",
      ),
  },
  {
    name: "a dropped sentence of requirement prose is refused",
    expect: "LOSES",
    mutate: (dir) =>
      edit(
        dir,
        CHANGE_DISCOVERY,
        "The circular artist section SHALL never be adjacent to another circular section",
        "The circular artist section is arranged nicely",
      ),
  },
  {
    name: "a dropped scenario in a MODIFIED delta is refused",
    expect: "drops 1 existing scenario",
    mutate: (dir) =>
      edit(
        dir,
        CHANGE_DISCOVERY,
        "#### Scenario: No mixes means no mixes section",
        "#### Scenario: Renamed away",
      ),
  },
  {
    name: "a renamed requirement is refused, not silently unmatched",
    expect: "which discovery does not have",
    mutate: (dir) =>
      edit(
        dir,
        CHANGE_DISCOVERY,
        "### Requirement: Home discovery feed",
        "### Requirement: Home feed",
      ),
  },
  {
    name: "an emptied ADDED capability is refused",
    expect: "has no scenarios",
    mutate: (dir) => editRegex(dir, CHANGE_MIXES_CAP, /^#### Scenario: .*\n/gm, ""),
  },
  {
    name: "a stray extra capability in the delta is refused, not passed over",
    expect: "unexpected capability",
    mutate: (dir) => {
      execFileSync("node", [
        "-e",
        `require("fs").mkdirSync(${JSON.stringify(join(dir, "openspec/changes/m17-home-discovery/specs/stray"))}, { recursive: true }); require("fs").writeFileSync(${JSON.stringify(join(dir, "openspec/changes/m17-home-discovery/specs/stray/spec.md"))}, "## ADDED Requirements\\n### Requirement: X\\n#### Scenario: Y\\n");`,
      ]);
    },
  },
  {
    // The capability's spec file is deleted but its directory remains, so the capability-set walk still
    // lists it and the more specific `missing delta` path is the one that must catch this.
    name: "a delta capability with no spec file is refused",
    expect: "missing delta",
    mutate: (dir) => rmSync(join(dir, CHANGE_MIXES), { force: true }),
  },
  {
    // The capability directory is gone entirely, so the directory walk is the only thing that can see
    // it — the case that a spec file check alone would miss.
    name: "a missing delta capability is refused",
    expect: "is missing the",
    mutate: (dir) =>
      rmSync(join(dir, "openspec/changes/m17-home-discovery/specs/mixes"), {
        force: true,
        recursive: true,
      }),
  },
  {
    name: "an unmarked MODIFIED block is refused",
    expect: "is not marked `## MODIFIED Requirements`",
    mutate: (dir) => edit(dir, CHANGE_MIXES, "## MODIFIED Requirements", "## Something Else"),
  },
  {
    name: "a second operation heading in one delta file is refused",
    expect: "operation heading",
    mutate: (dir) =>
      edit(
        dir,
        CHANGE_MIXES,
        "## MODIFIED Requirements",
        "## ADDED Requirements\n\n## MODIFIED Requirements",
      ),
  },
  {
    name: "an ADDED capability that already exists is refused, not overwritten",
    expect: "already exists",
    mutate: (dir) => {
      const path = join(dir, "openspec/specs/home-mixes/spec.md");
      execFileSync("node", [
        "-e",
        `require("fs").mkdirSync(require("path").dirname(${JSON.stringify(path)}), { recursive: true }); require("fs").writeFileSync(${JSON.stringify(path)}, "# home-mixes Specification\\n");`,
      ]);
    },
  },
  {
    name: "a MODIFIED delta against a missing record capability is refused",
    expect: "does not exist",
    mutate: (dir) => rmSync(join(dir, "openspec/specs/discovery/spec.md"), { force: true }),
  },
  {
    // This guard is unreachable by deleting a scenario from the delta: that removes a NAME too, and
    // the drop guard above fires first. The only shape that reaches it is a record whose requirement
    // lists the same scenario more than once — the delta then dedupes it, the count falls, and no
    // name is dropped. That is a real defect in the record, and it must be argued for rather than
    // absorbed, which is what this case asserts.
    name: "a silently merged scenario count is refused",
    expect: "scenarios were merged rather than removed",
    mutate: (dir) =>
      edit(
        dir,
        RECORD_MIXES,
        "#### Scenario: The generation period is recorded",
        // Four extra copies turn the record's 3 headings into 7; the delta's 6 then looks like a shrink.
        "#### Scenario: The generation period is recorded\n#### Scenario: The generation period is recorded\n#### Scenario: The generation period is recorded\n#### Scenario: The generation period is recorded\n#### Scenario: The generation period is recorded",
      ),
  },
];

/* ── run ────────────────────────────────────────────────────────────────────────────── */

let failures = 0;

for (const testCase of CASES) {
  const dir = sandbox();
  try {
    testCase.mutate(dir);
    const result = run(dir);
    const refused = result.code !== 0 && result.out.includes(testCase.expect);
    if (refused) {
      console.log(`  PASS  ${testCase.name}`);
      continue;
    }
    failures += 1;
    const detail =
      result.code === 0
        ? "the sync exited 0 — it wrote over the mutation"
        : `no message matching ${JSON.stringify(testCase.expect)}`;
    console.log(`  FAIL  ${testCase.name}  (${detail})`);
    for (const line of result.out
      .split("\n")
      .filter((line) => line.trim())
      .slice(0, 4)) {
      console.log(`          ${line.trim().slice(0, 150)}`);
    }
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${testCase.name}  (harness error: ${error.message})`);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

/* ── the control: an unmutated copy must still sync cleanly ──────────────────────────── */

const controlDir = sandbox();
const check = run(controlDir, "--check");
if (check.code === 0) {
  console.log("  PASS  control: --check on an unmutated copy reports and writes nothing");
} else {
  failures += 1;
  console.log("  FAIL  control: --check on an unmutated copy exited non-zero");
  for (const line of check.out
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, 6)) {
    console.log(`          ${line.trim().slice(0, 150)}`);
  }
}

// The write path itself, on the copy: this is the one case where the script is allowed to succeed.
const write = run(controlDir);
if (write.code === 0 && write.out.includes("written and re-verified from disk")) {
  console.log("  PASS  control: a real merge on a copy reports a verified write");
} else {
  failures += 1;
  console.log(`  FAIL  control: a real merge on a copy exited ${write.code}`);
  for (const line of write.out
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, 6)) {
    console.log(`          ${line.trim().slice(0, 150)}`);
  }
}
rmSync(controlDir, { force: true, recursive: true });

console.log("");
console.log(
  `  ${CASES.length + 2 - failures}/${CASES.length + 2} sync-guard cases behaved correctly`,
);
process.exit(failures === 0 ? 0 : 1);
