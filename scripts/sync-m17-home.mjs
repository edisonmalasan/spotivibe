// Sync M17's delta specs into the specs of record.
//
// Why a script, and why not an edit of the M16 one: this sync has three capabilities, not two, and two
// of them are MODIFIED. A MODIFIED block *replaces* its requirement in the record, so a scenario the
// record has and the delta omits is silently deleted from the source of truth, and `openspec validate`
// reports nothing. The previous sync in this repository (`963b2fa`) lost a scenario to exactly that,
// and needed a hand edit plus a post-hoc check to notice. M16 introduced `sync-m16-lyrics.mjs` for one
// capability; this generalises the approach rather than editing that script, because one already run
// and audited against a single shape should not be reshaped underneath that evidence.
//
// This one:
//   1. reads the requirement and scenario NAMES from both sides;
//   2. refuses unless the delta's capability set is exactly the expected one, so a stray delta file
//      cannot be passed over in silence;
//   3. refuses if a MODIFIED delta drops any scenario name the record has;
//   4. refuses if a MODIFIED delta names a requirement the record does not have — a name-matched
//      merge cannot apply a rename, and a rename is an explicit decision, not a merge;
//   5. refuses if a MODIFIED capability file carries more than one operation heading, so a second
//      block of a different kind is not written past;
//   6. refuses if a requirement would shrink in scenario count without dropping a name, which means
//      scenarios were quietly merged together;
//   7. only then writes, replacing each requirement block in place and leaving every other line of
//      every other file byte-identical; and
//   8. re-reads the result from disk and re-checks it, so a write that did not take effect is caught
//      rather than reported as success.
//
// The ADDED capability is a whole new file, so there is nothing to preserve — but its requirement and
// scenario names are still verified non-empty, because an empty spec file validates happily and
// means nothing.
//
// Usage, from the repository root:  node scripts/sync-m17-home.mjs [--check]
//   --check  report what would change and write nothing
//
// `SPOTIVIBE_REPO` overrides the repository root, following the convention the release-gate harness
// established, so the refusal paths can be exercised against a mutated *copy* rather than against the
// real delta. A guard that has only ever been seen to pass is a claim, not a guard.
//   See `sync-m17-home.prove.mjs`.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.env.SPOTIVIBE_REPO ?? process.cwd();

const CHECK_ONLY = process.argv.includes("--check");
const CHANGE = join(ROOT, "openspec", "changes", "m17-home-discovery", "specs");
const RECORD = join(ROOT, "openspec", "specs");

/** What this sync is for. Anything else in the delta directory is a stray and must be refused. */
const ADDED_CAPABILITIES = ["home-mixes"];
const MODIFIED_CAPABILITIES = ["discovery", "mixes"];

/** Requirement and scenario names, in document order, with each scenario's body text. */
function names(markdown) {
  const requirements = [];
  const scenarios = [];
  const lines = markdown.split("\n");
  let current = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const requirement = /^### Requirement:\s*(.+?)\s*$/.exec(line);
    if (requirement) {
      current = requirement[1];
      requirements.push(current);
      continue;
    }
    const scenario = /^#### Scenario:\s*(.+?)\s*$/.exec(line);
    if (scenario && current) {
      // A scenario's body runs to the next scenario or requirement heading. Capturing it is what lets
      // this script notice a *weakened* constraint: the scenario name survives, the obligation does not.
      let end = lines.length;
      for (let scan = index + 1; scan < lines.length; scan += 1) {
        if (/^#{3,4} /.test(lines[scan])) {
          end = scan;
          break;
        }
      }
      scenarios.push({
        requirement: current,
        name: scenario[1],
        body: lines
          .slice(index + 1, end)
          .join("\n")
          .replace(/\s+$/, ""),
      });
    }
  }
  return { requirements, scenarios };
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

/** A requirement block's prose: everything after its heading up to its first scenario. */
function requirementProse(blockText) {
  const lines = blockText.split("\n");
  const firstScenario = lines.findIndex((line) => line.startsWith("#### "));
  const body = (firstScenario === -1 ? lines : lines.slice(0, firstScenario)).slice(1).join("\n");
  // The prose is hard-wrapped in the delta and unwrapped in the record, so compare on whitespace
  // collapsed. A dropped sentence is a dropped sentence however it was wrapped.
  return body.replace(/\s+/g, " ").replace(/\s+$/, "");
}

const problems = [];
const report = [];

/* ── 0. the delta directory holds exactly the capabilities this sync knows about ──────── */

