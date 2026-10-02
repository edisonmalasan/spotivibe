// Prove `sync-m18-interactions.mjs` can actually refuse, before it is trusted with a real merge.
//
// Each case copies the real `openspec/` tree into a temp directory, mutates the COPY, runs the sync
// against it, and requires a non-zero exit whose message names the defect. The real repository is never
// written to. A control case then requires an unmutated copy to sync cleanly, and a second control
// requires a real merge on a copy to report a verified write.
//
// The ADDED-into-an-existing-capability merge is the one most able to produce a silent failure, so it
// gets the most cases: a duplicate requirement name, a missing `## Requirements` section, and an
// unexpected MODIFIED block are all refusals, not warnings.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SYNC = resolve(dirname(fileURLToPath(import.meta.url)), "sync-m18-interactions.mjs");
const REPO = process.cwd();

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "spotivibe-m18-sync-"));
  cpSync(join(REPO, "openspec"), join(dir, "openspec"), { recursive: true });
  return dir;
}

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

function edit(dir, relative, from, to) {
  const path = join(dir, relative);
  const before = readFileSync(path, "utf8");
  if (!before.includes(from))
    throw new Error(`anchor not found in ${relative}: ${JSON.stringify(from)}`);
  writeFileSync(path, before.replace(from, to), "utf8");
}

const DELTA_SEARCH = "openspec/changes/m18-interactions/specs/search/spec.md";
const DELTA_SHORTCUTS = "openspec/changes/m18-interactions/specs/keyboard-shortcuts/spec.md";
const RECORD_SEARCH = "openspec/specs/search/spec.md";

const CASES = [
  {
    // The failure this merge is most able to produce: an ADDED requirement whose name is already in the
    // record. Two requirements sharing a name pass `openspec validate` without complaint.
    // The anchor must be the WHOLE heading. An earlier draft replaced only the prefix, producing
    // "Local library fallback as it is typed" — a name that genuinely does not exist, so the sync
    // correctly exited 0 and the probe reported a false failure. A probe with a wrong mutation measures
    // the probe, not the guard.
    name: "an ADDED requirement whose name already exists is refused",
    expect: "already exist in the record",
    mutate: (dir) =>
      edit(
        dir,
        DELTA_SEARCH,
        "### Requirement: The search field offers suggestions as it is typed",
        "### Requirement: Local library fallback",
      ),
  },
  {
    name: "a MODIFIED block is refused, not silently applied",
    expect: "this sync applies ADDED blocks only",
    mutate: (dir) => edit(dir, DELTA_SEARCH, "## ADDED Requirements", "## MODIFIED Requirements"),
  },
  {
    name: "a second operation heading in one delta is refused",
    expect: "this sync applies ADDED blocks only",
    mutate: (dir) =>
      edit(
        dir,
        DELTA_SHORTCUTS,
        "## ADDED Requirements",
        "## ADDED Requirements\n\n## MODIFIED Requirements",
      ),
  },
  {
    name: "an emptied ADDED capability is refused",
    expect: "has no scenarios",
    mutate: (dir) => editRegex(dir, DELTA_SHORTCUTS, /^#### Scenario: .*\n/gm, ""),
  },
  {
    name: "a target capability that does not exist yet is refused",
    expect: "does not exist",
    mutate: (dir) => rmSync(join(dir, RECORD_SEARCH), { force: true }),
  },
  {
    name: "a record with no `## Requirements` section to insert into is refused",
    expect: "to insert into",
    mutate: (dir) => edit(dir, RECORD_SEARCH, "## Requirements", "## Requisitos"),
  },
  {
    name: "a capability that should be new but already exists is refused",
    expect: "refusing to overwrite a capability",
    mutate: (dir) => {
      const path = join(dir, "openspec/specs/sharing/spec.md");
      mkdirFor(path);
      writeFileSync(path, "# sharing Specification\n\n## Requirements\n");
    },
  },
  {
    name: "an unexpected capability in the delta is refused, not passed over",
    expect: "unexpected capability",
    mutate: (dir) => {
      const dirPath = join(dir, "openspec/changes/m18-interactions/specs/stray");
      mkdirFor(join(dirPath, "spec.md"));
      writeFileSync(
        join(dirPath, "spec.md"),
        "## ADDED Requirements\n### Requirement: X\n#### Scenario: Y\n",
      );
    },
  },
  {
    name: "a missing delta capability is refused",
    expect: "missing delta",
    mutate: (dir) => rmSync(join(dir, DELTA_SHORTCUTS), { force: true }),
  },
];

function editRegex(dir, relative, pattern, replacement) {
  const path = join(dir, relative);
  const before = readFileSync(path, "utf8");
  if ([...before.matchAll(pattern)].length === 0) throw new Error(`no match in ${relative}`);
  writeFileSync(path, before.replace(pattern, replacement), "utf8");
}

function mkdirFor(path) {
  execFileSync(process.execPath, [
    "-e",
    `require("fs").mkdirSync(require("path").dirname(${JSON.stringify(path)}), { recursive: true });`,
  ]);
}

let failures = 0;

for (const testCase of CASES) {
  const dir = sandbox();
  try {
    testCase.mutate(dir);
    const result = run(dir);
    if (result.code !== 0 && result.out.includes(testCase.expect)) {
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

/* ── controls: an unmutated copy must sync cleanly, and a real merge must verify ────────── */

const control = sandbox();
const check = run(control, "--check");
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

const write = run(control);
if (write.code === 0 && write.out.includes("written and re-verified from disk")) {
  console.log("  PASS  control: a real merge on a copy reports a verified write");
} else {
  failures += 1;
  console.log(`  FAIL  control: a real merge on a copy exited ${write.code}`);
  for (const line of write.out
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, 8)) {
    console.log(`          ${line.trim().slice(0, 150)}`);
  }
}
rmSync(control, { force: true, recursive: true });

console.log("");
console.log(
  `  ${CASES.length + 2 - failures}/${CASES.length + 2} sync-guard cases behaved correctly`,
);
process.exit(failures === 0 ? 0 : 1);
