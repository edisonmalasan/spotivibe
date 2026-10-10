// CANONICAL COPY - this is the runnable gate-batch corroborator.
//
//     frontend/scripts/gate-batch/run-gate-batch.ps1
//     frontend/scripts/gate-batch/verify-gate-batch.mjs
//
// A byte-identical pair exists at
// openspec/changes/archive/2026-10-05-harden-post-v1-verification/evidence/ and is **deliberately
// NOT repaired**. It is M21's frozen record of what that milestone shipped; editing it would
// destroy that record while making the defect invisible to the next reader. Do not run the archived
// copies.
//
// ---------------------------------------------------------------------------------------------
//
// Independent corroboration of a batch of six full gate runs.
//
// **Why this file is in the repository, and why that is a repair rather than a filing habit.** Eleven
// entries in this change's tasks.md described their figures as "corroborated from the six logs by
// separate code", naming a script each time. Round 10's second WARNING established that none of those
// scripts existed as repository files: `git grep -l gateruns` returned nothing, and a recursive filename
// search over the repository and the agent workspace found nothing either. Every batch entry was therefore
// self-reported by the tool that produced it — which is the arrangement `verify-gateruns7.mjs` was
// created to replace, reintroduced one level up.
//
// A claim of independent corroboration that nobody else can run is not independent corroboration; it is
// a second script by the same author, agreeing with the first. Reviewability is the property that makes
// the word mean something, so the mechanism ships with the claim it supports.
//
// ## Usage
//
//   node verify-gate-batch.mjs <log-directory> [--expect-files N] [--expect-budget N]
//
// The log directory must contain `run1.log` … `run6.log`, as written by `run-gate-batch.ps1`. Both the
// directory and the frontend path are arguments rather than constants: a checker hard-coded to one
// author's temporary directory is not runnable by the person reading it, which is the same defect as not
// shipping it.
//
// ## What is asserted, what is reported, and why the difference is the whole design
//
// Asserted, because a wrong value would be a claim about the gate or the tree:
//   - `Test Files` is N and identical across all six logs.
//   - `motion-budget` is N in all six. This is the load-bearing half of the gate-ordering argument:
//     15 passed + 6 skipped is the no-build figure, so a run without a build reports 15 here.
//   - 0 skipped in all six, because a skipped test is a check that did not run.
//   - every log is free of NUL bytes and of U+FFFD, because a UTF-16 log and a lossy log both read as
//     *markers absent* rather than as *markers present and wrong*.
//   - every asserted figure is identical across the six, because six logs disagreeing with each other is
//     not six green runs.
//
// Reported, not asserted, because a hard-coded expectation that is wrong about the tree reports itself
// as a finding about the tree:
//   - the executed-test total. It is cross-checked against a second mechanism instead — see phase 2.
//
// The `--expect-*` flags parameterise the two figures this script asserts. **They have no defaults.**
//
// **Why there are none, and why this paragraph is longer than the code it replaced.** This script used to
// fall back to `182` and `21`, describe their provenance, and then fail when the tree moved past them. The
// two numbers were the M21 tree's file and motion-budget counts, so the default was stale *by
// construction*: correct on the day it was written, wrong again at the next milestone. `21` had been
// failing on arrival since M22. The script could name the cause of its own failure and still exited 1, and
// `run-gate-batch.ps1` printed a follow-up command omitting both flags, so following the apparatus's own
// instructions failed a perfect batch — measured against `qpo-batch2`, six of six green at the merged
// commit: `8 problem(s) unresolved`, exit 1. Four separate sessions rediscovered the required override,
// and no documented source recorded it.
//
// **Round 12's CRITICAL 4b, kept because it is the reason not to reintroduce a constant.** The sentence
// here used to read that the flags were "optional on purpose... the honest move is for the caller to say
// what it expects, not for this script to guess and then report its own guess back as a finding" — while
// the code did precisely that: `?? "182"`, then `found.files === options.files`. A stated philosophy
// contradicted by the code two lines below it is worse than no philosophy, because a reader deciding
// whether to trust this script will reason from it. Round 12 fixed the sentence and kept the constant; the
// sentence was right and the code was wrong, and only one of the two got repaired.
//
// A figure stored in this file is a snapshot of some earlier tree. Reading it at check time, from either
// the logs or the live tree, is what makes it incapable of going stale.
//
// So, now:
//
//   - **Caller states a figure** — it is the expectation, and a disagreement is a real failure.
//   - **Caller states none** — the figure is derived from the batch, and the file count is additionally
//     checked against the live tree via `vitest list --filesOnly`, which returns one line per *file* and
//     so is an exact equality rather than the lower bound plain `vitest list` gives.
//   - **The executed-test total is unasserted**, because it moves whenever the suite gains a test and has
//     no exact live-tree equivalent.
//
// A closing line names which of these applied, so a green exit cannot be read as covering more than it did.
//
// ## The five defects this checker's own history contains, kept because each was a real false report
//
// 1. **A parser that could not find what it was looking for reported it as absent.** vitest colours its
//    summary, so the bytes read `Test Files \x1b[2m181 passed\x1b[22m` and `Test Files\s+(\d+) passed`
//    does not match — an escape sequence is not whitespace. Every marker below is therefore located as a
//    *string* first and reported ABSENT separately; a number is only ever read from a region already
//    known to contain its marker.
// 2. **A phase guarded behind a line the tool does not print.** `vitest list` was gated on a summary line
//    it never emits, so a working enumeration was reported as an absent capability — this change's own
//    defect class, committed by the checker rather than the code.
// 3. **Counting separators instead of ids**, then asserting equality against a number it could not
//    legitimately have. `vitest list` emits one line per test *template*; this suite has 33 `.each(` call
//    sites that expand at run time, so enumeration is a lower bound by construction. Only the directional
//    claim the two mechanisms share (`enumerated <= executed`) is asserted. **A checker adjusted until it
//    agrees has stopped checking.**
// 4. **A hard-coded expected total**, whose failure mode is worse than the staleness it guards against.
// 5. **Windows PowerShell writing UTF-16LE** into a log the parser then read as UTF-8, so half the
//    characters were NULs and `Test Files` was not *findable*. The NUL and U+FFFD assertions above exist
//    because of that, not because encoding is interesting.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

