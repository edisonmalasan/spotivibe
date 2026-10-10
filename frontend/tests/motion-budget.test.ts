import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MOTION_ALLOWED } from "@/styles/motionTokens";
import {
  CLIENT_BUDGET,
  M20_CLIENT_BUDGET,
  M22_CLIENT_BUDGET,
  M23_CLIENT_BUDGET,
  M29_CLIENT_BUDGET,
  PRE_M19_CLIENT_BUDGET,
  measureClientBundle,
  measureRouteFirstLoad,
  routeFirstLoads,
} from "../scripts/measure-client-bundle.mjs";
import { code, sourceFiles } from "./helpers/motionSource";

/**
 * M19 tasks 5.1–5.3 (spec `performance` — "A motion budget holds the client bundle";
 * spec `motion` — "Motion costs no client JavaScript").
 *
 * The milestone's central decision is that motion is **CSS**, and therefore free. That is
 * only worth something if it is a number, and the number has to be measured the way a CDN
 * serves bytes. `scripts/measure-client-bundle.mjs` is that measurement; this file asserts
 * against it and states the ceiling.
 *
 * **Why the emitted chunks and not the build log.** `next build` under Turbopack prints the
 * route table with **no size columns at all** — an earlier version of this idea assumed it
 * did, and would have read nothing. The emitted `.js` chunks under `.next/static/chunks`
 * are gzipped at level 9, which is what a CDN applies.
 *
 * **A caveat stated rather than hidden.** A build is required for these checks to mean
 * anything, and without one `.next/static/chunks` does not exist, so the measured assertions are
 * **skipped with a printed reason** rather than reported as passes. The assertions that do not need
 * a build — the recorded figure, the manifest rule — run unconditionally, so the "no animation
 * library" half of the decision is enforced on every run.
 *
 * **This paragraph previously said the skip was CI's normal state** — "In CI the suite runs
 * *before* `next build`, so on a cold checkout the measured assertions are skipped". That was true
 * in M19 and M21 changed it, because a budget whose rules skip in CI is not a budget. The build now
 * runs first in `.github/workflows/ci.yml` and in the archived release gate, and
 * `tests/ci-workflow.test.ts` asserts that ordering so it cannot regress.
 *
 * The distinction is kept rather than dropped, because the two causes have opposite remedies. A CI
 * skip meant a pipeline defect; a local skip means you have not run `npm run build`. The count that
 * tells them apart is this file's own: **21 tests** when the size rules ran, **15 passed plus 6
 * skipped** when they did not, and those are indistinguishable from each other at the exit code.
 */

// Keep every literal in a variable — Vite rewrites an inline
// `new URL("...", import.meta.url)` into a non-`file:` URL under the jsdom environment,
// and `fileURLToPath` rejects it.
const motionCssRel = "../src/styles/motion.css";
const frontendRel = "..";
const manifestRel = "../package.json";

const vocabularyCss = readFileSync(fileURLToPath(new URL(motionCssRel, import.meta.url)), "utf8");
const FRONTEND = fileURLToPath(new URL(frontendRel, import.meta.url));

/**
 * A measured build, or `null` when there is none.
 *
 * `null` is reported as a skip, never as a pass: a budget that cannot be measured is a
 * budget nobody checked, and a green run must not be able to claim otherwise.
 */
function measuredBuild(): ReturnType<typeof measureClientBundle> | null {
  try {
    return measureClientBundle(FRONTEND);
  } catch (error) {
    if (error instanceof Error && error.message.includes("no build to measure")) {
      console.warn(
        `[motion budget] SKIPPED: ${error.message} Run \`npm run build\` first; these are measurements, not estimates.`,
      );
      return null;
    }
    throw error;
  }
}

const measured = measuredBuild();

/**
 * The published cost of the `framer-motion` spike, in bytes.
 *
 * The proposal states the spike as **+41.4 kB total**, and the measurement script reports in
 * 1 kB = 1024 B, so this is that figure converted rather than a second measurement. It is
 * derived rather than recorded because it came from a *different* build — the spike branch —
 * and pretending to byte precision across two builds would be the exact kind of invented
 * number this file exists to prevent.
 */
