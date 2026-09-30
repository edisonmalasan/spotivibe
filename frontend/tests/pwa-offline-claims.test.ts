import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * M13 tasks 1.3, 4.2, 6.1: the document metadata an installed copy depends on, and
 * the negative rules this milestone is only allowed to satisfy by *not* doing
 * something.
 *
 * The second describe block is the one that matters most. ROADMAP M13 says the app
 * must not market offline YouTube playback, and a rule nobody can violate is not a
 * rule — so the shipped sources are scanned for the sentences such a claim would be
 * made of. A copy change that reintroduces it fails here rather than in a review.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src");

/** Every shipped source a listener can read: components, features, routes. */
function shippedSources(): Array<{ file: string; source: string }> {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if ([".ts", ".tsx"].includes(extname(entry.name))) files.push(full);
    }
  };
  walk(srcDir);
  return files.map((file) => ({
    file: relative(srcDir, file),
    source: readFileSync(file, "utf8"),
  }));
}

/**
 * `layout.tsx` is read as text rather than imported: it calls `Inter()` at module
 * scope (a `next/font` build-time concern) and imports the whole `AppShell` graph,
 * neither of which is what this milestone asserts. The existing style suites read
 * `globals.css` the same way, and the manifest route itself *is* imported in
 * `pwa-manifest.test.ts`, so the object-level assertion lives where it can be one.
 */
const layoutSource = readFileSync(join(srcDir, "app", "layout.tsx"), "utf8");

describe("the document metadata an installed copy needs (task 1.3)", () => {
  it("links the manifest and declares the application name", () => {
    expect(layoutSource).toMatch(/manifest:\s*"\/manifest\.webmanifest"/);
    expect(layoutSource).toMatch(/applicationName:\s*"Spotivibe"/);
  });

  it("declares the iOS home-screen path, which is the only one iOS offers", () => {
    // iOS has no `beforeinstallprompt`, so the document is the only place the
    // installed name and icon can be declared for it.
    expect(layoutSource).toMatch(/appleWebApp:\s*\{[\s\S]{0,400}?capable:\s*true/);
    expect(layoutSource).toMatch(/appleWebApp:\s*\{[\s\S]{0,400}?title:\s*"Spotivibe"/);
    // And an icon, because an installed app with no icon gets a screenshot of a web
    // page instead of the app's mark.
    expect(layoutSource).toMatch(/apple:\s*\[\{\s*url:\s*"\/icons\/icon-192\.png"/);
  });

  it("reaches the window's own insets in standalone mode", () => {
    expect(layoutSource).toMatch(/viewportFit:\s*"cover"/);
    expect(layoutSource).toMatch(/themeColor:\s*"#000000"/);
    // And the body consumes them, or the top bar and player slide under a notch.
    const globals = readFileSync(join(srcDir, "app", "globals.css"), "utf8");
    expect(globals).toMatch(/padding-left:\s*env\(safe-area-inset-left/);
    expect(globals).toMatch(/padding-right:\s*env\(safe-area-inset-right/);
  });

  it("keeps the title and description contract the M1 shell promised", () => {
    expect(layoutSource).toMatch(/default:\s*"Spotivibe",\s*\n\s*template:\s*"%s · Spotivibe"/);
    expect(layoutSource).toMatch(/description:\s*"Local-first music discovery and playback\."/);
  });
});

describe("nothing in the application claims offline playback (task 4.2)", () => {
  it("names no sentence that would promise provider content without a connection", () => {
    // The phrases a marketing-minded copy change reaches for, each with the shape
    // that would make it a claim about provider content. Comments are scanned too:
    // a comment that says "this works offline" is the same bug one release later.
    const forbidden: Array<{ label: string; pattern: RegExp }> = [
      { label: "offline playback", pattern: /offline[\s-]+(youtube\s+)?playback/i },
      {
        label: "playback works offline",
        pattern: /playback[\s-]+(works|available|works? fine)\s+offline/i,
      },
      { label: "listen offline", pattern: /listen\s+offline/i },
      {
        label: "works offline with the player",
        pattern: /works?\s+offline[\s\w]*(with|using)\s+(the\s+)?player/i,
      },
      { label: "download for offline", pattern: /download[\s\w]{0,12}for\s+offline/i },
      { label: "offline streaming", pattern: /offline[\s-]+stream(ing)?/i },
    ];

    const offenders: string[] = [];
    for (const { file, source } of shippedSources()) {
      for (const { label, pattern } of forbidden) {
        if (pattern.test(source)) offenders.push(`${file}: ${label}`);
      }
    }
    expect(offenders, "no shipped source may promise provider content offline").toEqual([]);
  });

  it("states the opposite where it matters, so the rule is not vacuous", () => {
    // A negative test with no positive counterpart passes for the wrong reason — a
    // typo in a file name, a scan that reads nothing. The banner is the one place
    // that must say what is unavailable.
    const banner = readFileSync(
      join(srcDir, "components", "layout", "ConnectionBanner.tsx"),
      "utf8",
    );
    expect(banner).toMatch(/search and playback need a connection/i);
    expect(banner).toMatch(/library, playlists, and history still work/i);
  });

  it("scans a non-trivial number of files, so the scan is not vacuous", () => {
    // If the walker ever stops finding sources, the negative test above would pass
    // for the wrong reason. This asserts the scan still has reach.
    expect(shippedSources().length).toBeGreaterThan(100);
  });

  it("catches a claim when one is introduced (the detector works)", () => {
    // Proved against violating snippets, the way the architecture suite proves its
    // detectors: a rule that cannot be shown to fire is not evidence of anything.
    // Each snippet is matched by the rule that would actually catch it — which is
    // also how it shows the rules are not all one pattern wearing six hats.
    const withPlayer = /works?\s+offline[\s\w]*(with|using)\s+(the\s+)?player/i;
    const listen = /listen\s+offline/i;
    const streaming = /offline[\s-]+stream(ing)?/i;
    expect(withPlayer.test("Playback works offline with the player.")).toBe(true);
    expect(listen.test("You can listen offline once Spotivibe is installed.")).toBe(true);
    expect(streaming.test("Offline streaming, on every device.")).toBe(true);
    // And the honest copy the app does ship is not mistaken for a claim.
    expect(listen.test("Your library, playlists, and history still work.")).toBe(false);
  });
});