// Arguments first, and this function refuses rather than defaulting silently: a checker that cannot tell
// which logs it was asked about cannot report what it found in them.
function parseArguments(argv) {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith("--")) {
      flags.set(argument.slice(2), argv[index + 1]);
      index += 1;
    } else {
      positional.push(argument);
    }
  }
  if (positional.length !== 1) {
    process.stderr.write(
      "usage: node verify-gate-batch.mjs <log-directory> " +
        "[--expect-files N] [--expect-budget N] [--runs N] [--frontend <path>]\n" +
        "       --expect-* are optional. Omit them and the figures are derived from the batch, with\n" +
        "       the file count additionally checked against the live tree.\n",
    );
    process.exit(2);
  }
  return {
    dir: resolve(positional[0]),
    frontend: resolve(flags.get("frontend") ?? "frontend"),
    files: flags.get("expect-files") ?? null,
    budget: flags.get("expect-budget") ?? null,
    runs: Number(flags.get("runs") ?? "6"),
    // Whether each expected figure was **stated by the caller** or fell back to the built-in default.
    // The distinction decides what a mismatch means: a caller-stated figure that does not match is a
    // disagreement to investigate, while a stale default that does not match is a constant that fell
    // behind the tree. Reporting them identically is what made the original failure undiagnosable.
    supplied: {
      files: flags.has("expect-files"),
      budget: flags.has("expect-budget"),
    },
  };
}

const options = parseArguments(process.argv.slice(2));
const DIR = options.dir;

process.stdout.write(`verifying ${options.runs} logs in ${DIR}\n`);
process.stdout.write(`frontend for the enumeration phase: ${options.frontend}\n\n`);

if (!existsSync(DIR)) {
  process.stdout.write(`FAIL the log directory does not exist: ${DIR}\n`);
  process.exit(1);
}

const rows = [];
let problems = 0;

// **Third defect in this checker's own history, found by attacking it rather than by using it.**
//
// The loop below reads `run1.log` .. `runN.log` and never enumerates the directory, so a caller who passed
// `--runs 2` against a directory holding six logs had logs 3-6 silently ignored - and the closing line then
// read `every asserted figure was found in all 2 logs, they all agree`. Asserting *more* runs than exist was
// caught (`only 6 of 9 logs were present`); asserting *fewer* was not. **The asymmetry is the defect**: the
// check is loud about missing evidence and silent about unexamined evidence, and the word "all" in the
// verdict is a claim about the batch rather than about the subset that was read.
//
// This is lesson 76's general form, one level down: a report that mixes what was checked with what was
// skipped must not print one word of verdict over both. Here the skipped part is four logs the caller
// plainly meant to include.
//
// So the directory is enumerated and must contain exactly the logs the caller named. Extra logs are
// reported as *unexamined*, distinctly from *absent*, because they fail differently: absent logs are missing
// evidence and extra logs are evidence nobody read, and a reader who conflated the two would be told to go
// and run a batch that has already been run.
const presentLogs = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((name) => /^run\d+\.log$/.test(name))
      .sort((left, right) => Number(left.match(/\d+/)[0]) - Number(right.match(/\d+/)[0]))
  : [];
const expectedLogs = Array.from({ length: options.runs }, (_, index) => `run${index + 1}.log`);
const unexamined = presentLogs.filter((name) => !expectedLogs.includes(name));
if (unexamined.length > 0) {
  process.stdout.write(
    `\nFAIL ${unexamined.length} log(s) in ${DIR} were NOT examined, because --runs is ${options.runs}: ` +
      `${unexamined.join(", ")}\n` +
      "      These are not missing logs; they are logs nobody read, and a verdict over a subset is not a\n" +
      "      verdict over the batch. Pass --runs " +
      `${presentLogs.length} to examine them, or --runs ${expectedLogs.length} to assert this batch.\n`,
  );
  problems += 1;
}

// **The live tree's own test-file count, read once, here — before the per-log loop — because it is the
// default expectation.** When the caller states no `--expect-files`, this is what each log's file count is
// compared against, so the comparison has to exist before the loop rather than being retrofitted after.
//
// **It is an exact equality, not a lower bound**, and that was measured before this was written:
// `vitest list --filesOnly` prints one line per *file* (185 on this tree, matching the batches), whereas
// plain `vitest list` prints one line per *template* (3,112) and is a lower bound by construction because
// `.each(` call sites expand only at run time. The full rationale, and the reason the hard-coded `182`/`21`
// this replaced is not coming back, is in the header and in the block below that consumes this figure.
const filesOnly = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "list", "--filesOnly"],
  { cwd: options.frontend, encoding: "utf8", env: process.env },
);
const liveTreeFiles = (() => {
  const out = ((filesOnly.stdout ?? "") + (filesOnly.stderr ?? "")).replace(ANSI, "");
  const n = out
    .split(/\r?\n/)
    .filter((line) => /^\S+\.(test|spec)\.[cm]?[jt]sx?$/.test(line.trim())).length;
  return filesOnly.status === 0 && n > 0 ? String(n) : null;
})();

