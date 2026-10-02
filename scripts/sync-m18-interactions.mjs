// Sync M18's delta specs into the specs of record.
//
// Why its own script rather than an edit of `sync-m17-home.mjs`: M17's deltas were two MODIFIED
// blocks plus one new capability. M18's are **three ADDED-only** blocks, and one of them targets a
// capability that already exists — `search`, with 9 requirements and 33 scenarios in the record. An
// ADDED block against an existing capability is a different merge entirely: the requirement bodies must
// be *inserted into* the record's existing `## Requirements` section without touching anything already
// there. Getting that wrong either loses the nine existing requirements or silently duplicates one.
//
// This one:
//   1. refuses unless the delta's capability set is exactly the expected one;
//   2. refuses if ANY delta carries a MODIFIED, REMOVED, or RENAMED block. M18 has none by design, and
//      a hand-merged replacement is precisely the M17 failure this repository now guards against — so
//      rather than silently supporting it, this script states the assumption in a refusal;
//   3. refuses if a delta requirement's NAME already exists in the record, which would duplicate rather
//      than add;
//   4. refuses if the target record has no `## Requirements` section to insert into;
//   5. writes new capabilities whole, and appends an ADDED block into an existing capability's
//      `## Requirements` section, leaving every existing line byte-identical; and
//   6. re-reads what it wrote and re-checks it.
//
// Usage, from the repository root:
//   node scripts/sync-m18-interactions.mjs [--check]              # M18, the defaults
//   SPOTIVIBE_CHANGE=m19-motion node scripts/sync-m18-interactions.mjs [--check]
//   --check  report what would change and write nothing
//
// `SPOTIVIBE_REPO` overrides the repository root so every refusal path can be exercised against a
// mutated *copy*. A guard that has only ever been seen to pass is a claim, not a guard.
//   See `sync-m18-interactions.prove.mjs`.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.env.SPOTIVIBE_REPO ?? process.cwd();

const CHECK_ONLY = process.argv.includes("--check");
/**
 * The change to merge, and which of its capabilities are new versus appended to an existing one.
 * Defaults are M18's own arrangement; M19 has the same shape — one new capability and one ADDED
 * block against a capability that already exists — so it reuses this guard rather than adding a third
 * near-identical copy of the same refusal logic.
 */
const CHANGE_NAME = process.env.SPOTIVIBE_CHANGE ?? "m18-interactions";
const CHANGE = join(ROOT, "openspec", "changes", CHANGE_NAME, "specs");
const NEW_CAPABILITIES = (process.env.SPOTIVIBE_NEW ?? "keyboard-shortcuts,sharing").split(",");
const EXTENDED_CAPABILITIES = (process.env.SPOTIVIBE_EXTENDED ?? "search").split(",");
const RECORD = join(ROOT, "openspec", "specs");

/** What this sync is for. Anything else in the delta directory is a stray and must be refused. */
const EXPECTED = [...NEW_CAPABILITIES, ...EXTENDED_CAPABILITIES];

const problems = [];
const report = [];

