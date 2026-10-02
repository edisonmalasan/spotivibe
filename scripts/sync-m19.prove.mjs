// Prove the shared sync guard refuses, exercised against M19's delta.
//
// The guard itself is `sync-m18-interactions.mjs`, parameterised: `SPOTIVIBE_CHANGE` names the change and
// `SPOTIVIBE_NEW` / `SPOTIVIBE_EXTENDED` name which capabilities are new and which are appended. Its
// defaults are M18's own, so this file does not fork the guard — it drives it.
//
// Written fresh rather than derived from the M18 provere: transforming that file by string substitution
// broke on the third anchor, and a provere assembled by search-and-replace is exactly the fragile kind
// this repository has already paid for twice. Each case copies the real `openspec/` tree into a temp
// directory, mutates the COPY, and requires a non-zero exit whose message names the defect. The real
// repository is never written to.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SYNC = resolve(dirname(fileURLToPath(import.meta.url)), "sync-m18-interactions.mjs");
const SYNC_ENV = {
  SPOTIVIBE_CHANGE: "m19-motion",
  SPOTIVIBE_NEW: "motion",
  SPOTIVIBE_EXTENDED: "performance",
};
const REPO = process.cwd();

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "spotivibe-m19-sync-"));
  cpSync(join(REPO, "openspec"), join(dir, "openspec"), { recursive: true });
  return dir;
}

function run(dir, ...args) {
  try {
    const stdout = execFileSync(process.execPath, [SYNC, ...args], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, ...SYNC_ENV, SPOTIVIBE_REPO: dir },
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
    throw new Error(`anchor not found in ${relative}: ${JSON.stringify(from.slice(0, 70))}`);
  writeFileSync(path, before.replace(from, to), "utf8");
}

function mkdirp(file) {
  // `dirname` is imported above; the first draft of this helper reached for `require`, which is both a
  // lint error in this repository's `.mjs` scripts and a runtime `ReferenceError` in an ES module.
  execFileSync(process.execPath, [
    "-e",
    `require("fs").mkdirSync(${JSON.stringify(dirname(file))}, { recursive: true });`,
  ]);
}

const DELTA_MOTION = "openspec/changes/m19-motion/specs/motion/spec.md";
const DELTA_PERF = "openspec/changes/m19-motion/specs/performance/spec.md";
const RECORD_PERF = "openspec/specs/performance/spec.md";

const CASES = [
  {
    // The failure this merge is most able to produce, and the one `openspec validate` cannot see:
    // two requirements sharing a name.
    name: "an ADDED requirement whose name already exists is refused",
    expect: "already exist in the record",
    mutate: (dir) =>
      edit(
        dir,
        DELTA_PERF,
        "### Requirement: A motion budget holds the client bundle",
        "### Requirement: No interval runs while the application is idle",
      ),
  },
  {
    name: "a MODIFIED block is refused, not silently applied",
    expect: "this sync applies ADDED blocks only",
    mutate: (dir) => edit(dir, DELTA_MOTION, "## ADDED Requirements", "## MODIFIED Requirements"),
  },
  {
    name: "a second operation heading in one delta is refused",
    expect: "this sync applies ADDED blocks only",
    mutate: (dir) =>
      edit(
        dir,
        DELTA_MOTION,
        "## ADDED Requirements",
        "## ADDED Requirements\n\n## MODIFIED Requirements",
      ),
  },
  {
    name: "a target capability that is not in the record is refused",
    expect: "does not exist",
    mutate: (dir) => rmSync(join(dir, RECORD_PERF), { force: true }),
  },
  {
    name: "a capability that should be new but already exists is refused",
    expect: "refusing to overwrite a capability",
    mutate: (dir) => {
      const path = join(dir, "openspec/specs/motion/spec.md");
      mkdirp(path);
      writeFileSync(path, "# motion Specification\n\n## Requirements\n");
    },
  },
  {
    name: "an unexpected capability in the delta is refused, not passed over",
    expect: "unexpected capability",
    mutate: (dir) => {
      const spec = join(dir, "openspec/changes/m19-motion/specs/stray/spec.md");
      mkdirp(spec);
      writeFileSync(spec, "## ADDED Requirements\n### Requirement: X\n#### Scenario: Y\n");
    },
  },
];

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
        ? "the guard exited 0 — it wrote over the mutation"
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