// What each log is held against, resolved once. A caller-stated figure always wins; otherwise the live tree
// supplies the file count. `budget` has no live-tree equivalent, so with nothing stated it is not held
// against any external figure - only against the other logs, in the aggregate block below.
const expectedFiles = options.supplied.files ? options.files : liveTreeFiles;
const expectedBudget = options.supplied.budget ? options.budget : null;

if (liveTreeFiles === null) {
  // A phase that cannot run is the absence of the check, not a pass — the same reasoning that repaired the
  // plain-`vitest list` phase further down, applied here. It is only fatal when it would have been the
  // expectation: a caller who stated `--expect-files` has supplied the figure this would have provided.
  process.stdout.write(
    `FAIL live tree file count: \`vitest list --filesOnly\` produced no file list (exit ${filesOnly.status}).\n` +
      "      This is the expectation used whenever the caller supplies no --expect-files, so a phase\n" +
      "      that cannot run is the absence of the check rather than a pass. Check that --frontend\n" +
      "      points at the frontend directory and that dependencies are installed.\n",
  );
  if (!options.supplied.files) problems += 1;
} else {
  process.stdout.write(
    `ok   live tree file count: ${liveTreeFiles} test files, from \`vitest list --filesOnly\`\n`,
  );
}

for (let run = 1; run <= options.runs; run += 1) {
  const path = `${DIR}/run${run}.log`;
  if (!existsSync(path)) {
    process.stdout.write(`run${run}  ABSENT  ${path} does not exist\n`);
    problems += 1;
    continue;
  }

  const bytes = readFileSync(path);
  const nulBytes = bytes.filter((byte) => byte === 0).length;
  const text = bytes.toString("utf8").replace(ANSI, "");
  const replacement = (text.match(/�/g) ?? []).length;

  // Phase 1a: is the marker there at all? Reported separately from any number, always. Defect 1 above is
  // why this phase exists and why its answer is never inferred from a failed number match.
  const markerAt = (marker) => {
    const at = text.indexOf(marker);
    return at === -1 ? null : at;
  };
  const markers = {
    files: markerAt("Test Files"),
    tests: markerAt("Tests "),
    budget: markerAt("tests/motion-budget.test.ts"),
  };

  // Phase 1b: only now read a number, from a region already known to hold its marker.
  const found = {
    files: /Tests?\s+Files\s+(\d+) passed/.exec(text)?.[1] ?? null,
    tests: /Tests\s+(\d+) passed/.exec(text)?.[1] ?? null,
    budget: /tests\/motion-budget\.test\.ts\s+\((\d+) tests?\)/.exec(text)?.[1] ?? null,
    skipped: /(\d+) skipped/.exec(text)?.[1] ?? null,
  };

  const markersPresent = Object.values(markers).every((at) => at !== null);

  // **Round 11's WARNING 3: the criterion is "six consecutive GREEN runs", and the exit status had no
  // artefact anywhere.** Every figure above is read from vitest's summary, and a run that prints a full
  // green summary and *then* exits non-zero satisfies all of them — the driver's `$exitCode` went to the
  // console and the log received the gate's stdout and nothing else. Measured: appending a red summary and
  // `npm error code 1` to one of six otherwise-untouched logs still reported `run1 … asserted ok` and
  // `corroborated`, exit 0.
  //
  // It was latent rather than exploitable — a genuinely red gate run's only `Test Files` line reads
  // `1 failed | N-1 passed (N)`, which does not match `/Tests?\s+Files\s+(\d+) passed/`, so `files` is null
  // and the log is refused. Round 12 forced a real failure and confirmed it against captured output:
  // `files`, `tests`, `budget` and `skipped` all came back null, `exitCode` was `"1"`, and the
  // failing-summary regex matched. A red run is now caught by **three** independent mechanisms.
  //
  // **Two corrections round 12 made to this comment, both because it asserted more than was measured.**
  // It said a red run "has exactly one `Tests … passed` match" — the measurement is **zero**, because the
  // red line reads `Tests  1 failed | …` and the `passed`-anchored pattern does not match it. Harmless,
  // since `tests` is reported rather than asserted and the driver prints `?` when it finds none, but it
  // was a false statement. And it quoted `1 failed | 180 passed (181)` as a literal; with the suite at
  // 182 files that line reads `1 failed | 181 passed (182)`. The *claim* survives, the *figures* did not,
  // and a hard-coded figure in a comment about a moving count is the same failure as a hard-coded figure
  // in an assertion — so both are now written as `N-1` and `N`.
  //
  // None of that is why the repair was made. "The batch would still have noticed, for a different reason"
  // is not the same claim as "the batch checks the thing it says it checks", and a criterion whose stated
  // half has no evidence behind it is a criterion with an unmeasured half. The driver now writes
  // `gate exit <code>` into the log and this asserts it is 0.
  const exitCode = /gate exit(\d+)/.exec(text)?.[1] ?? null;
  // **Round 13's WARNING 1: a batch whose logs cannot name their commit cannot support a claim about
  // the tree at a commit.** Six logs can agree on every figure and still have been produced by six
  // different trees, and the criterion is stated in terms of a commit. The driver now writes
  // `commit <sha>` under the exit line and this reads it.
  //
  // **The check is that it is present, not that it is `unknown`.** A log stamped `unknown` proves the
  // driver ran; it does not prove what it ran against, so refusing `unknown` would make the driver
  // unusable in exactly the shallow-clone or no-git case it must not fail in. What is refused is
  // *absence*, for the same reason `gate exit` absence is refused: absent and present-but-uninformative
  // must not collapse into one another silently. Every commit in the batch is printed at the end, so a
  // batch spanning two commits is visible to a reader rather than averaged away.
  const commit = /^commit (\S+)$/m.exec(text)?.[1] ?? null;
  // A second summary contradicting the first would also be a log carrying two verdicts. Refused rather than
  // resolved, because which one the gate meant is not decidable from the file.
  const failingSummary = /Tests\s+[^\n]*\d+ failed/.exec(text)?.[0] ?? null;

  const assertedHold =
    found.files === expectedFiles &&
    (expectedBudget === null || found.budget === expectedBudget) &&
    found.skipped === null &&
    exitCode === "0" &&
    commit !== null &&
    failingSummary === null;
  if (!markersPresent || !assertedHold || nulBytes > 0 || replacement > 0) problems += 1;

  // **Round 11's NIT 3: six byte-identical logs were corroborated as six runs.** The agreement check below
  // establishes that the *figures* match, which cannot distinguish six runs from one run copied six times —
  // and copying is the cheapest available way to make a stability criterion vacuous. A digest per log makes
  // "six runs" mean six distinct byte streams. Hashing the whole log is right here: real runs differ in
  // their timing lines, which is precisely the variation the criterion is claiming to have observed.
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 12);

  rows.push({
    run,
    nulBytes,
    replacement,
    markersPresent,
    assertedHold,
    digest,
    exitCode,
    commit,
    ...found,
  });

  process.stdout.write(
    `run${run}  ${String(bytes.length).padStart(6)}B  NULs ${nulBytes}  U+FFFD ${replacement}  ` +
      `markers ${markersPresent ? "all found" : "MISSING"}  ` +
      `files ${found.files}  tests ${found.tests ?? "?"} (reported, not asserted)  ` +
      `budget ${found.budget}  skipped ${found.skipped ?? "none"}  ` +
      `exit ${exitCode ?? "ABSENT"}  commit ${commit ?? "ABSENT"}  sha ${digest}  ` +
      `${assertedHold ? "asserted ok" : "ASSERTED MISMATCH"}\n`,
  );

  if (commit === null) {
    process.stdout.write(
      "        the log carries no `commit <sha>` line, so this run cannot be tied to a tree. The\n" +
        "        criterion is stated about a commit; a batch that cannot name it is agreeing about\n" +
        "        figures without saying which code produced them. Logs must come from the shipped\n" +
        "        run-gate-batch.ps1, which writes it.\n",
    );
  }

  if (exitCode === null) {
    process.stdout.write(
      "        the log carries no `gate exit <code>` line, so the gate's own exit status cannot be read.\n" +
        "        Logs must come from the shipped run-gate-batch.ps1, which writes it. This is a problem,\n" +
        "        not a gap to be tolerated: the criterion is six GREEN runs.\n",
    );
  } else if (exitCode !== "0") {
    process.stdout.write(`        the gate reported exit ${exitCode}, so this run is not green.\n`);
  }
  if (failingSummary !== null) {
    process.stdout.write(
      `        the log also carries a failing summary - ${JSON.stringify(failingSummary)} - so it holds ` +
        "two verdicts and which one the gate meant is not decidable from the file.\n",
    );
  }

  if (!markersPresent) {
    for (const [label, at] of Object.entries(markers)) {
      if (at === null) process.stdout.write(`        MARKER ABSENT: ${label}\n`);
    }
    const at = markers.files;
    process.stdout.write(
      `        tail: ${at === null ? "(no Test Files)" : text.slice(at, at + 120)}\n`,
    );
  }
}