const SPIKE_COST_BYTES = Math.round(41.4 * 1024);

/** The ceiling: the recorded baseline plus its stated headroom. */
const CEILING = CLIENT_BUDGET.totalGzippedBytes + CLIENT_BUDGET.toleranceBytes;

describe("the recorded ceiling is a measurement, not an estimate (task 5.1)", () => {
  it("states the toolchain, the subject, and the route it was measured on", () => {
    // A figure with no provenance is a guess someone wrote down. Three things make it a
    // measurement: what was measured, what measured it, and where.
    expect(CLIENT_BUDGET.subject).toContain(".next/static/chunks");
    expect(CLIENT_BUDGET.toolchain).toContain("Node");
    expect(CLIENT_BUDGET.toolchain).toContain("gzip level 9");
    expect(CLIENT_BUDGET.route).toBe("/");
    expect(CLIENT_BUDGET.method).toContain("gzip");
  });

  it("records the pre-milestone figures this milestone measured before changing anything", () => {
    // Taken from a `next build` of the tree as M19 found it, on 2026-10-03 under Node
    // 24.21.0: 24 emitted chunks, 384,831 bytes gzipped in total, largest 96,644, and
    // `/` first load 227,266 across 12 chunks. These are bytes, so the comparison cannot
    // move when someone rounds.
    //
    // Preserved as its own exported constant and asserted on its own terms: M20 re-recorded the
    // live ceiling, and a record that is overwritten rather than kept is the only evidence that
    // the number ever moved. M19's measurement still has to be right, and the current ceiling
    // still has to be at least it.
    expect(PRE_M19_CLIENT_BUDGET.totalGzippedBytes).toBe(384831);
    expect(PRE_M19_CLIENT_BUDGET.largestChunkGzippedBytes).toBe(96644);
    expect(PRE_M19_CLIENT_BUDGET.chunkCount).toBe(24);
    expect(PRE_M19_CLIENT_BUDGET.homeFirstLoadGzippedBytes).toBe(227266);
    expect(PRE_M19_CLIENT_BUDGET.homeFirstLoadChunkCount).toBe(12);

    expect(CLIENT_BUDGET.totalGzippedBytes).toBeGreaterThanOrEqual(
      PRE_M19_CLIENT_BUDGET.totalGzippedBytes,
    );
    expect(CLIENT_BUDGET.chunkCount).toBeGreaterThanOrEqual(PRE_M19_CLIENT_BUDGET.chunkCount);
  });

  it("states what M20 cost, in bytes, so a re-recorded ceiling is not an unexplained one", () => {
    // The claim being made is specific and checkable: personal-use downloading added first-party
    // code to the client and added no dependency. Both halves are asserted — the size of the move,
    // and that the moved size is nowhere near the cost of the library M19 declined.
    //
    // Asserted against `M20_CLIENT_BUDGET`, M20's own preserved record, rather than against
    // `PRE_M19_CLIENT_BUDGET`: M22 re-recorded the ceiling on top of M20's, and a delta
    // measured from M19 would now report the sum of two milestones' costs and read as
    // though M20 had spent 4,733 bytes. The record is the same one M20 preserved for M19.
    const delta = M20_CLIENT_BUDGET.totalGzippedBytes - PRE_M19_CLIENT_BUDGET.totalGzippedBytes;
    expect(delta, "M20's measured cost in gzipped bytes").toBe(3161);

    // The current ceiling has moved on, and must still sit above M20's record.
    //
    // M20's *chunk count* is the one figure that later milestones moved past in both
    // directions — M22 added one and M23 removed one, landing back on 25. So the
    // comparison here is total bytes only, and the chunk history is asserted per-record
    // below rather than as a chain this test would have to keep re-deriving.
    // The head ceiling names the change that produced it, so a re-record is never
    // unexplained. It has been re-recorded twice since this was written — the onboarding
    // change and then `ps:check` — so the assertion is that the field names *a* change
    // rather than one particular string that each new milestone would have to remember
    // to update. Which change it currently names is asserted by the record's own delta
    // test above, against the record it replaced.
    expect(CLIENT_BUDGET.recordedAt).toMatch(/after /);
    expect(CLIENT_BUDGET.totalGzippedBytes).toBeGreaterThanOrEqual(
      M20_CLIENT_BUDGET.totalGzippedBytes,
    );

    // Inside the headroom the *original* record already allowed, and far below the spike.
    expect(delta).toBeLessThan(CLIENT_BUDGET.toleranceBytes);
    expect(delta * 10, "an animation library remains out of reach by a factor of ten").toBeLessThan(
      SPIKE_COST_BYTES,
    );

    // One new chunk, and one only. A dependency that arrived would not come in ones.
    expect(M20_CLIENT_BUDGET.chunkCount - PRE_M19_CLIENT_BUDGET.chunkCount).toBe(1);
  });

  it("states what M22 cost, in bytes", () => {
    // M22 re-recorded the ceiling, so its move is stated the same way M20's and M19's
    // were: as a measured byte delta against the record it replaced, with the origin
    // of the code asserted rather than assumed.
    const delta = M22_CLIENT_BUDGET.totalGzippedBytes - M20_CLIENT_BUDGET.totalGzippedBytes;
    expect(delta, "M22's measured cost in gzipped bytes").toBe(1580);

    // Same shape M20 recorded: one extra emitted chunk and one extra on `/`. Asserted
    // because it is the part a reader would otherwise have to take on trust.
    expect(M22_CLIENT_BUDGET.chunkCount - M20_CLIENT_BUDGET.chunkCount).toBe(1);
    expect(
      M22_CLIENT_BUDGET.homeFirstLoadChunkCount - M20_CLIENT_BUDGET.homeFirstLoadChunkCount,
    ).toBe(1);

    // Inside the tolerance that existed before any of this, and nowhere near the
    // library the budget exists to keep out — 26 times the whole tolerance.
    expect(delta).toBeLessThan(CLIENT_BUDGET.toleranceBytes);
    expect(
      SPIKE_COST_BYTES / delta,
      "an animation library remains far out of reach",
    ).toBeGreaterThan(10);

    // The origin claim is not asserted here: it is already asserted where it belongs,
    // by "an animation library in the manifest fails the budget (task 5.3)", which reads
    // `dependencies` and `devDependencies` directly. Repeating it would be a second place
    // to keep in step for no additional coverage. What this test adds is the size
    // comparison and the chunk deltas — the numbers M22 actually moved.
  });

  it("states what M23 cost, in bytes, and the direction of the move", () => {
    // M23 *removed* a section, so its delta is negative — and a negative delta is the one
    // shape a stale record hides best: a ceiling left at 389,572 while the bundle sits at
    // 388,571 still passes every ceiling test in this file, because a smaller bundle is
    // inside any budget. Asserting the sign and the exact figure is what makes the
    // re-record a measurement rather than a slack grant.
    const delta = M23_CLIENT_BUDGET.totalGzippedBytes - M22_CLIENT_BUDGET.totalGzippedBytes;
    expect(delta, "M23's measured cost in gzipped bytes").toBe(-1001);

    // Read against `M23_CLIENT_BUDGET` rather than `CLIENT_BUDGET`: the current
    // ceiling has since been re-recorded, and computing M23's delta from the head
    // would silently fold this change's bytes into M23's figure — the same
    // misattribution the next test exists to prevent.
    expect(M23_CLIENT_BUDGET.chunkCount).toBe(M22_CLIENT_BUDGET.chunkCount - 1);
    expect(M23_CLIENT_BUDGET.homeFirstLoadChunkCount).toBe(
      M22_CLIENT_BUDGET.homeFirstLoadChunkCount - 1,
    );

    // The largest chunk did not move, which is what makes this a change in first-party
    // code rather than in a vendor's table of chunk sizes.
    expect(M23_CLIENT_BUDGET.largestChunkGzippedBytes).toBe(
      M22_CLIENT_BUDGET.largestChunkGzippedBytes,
    );

    // The removal is real but bounded: a milestone that deleted the whole feed would
    // satisfy the assertions above, so the size is pinned as well as the direction.
    expect(Math.abs(delta)).toBeLessThan(CLIENT_BUDGET.toleranceBytes);
  });

  it("keeps M22's own record readable, so its cost is not redefined by M23's", () => {
    // The failure this prevents is specific: a reader computing "what did M23 cost" from
    // `PRE_M19_CLIENT_BUDGET` gets 3,740 B, which is M20 *plus* M22 *plus* M23 and reads
    // as though M23 had spent three milestones' budgets. Each record has to hold its own
    // figures for any of those three numbers to mean what it says.
    expect(M22_CLIENT_BUDGET.totalGzippedBytes).toBe(389572);
    expect(M22_CLIENT_BUDGET.largestChunkGzippedBytes).toBe(96667);
    expect(M22_CLIENT_BUDGET.chunkCount).toBe(26);
    expect(M22_CLIENT_BUDGET.homeFirstLoadGzippedBytes).toBe(232135);
    expect(M22_CLIENT_BUDGET.homeFirstLoadChunkCount).toBe(14);
  });

  it("names what the headroom is for, and keeps it far smaller than any real dependency", () => {
    // 4,096 bytes of gzipped headroom. The animation library this decision considered
    // measured **+41.4 kB** — more than ten times the slack — so a ceiling that could absorb
    // one is not a ceiling. See `docs/MOTION.md` for the measurement.
    expect(CLIENT_BUDGET.toleranceBytes).toBe(4096);
    expect(CLIENT_BUDGET.toleranceBytes * 10).toBeLessThan(SPIKE_COST_BYTES);
  });
});

