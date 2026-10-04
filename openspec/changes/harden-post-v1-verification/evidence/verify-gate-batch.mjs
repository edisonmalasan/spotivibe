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
// The `--expect-*` flags are how the first two assertions are parameterised. They default to 181 and 21
// and are **optional on purpose**: a batch taken on a different tree may legitimately have different
// numbers, and the honest move is for the caller to say what it expects, not for this script to guess and
// then report its own guess back as a finding.
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
        "[--expect-files N] [--expect-budget N] [--runs N] [--frontend <path>]\n",
    );
    process.exit(2);
  }
  return {
    dir: resolve(positional[0]),
    frontend: resolve(flags.get("frontend") ?? "frontend"),
    files: flags.get("expect-files") ?? "181",
    budget: flags.get("expect-budget") ?? "21",
    runs: Number(flags.get("runs") ?? "6"),
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
  // It was latent rather than exploitable — I measured that a genuinely red gate run has exactly one
  // `Tests … passed` match and its only `Test Files` line reads `1 failed | 180 passed (181)`, which does
  // not match the green pattern, so `files` is null and the log is refused. But "the batch would still have
  // noticed, for a different reason" is not the same claim as "the batch checks the thing it says it
  // checks", and a criterion whose stated half has no evidence behind it is a criterion with an unmeasured
  // half. So the driver now writes `gate exit <code>` into the log and this asserts it is 0.
  const exitCode = /gate exit(\d+)/.exec(text)?.[1] ?? null;
  // A second summary contradicting the first would also be a log carrying two verdicts. Refused rather than
  // resolved, because which one the gate meant is not decidable from the file.
  const failingSummary = /Tests\s+[^\n]*\d+ failed/.exec(text)?.[0] ?? null;

  const assertedHold =
    found.files === options.files &&
    found.budget === options.budget &&
    found.skipped === null &&
    exitCode === "0" &&
    failingSummary === null;
  if (!markersPresent || !assertedHold || nulBytes > 0 || replacement > 0) problems += 1;

  // **Round 11's NIT 3: six byte-identical logs were corroborated as six runs.** The agreement check below
  // establishes that the *figures* match, which cannot distinguish six runs from one run copied six times —
  // and copying is the cheapest available way to make a stability criterion vacuous. A digest per log makes
  // "six runs" mean six distinct byte streams. Hashing the whole log is right here: real runs differ in
  // their timing lines, which is precisely the variation the criterion is claiming to have observed.
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 12);

  rows.push({ run, nulBytes, replacement, markersPresent, assertedHold, digest, ...found });

  process.stdout.write(
    `run${run}  ${String(bytes.length).padStart(6)}B  NULs ${nulBytes}  U+FFFD ${replacement}  ` +
      `markers ${markersPresent ? "all found" : "MISSING"}  ` +
      `files ${found.files}  tests ${found.tests ?? "?"} (reported, not asserted)  ` +
      `budget ${found.budget}  skipped ${found.skipped ?? "none"}  ` +
      `exit ${exitCode ?? "ABSENT"}  sha ${digest}  ` +
      `${assertedHold ? "asserted ok" : "ASSERTED MISMATCH"}\n`,
  );

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

// Every asserted total must be identical across the logs. Asserted without naming a value for `tests`: the
// claim is "N runs of one unchanged tree", and disagreement between the logs is a finding whatever the
// number happens to be.
for (const [label, key] of [
  ["Test Files", "files"],
  ["Tests", "tests"],
  ["motion-budget", "budget"],
]) {
  const distinct = [...new Set(rows.map((row) => row[key]))];
  const stable = distinct.length === 1 && distinct[0] !== null;
  const expected = key === "files" ? options.files : key === "budget" ? options.budget : null;
  const matchesExpectation = expected === null || distinct[0] === expected;
  const ok = stable && matchesExpectation;
  process.stdout.write(
    `${ok ? "ok   " : "FAIL "}${label} across the logs: ${distinct.join(", ")}` +
      `${expected === null ? " (stability only)" : ` (asserted ${expected})`}\n`,
  );
  if (!ok) problems += 1;
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
  // A figure three thousand times off, and a gap of 997 004, both printed by this script on the line
  // immediately above the verdict word. The D2 repair closes neither: that one made the phase fail when it
  // produced *nothing*, and both of these produce plenty.
  //
  // **The anchor is a RATIO, and that is a measured revision rather than the original plan.**
  //
  // The first attempt asserted `listedIds === --expect-enumerated` with the constant 2995, which is the
  // obvious way to pin a figure down. It was measured at once and it does not hold: with **zero tests
  // added** — `git diff` finds no new `it(` or `test(` in the only test file changed — enumeration moved
  // 2995 -> 2997, both times across the same 181 files. The two extra entries are:
  //
  //     tests/release-gate-install.test.ts > node
  //     tests/release-gate-install.test.ts > lineOf
  //
  // Top-level entries with no suite segment, named after local identifiers in the edited file. The suite
  // was then run to settle whether they were tests: `Tests  1 failed | 3319 passed (3320)`, so the
  // executed total is unchanged and **they are not tests — `vitest list` emitted two non-test lines.**
  // *Why* it does that is **unverified**; the mechanism was not established, and a guess with a number
  // attached to it would be worse than an admission.
  //
  // What the measurement does establish is enough to reject the constant. An anchor that moves when
  // nothing was added is a value nobody can maintain, and maintaining it means editing 2995 to 2997 until
  // it agreed — which is this checker's own recorded defect 3, reached by a different road.
  //
  // So the anchor is the **ratio** of enumerated templates to executed tests: a property of the suite
  // rather than of the enumerator's line discipline. Both measured holes still fail it decisively —
  //
  //     a tree holding ONE test   ->   1 / 3320    = 0.0003   (W2)
  //     a log inflated to 999999  -> 2997 / 999999 = 0.0030   (W4)
  //
  // — and the honest batch sits at 2997 / 3320 = 0.903. The floor is 0.8: far enough below 0.90 that
  // ordinary growth in `.each(` expansion cannot cross it. The ratio cannot exceed 1, because enumeration
  // is a lower bound by construction.
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

process.stdout.write(
  problems === 0
    ? `\ncorroborated: all ${options.runs} logs are distinct runs, each green, and every asserted figure ` +
      "was found in all of them, with the independent enumeration anchored and in the same order of " +
      "magnitude\n"
    : `\n${problems} problem(s) unresolved\n`,
);

process.exit(problems === 0 ? 0 : 1);