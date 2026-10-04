#!/usr/bin/env node
/**
 * The release gate (M15 tasks 3.1-3.4; spec `release-validation` — "The release gate is
 * runnable and reports what it did not run").
 *
 * ## The output is the deliverable
 *
 * A gate that prints one green tick teaches a reader nothing, and worse, invites the
 * assumption that the items it did not run were run. So this script prints one line per
 * checklist item — a result, or **NOT RUN** with the reason and the steps — and then a
 * tally that names both numbers. Every item appears exactly once, so the whole list can be
 * accounted for.
 *
 * ## What it does not do
 *
 * It does not deploy. Nothing in this repository can deploy to Vercel: that needs account
 * credentials the project does not have and does not want, and a free-tier account is a
 * resource not worth spending on a check. The first deployment stays a manual step, with
 * `frontend/docs/DEPLOYMENT.md` as the procedure. It does not drive Firefox, Android, or
 * iOS either, and says so rather than listing them as covered.
 *
 * ## What it does
 *
 * It runs the checks that can be run here, in this order: the quality gates, the release
 * suites, the permanent-exclusion and deployment-contract checks, the PWA asset drift
 * check, and the accessibility and performance measurement against a production build.
 *
 * Usage:  node openspec/changes/add-release-validation-and-deployment/evidence/release-gate.mjs
 *         node ... --skip-browser     # everything except the browser-driven checks
 * Exit 0 = no automated check failed. A NOT RUN item does not fail the gate, and does not
 * pass it either: the tally says how many of each there were.
 */

import { spawnSync } from "node:child_process";
import { availableEngines, defaultEngine } from "./lib/harness.mjs";
import { prepareDependencies, isShortCircuited, cascadeReason } from "./lib/install.mjs";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Portability fix, and the second one ever made to M15's harnesses after archiving moved
// them a directory deeper. The relative walk was written while the change was *active*,
// where `evidence/../../../..` is the repository root; from `changes/archive/<name>/evidence`
// the same walk resolves to `openspec/` and the gate fails to find the frontend package. An
// explicit override is used when given and the walk is retained as the fallback, so the gate
// still works in an active change directory.
//
// The recurring lesson: a harness that locates the repository by counting directories is
// portable only until someone moves it. Both M15 harnesses needed the same one-line fix
// (`SPOTIVIBE_REPO` here, the same name in `audit.mjs`), which is evidence that the fix
// belongs in the harness design rather than in two patches.
const REPO = process.env.SPOTIVIBE_REPO
  ? resolve(process.env.SPOTIVIBE_REPO)
  : resolve(HERE, "../../../..");
const FRONTEND = join(REPO, "frontend");
const CHANGE = process.env.SPOTIVIBE_CHANGE
  ? resolve(process.env.SPOTIVIBE_CHANGE)
  : join(REPO, "openspec", "changes", "add-release-validation-and-deployment");

const SKIP_BROWSER = process.argv.includes("--skip-browser");