const present = existsSync(CHANGE)
  ? readdirSync(CHANGE, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  : [];

for (const capability of present) {
  if (![...ADDED_CAPABILITIES, ...MODIFIED_CAPABILITIES].includes(capability)) {
    problems.push(
      `the delta holds an unexpected capability "${capability}" — this sync does not know what to do ` +
        `with it, and passing over it in silence is exactly the failure this script exists to prevent`,
    );
  }
}
for (const capability of [...ADDED_CAPABILITIES, ...MODIFIED_CAPABILITIES]) {
  if (!present.includes(capability))
    problems.push(`the delta is missing the "${capability}" capability`);
}

report.push(`  delta: ${present.length} capability/capabilities (${present.join(", ") || "none"})`);

/* ── 1. the ADDED capabilities: whole new record files ────────────────────────────────── */

for (const capability of ADDED_CAPABILITIES) {
  const deltaPath = join(CHANGE, capability, "spec.md");
  if (!existsSync(deltaPath)) {
    problems.push(`missing delta: ${deltaPath}`);
    continue;
  }
  const delta = readFileSync(deltaPath, "utf8");
  const deltaNames = names(delta);

  if (deltaNames.requirements.length === 0)
    problems.push(`the delta's ${capability} spec has no requirements`);
  if (deltaNames.scenarios.length === 0)
    problems.push(`the delta's ${capability} spec has no scenarios`);
  if (/^## ADDED Requirements/m.test(delta) === false) {
    problems.push(`the delta's ${capability} spec is not marked \`## ADDED Requirements\``);
  }

  const recordPath = join(RECORD, capability, "spec.md");
  if (existsSync(recordPath)) {
    problems.push(
      `openspec/specs/${capability}/spec.md already exists — refusing to overwrite a capability`,
    );
  }

  report.push(
    `  ${capability}: ${deltaNames.requirements.length} requirement(s), ` +
      `${deltaNames.scenarios.length} scenario(s) -> new capability ` +
      `${existsSync(recordPath) ? "(EXISTS, refused)" : "(new)"}`,
  );
}

/* ── 2. the MODIFIED capabilities: replace named requirements in place ────────────────── */

/** capability -> { path, lines, requirementCountBefore, writes } */
const pendingWrites = new Map();

for (const capability of MODIFIED_CAPABILITIES) {
  const deltaPath = join(CHANGE, capability, "spec.md");
  if (!existsSync(deltaPath)) {
    problems.push(`missing delta: ${deltaPath}`);
    continue;
  }
  const delta = readFileSync(deltaPath, "utf8");
  const deltaLines = delta.split("\n");
  const deltaNames = names(delta);

  if (/^## MODIFIED Requirements/m.test(delta) === false) {
    problems.push(`the ${capability} delta is not marked \`## MODIFIED Requirements\``);
  }

  // A file carrying more than one operation heading holds a second kind of block that a
  // requirement-block merge would write straight past. M16 could assert "exactly one requirement";
  // this capability legitimately modifies several, so the assertion is on the *operation heading*.
  const operations = [...delta.matchAll(/^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements/gm)].map(
    (m) => m[1],
  );
  if (operations.length !== 1) {
    problems.push(
      `the ${capability} delta carries ${operations.length} operation heading(s) ` +
        `(${operations.join(", ") || "none"}); this sync only applies a single MODIFIED block`,
    );
  }

  const recordPath = join(RECORD, capability, "spec.md");
  if (!existsSync(recordPath)) {
    problems.push(`openspec/specs/${capability}/spec.md does not exist — nothing to modify`);
    continue;
  }
  const recordText = readFileSync(recordPath, "utf8");
  const recordNames = names(recordText);
  const recordLines = recordText.split("\n");

  const writes = [];
  for (const requirement of deltaNames.requirements) {
    if (!recordNames.requirements.includes(requirement)) {
      problems.push(
        `the delta modifies "${requirement}", which ${capability} does not have. A MODIFIED block is ` +
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

    // And the check a name-only guard cannot make: a scenario whose NAME is kept but whose BODY is
    // weakened. M17's first delta did exactly this to all fourteen pre-existing scenarios, keeping
    // every name — so the name guard passed — while deleting "with no liked-track, playlist, or history
    // payload", "shaped like the cards it will replace", and the keyboard/focus/accessible-name clause.
    // Five requirements enforced by passing tests would have vanished from the record of truth, and
    // `openspec validate` would have reported nothing. Rewording a scenario is a deliberate act, not a
    // merge, so this refuses rather than guesses.
    const weakened = existing
      .filter((s) => incomingNames.has(s.name))
      .filter((s) => incoming.find((candidate) => candidate.name === s.name).body !== s.body)
      .map((s) => s.name);
    if (weakened.length > 0) {
      problems.push(
        `the delta REWRITES the body of ${weakened.length} existing scenario(s) in "${requirement}" — ` +
          `${weakened.map((n) => JSON.stringify(n)).join(", ")}. A MODIFIED block replaces the whole ` +
          `requirement, so a reworded body overwrites a constraint the record already states. Rewording ` +
          `is an explicit decision: update the record deliberately, or carry the body over verbatim.`,
      );
    }

    // Beyond preservation: a requirement that shrinks without dropping a name has had its scenarios
    // merged together. That is an explicit edit and must be argued for, not absorbed.
    if (incoming.length < existing.length) {
      problems.push(
        `"${requirement}" would go from ${existing.length} scenario(s) to ${incoming.length} without ` +
          `dropping a name — scenarios were merged rather than removed. That is an explicit decision ` +
          `and must not happen silently.`,
      );
    }

    const incomingBlock = requirementBlock(deltaLines, requirement);
    const currentBlock = requirementBlock(recordLines, requirement);
    if (incomingBlock === null || currentBlock === null) {
      problems.push(`could not locate the body of "${requirement}" in one of the two documents`);
      continue;
    }

    // The same argument applies to the requirement's own prose. M17's first delta shortened the Home
    // feed requirement from 1551 to 817 characters, dropping the DESIGN.md contract, the baseline-shelf
    // list, the Smart Mixes rendering contract, and the accessibility clause. Every sentence of the
    // record's prose must still be present; prose may be ADDED, never removed.
    const proseSentences = requirementProse(currentBlock.text)
      .split(/(?<=\.)\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 40);
    const lost = proseSentences.filter((sentence) => !requirementProse(incomingBlock.text).includes(sentence));
    if (lost.length > 0) {
      problems.push(
        `the delta LOSES ${lost.length} sentence(s) of the requirement prose for "${requirement}": ` +
          lost.map((n) => JSON.stringify(n.slice(0, 120))).join(", "),
      );
    }

    writes.push({ requirement, current: currentBlock, incoming: incomingBlock });
    report.push(
      `  ${capability} / ${requirement}: ${existing.length} scenario(s) -> ${incoming.length} ` +
        `(+${incoming.length - existing.length}, ${dropped.length} dropped) — verified`,
    );
  }

  pendingWrites.set(capability, {
    path: recordPath,
    lines: recordLines,
    requirementCountBefore: recordNames.requirements.length,
    writes,
  });
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

// Replace requirements from the end of the file backwards, so an earlier block's recorded offsets stay
// valid. Every other line of the file is left byte-identical.
for (const { path, lines, writes } of pendingWrites.values()) {
  const ordered = [...writes].sort((a, b) => b.current.start - a.current.start);
  let merged = lines;
  for (const write of ordered) {
    merged = [
      ...merged.slice(0, write.current.start),
      ...write.incoming.text.split("\n"),
      ...merged.slice(write.current.end),
    ];
  }
  writeFileSync(path, merged.join("\n"), "utf8");
}

// Write each new capability in the record's own shape: the delta's `# Spec Delta` title becomes
// `# <capability> Specification`, and `## ADDED Requirements` becomes `## Requirements`. A first draft
// of the M16 script rewrote only the second heading, which left a file of record opening with "Delta".
for (const capability of ADDED_CAPABILITIES) {
  const delta = readFileSync(join(CHANGE, capability, "spec.md"), "utf8");
  const body = delta
    .replace(/^# .*$/m, `# ${capability} Specification`)
    .replace(/^## ADDED Requirements/m, "## Requirements");
  const recordPath = join(RECORD, capability, "spec.md");
  mkdirSync(dirname(recordPath), { recursive: true });
  writeFileSync(recordPath, body, "utf8");
}

/* ── 5. re-read from disk and re-check: a write that did not take must not read as success ─ */

const afterProblems = [];

for (const capability of ADDED_CAPABILITIES) {
  const recordPath = join(RECORD, capability, "spec.md");
  const text = readFileSync(recordPath, "utf8");
  const after = names(text);
  const expected = names(readFileSync(join(CHANGE, capability, "spec.md"), "utf8"));
  if (after.requirements.length !== expected.requirements.length) {
    afterProblems.push(
      `${capability}: requirement count changed: ${expected.requirements.length} -> ${after.requirements.length}`,
    );
  }
  const afterNames = new Set(after.scenarios.map((s) => s.name));
  for (const scenario of expected.scenarios) {
    if (!afterNames.has(scenario.name)) {
      afterProblems.push(`${capability}: "${scenario.name}" is missing from the written spec`);
    }
  }
  if (text.split("\n")[0] !== `# ${capability} Specification`) {
    afterProblems.push(`${capability}: the written spec does not open with the record's own title`);
  }
  if (/^## ADDED Requirements/m.test(text)) {
    afterProblems.push(`${capability}: the written spec still carries the delta's ADDED heading`);
  }
}

for (const capability of MODIFIED_CAPABILITIES) {
  const { requirementCountBefore, writes } = pendingWrites.get(capability);
  const after = names(readFileSync(join(RECORD, capability, "spec.md"), "utf8"));
  const afterNames = new Set(after.scenarios.map((s) => s.name));

  // This sync replaces bodies, never adds or removes a requirement, so the count must not move. An
  // earlier draft of the M16 script compared each delta against the wrong spec and reported thirteen
  // phantom failures on a write that had succeeded — a check that cries wolf gets deleted.
  if (after.requirements.length !== requirementCountBefore) {
    afterProblems.push(
      `${capability}: requirement count changed: ${requirementCountBefore} -> ${after.requirements.length}`,
    );
  }
  for (const write of writes) {
    if (!after.requirements.includes(write.requirement)) {
      afterProblems.push(`${capability}: "${write.requirement}" is missing from the written spec`);
    }
    // Each delta is checked against the spec it was written INTO — never against the other capability.
    for (const scenario of names(write.incoming.text).scenarios) {
      if (!afterNames.has(scenario.name)) {
        afterProblems.push(`${capability}: "${scenario.name}" is missing from the written spec`);
      }
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
