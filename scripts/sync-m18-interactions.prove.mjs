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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function runWith(dir, env, ...args) {
  try {
    const stdout = execFileSync(process.execPath, [SYNC, ...args], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, ...env, SPOTIVIBE_REPO: dir },
      stdio: "pipe",
    });
    return { code: 0, out: stdout };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

function run(dir, ...args) {
  return runWith(dir, {}, ...args);
}

// The control's fixture, named so nothing it writes can collide with a real capability. See
// `controlSandbox()` for why it cannot reuse M18's own delta.
const CONTROL_CHANGE = "control-fixture";
const CONTROL_NEW = "control-added";
const CONTROL_EXTENDED = "control-extended";
const CONTROL_ENV = {
  SPOTIVIBE_CHANGE: CONTROL_CHANGE,
  SPOTIVIBE_NEW: CONTROL_NEW,
  SPOTIVIBE_EXTENDED: CONTROL_EXTENDED,
};

// The control's job is to prove the guard is not refusing *everything*. It cannot use `sandbox()`.
// M18's delta was merged into the record during its own Sync stage, so replaying it is a re-merge the
// guard rightly refuses — the control passed only while the record was still pre-M18, and no such state
// exists in this repository now. This builds one: its own delta and its own minimal record, in a
// directory containing nothing else. `control-added` is absent from the record because the delta
// creates it; `control-extended` holds one requirement the delta does not name, and adds a second.
// That is pending by construction, so the control cannot rot the way the replayed delta did.
function controlSandbox() {
  const dir = mkdtempSync(join(tmpdir(), "spotivibe-m18-control-"));
  const deltaDir = join(dir, "openspec", "changes", CONTROL_CHANGE, "specs");
  const recordDir = join(dir, "openspec", "specs", CONTROL_EXTENDED);

  // The guard builds these directories itself when it writes, but the fixture must exist before the
  // guard is ever invoked, so they are created here.
  mkdirSync(join(deltaDir, CONTROL_NEW), { recursive: true });
  mkdirSync(join(deltaDir, CONTROL_EXTENDED), { recursive: true });
  mkdirSync(recordDir, { recursive: true });

  writeFileSync(
    join(deltaDir, CONTROL_NEW, "spec.md"),
    [
      "# control-added Delta",
      "",
      "## ADDED Requirements",
      "",
      "### Requirement: A control requirement the record does not have",
      "",
      "The record does not state this requirement, so the merge adds it rather than duplicating it.",
      "",
      "#### Scenario: The control delta merges cleanly",
      "- **WHEN** the control guard merges the control delta",
      "- **THEN** the requirement is added and the existing capability is left intact",
      "",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(deltaDir, CONTROL_EXTENDED, "spec.md"),
    [
      "# control-extended Delta",
      "",
      "## ADDED Requirements",
      "",
      "### Requirement: A control requirement appended to an existing capability",
      "",
      "This requirement is not in the record, so appending it duplicates nothing.",
      "",
      "#### Scenario: The appended requirement lands",
      "- **WHEN** the control guard merges the control delta",
      "- **THEN** the requirement is appended and the pre-existing requirement is untouched",
      "",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(recordDir, "spec.md"),
    [
      `# ${CONTROL_EXTENDED} Specification`,
      "",
      "## Purpose",
      "",
      "A capability the control delta extends. It exists so an ADDED block has a record to extend,",
      "and it deliberately does not name either requirement the delta adds.",
      "",
      "## Requirements",
      "",
      "### Requirement: A pre-existing requirement the delta does not name",
      "",
      "This requirement is in the record before the merge and must survive it unchanged.",
      "",
      "#### Scenario: The pre-existing requirement survives",
      "- **WHEN** the control guard merges the control delta",
      "- **THEN** this requirement is still present with its body unchanged",
      "",
    ].join("\n"),
    "utf8",
  );

  return dir;
}

function edit(dir, relative, from, to) {
  const path = join(dir, relative);
  const before = readFileSync(path, "utf8");
  if (!before.includes(from))
    throw new Error(`anchor not found in ${relative}: ${JSON.stringify(from)}`);
  writeFileSync(path, before.replace(from, to), "utf8");
}

const DELTA_SEARCH = "openspec/changes/archive/2026-10-02-m18-interactions/specs/search/spec.md";
const DELTA_SHORTCUTS =
  "openspec/changes/archive/2026-10-02-m18-interactions/specs/keyboard-shortcuts/spec.md";
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
      const dirPath = join(dir, "openspec/changes/archive/2026-10-02-m18-interactions/specs/stray");
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

const control = controlSandbox();
const check = runWith(control, CONTROL_ENV, "--check");
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

const write = runWith(control, CONTROL_ENV);
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