/** One checklist item: what it requires, how it is checked, and what a human must do. */
const ITEMS = [
  {
    id: "gates-install",
    requirement: "the dependency tree is complete, and preparing it never destroys the working tree",
    how: "install",
    // No `command`/`args`: this step no longer runs a command over the working tree. It verifies
    // the existing tree and, only if that tree is unusable, installs into a temporary directory
    // and swaps the result in. See `lib/install.mjs` for why a dry run would not have been enough
    // and why the exit code is not treated as proof.
    //
    // **Why this item exists at all**, which is history rather than an instruction: M15 ran `npm ci`
    // here, which deletes `node_modules` before installing. A failed install therefore broke the
    // working tree, and then every later item failed for a reason that was not the code.
    //
    // That sentence was a `requirement_note` field until independent verification's second pass,
    // and the field was the defect: it was declared here and read by nothing — the printer emits
    // `requirement`, the JSON report emits `requirement:`, and no test referred to it. Repair
    // instructions for a human are carried by `steps`, which is emitted; this is the reason the step
    // was reshaped, so it belongs beside the reasoning rather than in a record shape that implies
    // something consumes it.
  },
  {
    id: "gates-lint",
    requirement: "`npm run lint` reports no errors",
    how: "command",
    command: "npm",
    args: ["run", "lint"],
  },
  {
    id: "gates-format",
    requirement: "`npm run format:check` passes",
    how: "command",
    command: "npm",
    args: ["run", "format:check"],
  },
  {
    id: "gates-typecheck",
    requirement: "`npm run typecheck` passes in strict mode",
    how: "command",
    command: "npm",
    args: ["run", "typecheck"],
  },
  {
    id: "gates-build",
    requirement: "`npm run build` produces a production build",
    how: "command",
    command: "npm",
    args: ["run", "build"],
  },
  // **Build before test, deliberately.** `motion-budget.test.ts` has two halves: its manifest and
  // import rules run unconditionally, and its *size* rules need a build report and skip without one.
  // With the tests first those six size assertions skipped on every run and the gate reported green for
  // a file whose headline is a budget. Measured both ways by moving `.next` aside: 21 passed with a
  // build, 15 passed and 6 skipped without.
  //
  // The ordering was fixed in `.github/workflows/ci.yml` and asserted there by `ci-workflow.test.ts`,
  // which read only the workflow file - so this gate kept the defect while the check sat next to it
  // looking as though it covered it. `tests/ci-workflow.test.ts` now reads this file too.
  {
    id: "gates-tests",
    requirement: "`npm test` passes",
    how: "command",
    command: "npm",
    args: ["test"],
  },
  {
    id: "icons-drift",
    requirement: "PWA icons match the committed generator's output",
    how: "command",
    command: "npm",
    args: ["run", "icons:check"],
  },
  {
    id: "pwa-manifest",
    requirement: "The manifest and the worker validate",
    how: "test",
    // The manifest's own suite decodes the PNGs and the worker is driven from its
    // shipped bytes, so this is the checklist item rather than a proxy for it.
    test: "tests/pwa-manifest.test.ts",
  },
  {
    id: "pwa-offline-claims",
    requirement:
      "The offline copy claims only what the offline experience does",
    how: "test",
    test: "tests/pwa-offline-claims.test.ts",
  },
  {
    id: "security-policy",
    requirement: "Every response is governed by one declared security policy",
    how: "test",
    test: "tests/security-policy.test.ts",
  },
  {
    id: "exclusions",
    requirement:
      "No permanent product exclusion is present in the shipped sources",
    how: "test",
    test: "tests/release-exclusions.test.ts",
  },
  {
    id: "deployment-contract",
    requirement:
      "The deployable shape is what a free-tier single application needs",
    how: "test",
    test: "tests/deployment-contract.test.ts",
  },
  {
    id: "backup-roundtrip",
    requirement: "Export, reset, and import round-trip the listener's data",
    how: "test",
    test: "tests/backup-import.test.ts",
  },
  {
    id: "evidence-parses",
    requirement: "Every evidence script parses",
    how: "command",
    command: "node",
    // The evidence scripts live outside `frontend/`, so `npm run lint`, `format:check`, and
    // `tsc` never see them — which is why a backtick inside a comment inside a template
    // literal was able to end a string three times here without any gate noticing. This
    // item is the substitute, and it is cheap: `node --check` parses without executing.
    args: [join(CHANGE, "evidence", "check-parses.mjs")],
    needsBrowser: false,
  },
  {
    id: "backup-format",
    requirement:
      "The backup format is documented, and the document matches the code it describes",
    how: "test",
    // The roadmap's checklist asks for the format to be *documented*. A document nothing
    // checks is a document that can drift in either direction, so this asserts the
    // documented envelope against the schema that writes it, rather than trusting the prose.
    test: "tests/release-documentation.test.ts",
  },
  {
    id: "accessibility-performance",
    requirement:
      "Contrast, names, keyboard reachability, and loading are within the stated targets",
    how: "command",
    command: "node",
    // The measurement is M14's and lives in that change's archive, not here. Pointing at
    // this change's evidence directory found no file and reported a failure in 0.1s.
    args: [
      join(
        REPO,
        "openspec",
        "changes",
        "archive",
        "2026-09-30-add-deployment-hardening",
        "evidence",
        "audit.mjs",
      ),
    ],
    needsBrowser: true,
  },
  {
    id: "end-to-end",
    requirement:
      "The critical flows work in a real browser against a production build",
    how: "command",
    command: "node",
    args: [join(CHANGE, "evidence", "end-to-end.mjs")],
    needsBrowser: true,
  },
  {
    id: "falsifiability",
    requirement: "The suite's own assertions are proven capable of failing",
    how: "command",
    command: "node",
    // A suite whose assertions have never been observed failing is a report, not a check.
    // This item is in the gate rather than run by hand because the first version left it
    // outside entirely: a proof whose loss nothing would catch is not a gate item in
    // anyone's sense. It runs the full suite so the exit code covers both the flows and
    // the probes.
    //
    // Its own ports. The suite starts and stops a real server and a real browser, and the
    // preceding `end-to-end` item has only just torn its own down; sharing a port made the
    // second run fail for a reason that had nothing to do with falsifiability, which is the
    // worst way for a gate item to fail — a failure that looks like the thing being checked.
    args: [join(CHANGE, "evidence", "end-to-end.mjs"), "--prove-can-fail"],
    env: { SPOTIVIBE_E2E_PORT: "3215", SPOTIVIBE_E2E_CDP_PORT: "9468" },
    needsBrowser: true,
  },
  {
    id: "browser-second-engine",
    requirement: "The flows also pass in a second browser engine",
    how: "command",
    command: "node",
    // The engine is filled in at run time from what is actually installed. The first
    // version passed the literal "second", which `findBrowser` rejects as unknown - so on
    // a machine with two engines, the only machine where this requirement could be met,
    // the item failed every time, and the honest reporting was attached to a command that
    // could never succeed.
    args: [
      join(CHANGE, "evidence", "end-to-end.mjs"),
      "--browser=__SECOND_ENGINE__",
    ],
    needsBrowser: true,
    // Steps for the not-run case. The first version omitted them, so an item that resolved
    // to NOT RUN at run time reached the printer with no `steps` and no `reason`: the reader
    // got one sentence and no instruction, while `--skip-browser` items — a different
    // not-run path — did carry steps. The spec asks for "the reason together with the steps
    // to perform it", and the gate was inconsistent precisely where it was being honest.
    steps: [
      "Install a second Chromium-family browser: Edge is preinstalled on Windows, Chrome on macOS and Linux.",
      "Re-run the gate — it discovers installed engines at run time and names the second one.",
      "Or run it directly: node openspec/changes/add-release-validation-and-deployment/evidence/end-to-end.mjs --browser=<engine>",
    ],
    // Which engines exist is a property of the machine, not of the repository, so this is
    // resolved at run time. With fewer than two installed it reports NOT RUN and the
    // reason, because a second-engine run that did not happen must never read as one that
    // did.
    resolve: () => {
      const installed = availableEngines().map((entry) => entry.engine);
      if (installed.length < 2) {
        return {
          manual: true,
          reason: `only one browser engine is installed here (${installed.join(", ") || "none"}); a second-engine run needs a second engine`,
        };
      }
      // The second engine is the installed one that is not the default, so the command
      // names an engine the harness can actually start.
      return {
        substitute: installed.find((engine) => engine !== defaultEngine()),
      };
    },
  },

  // ---- items that cannot be automated from here, each with its steps ------------
  {
    id: "vercel-deploy",
    requirement: "Vercel production build passes",
    how: "manual",
    steps: [
      "Import the repository into Vercel with `frontend/` as the project root.",
      "Accept the auto-detected Next.js preset; add no environment variables.",
      "Confirm the build log reports Node 26, matching `package.json` `engines.node`.",
      "Follow the five verification steps in `frontend/docs/DEPLOYMENT.md`.",
    ],
    reason:
      "needs Vercel account credentials, which this project does not have or want",
  },
  {
    id: "design-visual-audit",
    requirement: "`frontend/docs/DESIGN.md` visual audit passed",
    how: "manual",
    steps: [
      "Open each surface named in DESIGN.md at 1280x900 and at 390x844.",
      "Compare against the layout, spacing, typography, and colour the document specifies.",
      "The automated contrast, naming, and keyboard audits cover what can be computed;",
      "proportion, hierarchy, and visual rhythm are a human judgement and are not asserted.",
    ],
    reason:
      "proportion and visual hierarchy are judgements no check in this repository makes",
  },
  {
    id: "browser-firefox",
    requirement: "Firefox desktop, standard web mode",
    how: "manual",
    steps: [
      "Open the production build in Firefox desktop.",
      "Walk the critical flows: first launch, search and play, navigate while playing,",
      "like, queue, playlist edit, reload and session restore, offline shell.",
      "Watch for layout differences at 1280x900 and 390x844, and for focus visibility.",
    ],
    reason: "the automation protocol this project uses is a Chromium protocol",
  },
  {
    id: "browser-android",
    requirement: "Android Chromium/PWA where available",
    how: "manual",
    steps: [
      "Open the deployed origin in Chrome for Android and install it from the menu.",
      "Confirm the installed copy launches standalone and registers a service worker.",
      "Repeat the critical flows offline with the network disabled.",
    ],
    reason: "no Android device or emulator is available in this environment",
  },
  {
    id: "browser-ios",
    requirement: "iOS Safari/Home Screen PWA where available",
    how: "manual",
    steps: [
      "Open the deployed origin in Safari on iOS and add it to the Home Screen.",
      "Confirm it launches standalone, plays, and survives a background/foreground cycle.",
      "Note: iOS is the platform where a waiting service worker is least likely to activate",
      "promptly, so the update notice in M13's flow is the thing to watch.",
    ],
    reason: "no iOS device or simulator is available in this environment",
  },
  {
    id: "roadmap-truth",
    requirement: "`ROADMAP.md` reflects actual scope and status",
    how: "manual",
    steps: [
      "Compare the status table against `openspec/changes/archive` and the merge history.",
      "Confirm every DONE milestone has its change archived and its specs synced.",
    ],
    reason:
      "checked by hand at each lifecycle stage; the orchestrator owns this file",
  },
  {
    id: "attribution",
    requirement:
      "Attribution notices are included for substantial Lyrix-derived code",
    how: "manual",
    steps: [
      "Read `ATTRIBUTION.md` and confirm its claim matches the repository's history:",
      "concepts were studied and reimplemented, and no Lyrix source was copied.",
      "If code is ever copied or modified rather than reimplemented, add its MIT notice.",
    ],
    reason:
      "a provenance judgement about authorship, not something a check can decide",
  },
];

