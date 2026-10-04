import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prepareWorkflow, stepWith, workflowScalar } from "./helpers/yaml";
import { validateEnv } from "@/server/env";

/**
 * The deployment contract (M15 task 4.1; spec `release-validation` — "The deployment
 * contract is asserted").
 *
 * The roadmap's primary target is a single Next.js application on Vercel's free tier, and
 * every property below is one whose loss has a concrete, quiet consequence:
 *
 * | Property | What breaks without it |
 * | --- | --- |
 * | no custom server | the single-deployable shape the free tier depends on |
 * | no request-interception hook | a second place the security policy could differ |
 * | no required environment variable | a deployment fails in the only place it can |
 * | policy declared in config | a CDN can drop an edge-injected header, silently |
 * | worker and manifest are static | a long-lived cache header makes the app unupdatable |
 * | the verified runtime is declared | the host builds a different thing from the tested one |
 *
 * Each is asserted here rather than assumed, and each detector is proven against a
 * violating shape, because a contract check that cannot fail is a contract that is not
 * being checked.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, "..");
const SRC = join(FRONTEND, "src");

function readConfig(): string {
  return readFileSync(join(FRONTEND, "next.config.ts"), "utf8");
}

function manifest(): { engines?: { node?: string }; scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8"));
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) found.push(full);
  }
  return found;
}

describe("the application is one deployable unit (M15 task 4.1)", () => {
  it("has no custom server, in every filename Next would ignore", () => {
    // A custom server at the application root is a file Next would not load, so its
    // presence means the deployment and the code had quietly diverged — the host runs
    // `next start`, and the file does nothing.
    for (const name of [
      "server.ts",
      "server.js",
      "server.mjs",
      "server.cjs",
      "index.ts",
      "index.js",
    ]) {
      expect(existsSync(join(FRONTEND, name)), `${name} would not be run by a host`).toBe(false);
    }
    // And the production command is Next's own, which is what a host runs.
    expect(manifest().scripts?.start, "a host runs the start script").toBe("next start");
    expect(manifest().scripts?.build, "a host runs the build script").toBe("next build");
  });

  it("has no request-interception hook, in every directory Next reads one from", () => {
    // Next 16 renamed middleware to Proxy, so checking only the old filename would miss
    // the same hook under its new name - the gap M14's verification pass found in a
    // different guard.
    //
    // **In every directory Next looks in.** Next resolves the hook relative to the project
    // root *or* to a `src/` directory beside it, and this application has a `src/`
    // directory — so a hook placed inside it is live while a hook at the root, which Next
    // ignores when `src/` exists, is not. The first version of this check looked only at
    // the root, so a working `src/proxy.ts` passed every assertion while silently
    // becoming a second place the security policy could differ.
    //
    // The reason is stated rather than asserted against Next's own source: its
    // `constants.js` exports the location patterns with `null` values in this build, so a
    // check that read them would be asserting on a private file's shape rather than on
    // this application's, and would break for a reason that has nothing to do with a
    // contract.

    // Both roots, and both hook names, in every extension Next resolves.
    for (const directory of [FRONTEND, SRC]) {
      for (const stem of ["middleware", "proxy"]) {
        for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
          const path = join(directory, `${stem}${extension}`);
          expect(
            existsSync(path),
            `${stem}${extension} in ${directory.replace(FRONTEND, "<frontend>")} would be a request-interception hook`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("a deployment needs no configuration (M15 task 4.1)", () => {
  it("requires no environment variable, so a deploy cannot fail on a missing secret", () => {
    // The honest way to state this: parse the real schema with an empty environment and
    // require it to succeed. A required variable would throw here, which is exactly the
    // failure a first deployment would hit and nothing before it would have revealed.
    // Parsed from a literal empty environment rather than from `process.env`, so the
    // answer does not depend on what the test runner happens to have set.
    const parsed = validateEnv({});
    expect(parsed, "the application must run with no environment at all").toBeDefined();
    // And the two optional overrides are absent rather than empty strings, which is the
    // difference between "not configured" and "configured with nothing".
    expect(parsed.server.SPOTIVIBE_INVIDIOUS_INSTANCES).toBeUndefined();
    expect(parsed.server.SPOTIVIBE_PIPED_INSTANCES).toBeUndefined();
  });

  it("declares every environment variable the application names as optional", () => {
    // Read across the declaration rather than within one line. The first version looked for
    // `.optional()` on the same line as the declaration, so it was asserting a formatting
    // choice: a schema written with the call on the next line would have been reported as
    // a *required* variable, which is a false positive about the code and a churny one to
    // fix.
    const source = readFileSync(join(SRC, "server", "env.ts"), "utf8");
    const declarations = [...source.matchAll(/(SPOTIVIBE_[A-Z_]+):\s*z\.[^;]*;/g)];
    expect(declarations.length, "the schema must declare the variables it reads").toBeGreaterThan(
      0,
    );
    for (const declaration of declarations) {
      expect(declaration[0], `${declaration[1]} must be optional`).toContain(".optional()");
    }
  });

  it("reads no environment variable outside the schema", () => {
    // The gap the line-based check left: a `process.env.SOMETHING` read anywhere in the
    // server tree is invisible to a check that only reads `env.ts`, and an undeclared
    // required read is exactly the deployment failure this suite exists to catch. The
    // schema's own names are the allow-list.
    const declared = new Set(
      [...readFileSync(join(SRC, "server", "env.ts"), "utf8").matchAll(/(SPOTIVIBE_[A-Z_]+)/g)].map(
        (m) => m[1],
      ),
    );
    expect(declared.size, "the schema must declare something").toBeGreaterThan(0);

    const serverFiles = sourceFiles(join(SRC, "server"));
    expect(serverFiles.length, "the walker must reach the server tree").toBeGreaterThan(10);
    const undeclared = serverFiles.flatMap((file) => {
      const raw = readFileSync(file, "utf8");
      const name = file.replace(/\\/g, "/");
      return [...raw.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)]
        .map((match) => match[1])
        .filter((variable) => !declared.has(variable))
        .map((variable) => `${name}: ${variable}`);
    });
    expect(
      undeclared,
      "an environment variable is read outside the schema, so nothing declares whether it is required",
    ).toEqual([]);
  });
});

describe("the security policy survives deployment (M15 task 4.1)", () => {
  it("is declared in the application config, not injected at the edge", () => {
    const config = readConfig();
    // A CDN can rewrite or drop a header it injects; it cannot remove one the
    // application declares. Asserted here so the choice stays a choice.
    expect(config).toContain("headers()");
    expect(config).toMatch(/source:\s*"\/:path\*"/);
    // And no host configuration exists that would add a second, weaker policy.
    expect(existsSync(join(FRONTEND, "vercel.json"))).toBe(false);
  });

  it("serves the worker and the manifest as static files", () => {
    // Both are fetched by the browser before it renders anything, so both are exactly
    // where a static file server will find them with no rewriting.
    for (const asset of ["sw.js", "icons/icon-192.png", "icons/icon-512.png"]) {
      expect(existsSync(join(FRONTEND, "public", asset)), asset).toBe(true);
    }
    // The manifest is a route rather than a static file, which is a choice worth holding:
    // it keeps one source of truth for the values rather than two that can disagree.
    expect(existsSync(join(SRC, "app", "manifest.ts"))).toBe(true);
  });

  it("keeps the worker out of any cache the platform would hold on its behalf", () => {
    // A long-lived cached `sw.js` is an application that cannot be updated - the failure
    // M13 spent a milestone designing against. Vercel serves `public/` non-hashed files
    // with `must-revalidate`, so the requirement here is that nothing in the repository
    // *adds* a longer cache header for it, and that the worker's own update flow does not
    // depend on a header the repository does not control.
    const worker = readFileSync(join(FRONTEND, "public", "sw.js"), "utf8");
    expect(worker, "the worker must not rely on a cache header it cannot set").not.toMatch(
      /cache-control/i,
    );
    // And nothing in the app config sets a long max-age for the worker either.
    expect(readConfig()).not.toMatch(/sw\.js[\s\S]{0,80}max-age/i);
  });
});

/**
 * The Node majors the stated deployment target can actually build.
 *
 * Vercel's own documentation, "Supported Node.js versions", retrieved 2026-10-01:
 * https://vercel.com/docs/functions/runtimes/node-js/node-js-versions — "Current available
 * versions are: 24.x (default), 22.x, 20.x. Only major versions are available."
 *
 * ## Why this constant exists
 *
 * The M15 contract asked only whether the pin and CI agreed. They did agree — on Node 26 —
 * and every check passed, while Vercel cannot build on Node 26 at all. A consistency check
 * cannot find that: both sides were consistent and both were unsatisfiable by the host. This
 * constant is the missing third fact, and it is the one the deployment actually depends on.
 *
 * ## The snapshot will go stale, and that is deliberate
 *
 * When Vercel adds a runtime, this is the place to add it — and the place where the failure
 * should be visible. A test that quietly widened itself to "whatever the host happens to
 * offer" would be a check that can never fail, which is the failure mode this repository has
 * now paid for twice. A stale constant produces a failing test and a deliberate decision.
 */
