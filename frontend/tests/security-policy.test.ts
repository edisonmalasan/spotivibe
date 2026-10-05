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

/**
 * Provider hosts that serve artwork to the browser by proxying it.
 *
 * These are permitted in `img-src` and nowhere else. They are listed here, separately
 * from the fixture-derived origins, for the one case fixtures cannot cover: the second
 * default Invidious instance. Whichever instance answers a request returns proxied
 * thumbnails from its own host, so both must be permitted even though the captured
 * fixtures happen to record only one of them.
 *
 * Each entry is asserted below to be either a captured-fixture artwork origin or a
 * member of a provider's `DEFAULT_INSTANCES` list, so this cannot become a place to
 * grant access to an arbitrary host.
 */
const PROXY_ARTWORK_ORIGINS = ["https://invidious.f5.si", "https://yewtu.be"];

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
 * Artwork is the case that matters, and it is where this function previously failed
 * the whole suite for a year. Artwork reaches the browser as *data*: the server builds
 * a fallback URL (`server/music/normalize.ts`) and passes every provider URL through
 * verbatim, so no client or server file contains a literal for the host the providers
 * actually return. Yet the browser still loads an image from it, and a policy without
 * it shows every artist photo as a broken image — which is exactly what shipped.
 *
 * So the origins are taken from **two** places, and both are necessary:
 *
 * 1. the fallback URL our own code constructs, and
 * 2. the artwork hosts present in the **captured provider fixtures**.
 *
 * The second source is the one that matters and the one that was missing. A detector
 * built only from source text is structurally incapable of observing an origin that
 * arrives as opaque provider data, so its green result is not evidence about artwork
 * at all. `tests/fixtures/providers/` is where the truth lives: those files are real
 * provider payloads, and the artwork URLs in them are what production really requests.
 */
