import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const globalsCss = read("../src/app/globals.css");
const tokensCss = read("../src/styles/tokens.css");

describe("base styles (globals.css)", () => {
  it("imports the token layer into the Tailwind entry", () => {
    expect(globalsCss).toMatch(/@import\s+"tailwindcss"/);
    expect(globalsCss).toMatch(/@import\s+"\.\.\/styles\/tokens\.css"/);
  });

  it("applies DESIGN.md canvas, colors, and default typography to the document", () => {
    expect(globalsCss).toMatch(/background-color:\s*var\(--color-void-black\)/);
    expect(globalsCss).toMatch(/color:\s*var\(--color-pure-white\)/);
    expect(globalsCss).toMatch(/font-family:\s*var\(--font-spotifymixui\)/);
    expect(globalsCss).toMatch(/font-size:\s*var\(--text-body-lg\)/);
    expect(globalsCss).toMatch(/line-height:\s*var\(--text-body-lg--line-height\)/);
  });

  it("defines a visible keyboard focus indicator", () => {
    expect(globalsCss).toMatch(/:focus-visible\s*\{/);
    expect(globalsCss).toMatch(/outline:\s*2px solid var\(--color-spotify-green\)/);
  });

  it("respects prefers-reduced-motion", () => {
    expect(globalsCss).toContain("prefers-reduced-motion: reduce");
    expect(globalsCss).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(globalsCss).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it("documents and pins the breakpoint contract", () => {
    expect(tokensCss).toContain("mobile <768px");
    expect(tokensCss).toContain("desktop ≥1024px (lg)");
    expect(tokensCss).toMatch(/--breakpoint-md:\s*48rem/);
    expect(tokensCss).toMatch(/--breakpoint-lg:\s*64rem/);
  });
});