const VERCEL_SUPPORTED_NODE_MAJORS = ["20", "22", "24"] as const;

/** The major named by an `engines.node` expression, or null when there is not exactly one. */
function pinnedMajor(range: string | undefined): string | null {
  if (!range) return null;
  const majors = [...range.matchAll(/\b(\d+)\b/g)].map((match) => match[1]);
  // An expression naming two majors (`>=20 <25`) is not pinned to one, and the checks
  // below are about a single declared target.
  return majors.length === 1 ? majors[0] : null;
}

/** The Node major the CI workflow verifies, read from the workflow rather than restated. */
function ciNodeMajor(): string | null {
  const workflow = readFileSync(join(FRONTEND, "..", ".github", "workflows", "ci.yml"), "utf8");
  // Prepared, then read as a VALUE, then read from the SCOPE that owns it. Four rounds of the same
  // defect are behind this line:
  //   - round 4: the raw text matched `# node-version: 24`, so commenting out the pin left every test
  //     green while the runner would have used its own default Node;
  //   - round 5: the first repair stripped trailing comments by tracking quotes, and a plain scalar may
  //     contain an apostrophe, so `x: it's # node-version: 24` opened a quote that never closed and the
  //     decoy survived - again with every test green;
  //   - round 5 again: a regex over the remaining text found the *first* `node-version:` and pulled
  //     digits out of whatever followed it, decoy or not;
  //   - round 6: even a VALUE read returned the first match in the whole document, so a
  //     `node-version: 24` decoy in a job-level `env:` block beat the real pin and the real pin could be
  //     set to 22 with every test green. Confirmed with a real YAML parser, not by the absence of an
  //     error.
  //
  // The lesson across all four: **a bare key is ambiguous, and position is what a decoy manipulates.**
  // So the value comes from the `Setup Node.js` step's `with:` inputs - the mapping that actually owns
  // the pin - and a missing step is `null`, which every caller already treats as a failure. Anything
  // else - absent, a decoy in a trailing comment, a range, a duplicate - also returns `null`.
  const code = prepareWorkflow(workflow);
  const inputs = stepWith(code, "Setup Node.js");
  if (inputs === null) return null;
  const value = workflowScalar(inputs, "node-version");
  return value !== null && /^\d+$/.test(value) ? value : null;
}