/** Requirement names, in document order. */
function requirementNames(markdown) {
  return [...markdown.matchAll(/^### Requirement:\s*(.+?)\s*$/gm)].map((match) => match[1]);
}

/** Scenario names, in document order. */
function scenarioNames(markdown) {
  return [...markdown.matchAll(/^#### Scenario:\s*(.+?)\s*$/gm)].map((match) => match[1]);
}

/** The text of one requirement block, heading through to just before the next `###`. */
function requirementBlock(lines, name) {
  const heading = `### Requirement: ${name}`;
  const start = lines.findIndex((line) => line === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("### ")) {
      end = index;
      break;
    }
  }
  return { start, end, text: lines.slice(start, end).join("\n").replace(/\s+$/, "") };
}

/* ── 0. the delta directory holds exactly the capabilities this sync knows about ──────────── */

const present = existsSync(CHANGE)
  ? readdirSync(CHANGE, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  : [];

for (const capability of present) {
  if (!EXPECTED.includes(capability)) {
    problems.push(
      `the delta holds an unexpected capability "${capability}" — passing over it in silence is ` +
        `exactly the failure this script exists to prevent`,
    );
  }
}
for (const capability of EXPECTED) {
  if (!present.includes(capability))
    problems.push(`the delta is missing the "${capability}" capability`);
}

report.push(`  delta: ${present.length} capability/capabilities (${present.join(", ") || "none"})`);

/* ── 1. every delta must be ADDED-only, and must carry real content ────────────────────── */

/** capability -> { path, addedText, requirementNames, scenarioNames } */
const pending = new Map();

for (const capability of EXPECTED) {
  const deltaPath = join(CHANGE, capability, "spec.md");
  if (!existsSync(deltaPath)) {
    problems.push(`missing delta: ${deltaPath}`);
    continue;
  }
  const delta = readFileSync(deltaPath, "utf8");

  const operations = [...delta.matchAll(/^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements/gm)].map(
    (match) => match[1],
  );
  if (operations.length !== 1 || operations[0] !== "ADDED") {
    problems.push(
      `the ${capability} delta carries operation heading(s) [${operations.join(", ") || "none"}], but ` +
        `this sync applies ADDED blocks only. M18 was specified so that no existing requirement is ` +
        `replaced, which is why its Sync stage has no lossy-merge surface. A MODIFIED block here means ` +
        `either the design changed or the wrong script is being used — resolve it deliberately.`,
    );
    continue;
  }

  const names = requirementNames(delta);
  const scenarios = scenarioNames(delta);
  if (names.length === 0) problems.push(`the delta's ${capability} spec has no requirements`);
  if (scenarios.length === 0) problems.push(`the delta's ${capability} spec has no scenarios`);

  pending.set(capability, { path: deltaPath, delta, names, scenarios });
  report.push(`  ${capability}: ${names.length} requirement(s), ${scenarios.length} scenario(s)`);
}

/* ── 2. target shape: a new capability must not exist; an existing one must ─────────────── */

for (const capability of NEW_CAPABILITIES) {
  const recordPath = join(RECORD, capability, "spec.md");
  if (existsSync(recordPath)) {
    problems.push(
      `openspec/specs/${capability}/spec.md already exists — refusing to overwrite a capability`,
    );
  }
}

for (const capability of EXTENDED_CAPABILITIES) {
  const recordPath = join(RECORD, capability, "spec.md");
  if (!existsSync(recordPath)) {
    problems.push(
      `openspec/specs/${capability}/spec.md does not exist — an ADDED block cannot extend a capability ` +
        `that is not in the record. Either the delta should be a new capability, or the record is wrong.`,
    );
    continue;
  }
  const record = readFileSync(recordPath, "utf8");
  if (!/^## Requirements$/m.test(record)) {
    problems.push(
      `openspec/specs/${capability}/spec.md has no \`## Requirements\` section to insert into`,
    );
  }
  const existing = new Set(requirementNames(record));
  const entry = pending.get(capability);
  if (entry === undefined) continue;
  // An ADDED block whose requirement name already exists would duplicate the requirement rather than
  // add one. Two requirements with the same name are invisible to `openspec validate`.
  const duplicates = entry.names.filter((name) => existing.has(name));
  if (duplicates.length > 0) {
    problems.push(
      `the ${capability} delta adds requirement(s) whose names already exist in the record: ` +
        duplicates.map((name) => JSON.stringify(name)).join(", "),
    );
  }
  report.push(
    `  ${capability}: record has ${existing.size} requirement(s); ${entry.names.length} appended, ` +
      `${duplicates.length} duplicate name(s)`,
  );
}

/* ── 3. refuse before writing anything ────────────────────────────────────────────────── */

if (problems.length > 0) {
  console.log("");
  for (const problem of problems) console.log("  REFUSING: " + problem);
  console.log("");
  process.exit(1);
}

if (CHECK_ONLY) {
  console.log("");
  for (const line of report) console.log(line);
  console.log("\n  --check: nothing written.");
  process.exit(0);
}

/* ── 4. write ─────────────────────────────────────────────────────────────────────────── */

// A new capability: the whole file, in the record's own shape. The delta's `# Spec Delta` title becomes
// `# <capability> Specification`, and its `## ADDED Requirements` becomes `## Requirements`, so a file of
// record does not open with the word "Delta" or carry a heading the record never uses.
for (const capability of NEW_CAPABILITIES) {
  const entry = pending.get(capability);
  const body = entry.delta
    .replace(/^# .*$/m, `# ${capability} Specification`)
    .replace(/^## ADDED Requirements/m, "## Requirements");
  const recordPath = join(RECORD, capability, "spec.md");
  mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, body, "utf8");
}

// An existing capability: append the ADDED requirements to the end of the existing `## Requirements`
// section — that is, immediately before whatever comes after it — leaving every existing line alone.
for (const capability of EXTENDED_CAPABILITIES) {
  const entry = pending.get(capability);
  const recordPath = join(RECORD, capability, "spec.md");
  const recordLines = readFileSync(recordPath, "utf8").split("\n");

  const headingIndex = recordLines.findIndex((line) => line === "## Requirements");
  if (headingIndex === -1) continue; // already refused above

  // The `## Requirements` section runs to the next `## ` heading, or to the end of the file.
  let sectionEnd = recordLines.length;
  for (let index = headingIndex + 1; index < recordLines.length; index += 1) {
    if (/^## /.test(recordLines[index])) {
      sectionEnd = index;
      break;
    }
  }

  // The ADDED block's own heading is dropped: the requirements join the record's single `## Requirements`
  // section rather than introducing a second one mid-file.
  const addedBody = entry.delta.replace(/^# .*$/m, "").replace(/^## ADDED Requirements\s*$/m, "");

  const merged = [
    ...recordLines.slice(0, sectionEnd),
    ...addedBody
      .split("\n")
      .filter((line, index, all) => !(line === "" && index === all.length - 1)),
    ...recordLines.slice(sectionEnd),
  ].join("\n");
  writeFileSync(recordPath, merged, "utf8");
}

/* ── 5. re-read from disk and re-check: a write that did not take must not read as success ─ */

const afterProblems = [];

for (const capability of NEW_CAPABILITIES) {
  const recordPath = join(RECORD, capability, "spec.md");
  const text = readFileSync(recordPath, "utf8");
  const entry = pending.get(capability);
  const afterRequirements = new Set(requirementNames(text));
  for (const name of entry.names) {
    if (!afterRequirements.has(name)) {
      afterProblems.push(`${capability}: "${name}" is missing from the written spec`);
    }
  }
  const afterScenarios = new Set(scenarioNames(text));
  for (const scenario of entry.scenarios) {
    if (!afterScenarios.has(scenario)) {
      afterProblems.push(`${capability}: scenario "${scenario}" is missing from the written spec`);
    }
  }
  if (text.split("\n")[0] !== `# ${capability} Specification`) {
    afterProblems.push(`${capability}: the written spec does not open with the record's own title`);
  }
  if (/^## ADDED Requirements/m.test(text)) {
    afterProblems.push(`${capability}: the written spec still carries the delta's ADDED heading`);
  }
}

for (const capability of EXTENDED_CAPABILITIES) {
  const recordPath = join(RECORD, capability, "spec.md");
  const text = readFileSync(recordPath, "utf8");
  const entry = pending.get(capability);
  const lines = text.split("\n");
  const afterRequirements = requirementNames(text);
  const afterScenarios = new Set(scenarioNames(text));

  for (const name of entry.names) {
    if (!afterRequirements.includes(name)) {
      afterProblems.push(`${capability}: "${name}" is missing from the written spec`);
    }
  }
  for (const scenario of entry.scenarios) {
    if (!afterScenarios.has(scenario)) {
      afterProblems.push(`${capability}: scenario "${scenario}" is missing from the written spec`);
    }
  }
  // A duplicate is the failure mode this merge is most able to produce, so it is checked after writing
  // and not only before: two requirements sharing a name pass `openspec validate` unnoticed.
  const seen = new Set();
  for (const name of afterRequirements) {
    if (seen.has(name))
      afterProblems.push(`${capability}: requirement "${name}" appears more than once`);
    seen.add(name);
  }
  // Exactly one `## Requirements` heading: appending a second is how a record starts reading as a delta.
  const headings = [...text.matchAll(/^## .*$/gm)].map((match) => match[0]);
  const requirementHeadings = headings.filter((heading) => heading === "## Requirements");
  if (requirementHeadings.length !== 1) {
    afterProblems.push(
      `${capability}: the written spec has ${requirementHeadings.length} \`## Requirements\` headings, expected 1`,
    );
  }
  // Every requirement block is reachable, i.e. no requirement got orphaned outside the section.
  for (const name of afterRequirements) {
    if (requirementBlock(lines, name) === null) {
      afterProblems.push(
        `${capability}: could not locate the body of "${name}" in the written spec`,
      );
    }
  }
}

if (afterProblems.length > 0) {
  console.log("");
  for (const problem of afterProblems) console.log("  WRITE VERIFICATION FAILED: " + problem);
  console.log("");
  process.exit(1);
}

console.log("");
for (const line of report) console.log(line);
console.log("");
console.log("  written and re-verified from disk.");