const results = [];

function run(command, args, cwd, env = {}) {
  const started = Date.now();
  const outcome = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    code: outcome.status ?? 1,
    ms: Date.now() - started,
    output: `${outcome.stdout ?? ""}${outcome.stderr ?? ""}`,
  };
}

/**
 * Set when dependency preparation failed, so the cascade is reported as one failure rather than as
 * every later item failing for a reason that is not the code.
 *
 * This is the diagnostic half of the fix, and it is the half that matters most in practice: the
 * destructive install is gone, but a staged install can still fail, and a reader told "sixteen
 * things are wrong" spends an hour in the wrong place. The reason travels with every skipped item
 * so the first line of output names the real cause.
 */
let environmentBroken = null;

for (const item of ITEMS) {
  // Every item after a failed dependency preparation is reported as not run, with the cause. It is
  // deliberately **not** reported as failed: a missing `tsc` is not a finding about the code, and
  // recording it as one would put a defect in the tally that does not exist.
  if (isShortCircuited(item, environmentBroken)) {
    results.push({
      item,
      status: "NOT RUN",
      detail: `the environment is broken (${environmentBroken}); this item could not have been a meaningful result`,
      steps: [
        `Repair the dependency tree, then re-run the gate. The cause was: ${environmentBroken}`,
      ],
    });
    continue;
  }
  if (item.needsBrowser && SKIP_BROWSER) {
    results.push({
      item,
      status: "SKIPPED",
      detail: "--skip-browser was passed",
      // A skipped item is not a passed one, and the spec asks for the steps. So it carries
      // them: what to run, and what running it would check.
      steps: [
        "Re-run the gate without --skip-browser to perform this check.",
        `Or run it directly: node ${(item.args ?? []).join(" ")}`,
      ],
    });
    continue;
  }
  if (item.how === "manual") {
    results.push({ item, status: "NOT RUN", detail: item.reason });
    continue;
  }
  // An item may discover at run time that it cannot be run here, which is reported the
  // same way a permanently manual item is: as not run, with the reason **and the steps**.
  // The steps come from the item, so a run-time-resolved NOT RUN is as actionable as a
  // hand-written one — the first version carried the reason alone, and the two not-run
  // paths were inconsistent.
  const verdict = item.resolve?.();
  if (verdict?.manual) {
    results.push({
      item,
      status: "NOT RUN",
      detail: verdict.reason,
      steps: item.steps ?? [],
    });
    continue;
  }
  if (item.how === "install") {
    const prepared = prepareDependencies({ frontendDir: FRONTEND });
    if (prepared.ok) {
      results.push({ item, status: "PASS", detail: prepared.detail, output: prepared.output });
    } else {
      // The cascade's value comes from a tested function rather than being spelled here, so the
      // mapping from an install outcome to the reason string is pinned by behaviour instead of by a
      // check that the identifier appears in this file.
      environmentBroken = cascadeReason(prepared);
      results.push({ item, status: "FAIL", detail: prepared.detail, output: prepared.output });
    }
    continue;
  }
  // Any placeholder the item wanted filled in is filled in now, so the command names
  // something real rather than a token.
  const args = verdict?.substitute
    ? item.args.map((value) =>
        value === "__SECOND_ENGINE__" ? verdict.substitute : value,
      )
    : item.args;
  if (item.how === "test") {
    // One vitest file, so a checklist item's result is that item's result rather than a
    // whole suite's. A missing file is a failure, not a skip: the gate must not report a
    // pass for a check that does not exist.
    if (!existsSync(join(FRONTEND, item.test))) {
      results.push({
        item,
        status: "FAIL",
        detail: `no such test file: ${item.test}`,
      });
      continue;
    }
    // The project's own binary rather than `npx`: `npx` resolved a cached vitest in this
    // environment that could not find the workspace's `jsdom` and reported a missing
    // dependency for a suite that passes.
    const outcome = run(
      join(
        FRONTEND,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "vitest.cmd" : "vitest",
      ),
      ["run", item.test],
      FRONTEND,
    );
    const passed = outcome.code === 0;
    const tally = /Tests\s+(\d+) passed/.exec(stripAnsi(outcome.output))?.[1];
    results.push({
      item,
      status: passed ? "PASS" : "FAIL",
      detail: tally ? `${tally} assertions` : "no tally reported",
      output: outcome.output,
    });
    continue;
  }
  // M14's measurement harness writes several files next to itself - `results.json` and its
  // screenshots - and all of them live inside that change's archive.
  //
  // The first version of this guard snapshotted one file, `results.json`, and the second
  // verification pass found the screenshots being overwritten on every run while this
  // change's own evidence README claimed "it never rewrites an archived record". That claim
  // was false for every file but one, which is the same defect as the one being fixed: a
  // stated property the code only half-implemented. So the whole directory is captured and
  // restored.
  //
  // **Scoped to the measurement item alone.** An earlier version of this fix wrapped every
  // command item, which is both wasteful and wrong in intent: `npm ci` has no business
  // touching the archive, and a guard applied everywhere reads as thoroughness rather than
  // as a claim about one specific harness.
  //
  // The guard **fails loudly** if the directory is missing rather than skipping quietly,
  // because a protection that disappears when a path changes is not a protection.
  const guardsArchive = item.id === "accessibility-performance";
  const archive = archivedEvidenceDir();
  if (guardsArchive && !existsSync(archive)) {
    results.push({
      item,
      status: "FAIL",
      detail: `the archived M14 evidence directory is missing at ${archive}, so the gate cannot guarantee it leaves archived material unchanged`,
      output: "",
    });
    continue;
  }
  const archivedBefore = guardsArchive ? snapshot(archive) : null;

  // The repository root goes with every command item, not just the measurement one: all
  // three harnesses find the repository by walking up from their own directory, and archiving
  // moved them all deeper than the walk expects. The end-to-end suite's first symptom was
  // "No production build found" - a message about the build when the fault was the path -
  // and without this it fails in 0.8 seconds having tested nothing.
  const outcome = run(item.command, args, FRONTEND, {
    SPOTIVIBE_REPO: REPO,
    // A per-item environment, so an item that needs its own port or can say so rather than
    // colliding with whatever ran before it.
    ...(item.env ?? {}),
  });

  let archiveNote = "";
  let restored = true;
  if (guardsArchive) {
    // Restore unconditionally, including when the harness threw, and then *verify* the
    // restore. A restore that silently failed would leave the archive damaged while the gate
    // reported a pass.
    const archivedAfter = snapshot(archive);
    const changed = [
      ...new Set([...archivedBefore.keys(), ...archivedAfter.keys()]),
    ].filter(
      (name) => !sameBytes(archivedBefore.get(name), archivedAfter.get(name)),
    );
    if (changed.length > 0) {
      for (const name of archivedAfter.keys()) {
        if (!archivedBefore.has(name))
          rmSync(join(archive, name), { force: true });
      }
      for (const [name, bytes] of archivedBefore) {
        writeFileSync(join(archive, name), bytes);
      }
      // This run's fresh measurement is this change's evidence, kept as a copy rather than
      // left behind in the archive. Only the files the harness actually rewrote are copied:
      // the directory also holds `audit.mjs` and its README, which the run did not touch,
      // and copying those would put two more copies of M14's material in this change.
      mkdirSync(join(HERE, "measurement"), { recursive: true });
      for (const name of changed) {
        const bytes = archivedAfter.get(name);
        if (bytes) writeFileSync(join(HERE, "measurement", name), bytes);
      }
      const verified = snapshot(archive);
      restored =
        verified.size === archivedBefore.size &&
        [...archivedBefore.keys()].every((name) =>
          sameBytes(archivedBefore.get(name), verified.get(name)),
        );
      archiveNote = ` - restored ${changed.length} archived file(s) the harness overwrote`;
    }
    archiveNote += restored ? "" : " - THE RESTORE DID NOT VERIFY";
  }
  results.push({
    item,
    status: outcome.code === 0 && restored ? "PASS" : "FAIL",
    detail: `${(outcome.ms / 1000).toFixed(1)}s${archiveNote}`,
    output: outcome.output,
  });
}