// N logs, or the streak is not N. Reported as a count rather than assumed.
if (rows.length !== options.runs) {
  process.stdout.write(`\nFAIL only ${rows.length} of ${options.runs} logs were present\n`);
  problems += 1;
}

// **NIT 3, asserted rather than described.** The comment below this block claimed the claim was "N runs of
// one unchanged tree"; the check established only that the figures agree, and agreement cannot tell six runs
// from one run copied six times. So distinctness is asserted on the bytes.
if (rows.length > 0) {
  const distinctDigests = new Set(rows.map((row) => row.digest));
  const allDistinct = distinctDigests.size === rows.length;
  process.stdout.write(
    `${allDistinct ? "ok   " : "FAIL "}log digests across the logs: ${distinctDigests.size} distinct of ` +
      `${rows.length}\n`,
  );
  if (!allDistinct) {
    process.stdout.write(
      "      identical logs cannot be six runs. Agreement between copies is not stability; it is one run\n" +
        "        counted six times.\n",
    );
    problems += 1;
  }
}

// **All six logs must name the SAME commit.** Distinct digests prove six distinct byte streams; they do
// not prove one tree. Six runs spanning a commit boundary would agree on every figure only if the change
// was inert, and "inert" is an assumption no reader of a criterion should be asked to make. This is the
// difference between six runs and six runs *of one unchanged tree*, which is the claim the block above
// was corrected to make.
//
// **Refused, not reported — round 14's WARNING 1, and the comment previously here was wrong about it.**
// This block said a straddling batch "cannot pass unnoticed", and measured: it printed `WARN`, left
// `problems` at 0, printed `corroborated:` and **exited 0**. Unnoticed by the criterion means *seen by a
// human reading the output*. Every other caller of this checker reads only the exit status — this file
// says so itself a few hundred lines below, about a stale figure: "the exit status is 0, and a caller
// that only reads the exit status — which is what CI, and every batch entry in tasks.md, does — records
// a pass." A warning nobody's tooling reads is not a check.
//
// So this increments `problems`. The reasoning for refusing rather than warning is the mirror of the
// `unknown` case below: refusing `unknown` would punish the environment, but a batch naming two commits
// is a defect in the *evidence*, not in the machine that produced it, and the criterion is stated about a
// commit. `unknown` is accepted and visible; a straddling batch is accepted by no one.
if (rows.length > 0) {
  const distinctCommits = [...new Set(rows.map((row) => row.commit))];
  // **Round 16's WARNING 4: this line printed `ok` when every commit was absent.** `new Set([null, null,
  // …])` has size 1, so a batch in which *no* log names a commit read as one agreeing commit. The run was
  // still caught — every row reports `ASSERTED MISMATCH` and `problems` is 7 — so it was never a false
  // green. It is nonetheless the exact shape this project has twice promoted to CRITICAL: **a check
  // printing `ok` while the thing it checks is absent**, and a reader scanning this one line saw `ok`.
  //
  // The status word is therefore derived from what is *known*, not from how many values there are. An
  // absent commit is `FAIL` here even when it is the only value, and `unknown` — present but
  // uninformative — stays `ok`, because presence is required and informativeness is not.
  const allPresent = rows.every((row) => row.commit !== null);
  const label = !allPresent ? "FAIL " : distinctCommits.length === 1 ? "ok   " : "FAIL ";
  process.stdout.write(
    `${label}commits named across the logs: ` +
      `${distinctCommits.map((c) => c ?? "ABSENT").join(", ")} ` +
      `(${distinctCommits.length} distinct of ${rows.length})\n`,
  );
  // **Two conditions, and the order matters.** Absence is tested FIRST, because a partly-absent batch also
  // has more than one distinct value and would otherwise be explained as a straddling batch — which is
  // round 17's NIT 1, measured: five commits plus one absent printed "a batch spanning more than one
  // commit". The status word was right (`FAIL`), the `ABSENT` was visible and the exit was non-zero, so it
  // was cosmetic rather than a false green. It was still the wrong sentence for the evidence in front of
  // the reader, and a check that explains the wrong thing teaches the reader to ignore it.
  if (!allPresent) {
    // **Round 17's WARNING 1: this branch was commented "unreachable in practice", and it is not.** The
    // comment argued from `problems` already being 7, which proves the *consequence* of an absent commit
    // rather than its *absence* — a non-sequitur — and round 17 executed the branch by feeding it the
    // all-absent batch the new negative test builds. "In practice" was satisfied routinely. The branch is
    // kept because it earns its place on the merits: it states in the summary line the fact the six
    // per-row `ASSERTED MISMATCH` lines above already carry.
    problems += 1;
    const absentCount = rows.filter((row) => row.commit === null).length;
    process.stdout.write(
      absentCount === rows.length
        ? "      no log names a commit, so there is nothing to agree about. Each row above reports\n" +
            "        ASSERTED MISMATCH; this line states the same fact in the summary a reader scans.\n"
        : `      ${absentCount} of ${rows.length} logs name no commit, so the batch does not agree on one.\n` +
            "        Each affected row above reports ASSERTED MISMATCH. Re-run the batch rather than\n" +
            `        reading the agreement in the remaining ${rows.length - absentCount} as if it covered all ${rows.length}.\n`,
    );
  } else if (distinctCommits.length !== 1) {
    problems += 1;
    // "six" below is `rows.length`, parameterised because round 18's WARNING 3 measured a five-log read
    // --runs 6 with a missing file, where a hard-coded "six" printed inside a sentence about a count.
    // Round 12 corrected this exact class of figure twice in this same comment block; a figure in prose is
    // the first thing to go stale when the thing it counts is parameterised.
    process.stdout.write(
      `      a batch spanning more than one commit is not ${rows.length} runs of one unchanged tree, and this is\n` +
        "        refused rather than warned about. The figures may still agree, but the criterion is\n" +
        "        about a commit: attribute the batch to neither, or split it.\n",
    );
  }
}

