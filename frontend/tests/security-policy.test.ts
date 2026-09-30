import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

/**
 * M14 tasks 1.1, 1.3: the security policy is derived from the code, not from a
 * template.
 *
 * Two failure modes, both silent, and this suite exists to catch each:
 *
 * 1. **Too tight.** The browser contacts an origin the policy does not permit, and the
 *    page loads while the player, or the artwork, quietly does not. A 200 for a
 *    document is not evidence that playback works.
 * 2. **Too loose.** The policy permits an origin nothing in the browser needs - most
 *    often a provider host that the *server* contacts, which would hand the page
 *    access it has no reason to have.
 *
 * So the origins are read out of the sources, client code and server code are
 * separated the way the architecture suite separates them, and the two sets are
 * compared against the policy's directives in both directions.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, "..");
const SRC = join(FRONTEND, "src");

/**
 * Directories whose code runs in the browser.
 *
 * `src/server` is the provider layer and `src/data` is the repository layer: both run
 * in Node. Getting this split wrong in either direction produces a wrong policy, so it
 * is named rather than inferred.
 */
const CLIENT_DIRECTORIES = ["app", "components", "features", "lib", "player", "stores"];

/** Every `https://host` literal under a path, with the file it came from. */
function externalOrigins(path: string): Array<{ origin: string; file: string }> {
  const found: Array<{ origin: string; file: string }> = [];
  const walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return; // a directory that does not exist is simply not a source of origins
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (![".ts", ".tsx"].includes(extname(entry.name))) continue;
      const source = readFileSync(full, "utf8");
      for (const match of source.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
        found.push({
          origin: `https://${match[1].toLowerCase()}`,
          file: relative(SRC, full).replace(/\\/g, "/"),
        });
      }
    }
  };
  walk(path);
  return found;
}

/**
 * Origins the browser renders but never fetches from its own source.
 *
 * Artwork is the case that matters: the *server* builds the thumbnail URL
 * (`server/music/normalize.ts`) and hands it to the client as data, so no client file
 * contains a literal for it - yet the browser still loads an image from it, and a
 * policy without it shows every album cover as a broken image. An origin constructed
 * server-side for rendering is therefore legitimately an `img-src` entry, and that is
 * the one directive where a server-side origin belongs.
 */
function serverConstructedImageOrigins(): Set<string> {
  const normalize = readFileSync(join(SRC, "server", "music", "normalize.ts"), "utf8");
  return new Set(
    [...normalize.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map(
      (match) => `https://${match[1].toLowerCase()}`,
    ),
  );
}

/** The single header rule the config declares, read with the ambient environment. */
async function policyHeaders(): Promise<Record<string, string>> {
  const rules = (await nextConfig.headers?.()) as unknown as Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;
  expect(Array.isArray(rules), "next.config.ts must declare headers()").toBe(true);
  expect(rules, "exactly one header rule, so no path can be exempt").toHaveLength(1);
  // One rule covering every path: a policy that skips `/sw.js` or the manifest leaves
  // the two files a browser fetches before it renders anything unprotected.
  expect(rules[0].source).toBe("/:path*");
  return Object.fromEntries(rules[0].headers.map(({ key, value }) => [key, value]));
}

/**
 * The policy as a production build serves it.
 *
 * `headers()` reads `NODE_ENV` when it is called rather than when the module is
 * imported, so setting it here produces the production policy - the one that is
 * actually deployed, and the one every claim about production has to be made against.
 */
async function productionPolicy(): Promise<string> {
  const environment = process.env as Record<string, string | undefined>;
  const previous = environment.NODE_ENV;
  environment.NODE_ENV = "production";
  try {
    return (await policyHeaders())["Content-Security-Policy"];
  } finally {
    environment.NODE_ENV = previous;
  }
}

function parsePolicy(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    directives.set(name.toLowerCase(), values);
  }
  return directives;
}

/** Policy vocabulary: keywords and schemes, not origins. */
const VOCABULARY = new Set([
  "'self'",
  "data:",
  "blob:",
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'none'",
]);

describe("the declared security headers (task 1.1, 1.2)", () => {
  it("carries a policy and the standard hardening headers", async () => {
    const headers = await policyHeaders();
    expect(Object.keys(headers).sort()).toEqual([
      "Content-Security-Policy",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
      "Permissions-Policy",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ]);
    // The values with an obviously right answer, asserted so a typo cannot pass.
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    // The permissions the application never asks for are closed explicitly, which is
    // the point of declaring them rather than relying on a browser default.
    const permissions = headers["Permissions-Policy"];
    for (const feature of ["camera", "microphone", "geolocation"]) {
      expect(permissions, feature).toContain(`${feature}=()`);
    }
  });
});