describe("the emitted client bundle is held to the ceiling (task 5.2)", () => {
  it.skipIf(measured === null)("keeps the total gzipped client bundle under the ceiling", () => {
    expect(measured!.totalGzippedBytes).toBeLessThanOrEqual(CEILING);
  });

  it("states what the `ps:check` step cost, in bytes", () => {
    // The largest-chunk rule carries no tolerance, so this change re-recorded the
    // ceiling upward and the move is stated here the same way M20's, M22's, M23's and
    // the onboarding change's were: as a measured delta against the record it replaced.
    // Asserting it is what stops the ceiling being raised again later without anyone
    // noticing.
    const delta =
      CLIENT_BUDGET.largestChunkGzippedBytes - M29_CLIENT_BUDGET.largestChunkGzippedBytes;
    expect(delta, "the largest chunk's measured cost in gzipped bytes").toBe(20);

    // Next.js inlines the whole of `frontend/package.json` into the client bundle, so the
    // added script entry is the entire cost. Pinned rather than described: if a future
    // change reaches the client by the same route, the number moves and this fails.
    expect(
      CLIENT_BUDGET.totalGzippedBytes - M29_CLIENT_BUDGET.totalGzippedBytes,
      "the total moved by the same amount as the largest chunk",
    ).toBe(20);

    // The count did not move, and neither did any route's first load, so this is a string
    // inside the existing graph rather than a new chunk arriving — which is the shape a
    // dependency takes, and the rule that would catch it.
    expect(CLIENT_BUDGET.chunkCount - M29_CLIENT_BUDGET.chunkCount).toBe(0);
    expect(CLIENT_BUDGET.homeFirstLoadChunkCount - M29_CLIENT_BUDGET.homeFirstLoadChunkCount).toBe(
      0,
    );
    expect(CLIENT_BUDGET.homeFirstLoadGzippedBytes).toBe(
      M29_CLIENT_BUDGET.homeFirstLoadGzippedBytes,
    );

    // 20 bytes is under a fiftieth of the pre-existing tolerance, and nowhere near the
    // library the budget exists to keep out.
    expect(delta).toBeLessThan(CLIENT_BUDGET.toleranceBytes);
    expect(
      SPIKE_COST_BYTES / delta,
      "an animation library remains far out of reach",
    ).toBeGreaterThan(10);
  });

  it("keeps M23's own record readable, so its cost is not redefined by later ceilings", () => {
    // M23's *largest chunk* did not move against M22 — M23 removed a chunk and shrank
    // another, and it is the total that fell. Its total delta is therefore −25, and it has
    // to be read from M23's preserved record rather than from the live ceiling, which has
    // since been re-recorded twice and would fold both later changes' bytes into M23's.
    expect(M23_CLIENT_BUDGET.largestChunkGzippedBytes).toBe(
      M22_CLIENT_BUDGET.largestChunkGzippedBytes,
    );
    expect(M23_CLIENT_BUDGET.totalGzippedBytes - M22_CLIENT_BUDGET.totalGzippedBytes).toBe(-1001);
    expect(M23_CLIENT_BUDGET.chunkCount).toBe(M22_CLIENT_BUDGET.chunkCount - 1);

    // The onboarding change, not M23, is what moved the largest chunk by 803. Asserting it
    // here against the record it replaced is what keeps the two costs from being swapped.
    expect(
      M29_CLIENT_BUDGET.largestChunkGzippedBytes - M23_CLIENT_BUDGET.largestChunkGzippedBytes,
    ).toBe(803);
  });

  it.skipIf(measured === null)("keeps the largest single chunk under the recorded figure", () => {
    expect(measured!.largestChunkGzippedBytes).toBeLessThanOrEqual(
      CLIENT_BUDGET.largestChunkGzippedBytes,
    );
  });

  it.skipIf(measured === null)("adds no chunk: the count is a measurement too", () => {
    // The `framer-motion` spike added exactly one chunk. A chunk-count assertion catches
    // that shape even if the total happened to compress well.
    expect(measured!.chunkCount).toBeLessThanOrEqual(CLIENT_BUDGET.chunkCount);
  });

  it.skipIf(measured === null)("holds Home's first load under the recorded figure", () => {
    // `/` is emitted as `index.html` by this build — the route table's naming is not
    // uniform (`/discover` is `discover.html`), which is why the document is named here
    // rather than derived.
    const home = measureRouteFirstLoad(FRONTEND, "index.html");
    expect(home.chunkCount).toBeLessThanOrEqual(CLIENT_BUDGET.homeFirstLoadChunkCount);
    expect(home.totalGzippedBytes).toBeLessThanOrEqual(
      CLIENT_BUDGET.homeFirstLoadGzippedBytes + CLIENT_BUDGET.toleranceBytes,
    );
  });

  it.skipIf(measured === null)(
    "costs a shared chunk once per route, because each visit pays for it",
    () => {
      // Spec `performance`: a chunk two routes load is counted in *each* route's total, not
      // once globally. Asserted by finding a chunk that appears in two routes' figures.
      const routes = routeFirstLoads(FRONTEND);
      const shared = new Map<string, number>();
      for (const route of routes as Array<{
        route: string;
        totalGzippedBytes: number;
        chunkCount: number;
        perChunk: Array<{ file: string; gzippedBytes: number }>;
      }>) {
        for (const chunk of route.perChunk) {
          shared.set(chunk.file, (shared.get(chunk.file) ?? 0) + 1);
        }
      }
      const twiceOrMore = [...shared.values()].filter((count) => count >= 2);
      expect(twiceOrMore.length, "routes really do share chunks").toBeGreaterThan(0);
      // And the deduplicated union is strictly smaller than the sum, which is exactly why
      // summing would understate what a listener downloads.
      const sum = (routes as Array<{ totalGzippedBytes: number }>).reduce(
        (total: number, route) => total + route.totalGzippedBytes,
        0,
      );
      expect(sum).toBeGreaterThan(measured!.totalGzippedBytes);
    },
  );

  it.skipIf(measured === null)("accounts for every emitted chunk in the total", () => {
    // Guards the measurement itself: a walker that silently missed a directory would report
    // a smaller, more flattering total and every ceiling above would be satisfied by it.
    const summed = (measured!.perChunk as Array<{ gzippedBytes: number }>).reduce(
      (total: number, chunk) => total + chunk.gzippedBytes,
      0,
    );
    expect(summed).toBe(measured!.totalGzippedBytes);
    expect(measured!.perChunk).toHaveLength(CLIENT_BUDGET.chunkCount);
  });
});