// Every asserted total must be identical across the logs. Asserted without naming a value for `tests`: the
// claim is "N runs of one unchanged tree", and disagreement between the logs is a finding whatever the
// number happens to be.
// **The built-in defaults are gone, and the reason is worth keeping in full.** This block used to compare
// the logs against the literals `182` and `21`, describe exactly where they came from, and then still
// fail when the tree moved on. That combination is the defect this change exists to remove:
//
//   - `182` was the M21 tree's file count. Every milestone since has added test files, so the default was
//     stale *by construction* — correct on the day it was written, wrong again at the next milestone.
//   - `21` was the M21 tree's motion-budget count, and it had been failing on arrival since M22.
//   - The checker could name the cause of its own failure and still incremented `problems` and exited 1.
//   - `run-gate-batch.ps1` printed a follow-up command that omitted both flags, so following the
//     apparatus's own instructions failed a perfect batch. Measured against `qpo-batch2`, six of six
//     green at the merged commit: `8 problem(s) unresolved`, exit 1.
//
// **What replaced them is not a bigger constant.** When the caller states a figure, that figure is the
// expectation and a disagreement is a real failure — unchanged. When the caller states none, the
// expectation is *derived* from the batch and checked against the **live tree**, which cannot fall behind
// because it is read at check time. Two properties survive, and both are asserted:
//
//   1. all N logs agree on the figure, and
//   2. for the file count, the live tree holds exactly that many test files.
//
// **The cross-check is an equality, not a floor**, and that was measured before this design was written:
// `npx vitest list --filesOnly` returns one line per *file* (185 on this tree, matching the batches),
// whereas plain `vitest list` returns one line per *template* (3,112) and is explicitly a lower bound by
// construction because `.each(` call sites expand only at run time. So the mechanism is exact, needs no
// new dependency, and needs no hand-rolled globbing against the vitest config.
//
// **There is no live-tree equivalent for the motion-budget count**, and inventing one would mean
// enumerating templates and guessing at `.each(` expansion — i.e. reintroducing a lower bound where this
// block is supposed to be exact. So for `budget`, an unstated figure is asserted for *stability only*, and
// the output says so rather than implying a tree check that did not happen.
//
// **The accepted limitation, stated rather than papered over:** equality on a file count is weaker than
// equality on a commit. A batch from a different commit with the same number of test files would pass.
// Pinning the commit would require the checker to know a commit the caller has not told it; the logs do
// record their commit and the commit-agreement block above already refuses a batch spanning two. This
// block therefore asserts tree-*shape* agreement, not commit agreement.
//
// `liveTreeFiles` and the two `expected*` figures were computed above the per-log loop, so that the
// per-row check and this aggregate check read the same expectation. Deriving them twice would leave two
// places to disagree, and a disagreement between them would present as a batch that fails for no stated
// reason.

