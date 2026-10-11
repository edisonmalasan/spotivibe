import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "@/components/layout/Logo";
import { ALL_FILES, readTreeStrict } from "./helpers/sourceTree";

// Keep the literal in a variable — Vite rewrites new URL("<literal>", import.meta.url).
const srcRel = "../src";
const srcDir = fileURLToPath(new URL(srcRel, import.meta.url));
const frontendRoot = dirname(srcDir);

/** Canonical DESIGN.md token names (and their derived utility classes). */
const allowed = [/spotify-green/gi, /spotifymixui/gi];

describe("Spotivibe branding", () => {
  it("renders the original logo mark and wordmark", () => {
    render(<Logo />);

    expect(screen.getByText("Spotivibe")).toBeInTheDocument();
    const svg = document.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // Tile + three ascending vibe bars.
    expect(svg!.querySelectorAll("rect")).toHaveLength(4);
    expect(svg!.querySelectorAll("rect")[1]).toHaveAttribute("fill", "var(--color-spotify-green)");
  });

  it("ships no third-party music-service branding in source or public assets", () => {
    // `readTreeStrict`, not `readdirSync` + `readFileSync`. This suite walked `src` and `public` and then
    // read every file it had listed; `motion-scope.test.ts` writes and deletes a probe inside
    // `src/features/sharing` at the same time, and a file vanishing between the listing and the read threw
    // `ENOENT` here — a branding failure with nothing to do with branding. It was observed live in M31.
    //
    // `ALL_FILES` because this guard is about *any* third-party name, not about TypeScript: the old walker
    // had no extension filter and narrowing it would quietly stop scanning, say, `public/*.svg`.
    const files = [
      ...readTreeStrict(srcDir, { extensions: ALL_FILES }),
      ...readTreeStrict(join(frontendRoot, "public"), { extensions: ALL_FILES }),
    ];

    const offenders = files
      .filter(({ source }) =>
        /spotify/i.test(allowed.reduce((text, pattern) => text.replace(pattern, ""), source)),
      )
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("serves an original app icon and drops the scaffold favicon", () => {
    const appDir = join(srcDir, "app");
    const icon = readFileSync(join(appDir, "icon.svg"), "utf8");

    expect(icon).toContain("1ed760");
    expect(() => statSync(join(appDir, "favicon.ico"))).toThrow();
  });

  it("declares Spotivibe page metadata", () => {
    const layout = readFileSync(join(srcDir, "app", "layout.tsx"), "utf8");

    expect(layout).toContain('default: "Spotivibe"');
    expect(layout).toContain("Local-first music discovery and playback.");
    expect(layout).not.toContain("Create Next App");
  });
});
