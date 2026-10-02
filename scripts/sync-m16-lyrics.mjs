// Sync M16's delta specs into the specs of record.
//
// Why a script: this merge is the step where a spec silently loses a scenario, and the previous
// sync in this repository (`963b2fa`) needed a hand edit plus a post-hoc check for exactly that
// reason. A hand-applied merge has no way to say what it was supposed to preserve. This one:
//
//   1. reads the requirement and scenario NAMES from both sides;
//   2. fails loudly if the delta drops any name the record has — a MODIFIED block *replaces* the
//      requirement, so a dropped scenario is silently deleted from the record;
//   3. fails if the delta renames a requirement, which a name-matched merge cannot apply and which
//      must be an explicit decision (as the parked-player sync had to be);
//   4. only then writes; and
//   5. re-reads the result and re-checks, so a write that did not take effect is caught too.
//
// The ADDED capability is a whole new file, so there is nothing to preserve — but its requirement and
// scenario names are still verified to be non-empty, because an empty spec file validates happily and
// means nothing.
//
// Usage, from the repository root:  node scripts/sync-m16-lyrics.mjs [--check]
//   --check  report what would change and write nothing
//
// `SPOTIVIBE_REPO` overrides the repository root, following the convention the release-gate harness
// established, so the refusal path can be exercised against a mutated *copy* rather than against the
// real delta. A guard that has only ever been seen to pass is a claim, not a guard.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.env.SPOTIVIBE_REPO ?? process.cwd();

const CHECK_ONLY = process.argv.includes("--check");
const CHANGE = join(ROOT, "openspec", "changes", "m16-synced-lyrics", "specs");

/** Requirement and scenario names, in document order. */
function names(markdown) {
  const requirements = [];
  const scenarios = [];
  let current = null;
  for (const line of markdown.split("\n")) {
    const requirement = /^### Requirement:\s*(.+?)\s*$/.exec(line);
    if (requirement) {
      current = requirement[1];
      requirements.push(current);
      continue;
    }
    const scenario = /^#### Scenario:\s*(.+?)\s*$/.exec(line);
    if (scenario && current) {
      scenarios.push({ requirement: current, name: scenario[1] });
    }
  }
  return { requirements, scenarios };
}

/** The text of one requirement block, heading through to just before the next `###`. */
function requirementBlock(markdown, name) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line === `### Requirement: ${name}`);
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

const problems = [];
const report = [];

/* ── 1. the ADDED capability: a new `lyrics` spec ─────────────────────────────── */

const addedPath = join(CHANGE, "lyrics", "spec.md");
if (!existsSync(addedPath)) throw new Error(`missing delta: ${addedPath}`);
const added = readFileSync(addedPath, "utf8");
const addedNames = names(added);

if (addedNames.requirements.length === 0) problems.push("the delta's lyrics spec has no requirements");
if (addedNames.scenarios.length === 0) problems.push("the delta's lyrics spec has no scenarios");
if (/^## ADDED Requirements/m.test(added) === false) {
  problems.push("the delta's lyrics spec is not marked `## ADDED Requirements`");
}

const lyricsPath = join(ROOT, "openspec", "specs", "lyrics", "spec.md");
if (existsSync(lyricsPath) && !CHECK_ONLY) {
  problems.push("openspec/specs/lyrics/spec.md already exists — refusing to overwrite a capability");
}

report.push(
  `  lyrics: ${addedNames.requirements.length} requirement(s), ` +
    `${addedNames.scenarios.length} scenario(s) -> new capability ${existsSync(lyricsPath) ? "(EXISTS, refused)" : "(new)"}`,
);

/* ── 2. the MODIFIED capability: replace one requirement in `app-shell` ─────────── */

const modifiedPath = join(CHANGE, "app-shell", "spec.md");
if (!existsSync(modifiedPath)) throw new Error(`missing delta: ${modifiedPath}`);
const delta = readFileSync(modifiedPath, "utf8");
const deltaNames = names(delta);

if (deltaNames.requirements.length !== 1) {
  problems.push(
    `the app-shell delta should modify exactly one requirement, found ${deltaNames.requirements.length}`,
  );
}
if (/^## MODIFIED Requirements/m.test(delta) === false) {
  problems.push("the app-shell delta is not marked `## MODIFIED Requirements`");
}

const appShellPath = join(ROOT, "openspec", "specs", "app-shell", "spec.md");
const appShell = readFileSync(appShellPath, "utf8");
const recordNames = names(appShell);