// What each figure was actually checked against, so the verdict can report it rather than imply it.
const assertedAgainst = {};

for (const [label, key, crossChecked] of [
  ["Test Files", "files", true],
  ["Tests", "tests", false],
  ["motion-budget", "budget", false],
]) {
  const distinct = [...new Set(rows.map((row) => row[key]))];
  const stable = distinct.length === 1 && distinct[0] !== null;
  const derived = stable ? distinct[0] : null;

  const stated = options.supplied[key] === true ? options[key] : null;
  const against =
    stated !== null ? stated : crossChecked && derived !== null ? liveTreeFiles : null;
  assertedAgainst[key] = stated !== null ? "stated" : against !== null ? "liveTree" : "stability";

  const ok = stable && (against === null || distinct[0] === against);
  const source =
    stated !== null
      ? "the figure you supplied with --expect-*"
      : "the live tree, because you supplied none";

  process.stdout.write(
    `${ok ? "ok   " : "FAIL "}${label} across the logs: ${distinct.join(", ")}` +
      `${against === null ? " (stability only - nothing asserted beyond the logs agreeing)" : ` (asserted ${against} - ${source})`}\n`,
  );

  if (!ok) {
    problems += 1;
    // Three distinct causes, and each gets its own sentence because telling them apart must not require
    // re-deriving the whole measurement — the failure this block was originally repaired from.
    if (!stable) {
      process.stdout.write(
        `      found ${distinct.join(", ")}. The logs disagree with each other, so there is no single\n` +
          "        figure to check. Agreement between runs is the first claim; re-run the batch rather\n" +
          "        than reading the majority as if it covered all of them.\n",
      );
    } else if (stated !== null) {
      process.stdout.write(
        `      found ${derived}, expected ${stated}. You supplied this figure with --expect-*, so this is\n` +
          "        a real disagreement to investigate, not a stale constant.\n",
      );
    } else {
      process.stdout.write(
        `      found ${derived}, expected ${against}. No figure was supplied with --expect-*, so this was\n` +
          "        checked against the live tree: the batch reports a different number of test files\n" +
          "        than the tree holds, which means it was taken on a different tree. Re-run the batch on\n" +
          "        this tree, or pass --expect-files if the batch is deliberately from another one.\n",
      );
    }
  }
}

// Phase 2: derive the test total from vitest rather than from memory, so the reported figure has a second
// mechanism behind it. Defects 2 and 3 above are both from this phase, and both were false reports about a
// working measurement.
const list = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "list"], {
  cwd: options.frontend,
  encoding: "utf8",
  env: process.env,
});
const listed = ((list.stdout ?? "") + (list.stderr ?? "")).replace(ANSI, "");
const logTotal = rows.length > 0 && rows[0].tests !== null ? Number(rows[0].tests) : null;

// One line per enumerated test id, identified by the "file > suite > test" shape rather than by counting
// separators: a two-level id has two separators and would be double-counted.
const listedIds = listed.split(/\r?\n/).filter((line) => /^tests\/\S+ > /.test(line.trim())).length;

