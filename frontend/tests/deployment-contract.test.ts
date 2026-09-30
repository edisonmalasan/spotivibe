import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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

describe("the build that runs is the build that was tested (M15 task 4.2)", () => {
  it("declares the runtime this repository is verified on", () => {
    const engines = manifest().engines;
    // Without this, a Vercel build uses the host's default Node rather than the Node 26
    // CI verifies, and it would still succeed - the application has no required
    // environment variables, no custom server, and no native dependencies - and then
    // differ at runtime from anything tested.
    expect(engines, "package.json must declare engines.node").toBeDefined();
    expect(engines?.node, "the pin must name Node 26").toContain("26");
  });

  it("pins a range rather than a single patch, so a host can satisfy it", () => {
    const range = manifest().engines?.node ?? "";
    // An exact patch would make the build fail on a host that has a different one, which
    // is a worse outcome than building on an adjacent release inside the same major.
    expect(range).toMatch(/>=\d+/);
    expect(range).toMatch(/<\d+/);
  });

  it("names the runtime CI verifies, so the two cannot drift", () => {
    const workflow = readFileSync(join(FRONTEND, "..", ".github", "workflows", "ci.yml"), "utf8");
    const major = /(\d+)/.exec(manifest().engines?.node ?? "")?.[1];
    expect(major, "the pin must name a major version").toBeDefined();
    expect(workflow, "CI must verify the major version the pin names").toContain(
      `node-version: ${major}`,
    );
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
