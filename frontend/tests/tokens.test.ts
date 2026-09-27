import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// NOTE: keep the URL path in a variable — Vite statically rewrites
// `new URL("<literal>", import.meta.url)` into an http asset URL, which breaks file reads.
const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const tokensCss = read("../src/styles/tokens.css");

function token(name: string): string {
  // Anchored to declaration lines (whitespace only before the name) so prose in
  // comments that mentions a token cannot match.
  const match = tokensCss.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"));
  if (!match) throw new Error(`token ${name} not found in src/styles/tokens.css`);
  return match[1].trim();
}

describe("design tokens (extracted from frontend/docs/DESIGN.md)", () => {
  it("exposes the DESIGN.md color palette", () => {
    expect(token("--color-spotify-green")).toBe("#1ed760");
    expect(token("--color-signal-red")).toBe("#b85850");
    expect(token("--color-void-black")).toBe("#000000");
    expect(token("--color-carbon")).toBe("#121212");
    expect(token("--color-graphite")).toBe("#1f1f1f");
    expect(token("--color-smoke")).toBe("#292929");
    expect(token("--color-iron")).toBe("#333333");
    expect(token("--color-steel")).toBe("#535353");
    expect(token("--color-fog")).toBe("#73777c");
    expect(token("--color-mist")).toBe("#b3b3b3");
    expect(token("--color-bone")).toBe("#c5c5c5");
    expect(token("--color-pure-white")).toBe("#ffffff");
    expect(token("--color-promo-gradient")).toBe("#509bf5");
    expect(token("--color-magenta-glow")).toBe("#af2896");
  });

  it("exposes the DESIGN.md type scale, weights, and font families", () => {
    expect(token("--text-caption")).toBe("11px");
    expect(token("--text-caption--line-height")).toBe("1.2");
    expect(token("--text-body-lg")).toBe("14px");
    expect(token("--text-body-lg--line-height")).toBe("1.33");
    expect(token("--text-link")).toBe("16px");
    expect(token("--text-link--line-height")).toBe("1.2");
    expect(token("--text-heading")).toBe("24px");
    expect(token("--text-heading--line-height")).toBe("1.2");
    expect(token("--text-label")).toBe("12px");
    expect(token("--font-weight-regular")).toBe("400");
    expect(token("--font-weight-semibold")).toBe("600");
    expect(token("--font-weight-bold")).toBe("700");
    expect(token("--font-spotifymixui")).toContain('"SpotifyMixUI"');
    expect(token("--font-spotifymixui")).toContain("Inter");
    expect(token("--font-spotifymixuititle")).toContain('"SpotifyMixUITitle"');
  });

  it("uses the 4px base unit with the DESIGN.md literal spacing scale", () => {
    expect(token("--spacing")).toBe("4px");
    expect(token("--spacing-unit")).toBe("4px");
    for (const px of [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 172]) {
      expect(token(`--spacing-${px}`)).toBe(`${px}px`);
    }
  });

  it("exposes the DESIGN.md radius families", () => {
    expect(token("--radius-small")).toBe("2px");
    expect(token("--radius-cards")).toBe("6px");
    expect(token("--radius-images")).toBe("6px");
    expect(token("--radius-inputs")).toBe("500px");
    expect(token("--radius-avatars")).toBe("500px");
    expect(token("--radius-buttons")).toBe("9999px");
    expect(token("--radius-full")).toBe("500px");
    expect(token("--radius-full-2")).toBe("9999px");
  });

  it("exposes the DESIGN.md shadows", () => {
    expect(token("--shadow-lg")).toBe("rgba(0, 0, 0, 0.5) 0px 8px 24px 0px");
    expect(token("--shadow-subtle")).toBe(
      "rgb(18, 18, 18) 0px 1px 0px 0px, rgb(124, 124, 124) 0px 0px 0px 1px inset",
    );
  });

  it("exposes the DESIGN.md surface ladder and layout measurements", () => {
    expect(token("--surface-canvas")).toBe("#000000");
    expect(token("--surface-sidebar")).toBe("#121212");
    expect(token("--surface-card")).toBe("#1f1f1f");
    expect(token("--surface-card-hover")).toBe("#292929");
    expect(token("--card-padding")).toBe("12px");
    expect(token("--section-gap")).toBe("32-48px");
    expect(token("--element-gap")).toBe("8-12px");
    expect(token("--gradient-promo-gradient")).toContain("linear-gradient(90deg");
  });

  it("pins the responsive shell breakpoints (mobile <768, tablet ≥768, desktop ≥1024)", () => {
    expect(token("--breakpoint-md")).toBe("48rem");
    expect(token("--breakpoint-lg")).toBe("64rem");
  });
});