if (list.status !== 0 || listedIds === 0) {
  // **This is the sixth defect in this checker's own history, and it was found by using it.**
  //
  // `run-gate-batch.ps1` ended by printing the command to run next. That printed path was wrong - the
  // driver walks up three parents from `evidence/` and lands on `openspec/`, not the repository root - and
  // so it named `...\openspec\frontend`, which does not exist. Running the printed instruction produced:
  //
  //     n/a   independent enumeration: `vitest list` produced no ids (exit null, 0 ids).
  //     Reported as UNAVAILABLE, not as agreement.
  //     corroborated: every asserted figure was found in all 6 logs, ...
  //     exit: 0
  //
  // **A phase that cannot run was counted as a pass, and the word "corroborated" was printed under it.**
  // The first three lines are careful and the fourth is not: the mechanism that makes this check
  // *independent* of the logs it is checking did not execute, and the output said so and then agreed
  // anyway. That is this change's own defect class - *a check that reports green without checking what it
  // claims* - committed by the very script committed to repair an instance of it.
  //
  // It is worse than a stale number, because it is invisible: the exit status is 0, and a caller that only
  // reads the exit status - which is what CI, and every batch entry in `tasks.md`, does - records a pass.
  //
  // Note that this is NOT defect 2 above, which looks like it and is not. That one skipped a *working*
  // phase behind a marker the tool never prints. This one *ran* the phase, the phase failed, and the
  // failure was absorbed. Skipping a check and swallowing a failure are different bugs with the same
  // symptom, and conflating them would have left this one in place.
  //
  // The repair is to make it a problem, so it cannot be reported as agreement, and to say how to fix it -
  // because `npm run gate` is driven from the repository root while `vitest list` runs with
  // `cwd = --frontend`, and those are different directories on purpose.
  process.stdout.write(
    `FAIL independent enumeration: \`vitest list\` produced no ids (exit ${list.status}, ${listedIds} ids).\n` +
      "      This is the phase that makes the corroboration INDEPENDENT of the logs, so a phase that\n" +
      "      cannot run is the absence of the check rather than a pass. Check that --frontend points at\n" +
      "      the frontend directory and that dependencies are installed: the gate runs from the repository\n" +
      "      root, but this phase runs with cwd=--frontend, and those are different directories.\n",
  );
  problems += 1;
} else if (logTotal === null) {
  // Same reasoning, quieter case: with no log total there is no number to compare against, so the one
  // directional claim the two mechanisms share cannot be made at all. Reported as a problem rather than as
  // a phase that had nothing to say.
  process.stdout.write(
    `FAIL independent enumeration: ${listedIds} ids enumerated, but no log total to compare against, ` +
      "so `enumerated <= executed` cannot be established.\n",
  );
  problems += 1;
} else {
  // **Round 11's WARNINGs 2 and 4, one repair: the second mechanism was bounded and never anchored.**
  //
  // This phase was advertised as making the total "cross-checked against a second mechanism instead", and it
  // enforced exactly one thing: `listedIds <= logTotal`. That detects an *understated* log total and is
  // blind to an overstated one, and it is satisfied just as well by a tree containing a single test. Both
  // were measured:
  //
  //   --frontend pointing at an unrelated tree holding ONE test, against the six untouched logs:
  //     ok   independent enumeration: 1 test templates; the gate log reports 3320 executed (gap 3319)
  //     corroborated, exit 0
  //
  //   all six logs rewritten to claim `Tests  999999 passed (999999)`, nothing else touched:
  //     ok   Tests across the logs: 999999 (stability only)
  //     ok   independent enumeration: 2995 templates; the log reports 999999 executed (gap 997004)
  //     corroborated, exit 0
  //
  // A figure **three hundred** times off (999999 / 3326 = 300.7), and a gap of 997 004, both printed by this
  // script on the line immediately above the verdict word. The D2 repair closes neither: that one made the
  // phase fail when it produced *nothing*, and both of these produce plenty.
  // **Round 18's NIT 2: this said "three thousand times off", which is off by 10x.** It was in round 12's
  // recorded evidence, so the error was inherited rather than introduced — and the honest reading is worse
  // than a typo: "three thousand" makes the hole sound catastrophic, which flatters the repair. The true
  // factor, 300x, is still decisively fatal to a constant anchor, which is the only thing the sentence had
  // to establish.
  //
  // **The anchor is a RATIO, and that is a measured revision rather than the original plan.**
  //
  // The first attempt asserted `listedIds === 2995`, which is the obvious way to pin a figure down. It was
  // measured at once and it does not hold: with **zero tests added** — `git diff` finds no new `it(` or
  // `test(` — enumeration moved 2995 -> 2997, both times across the same 181 files. The two extra entries
  // were:
  //
  //     tests/release-gate-install.test.ts > node
  //     tests/release-gate-install.test.ts > lineOf
  //
  // Top-level entries with no suite segment. Running the suite settled that they are not tests — the
  // executed total was unchanged — so `vitest list` emitted non-test lines. Their exact number is
  // re-measured below rather than asserted here; see the count correction further down.
  //
  // **Round 12's CRITICAL 4c, and this is the correction that matters: the sentence above used to say
  // those entries were "named after local identifiers in the edited file", and that was refuted by
  // measurement rather than merely left unverified.** The identifiers were renamed — the `lineOf` const and
  // its `node` parameter, in `declarationFor`, then in `declaredHow`, then in `reachableComplementArm`,
  // one per run — and the phantom names did not move. Three further probes (an unused module-scope arrow
  // with unique const *and* parameter names, and a called one) each left the count unchanged. The names
  // are **invariant to the identifiers they were alleged to be named after**. A coincidence recorded as a
  // cause is the exact failure this change has spent twelve rounds removing, committed here in round 11.
  //
  // What survives measurement is narrower and sufficient: a small number of non-test lines exist, they
  // inflate `listedIds`, they are deterministic (6/6 full-suite runs enumerate identically), they appear
  // on stdout rather than stderr, and they are **not confined to one file**.
  //
  // **Round 14's NIT 2 correction was itself wrong on arrival, and round 15 caught it.** That correction
  // replaced "two" with "three" and "73 lines" with "74" — both right for `release-gate-install.test.ts` —
  // while leaving the sentence above it, "localised to one file", untouched. Re-measured here across the
  // whole population rather than at the site of the original error:
  //
  //     tests/release-gate-install.test.ts     listed 74  executed 71  delta +3
  //     tests/lyrics-induced-violations.test.ts listed 18  executed 17  delta +1
  //     sum of positive deltas 4, over 2 files
  //
  // The second file's entry is named `\/`, which is an artefact of that test's own
  // `replace(/\\/g, "/")` rather than a test name. **A correction added as a fix is still a claim**, and it
  // has to be measured over the population it is about — the site of the original error is the one place
  // it is guaranteed to agree with you.
  //
  // Immaterial to the anchor: 4 in a 3018-line count moves the ratio by **0.0013** (4/3018) — or 0.0012
  // against the 3342 executed at HEAD — against a floor the current batch clears by 0.104. **Round 18's
  // NIT 2: this read "about 0.0005", which is off by 2.4x, and the error again flattered the conclusion
  // by understating the effect.** A figure written down to support "this is immaterial" is under pressure
  // toward whichever side makes the sentence work, which is why the correction is made by measuring rather
  // than by re-reading the sentence and adjusting until it reads plausibly.
  // **That immateriality is
  // the point of writing the ratio rather than the constant.** The stale figures are corrected here
  // rather than deleted so a reader can see that the count was once anchored and was deliberately
  // replaced by something that does not move when a test is added.
  // **The mechanism remains unverified.** A `formatName` helper that accepts a function and
  // reads `.name` is *consistent* with the symptom without explaining why these two arrows and not the
  // three probes, and a `@jridgewell/trace-mapping` lead turned out to be a substring hit on `lineOffset`.
  // Both are recorded so nobody repeats them; neither is offered as the answer.
  //
  // What that measurement does establish is enough to reject the constant. An anchor that moves when
  // nothing was added is a value nobody can maintain, and maintaining it means editing 2995 to 2997 until
  // it agreed — which is this checker's own recorded defect 3 reached by a different road. So the anchor is
  // the **ratio** of enumerated templates to executed tests: a property of the suite rather than of the
  // enumerator's line discipline, and robust to the jitter in both directions, since ±2 in a 3000-line
  // count moves the ratio by 0.0006.
  //
  // Both measured holes still fail it decisively —
  //
  //     a tree holding ONE test   ->   1 / 3326    = 0.0003   (W2)
  //     a log inflated to 999999  -> 3003 / 999999 = 0.0030   (W4)
  //
  // — and an honest batch sits near 0.90. Two caveats, both measured by round 12 rather than assumed:
  //
  //   - The accepted window for the executed total is `[listedIds, listedIds / 0.8]`, so an **overstated**
  //     total of up to +12.8% is accepted as `corroborated`. That is two orders of magnitude better than
  //     the 999999 hole it replaced, and it is why the floor is defensible — but it is a band, and the
  //     honest description of it is a band.
  //   - The margin between an honest batch and the 0.8 floor, and an earlier version of this comment called
  //     the headroom "far enough below 0.90 that ordinary growth in `.each(` expansion cannot cross it".
  //     Nothing was measured about how fast `.each(` expansion grows. The claim was unmeasured and is
  //     withdrawn.
  //     **Round 18's NIT 2: this bullet used to read "11.4%" with no definition of the denominator, and
  //     11.4% does not follow from 0.90.** (0.90 − 0.8)/0.90 = 11.11%; /0.80 = 12.50%. 11.4% is what
  //     `(ratio − 0.8)/ratio` gives at a ratio of 0.9030 — which is exactly what batch 16 reported, so the
  //     figure was **not wrong, it was a correct answer to an older input that was never re-derived.** That
  //     is harder to catch than a plain error: it stays true in its own arithmetic and goes stale silently.
  //     Both forms are now stated, and the number that does not move with the suite is the one that carries
  //     the argument: the floor accepts an executed total up to `listedIds / 0.8` = **+25%**, against a
  //     measured honest gap of +8.7% (3020 enumerated against 3342 executed).
  const ANCHOR_FLOOR = 0.8;
  const ratio = listedIds / logTotal;
  const anchored = ratio >= ANCHOR_FLOOR && listedIds <= logTotal;

  process.stdout.write(
    `${anchored ? "ok   " : "FAIL "}independent enumeration: \`vitest list\` enumerates ${listedIds} ` +
      `templates against ${logTotal} executed = ${ratio.toFixed(3)}, floor ${ANCHOR_FLOOR}\n`,
  );
  if (!anchored) {
    process.stdout.write(
      `      the two figures stand at ${ratio.toFixed(3)} of each other. Enumeration is a lower bound, so\n` +
        "        this cannot detect a small excess — but a tree holding one test and a log claiming a\n" +
        "        million both land far below the floor, and both were measured passing before this\n" +
        "        anchor existed.\n",
    );
    problems += 1;
  }

  process.stdout.write(
    "      the residual gap is expected and is NOT checked for agreement: `vitest list` prints one line\n" +
      "      per template, and this suite has `.each(` call sites that expand over their tables at run\n" +
      "      time, so enumeration is a lower bound by construction. What is asserted is that the two\n" +
      "      mechanisms are the same order of magnitude and that the bound holds — two claims, each of\n" +
      "      which W2 and W4 defeated individually.\n",
  );
}