/** M14's archived evidence directory, which this gate must leave byte-for-byte unchanged. */
function archivedEvidenceDir() {
  return join(
    REPO,
    "openspec",
    "changes",
    "archive",
    "2026-09-30-add-deployment-hardening",
    "evidence",
  );
}

/** Every file in a directory, as name to bytes. */
function snapshot(directory) {
  const files = new Map();
  for (const name of readdirSync(directory)) {
    const full = join(directory, name);
    if (statSync(full).isFile()) files.set(name, readFileSync(full));
  }
  return files;
}

/**
 * Byte equality, compared by content and not by identity.
 *
 * The first version of this guard compared two `Buffer` objects with `!==`, which is true
 * for two distinct objects holding identical bytes - so every file always looked changed,
 * every item reported having restored something, and the gate failed on all of them. A
 * guard that cannot tell a change from a non-change is a guard that gets switched off, and
 * this one very nearly was.
 */
function sameBytes(a, b) {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && Buffer.compare(a, b) === 0;
}

function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

const passed = results.filter((entry) => entry.status === "PASS");
const failed = results.filter((entry) => entry.status === "FAIL");
const notRun = results.filter((entry) => entry.status === "NOT RUN");
const skipped = results.filter((entry) => entry.status === "SKIPPED");

const width = Math.max(...ITEMS.map((item) => item.id.length));
console.log("Spotivibe release gate");
console.log("=".repeat(width + 60));
for (const entry of results) {
  const mark =
    entry.status === "PASS"
      ? "PASS   "
      : entry.status === "FAIL"
        ? "FAIL   "
        : `${entry.status.padEnd(6)}`;
  console.log(`${mark} ${entry.item.id.padEnd(width)}  ${entry.detail ?? ""}`);
  console.log(`       ${" ".repeat(width)}  ${entry.item.requirement}`);
  if (entry.status === "NOT RUN") {
    // Every not-run item carries its steps. A NOT RUN with no instruction is an omission
    // wearing a label: the reader is told something was not done and given nothing to do.
    for (const step of entry.steps ?? entry.item.steps ?? [])
      console.log(`         - ${step}`);
  }
}
console.log("=".repeat(width + 60));
console.log(
  `${passed.length} passed, ${failed.length} failed, ${notRun.length} not run` +
    (skipped.length > 0 ? `, ${skipped.length} skipped by flag` : ""),
);
console.log(
  "A NOT RUN item has not passed either. Each one above states what a person must do.",
);

