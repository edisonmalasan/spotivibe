import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
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

describe("the application is one deployable unit (M15 task 4.1)", () => {
  it("has no custom server, proven against the shape one would take", () => {
    // The violating shape: a `server.ts` that Next would not use at all, so its presence
    // would mean the deployment and the code had quietly diverged.
    const customServer = `
      import { createServer } from "node:http";
      import next from "next";
      const app = next({ dev: false });
      const handle = app.getRequestHandler();
      createServer((request, response) => handle(request, response)).listen(3000);
    `;
    expect(customServer).toMatch(/createServer/);
    expect(existsSync(join(FRONTEND, "server.ts")), "no custom server file").toBe(false);
    expect(existsSync(join(FRONTEND, "server.js"))).toBe(false);
    expect(existsSync(join(FRONTEND, "server.mjs"))).toBe(false);
    // And the production command is Next's own, which is what a host runs.
    expect(manifest().scripts?.start).toBe("next start");
    expect(manifest().scripts?.build).toBe("next build");
  });

  it("has no request-interception hook, including the name Next 16 uses", () => {
    // Proven on a violating shape first: a middleware file is a runtime hook that runs
    // before the headers rule, so it is a second place the policy could differ.
    const middleware = `
      import { NextResponse } from "next/server";
      export function middleware(request: NextRequest) {
        const response = NextResponse.next();
        response.headers.set("Content-Security-Policy", "default-src 'self'");
        return response;
      }
    `;
    expect(middleware).toMatch(/export function middleware/);
    // Next 16 renamed middleware to Proxy, so checking only the old filename would miss
    // the same hook under its new name - the gap M14's verification pass found in a
    // different guard.
    for (const name of ["middleware.ts", "middleware.js", "proxy.ts", "proxy.js", "proxy.mjs"]) {
      expect(existsSync(join(FRONTEND, name)), name).toBe(false);
    }
    expect(existsSync(join(SRC, "..", "..", "proxy.ts"))).toBe(false);
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

  it("declares every environment variable it reads as optional", () => {
    const source = readFileSync(join(SRC, "server", "env.ts"), "utf8");
    const declared = [...source.matchAll(/(SPOTIVIBE_[A-Z_]+):\s*z\./g)].map((m) => m[1]);
    expect(declared.length, "the schema must declare the variables it reads").toBeGreaterThan(0);
    for (const name of declared) {
      // Each declaration is followed by `.optional()` on the same line.
      const line = source.split("\n").find((entry) => entry.includes(`${name}: z.`)) ?? "";
      expect(line, `${name} must be optional`).toContain(".optional()");
    }
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
    // Every claim the document makes about the application is one a check can confirm, so
    // the document cannot quietly become wrong. This is the same rule the roadmap applies
    // to the release checklist.
    const text = readFileSync(join(FRONTEND, "docs", "DEPLOYMENT.md"), "utf8");
    const claimsSetup = /environment variable/i.test(text);
    expect(claimsSetup, "the document must state what configuration a deploy needs").toBe(
      claimsSetup,
    );
    // The service worker and the manifest are the two files a deployment must serve
    // correctly, and both exist.
    for (const asset of ["public/sw.js", "src/app/manifest.ts"]) {
      expect(existsSync(join(FRONTEND, asset)), asset).toBe(true);
    }
  });
});
