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
import { availableEngines } from "./lib/harness.mjs";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
const FRONTEND = join(REPO, "frontend");
const CHANGE = join(
  REPO,
  "openspec",
  "changes",
  "add-release-validation-and-deployment",
);

const SKIP_BROWSER = process.argv.includes("--skip-browser");

/** One checklist item: what it requires, how it is checked, and what a human must do. */
const ITEMS = [
  {
    id: "gates-install",
    requirement: "`npm ci` installs from the lockfile",
    how: "command",
    command: "npm",
    args: ["ci"],
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
    id: "gates-tests",
    requirement: "`npm test` passes",
    how: "command",
    command: "npm",
    args: ["test"],
  },
  {
    id: "gates-build",
    requirement: "`npm run build` produces a production build",
    how: "command",
    command: "npm",
    args: ["run", "build"],
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
    id: "accessibility-performance",
    requirement:
      "Contrast, names, keyboard reachability, and loading are within the stated targets",
    how: "command",
    command: "node",
    args: [join(CHANGE, "evidence", "audit.mjs")],
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
    id: "browser-second-engine",
    requirement: "The flows also pass in a second browser engine",
    how: "command",
    command: "node",
    args: [join(CHANGE, "evidence", "end-to-end.mjs"), "--browser=second"],
    needsBrowser: true,
    // Resolved at run time, because which engines exist is a property of the machine and
    // not of the repository. When only one is installed this reports NOT RUN with the
    // reason, which is the whole point of the gate: a second-engine run that did not
    // happen must never read as one that did.
    resolve: () => {
      const installed = availableEngines().map((entry) => entry.engine);
      if (installed.length < 2) {
        return {
          manual: true,
          reason: `only one browser engine is installed here (${installed.join(", ") || "none"}); a second-engine run needs a second engine`,
        };
      }
      return null;
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

function run(command, args, cwd) {
  const started = Date.now();
  const outcome = spawnSync(command, args, {
    cwd,
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

for (const item of ITEMS) {
  if (item.needsBrowser && SKIP_BROWSER) {
    results.push({
      item,
      status: "SKIPPED",
      detail: "--skip-browser was passed",
    });
    continue;
  }
  if (item.how === "manual") {
    results.push({ item, status: "NOT RUN", detail: item.reason });
    continue;
  }
  // An item may discover at run time that it cannot be run here, which is reported the
  // same way a permanently manual item is: as not run, with the reason.
  if (item.resolve) {
    const verdict = item.resolve();
    if (verdict?.manual) {
      results.push({ item, status: "NOT RUN", detail: verdict.reason });
      continue;
    }
  }
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
    const outcome = run("npx", ["vitest", "run", item.test], FRONTEND);
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
  const outcome = run(item.command, item.args, FRONTEND);
  results.push({
    item,
    status: outcome.code === 0 ? "PASS" : "FAIL",
    detail: `${(outcome.ms / 1000).toFixed(1)}s`,
    output: outcome.output,
  });
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
    for (const step of entry.item.steps) console.log(`         - ${step}`);
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

// Every checklist item accounted for, exactly once. The gate asserting its own coverage
// is what stops a future item being added to the list and quietly not checked.
const ids = results.map((entry) => entry.item.id);
if (new Set(ids).size !== ids.length) {
  console.error("FAIL: an item appears more than once in the output");
  process.exit(1);
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
    reason: entry.item.how === "manual" ? entry.item.reason : null,
    steps: entry.item.steps ?? null,
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