// Every checklist item accounted for, exactly once, **and** every item on the roadmap's
// own release checklist represented by some line above.
//
// The first version of this only checked the gate's own list for duplicates, which is a
// check the gate passes by construction: it cannot detect a checklist item that has no
// line at all, and the roadmap's "Backup format/version documented" had none. So the
// roadmap's checklist is read and each of its items must be covered here. A new checklist
// item with no entry below fails the gate, which is the point — the list cannot grow
// without someone deciding how it is checked.

/** Which gate item covers each roadmap checklist item, and where coverage is partial. */
const CHECKLIST_COVERAGE = [
  { matches: /ROADMAP\.md.*reflects actual scope/i, item: "roadmap-truth" },
  { matches: /DESIGN\.md.*visual audit/i, item: "design-visual-audit" },
  {
    // One line covers this because `tests/release-exclusions.test.ts` now enforces all
    // three halves of it: accounts, cloud sync, and a cloud user database. The first
    // version mapped only the first two and cloud sync had no detector at all, which the
    // coverage check is what surfaced.
    matches: /account\/auth\/cloud-sync/i,
    item: "exclusions",
  },
  { matches: /Supabase\/user database dependencies/i, item: "exclusions" },
  { matches: /YouTube audio downloader/i, item: "exclusions" },
  { matches: /forced background-play/i, item: "exclusions" },
  { matches: /ad-blocking/i, item: "exclusions" },
  { matches: /media is proxied through Vercel/i, item: "exclusions" },
  { matches: /Backup format\/version documented/i, item: "backup-format" },
  { matches: /Attribution notices/i, item: "attribution" },
  { matches: /Vercel production build passes/i, item: "vercel-deploy" },
  { matches: /manifest.*service worker.*validate/i, item: "pwa-manifest" },
  {
    // "automated **and manual**". The automated half is `end-to-end`; the manual half is
    // the three matrix targets this tooling cannot drive, which are reported as NOT RUN
    // above. The first version mapped this line to the automated item alone and carried no
    // `partial` note, so the coverage summary counted it as fully covered — and the
    // `partial` branch that should have said otherwise was dead code, because no entry had
    // the property. A capability advertised and never used is how a reader ends up trusting
    // a count that is wrong.
    matches: /Critical flows pass automated and manual/i,
    item: "end-to-end",
    partial:
      "the automated half is covered; the manual half is the Firefox, Android, and iOS entries above, which are NOT RUN",
  },
];