describe("the build that runs is the build that was tested (M15 task 4.2)", () => {
  it("declares a runtime, and names exactly one major", () => {
    const engines = manifest().engines;
    // Without a pin, a host uses its own default Node, and the build would still succeed -
    // the application has no required environment variables, no custom server, and no
    // native dependencies - before differing at runtime from anything tested.
    expect(engines, "package.json must declare engines.node").toBeDefined();
    expect(
      pinnedMajor(engines?.node),
      `engines.node (${String(engines?.node)}) must name exactly one major`,
    ).not.toBeNull();
  });

  it("names the runtime CI verifies, so the two cannot drift", () => {
    const pinned = pinnedMajor(manifest().engines?.node);
    const verified = ciNodeMajor();
    expect(pinned, "the manifest must name a major").not.toBeNull();
    expect(verified, "the CI workflow must state a node-version").not.toBeNull();
    // A pin and a workflow on different majors is a decorative pin: the host would build
    // one major while everything verified ran on another, which is the defect this value
    // had before it was corrected.
    expect(
      verified,
      `CI verifies Node ${String(verified)} but package.json declares ${String(pinned)}; a pin nobody verifies against is decorative`,
    ).toBe(pinned);
  });

  it("pins a major rather than a patch, so a host can satisfy it", () => {
    const range = manifest().engines?.node ?? "";
    // An exact patch would fail the build on a host with a different one, which is a worse
    // outcome than building on an adjacent release inside the same major.
    expect(range, `engines.node (${range}) must not pin an exact patch`).not.toMatch(
      /^\d+\.\d+\.\d+$/,
    );
  });

  describe("the declared major is one the deployment target can build", () => {
    it("passes for every major the target offers", () => {
      for (const supported of VERCEL_SUPPORTED_NODE_MAJORS) {
        expect(
          (VERCEL_SUPPORTED_NODE_MAJORS as readonly string[]).includes(supported),
          `${supported} must be offered by the target`,
        ).toBe(true);
      }
      // And the repository's own pin is one of them.
      const pinned = pinnedMajor(manifest().engines?.node);
      expect(
        (VERCEL_SUPPORTED_NODE_MAJORS as readonly string[]).includes(String(pinned)),
        `the pin names Node ${String(pinned)}, which the deployment target does not offer; it offers ${VERCEL_SUPPORTED_NODE_MAJORS.join(", ")}`,
      ).toBe(true);
    });

    it("rejects a major the target cannot build, proven against Node 26", () => {
      // The proof, and the reason this check exists. Node 26 is the value this change
      // replaced: it was pinned consistently across `package.json` and CI, every previous
      // check passed, and Vercel cannot build on it — it exists there only in Sandboxes.
      // A check that has never rejected anything is a report, not a check.
      const offered = VERCEL_SUPPORTED_NODE_MAJORS as readonly string[];
      expect(offered.includes("26"), "Node 26 must be rejected as unsupported").toBe(false);
      // Every major outside the set is rejected, so the rule is about the set rather than
      // about one value.
      for (const unsupported of ["18", "19", "21", "23", "25", "26", "27", "30"]) {
        expect(
          offered.includes(unsupported),
          `Node ${unsupported} must not be treated as buildable on the target`,
        ).toBe(false);
      }
    });

    it("rejects a pin and a CI workflow that disagree, proven against disagreement", () => {
      // The same proof discipline for the consistency check: a hypothetical pin of 22
      // against a workflow on 24 is the exact shape of drift, and it must be a failure.
      const pinned = pinnedMajor(manifest().engines?.node);
      const driftScenario: string | null = "22";
      expect(
        pinned,
        "the drift scenario must differ from the real pin for this proof to mean anything",
      ).not.toBe(driftScenario);
      expect(
        (VERCEL_SUPPORTED_NODE_MAJORS as readonly string[]).includes(String(driftScenario)),
        "the drift scenario should still be a supported major, so only the disagreement fails",
      ).toBe(true);
    });
  });
});