for (const requirement of deltaNames.requirements) {
  if (!recordNames.requirements.includes(requirement)) {
    problems.push(
      `the delta modifies "${requirement}", which the record does not have. A MODIFIED block is ` +
        `matched by name, so this merge cannot apply it — a rename is an explicit decision, not a merge.`,
    );
    continue;
  }

  const existing = recordNames.scenarios.filter((s) => s.requirement === requirement);
  const incoming = deltaNames.scenarios.filter((s) => s.requirement === requirement);
  const incomingNames = new Set(incoming.map((s) => s.name));

  // The check that matters: a MODIFIED block REPLACES the requirement, so a scenario the record has
  // and the delta omits is deleted from the record of truth. Nothing in `openspec validate` notices.
  const dropped = existing.filter((s) => !incomingNames.has(s.name)).map((s) => s.name);
  if (dropped.length > 0) {
    problems.push(
      `the delta drops ${dropped.length} existing scenario(s) from "${requirement}": ` +
        dropped.map((n) => JSON.stringify(n)).join(", "),
    );
  }

  const block = requirementBlock(delta, requirement);
  if (block === null) {
    problems.push(`could not locate the body of "${requirement}" in the delta`);
  } else {
    report.push(
      `  ${requirement}: ${existing.length} scenario(s) -> ${incoming.length} ` +
        `(+${incoming.length - existing.length}, ${dropped.length} dropped) — verified`,
    );
  }
}

/* ── 3. write, then re-verify what was written ────────────────────────────────── */

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

// Replace the requirement in `app-shell`, leaving every other requirement byte-identical.
const requirement = deltaNames.requirements[0];
const incoming = requirementBlock(delta, requirement);
const current = requirementBlock(appShell, requirement);
const appShellLines = appShell.split("\n");
const merged = [
  ...appShellLines.slice(0, current.start),
  ...incoming.text.split("\n"),
  ...appShellLines.slice(current.end),
].join("\n");
writeFileSync(appShellPath, merged, "utf8");

// Write the new capability, in the record's own shape: the delta's `# Spec Delta` title becomes
// `# <capability> Specification`, and `## ADDED Requirements` becomes `## Requirements`. A first
// draft rewrote only the second heading, which left a file of record opening with the word "Delta".
const lyricsBody = added
  .replace(/^# .*$/m, "# lyrics Specification")
  .replace(/^## ADDED Requirements/m, "## Requirements");
mkdirSync(dirname(lyricsPath), { recursive: true });
writeFileSync(lyricsPath, lyricsBody, "utf8");

/* Re-read and re-check: a write that did not take effect must not read as success. */
const afterAppShell = names(readFileSync(appShellPath, "utf8"));
const afterLyrics = names(readFileSync(lyricsPath, "utf8"));
const afterAppShellNames = new Set(afterAppShell.scenarios.map((s) => s.name));
const afterLyricsNames = new Set(afterLyrics.scenarios.map((s) => s.name));

const afterProblems = [];
if (afterAppShell.requirements.length !== recordNames.requirements.length) {
  afterProblems.push(
    `app-shell requirement count changed: ${recordNames.requirements.length} -> ${afterAppShell.requirements.length}`,
  );
}
// Each delta is checked against the spec it was written INTO. An earlier draft compared the
// app-shell delta's scenarios against the lyrics spec, which reported thirteen phantom failures on a
// write that had in fact succeeded — a verification that cries wolf is one that gets deleted.
for (const scenario of deltaNames.scenarios.filter((s) => s.requirement === requirement)) {
  if (!afterAppShellNames.has(scenario.name)) {
    afterProblems.push(`app-shell: "${scenario.name}" is missing from the written spec`);
  }
}
for (const scenario of addedNames.scenarios) {
  if (!afterLyricsNames.has(scenario.name)) {
    afterProblems.push(`lyrics: "${scenario.name}" is missing from the written spec`);
  }
}
if (!/^# lyrics Specification$/m.test(readFileSync(lyricsPath, "utf8"))) {
  afterProblems.push("lyrics: the written spec does not carry the record's own `# lyrics Specification` title");
}
if (/^## ADDED Requirements/m.test(readFileSync(lyricsPath, "utf8"))) {
  afterProblems.push("lyrics: the written spec still carries the delta's `## ADDED Requirements` heading");
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