describe("an animation library in the manifest fails the budget (task 5.3)", () => {
  /**
   * The rule the decision depends on, written so it is checked against a **parsed
   * manifest** rather than a grep of the file: a test that reads `package.json` as text can
   * be satisfied by a dependency list that no npm ever read.
   */
  const ANIMATION_LIBRARIES = [
    "framer-motion",
    "motion",
    "motion-dom",
    "motion-utils",
    "gsap",
    "animejs",
    "anime",
    "@react-spring/web",
    "@react-spring/animated",
    "react-spring",
    "react-transition-group",
    "react-motion",
    "popmotion",
    "auto-animate",
    "velocity-animate",
    "lottie-web",
    "react-lottie",
  ] as const;

  /** A manifest, parsed — the shape a package manager would install from. */
  function manifest(overrides: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }): { dependencies: Record<string, string>; devDependencies: Record<string, string> } {
    return {
      dependencies: overrides.dependencies ?? {},
      devDependencies: overrides.devDependencies ?? {},
    };
  }

  /** Every animation library a parsed manifest declares, in either section. */
  function animationLibraries(parsed: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  }): string[] {
    const names = [...Object.keys(parsed.dependencies), ...Object.keys(parsed.devDependencies)];
    return names.filter((name) => (ANIMATION_LIBRARIES as readonly string[]).includes(name));
  }

  it("declares none today, in either section", () => {
    const parsed = JSON.parse(
      readFileSync(fileURLToPath(new URL(manifestRel, import.meta.url)), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(animationLibraries(manifest(parsed))).toEqual([]);
  });

  it("fails the budget the moment one appears — in dependencies or in devDependencies", () => {
    // The half of the decision that has to run on every invocation, build or no build. The
    // spike measured `framer-motion` at **+41.4 kB gzipped** — more than ten times the
    // ceiling's headroom — so the manifest rule and the size rule agree; whichever fires
    // first, adding the library cannot be done quietly.
    for (const library of ANIMATION_LIBRARIES) {
      for (const section of ["dependencies", "devDependencies"] as const) {
        const found = animationLibraries(manifest({ [section]: { [library]: "1.0.0" } }));
        expect(found, `${section}.${library} must be reported as a budget violation`).toContain(
          library,
        );
      }
    }
    // And the whole list is longer than the application's own dependency set, so a library
    // is recognised whether it is spelled the common way or an alias of it.
    expect(ANIMATION_LIBRARIES.length).toBeGreaterThan(Object.keys(ANIMATION_LIBRARIES).length / 2);
  });

  it("would be caught by the size rule too, not only by name", () => {
    // A dependency not on the list — a fork, a renamed package — slips past the manifest
    // rule, which is why the measured ceiling exists at all. The two rules are independent,
    // and this states which one catches what.
    expect(SPIKE_COST_BYTES).toBeGreaterThan(CLIENT_BUDGET.toleranceBytes * 10);
    expect(CLIENT_BUDGET.totalGzippedBytes + SPIKE_COST_BYTES).toBeGreaterThan(CEILING);
  });

  it("imports no animation library from any source file", () => {
    // The other half of "no `framer-motion`": a library that is installed but never
    // imported would measure zero and prove nothing. That is not hypothetical — it is why
    // the M19 spike deliberately *rendered* the library from `HomeView`, so the number it
    // produced was a number about the shipped application.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (!file.path.endsWith(".ts") && !file.path.endsWith(".tsx")) continue;
      for (const match of code(file.source).matchAll(/(?:from|import)\s+["']([^"']+)["']/g)) {
        const specifier = match[1] ?? "";
        if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
        const bare = specifier.replace(/^@\//, "").split("/")[0] ?? "";
        const packageName = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : bare;
        if ((ANIMATION_LIBRARIES as readonly string[]).includes(packageName)) {
          offenders.push(`${file.path}: ${specifier}`);
        }
      }
    }
    expect(offenders, "no animation library may be imported").toEqual([]);
  });
});

