import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "@/components/layout/Logo";

// Keep the literal in a variable — Vite rewrites new URL("<literal>", import.meta.url).
const srcRel = "../src";
const srcDir = fileURLToPath(new URL(srcRel, import.meta.url));
const frontendRoot = dirname(srcDir);

function walk(dir: string): string[] {
  // public/ may not exist yet (PWA assets arrive in M13).
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

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
    const files = [...walk(join(srcDir)), ...walk(join(frontendRoot, "public"))];
    const offenders: string[] = [];

    for (const file of files) {
      const raw = readFileSync(file, "utf8");
      const stripped = allowed.reduce((text, pattern) => text.replace(pattern, ""), raw);
      if (/spotify/i.test(stripped)) offenders.push(file);
    }

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