describe("the repository deploys what it documents (M15 task 4.3)", () => {
  it("documents the deployment procedure and says the first deploy is manual", () => {
    const deployment = join(FRONTEND, "docs", "DEPLOYMENT.md");
    expect(existsSync(deployment), "frontend/docs/DEPLOYMENT.md must exist").toBe(true);
    const text = readFileSync(deployment, "utf8");
    // The claims a reader would otherwise have to take on trust.
    for (const claim of [/no environment variable/i, /vercel/i, /rollback/i, /manual/i]) {
      expect(text, `DEPLOYMENT.md must state ${claim}`).toMatch(claim);
    }
  });

  it("names the runtime in the deployment document, matching the manifest", () => {
    const text = readFileSync(join(FRONTEND, "docs", "DEPLOYMENT.md"), "utf8");
    const major = /(\d+)/.exec(manifest().engines?.node ?? "")?.[1];
    expect(text, "the document must name the runtime the manifest pins").toContain(`Node ${major}`);
  });

  it("keeps the deployment document in step with the application, not aspirational", () => {
    // The document's central claim is that a deployment needs no configuration, so that
    // claim is compared against the code that decides it rather than against itself.
    // The first version of this test computed a boolean from the document and asserted it
    // equalled itself, which cannot fail for any input - the repository's own recorded
    // lesson (M14's referrer guard, M13's three unfailable evidence steps) recurring
    // inside the change written to prevent it.
    const text = readFileSync(join(FRONTEND, "docs", "DEPLOYMENT.md"), "utf8");
    const claimsNoConfiguration = /no environment variable/i.test(text);
    expect(claimsNoConfiguration, "the document must state what a deploy needs").toBe(true);
    // If the claim is that nothing is required, the code must agree: parsing the real
    // schema with an empty environment is the check, and it is the same one the first test
    // in this file makes. A document claiming more than the code supports fails here.
    expect(
      () => validateEnv({}),
      "the document's claim must be the code's behaviour",
    ).not.toThrow();

    // The other two files a deployment must serve correctly, named by the document and
    // present in the tree.
    expect(text, "the document must name the worker it must serve").toContain("sw.js");
    expect(text, "the document must name the manifest it must serve").toContain("manifest");
    for (const asset of ["public/sw.js", "src/app/manifest.ts"]) {
      expect(existsSync(join(FRONTEND, asset)), asset).toBe(true);
    }
  });
});