const ids = results.map((entry) => entry.item.id);
if (new Set(ids).size !== ids.length) {
  console.error("FAIL: an item appears more than once in the output");
  process.exit(1);
}

const roadmapChecklist = readRoadmapChecklist();
if (roadmapChecklist.length === 0) {
  console.error("FAIL: the roadmap's release checklist could not be read");
  process.exit(1);
}

const partialCoverage = [];
const uncovered = [];
for (const line of roadmapChecklist) {
  const coverage = CHECKLIST_COVERAGE.find((entry) => entry.matches.test(line));
  if (!coverage) {
    uncovered.push(`${line} (no gate item covers it)`);
  } else if (!ids.includes(coverage.item)) {
    uncovered.push(`${line} (its gate item "${coverage.item}" is missing)`);
  } else if (coverage.partial) {
    partialCoverage.push(`${line} - ${coverage.partial}`);
  }
}
if (uncovered.length > 0) {
  console.error(
    `FAIL: ${uncovered.length} roadmap checklist item(s) are not represented above:`,
  );
  for (const line of uncovered) console.error(`  - ${line}`);
  process.exit(1);
}
for (const line of partialCoverage) console.log(`  partial: ${line}`);
console.log(
  `  all ${roadmapChecklist.length} roadmap release checklist items are represented above` +
    (partialCoverage.length > 0
      ? `, ${partialCoverage.length} of them only partly.`
      : "."),
);