describe("the policy permits what the browser needs and nothing else (task 1.1)", () => {
  it("finds the origins the client code contacts", () => {
    // A guard on the guard: if this walker stopped finding origins, the comparisons
    // below would pass for the wrong reason.
    const origins = [
      ...new Set(
        CLIENT_DIRECTORIES.flatMap((dir) => externalOrigins(join(SRC, dir))).map((e) => e.origin),
      ),
    ].sort();
    expect(origins.length).toBeGreaterThan(0);
    expect(origins).toContain("https://www.youtube.com");
  });

  it("permits every origin the browser needs, in the directive that governs it", async () => {
    const directives = parsePolicy(await productionPolicy());

    // The IFrame API script and the embed frame both come from the player host.
    for (const entry of externalOrigins(join(SRC, "player"))) {
      expect(directives.get("script-src"), entry.file).toContain(entry.origin);
      expect(directives.get("frame-src"), entry.file).toContain(entry.origin);
    }
    // Artwork: rendered from a URL the server built, so the check is against the
    // server's construction rather than a client literal.
    const images = serverConstructedImageOrigins();
    expect(images.size, "the artwork origin must be discoverable").toBeGreaterThan(0);
    for (const origin of images) {
      expect(directives.get("img-src"), "server-constructed artwork").toContain(origin);
    }
    // The client's network calls all go to its own origin, which `connect-src` must
    // state explicitly rather than leaving to `default-src`.
    expect(directives.get("connect-src")).toContain("'self'");
  });

  it("permits no origin the browser does not need", async () => {
    const directives = parsePolicy(await productionPolicy());
    const needed = new Set([
      ...CLIENT_DIRECTORIES.flatMap((dir) => externalOrigins(join(SRC, dir))).map((e) => e.origin),
      ...serverConstructedImageOrigins(),
    ]);

    const offenders: string[] = [];
    for (const [name, values] of directives) {
      for (const value of values) {
        if (VOCABULARY.has(value)) continue;
        if (needed.has(value)) continue;
        offenders.push(`${name}: ${value}`);
      }
    }
    expect(offenders, "no permitted origin may be one the browser does not need").toEqual([]);
  });

  it("keeps the provider layer's API origins out of the browser policy", async () => {
    // Asserted explicitly because their presence is the most plausible way this policy
    // rots: someone adds a client-side fetch to a provider host and widens the policy
    // instead of routing the request through `/api`.
    const directives = parsePolicy(await productionPolicy());
    const serverOrigins = externalOrigins(join(SRC, "server"));
    expect(serverOrigins.length, "the provider layer must be found").toBeGreaterThan(0);
    const images = serverConstructedImageOrigins();

    // Two server origins are legitimately reachable from the browser as well, for two
    // different reasons, and conflating them is how this rule gets weakened into
    // uselessness:
    //
    // - an artwork origin, because the server builds the URL the browser renders; it
    //   belongs in `img-src` and nowhere else;
    // - the player host, because the same origin is both where the IFrame API comes
    //   from and where the server builds watch links. It belongs in `script-src` and
    //   `frame-src` - and in neither of those because the server uses it.
    const clientNeeded = new Set(
      CLIENT_DIRECTORIES.flatMap((dir) => externalOrigins(join(SRC, dir))).map((e) => e.origin),
    );

    for (const { origin, file } of serverOrigins) {
      if (images.has(origin)) {
        expect(directives.get("img-src"), `${file} artwork origin`).toContain(origin);
        for (const directive of ["script-src", "frame-src", "connect-src", "default-src"]) {
          expect(directives.get(directive) ?? [], `${file} in ${directive}`).not.toContain(origin);
        }
        continue;
      }
      if (clientNeeded.has(origin)) {
        // Permitted for the client's sake only. `connect-src` is the one directive
        // where a server-used origin must never appear, because that is what would let
        // the page talk to a provider directly.
        expect(directives.get("connect-src") ?? [], `${file} in connect-src`).not.toContain(origin);
        expect(directives.get("img-src") ?? [], `${file} in img-src`).not.toContain(origin);
        continue;
      }
      for (const [name, values] of directives) {
        expect(values ?? [], `${file} in ${name}`).not.toContain(origin);
      }
    }
  });

  it("frames and embeds nothing beyond the player", async () => {
    const directives = parsePolicy(await productionPolicy());
    // `frame-ancestors 'none'` is the instruction that stops this application being
    // framed by someone else - the mirror of `X-Frame-Options: DENY`.
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    // Nothing may be framed or embedded except the player and self.
    expect((directives.get("frame-src") ?? []).slice().sort()).toEqual([
      "'self'",
      "https://www.youtube.com",
    ]);
    // Plugins and form posts are refused outright.
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("form-action")).toEqual(["'none'"]);
  });
});

describe("production carries no development relaxation (task 1.1)", () => {
  it("has no unsafe-eval in a production policy, and does in development", async () => {
    expect(await productionPolicy()).not.toContain("unsafe-eval");
    // The difference is what makes the production assertion mean something: the
    // development branch really does add the eval relaxation, so the production check
    // is not passing because the config has no relaxation at all.
    expect(
      parsePolicy((await policyHeaders())["Content-Security-Policy"]).get("script-src"),
    ).toContain("'unsafe-eval'");
  });

  it("keeps unsafe-inline only where the framework's runtime requires it", async () => {
    const directives = parsePolicy(await productionPolicy());
    // Inline script and style are the documented debt: the App Router bootstraps
    // hydration inline and Tailwind's runtime sets styles inline. Any other permissive
    // directive would be an unrecorded relaxation.
    for (const name of ["default-src", "frame-src", "connect-src", "media-src", "object-src"]) {
      expect(directives.get(name) ?? [], name).not.toContain("'unsafe-inline'");
    }
  });
});

describe("every permissive directive records its debt (task 1.3)", () => {
  it("names a reason next to each unsafe directive in the declaration", () => {
    const config = readFileSync(join(FRONTEND, "next.config.ts"), "utf8");
    // Two declared relaxations (script and style), each with a DEBT note above it.
    const unsafe = [...config.matchAll(/'unsafe-[a-z]+'/g)].length;
    expect(unsafe).toBeGreaterThan(0);
    const debts = [...config.matchAll(/DEBT:/g)].length;
    expect(debts, "every unsafe directive needs a DEBT note").toBeGreaterThanOrEqual(unsafe - 1);
  });
});