describe("the motion itself is CSS, and costs no JavaScript of its own", () => {
  it("declares every duration, easing, and travel distance as a custom property", () => {
    // The reason the budget holds: a duration is a string in a stylesheet, not a number in
    // a bundle. Asserted on the stylesheet the application actually imports.
    expect(vocabularyCss).toContain("--motion-feedback:");
    expect(vocabularyCss).toContain("--motion-reveal:");
    expect(vocabularyCss).toContain("--motion-surface:");
    // And no class writes a duration longhand, which is what would put a number back into a
    // component's own stylesheet and start the drift the vocabulary exists to end.
    expect(vocabularyCss).not.toMatch(/transition-duration:\s*\d/);
    expect(vocabularyCss).not.toMatch(/animation-duration:\s*\d/);
  });
});

describe("the evidence file carries the decision and what would reverse it (task 5.4)", () => {
  // Written evidence is only evidence if something checks it. The numbers in
  // `docs/MOTION.md` are asserted against the recorded budget, so the file cannot quietly
  // start claiming a smaller cost than the build shows.
  const evidenceRel = "../docs/MOTION.md";
  const evidence = readFileSync(fileURLToPath(new URL(evidenceRel, import.meta.url)), "utf8");

  it("carries the before/after table, with both totals", () => {
    expect(evidence).toContain("375.8 kB");
    expect(evidence).toContain("417.2 kB");
    expect(evidence).toContain("+41.4 kB");
    expect(evidence).toContain("+41.5 kB");
    expect(evidence).toContain("263.4 kB");
    expect(evidence).toMatch(/18\.7%/);
    // This milestone's own cost, measured rather than asserted.
    expect(evidence).toContain("385,238 B");
    expect(evidence).toContain("384,831 B");
  });

  it("states the milestone's own cost as the difference of the two totals it recorded", () => {
    // **The two figures were contradicting each other and nothing noticed.** The table said
    // `+407 B` and the paragraph below it said "the 406 bytes are the `Dialog` primitive's
    // leave lifecycle", in a file whose whole purpose is that its numbers are measurements.
    // 385,238 − 384,831 is 407, so the *difference* is the authority here and the prose is
    // asserted against it — which means the two cannot drift apart again, and neither can
    // drift from the recorded baseline without this failing.
    const measuredAfterM19 = 385238;
    // Anchored on M19's own preserved record, not on the live ceiling. M20 re-recorded
    // `CLIENT_BUDGET`, so reading the baseline off it would have quietly redefined what M19 cost.
    const delta = measuredAfterM19 - PRE_M19_CLIENT_BUDGET.totalGzippedBytes;
    expect(delta, "the recorded totals must actually differ by the published figure").toBe(407);
    expect(evidence).toContain(`+${delta} B`);
    expect(evidence, "the prose must name the same number the table publishes").toMatch(
      new RegExp(`\\b${delta}\\b\\s+bytes\\b`),
    );
    // And no *other* three-digit byte figure is published as this milestone's cost, which is
    // the exact shape the contradiction took: a correct table beside a wrong sentence.
    expect(evidence, "and must not publish a different one anywhere").not.toMatch(
      new RegExp(`\\b(?!${delta}\\b)4\\d\\d\\s+bytes\\b`),
    );
  });

  it("counts the named surfaces from the contract rather than from memory", () => {
    // The same class of drift, in words: the file said "the six the roadmap lists" while
    // `MOTION_ALLOWED` carries five. Read from the contract, so the prose cannot disagree
    // with the thing it is describing — and matched in words, because that is how the
    // sentence reads.
    const NUMBER_WORDS = [
      "zero",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
    ];
    const surfaces = new Set([...MOTION_ALLOWED.values()].map((allowance) => allowance.surface));
    expect(surfaces.size, "the five named surfaces").toBe(5);
    expect(evidence).toContain(`the ${NUMBER_WORDS[surfaces.size]} the roadmap lists`);
  });

  it("carries the reversal conditions, so the decision is reversible on evidence", () => {
    expect(evidence).toMatch(/What would reverse this/i);
    expect(evidence).toMatch(/spring/i);
    expect(evidence).toMatch(/gesture/i);
    expect(evidence).toMatch(/interruptible/i);
  });

  it("records every re-recording of the ceiling, in bytes", () => {
    // The evidence file has to carry every later re-recording too, or the budget's whole claim —
    // that its numbers are measurements rather than intentions — stops holding at the moment a
    // feature moves them. Read from the constants, so the prose cannot claim a different cost.
    //
    // Each delta is measured against the record it replaced. A delta taken from the oldest
    // record would report the sum of several milestones and read as though M20 had spent the
    // others' money, which is the specific error this change had to avoid introducing.
    const m20 = M20_CLIENT_BUDGET.totalGzippedBytes - PRE_M19_CLIENT_BUDGET.totalGzippedBytes;
    const m22 = M22_CLIENT_BUDGET.totalGzippedBytes - M20_CLIENT_BUDGET.totalGzippedBytes;
    // Read against M23's own preserved record, not against the live ceiling: the
    // ceiling has been re-recorded since, so measuring M23 from `CLIENT_BUDGET`
    // would fold this change's bytes into M23's published figure.
    const m23 = M23_CLIENT_BUDGET.totalGzippedBytes - M22_CLIENT_BUDGET.totalGzippedBytes;
    // The onboarding change's own *total* delta, which is a slight reduction. Measured
    // against the record it actually replaced, which after this change is M29's rather
    // than the live ceiling — the same misattribution the comment above describes.
    const onboarding = M29_CLIENT_BUDGET.totalGzippedBytes - M23_CLIENT_BUDGET.totalGzippedBytes;

    expect(evidence, "M20's cost is published").toContain(`+${m20.toLocaleString("en-US")} B`);
    expect(evidence, "M22's cost is published").toContain(`+${m22.toLocaleString("en-US")} B`);
    // M23's is a reduction, so it is published with a minus and matched as one. Asserting
    // it as `+${...}` would pass only if the prose lied about the direction, and asserting
    // the bare figure would pass on either sign.
    expect(evidence, "M23's saving is published with its sign").toContain(
      `−${Math.abs(m23).toLocaleString("en-US")} B`,
    );
    // Same for this one. Its *total* fell by 25 bytes because the deleted language
    // picker was larger than the artist picker replacing it — but its largest chunk
    // grew by 803, which is the figure that actually forced the re-record and is
    // published separately so neither number hides the other.
    expect(evidence, "onboarding's total is published with its sign").toContain(
      `−${Math.abs(onboarding).toLocaleString("en-US")} B`,
    );
    expect(evidence, "onboarding's largest-chunk growth is published").toContain(
      `+${(M29_CLIENT_BUDGET.largestChunkGzippedBytes - M23_CLIENT_BUDGET.largestChunkGzippedBytes).toLocaleString("en-US")} B`,
    );

    // This change's own delta, published like every other re-recording's, so the evidence
    // cannot stay silent about a ceiling it raised.
    const psCheck =
      CLIENT_BUDGET.largestChunkGzippedBytes - M29_CLIENT_BUDGET.largestChunkGzippedBytes;
    expect(evidence, "the ps:check step's cost is published").toContain(
      `+${psCheck.toLocaleString("en-US")} B`,
    );

    // All six records, so the history is readable rather than overwritten.
    for (const record of [
      PRE_M19_CLIENT_BUDGET,
      M20_CLIENT_BUDGET,
      M22_CLIENT_BUDGET,
      M23_CLIENT_BUDGET,
      M29_CLIENT_BUDGET,
      CLIENT_BUDGET,
    ]) {
      expect(evidence).toContain(record.totalGzippedBytes.toLocaleString("en-US"));
    }

    // …and the reason it is a figure the ceiling can absorb: no client dependency was added.
    expect(evidence).toMatch(/dynamic `import\(\)`|dynamic import/i);
    expect(evidence).toContain("@distube/ytdl-core");
  });

  it("carries the method and the toolchain the numbers were taken with", () => {
    expect(evidence).toContain("scripts/measure-client-bundle.mjs");
    expect(evidence).toMatch(/level 9/i);
    expect(evidence).toMatch(/Turbopack/);
    // And the measurement gap, stated rather than hidden.
    expect(evidence).toMatch(/No transition was seen/i);
    expect(evidence).toMatch(/Deployment Protection/);
    expect(evidence).toMatch(/prefers-reduced-motion/);
  });
});