/** The roadmap's release checklist, read rather than restated here. */
function readRoadmapChecklist() {
  const roadmap = readFileSync(join(REPO, "ROADMAP.md"), "utf8");
  const heading = "### Release Checklist";
  const start = roadmap.indexOf(heading);
  if (start === -1) return [];
  return roadmap
    .slice(start + heading.length)
    .split("\n---")[0]
    .split("\n")
    .filter((line) => line.trimStart().startsWith("- "))
    .map((line) => line.replace(/^\s*-\s*/, "").trim());
}

const report = {
  generatedAt: new Date().toISOString(),
  repo: REPO,
  skipBrowser: SKIP_BROWSER,
  totals: {
    passed: passed.length,
    failed: failed.length,
    notRun: notRun.length,
    skipped: skipped.length,
  },
  items: results.map((entry) => ({
    id: entry.item.id,
    requirement: entry.item.requirement,
    status: entry.status,
    detail: entry.detail ?? null,
    // The reason for a not-run item, whether it was declared manual or discovered at run
    // time. The first version only reported the declared kind, so a run-time NOT RUN was
    // recorded with `reason: null` and `steps: null` — indistinguishable in the JSON from an
    // item nobody had thought about.
    reason:
      entry.status === "NOT RUN"
        ? (entry.detail ?? entry.item.reason ?? null)
        : null,
    steps: entry.steps ?? entry.item.steps ?? null,
  })),
  pass: failed.length === 0,
};
writeFileSync(
  join(HERE, "release-gate.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

if (failed.length > 0) {
  console.error(`\n${failed.length} automated check(s) failed.`);
  for (const entry of failed) {
    console.error(`\n--- ${entry.item.id} ---`);
    console.error(
      stripAnsi(entry.output ?? "")
        .split("\n")
        .slice(-25)
        .join("\n"),
    );
  }
  process.exit(1);
}
process.exit(0);