function serverConstructedImageOrigins(): Set<string> {
  const normalize = readFileSync(join(SRC, "server", "music", "normalize.ts"), "utf8");
  return new Set(
    [...normalize.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map(
      (match) => `https://${match[1].toLowerCase()}`,
    ),
  );
}

/**
 * The JSON keys the providers read artwork from.
 *
 * Named rather than inferred, because the difference between them is the difference
 * between a necessary policy entry and an unnecessary grant of access:
 *
 * - `videoThumbnails` — Invidious (`providers/invidious.ts`), an array of
 *   `{ url, width, height }`.
 * - `thumbnails` — the Innertube renderers (`providers/ytmusic.ts`,
 *   `providers/ytweb.ts`), nested under a `thumbnail` renderer.
 * - `thumbnail` — Piped (`providers/piped.ts`), a bare URL string.
 *
 * **Not** `authorThumbnails`, which the Invidious fixtures carry 380+ times. Those are
 * channel avatars that Spotivibe's normalizers never read, so those URLs never reach
 * the browser and their host must stay out of the policy. A detector that swept every
 * URL in every fixture would have permitted `yt3.ggpht.com` on the strength of data
 * this application discards — which is the "too loose" failure this suite exists to
 * prevent, arriving through the very detector meant to prevent it.
 */
const ARTWORK_KEYS = new Set(["videoThumbnails", "thumbnails", "thumbnail"]);

/** Every `https://host` origin in a URL-ish string. */
function originsIn(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
      into.add(`https://${match[1].toLowerCase()}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) originsIn(item, into);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) originsIn(nested, into);
  }
}

/**
 * Artwork origins present in the captured provider fixtures, read from the keys the
 * providers actually extract.
 *
 * This is the source that was missing when production shipped a policy refusing every
 * artist image. Artwork reaches the browser as data, so no file in `src/` contains a
 * literal for the host the providers return; the captured payloads do, and those are
 * what production really requests.
 */
function fixtureImageOrigins(): Set<string> {
  const directory = join(FRONTEND, "tests", "fixtures", "providers");
  const origins = new Set<string>();
  let files = 0;
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (ARTWORK_KEYS.has(key)) originsIn(value, origins);
      else walk(value);
    }
  };
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || extname(entry.name) !== ".json") continue;
    files += 1;
    walk(JSON.parse(readFileSync(join(directory, entry.name), "utf8")));
  }
  // A scan that silently found nothing would make every assertion below vacuous, so
  // the corpus itself is asserted: no fixtures, or no artwork in them, means the
  // detector has stopped detecting rather than that the policy is correct.
  expect(
    files,
    "captured provider fixtures must be present to derive artwork origins",
  ).toBeGreaterThan(0);
  expect(
    origins.size,
    "captured provider fixtures must contain artwork URLs to derive origins from",
  ).toBeGreaterThan(0);
  return origins;
}

/** Every declared header rule, in the order Next.js applies them. */
async function headerRules(): Promise<
  Array<{ source: string; headers: Array<{ key: string; value: string }> }>
> {
  const rules = (await nextConfig.headers?.()) as unknown as Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;
  expect(Array.isArray(rules), "next.config.ts must declare headers()").toBe(true);
  return rules;
}

/**
 * The headers a request to `path` actually receives.
 *
 * Next.js applies every matching rule in declaration order and the **last** value wins
 * for a given header key. That is the behaviour the `/sw.js` rule depends on, so this
 * helper reproduces it rather than assuming which order is right - and the ordering is
 * asserted separately below, because getting it backwards produces a silently
 * overwritten header rather than an error.
 *
 * Only the two source patterns this config uses are matched: the `/:path*` catch-all
 * and an exact path. A third pattern would need real path-to-regexp here, and would
 * also be a change worth a test of its own.
 */
function effectiveHeaders(
  rules: Array<{ source: string; headers: Array<{ key: string; value: string }> }>,
  path: string,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const rule of rules) {
    const matches = rule.source === "/:path*" || rule.source === path;
    if (!matches) continue;
    for (const { key, value } of rule.headers) resolved[key] = value;
  }
  return resolved;
}

/** The document's headers: the catch-all, with no `/sw.js` exemption applying to it. */
async function policyHeaders(): Promise<Record<string, string>> {
  return effectiveHeaders(await headerRules(), "/");
}

/**
 * The policy as a production build serves it.
 *
 * `headers()` reads `NODE_ENV` when it is called rather than when the module is
 * imported, so setting it here produces the production policy - the one that is
 * actually deployed, and the one every claim about production has to be made against.
 */
async function productionPolicy(): Promise<string> {
  return (await productionHeadersFor("/"))["Content-Security-Policy"];
}

/**
 * The headers `path` receives from a **production** build.
 *
 * Comparing the worker's policy against the document's is only meaningful if both come
 * from the same environment: `script-src` gains `unsafe-eval` outside production, so
 * reading the worker policy under the ambient test environment and the document policy
 * under production compares two different things and fails on `script-src` for a reason
 * that has nothing to do with the worker.
 */
async function productionHeadersFor(path: string): Promise<Record<string, string>> {
  const environment = process.env as Record<string, string | undefined>;
  const previous = environment.NODE_ENV;
  environment.NODE_ENV = "production";
  try {
    return effectiveHeaders(await headerRules(), path);
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
    // `strict-origin-when-cross-origin`, not the fully suppressive value: the `playback`
    // spec of record requires that the player does not suppress the page referrer, and
    // the architecture suite enforces that across this config as well as across `src`.
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
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
    // Artwork: rendered from URLs the server built *or* passed through from a
    // provider, so the check is against both the server's construction and the
    // captured provider payloads rather than a client literal.
    const images = new Set([...serverConstructedImageOrigins(), ...fixtureImageOrigins()]);
    expect(images.size, "the artwork origin must be discoverable").toBeGreaterThan(0);
    for (const origin of images) {
      expect(directives.get("img-src"), "provider-supplied artwork").toContain(origin);
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
      ...fixtureImageOrigins(),
      ...PROXY_ARTWORK_ORIGINS,
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
    // **M23.** A provider host can also be a genuine browser *image* origin without
    // being constructed by our code: `providers/invidious.ts` and
    // `providers/piped.ts` return proxied thumbnails pointing at the instance itself,
    // so the browser fetches images from a provider host. Those hosts belong in
    // `img-src` — and still nowhere else, which is what the loop below now pins.
    const providerArtwork = fixtureImageOrigins();

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
      if (
        images.has(origin) ||
        providerArtwork.has(origin) ||
        PROXY_ARTWORK_ORIGINS.includes(origin)
      ) {
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

  it("permits the artwork origin real provider payloads actually use", async () => {
    // M23 regression, stated as its own test because the general assertions above
    // would also have passed while this defect shipped: they read artwork origins
    // from source text, and these hosts never appear in source text.
    //
    // With them absent from `img-src` the policy refuses the images, and the page
    // renders broken artist photos while every status code stays 200.
    const directives = parsePolicy(await productionPolicy());
    const fromFixtures = [...fixtureImageOrigins()];
    for (const origin of ["https://yt3.googleusercontent.com", "https://yt3.ggpht.com"]) {
      expect(
        fromFixtures,
        "the captured fixtures must still carry the artwork host, or this test is vacuous",
      ).toContain(origin);
      expect(directives.get("img-src"), origin).toContain(origin);
    }
  });

  it("permits a proxied-artwork provider host only with evidence for it", () => {
    // `PROXY_ARTWORK_ORIGINS` exists for the one case fixtures cannot cover: the second
    // default Invidious instance. It is the one place this suite could be talked into
    // granting image access to an arbitrary host, so each entry must be justified by
    // either a captured payload or a provider's own default instance list.
    const providers = readFileSync(
      join(SRC, "server", "music", "providers", "invidious.ts"),
      "utf8",
    );
    const fromFixtures = fixtureImageOrigins();
    for (const origin of PROXY_ARTWORK_ORIGINS) {
      const inFixtures = fromFixtures.has(origin);
      const inDefaults = providers.includes(origin);
      expect(
        inFixtures || inDefaults,
        `${origin} is permitted for artwork with no captured payload and no default instance`,
      ).toBe(true);
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

describe("the service worker script is governed by its own policy (M23)", () => {
  /**
   * The defect this guards, in one sentence: the document policy's `connect-src 'self'`
   * was also being served with `/sw.js`, so the worker inherited it, and the worker's own
   * cross-origin `fetch()` of provider artwork threw `TypeError: Failed to fetch` — which
   * `artworkFirst` swallows before rethrowing `artwork unavailable`, so every
   * provider-hosted image failed to render for every visitor the worker was controlling.
   *
   * Nothing about that was visible from the source, the unit tests, or the document
   * policy: `i.ytimg.com` is in the worker's `NEVER_CACHE_HOSTS`, so it bypassed the
   * worker entirely and always worked, and every other artwork host went through the
   * broken path. It was found only by loading the page in a browser and measuring
   * `naturalWidth`.
   */
  it("gives the worker a connect-src naming every artwork origin the document allows", async () => {
    const workerPolicy = parsePolicy(
      (await productionHeadersFor("/sw.js"))["Content-Security-Policy"],
    );
    const documentPolicy = parsePolicy(await productionPolicy());
    const documentImgSrc = documentPolicy.get("img-src") ?? [];
    const workerConnectSrc = workerPolicy.get("connect-src") ?? [];

    expect(workerConnectSrc).toContain("'self'");
    // The derivation is not accidental: the worker's connect-src is `'self'` plus exactly
    // the document's img-src origins, which excludes both `'self'` (already present) and
    // `data:` (an image scheme a worker cannot `fetch`).
    const expected = documentImgSrc.filter((origin) => origin !== "data:" && origin !== "'self'");
    expect(workerConnectSrc.slice(1)).toEqual(expected);
    expect(expected.length, "the derivation is vacuous if it yields nothing").toBeGreaterThan(0);
  });

  it("does not widen the document's own connect-src", async () => {
    // The whole reason this is safe: a document's policy is not affected by the policy
    // served with the worker script, so the page still may not fetch a provider. If this
    // ever stops holding, the exemption has become a real grant and the change is wrong.
    expect(parsePolicy(await productionPolicy()).get("connect-src")).toEqual(["'self'"]);
  });

  it("orders the worker rule after the catch-all, because the last value wins", async () => {
    // If the `/sw.js` rule were declared first, the catch-all would overwrite its
    // `Content-Security-Policy` and the defect would return with no error anywhere.
    const rules = await headerRules();
    const catchAll = rules.findIndex((rule) => rule.source === "/:path*");
    const workerRule = rules.findIndex((rule) => rule.source === "/sw.js");
    expect(catchAll, "the catch-all must still cover every path").toBeGreaterThanOrEqual(0);
    expect(workerRule, "the worker rule must exist").toBeGreaterThan(catchAll);
    // The catch-all is still there, and still covers `/sw.js` for everything the worker
    // rule does not restate - so the exemption is one header, not a whole file.
    const workerHeaders = effectiveHeaders(rules, "/sw.js");
    const catchAllHeaders = effectiveHeaders(rules, "/some-other-path");
    for (const key of Object.keys(catchAllHeaders)) {
      if (key === "Content-Security-Policy") continue;
      expect(workerHeaders[key], `${key} must still apply to /sw.js`).toBe(catchAllHeaders[key]);
    }
  });

  it("keeps the worker's img-src equal to the document's, so nothing else drifts", async () => {
    // The worker's policy is the document's with one directive widened. If a future
    // change relaxed anything else in it, that change would be invisible here otherwise.
    const workerPolicy = parsePolicy(
      (await productionHeadersFor("/sw.js"))["Content-Security-Policy"],
    );
    const documentPolicy = parsePolicy(await productionPolicy());
    for (const [name, values] of documentPolicy) {
      if (name === "connect-src") continue;
      expect(workerPolicy.get(name), `${name} must match the document policy`).toEqual(values);
    }
  });
});

describe("every permissive directive records its debt (task 1.3)", () => {
  it("names a reason next to each unsafe directive in the declaration", () => {
    const config = readFileSync(join(FRONTEND, "next.config.ts"), "utf8");
    // Counted on the directive lists rather than on raw occurrences, and read as a list
    // rather than a tally. The first version allowed one note to satisfy two
    // relaxations (`debts >= unsafe - 1`), which is the kind of slack a debt note should
    // never have.
    //
    // There are three relaxations in the file: inline script and inline style, both in
    // the production policy, and `unsafe-eval`, which only the development branch adds.
    const relaxations = [...config.matchAll(/'unsafe-([a-z]+)'/g)].map((match) => match[1]);
    expect(relaxations.sort(), "the declared relaxations, and no others").toEqual([
      "eval",
      "inline",
      "inline",
    ]);
    const debts = [...config.matchAll(/DEBT:/g)].length;
    // One note per relaxation the *production* policy carries, which is two.
    expect(debts, "each production relaxation carries its own DEBT note").toBeGreaterThanOrEqual(2);
    // And the note is adjacent to the directive it explains, not merely somewhere in
    // the file: the text between each relaxation and the nearest preceding DEBT must be
    // short enough that the pairing is unambiguous.
    for (const match of config.matchAll(/'unsafe-[a-z]+'/g)) {
      const preceding = config.slice(0, match.index);
      const debt = preceding.lastIndexOf("DEBT:");
      const between = preceding.slice(debt);
      expect(
        between.split("\n").length,
        "the DEBT note sits next to its directive",
      ).toBeLessThanOrEqual(14);
    }
  });
});