// **A green exit has to say what it covered.** A batch is a sample, and a sample's value is bounded by
// what was actually held constant. Without this line, "exit 0" is read as covering everything the tool
// can check, when a run with no stated figure has asserted the logs' agreement and the file count's
// agreement with the live tree — and has *not* asserted either figure against a figure the caller chose.
if (problems === 0) {
  const statedCount = ["files", "budget"].filter((key) => assertedAgainst[key] === "stated").length;
  const liveChecked = assertedAgainst.files === "liveTree";
  const budgetChecked = assertedAgainst.budget === "liveTree";
  const summary =
    statedCount === 2
      ? "both the file count and the motion-budget count were supplied by you"
      : statedCount === 1
        ? "one of the two figures was supplied by you"
        : "no figure was supplied, so both were derived from the batch";
  process.stdout.write(
    `\nwhat was asserted: ${summary}; ` +
      `the file count was ${liveChecked ? "additionally checked against the live tree" : "NOT checked against the live tree"}; ` +
      `the motion-budget count was ${budgetChecked ? "checked against the live tree" : "checked for stability only, as no live-tree equivalent of it exists"}; ` +
      "the executed-test total is reported and never asserted.\n",
  );
}

process.stdout.write(
  problems === 0
    ? `\ncorroborated: all ${options.runs} logs are distinct runs, each green, and every asserted figure ` +
        "was found in all of them, with the independent enumeration anchored and in the same order of " +
        "magnitude\n"
    : `\n${problems} problem(s) unresolved\n`,
);

process.exit(problems === 0 ? 0 : 1);
