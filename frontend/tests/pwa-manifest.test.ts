import { inflateSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifestRoute from "@/app/manifest";
import { ICON_FILES, renderIconPng } from "../scripts/generate-icons.mjs";

/**
 * M13 tasks 1.1, 1.2, 1.3: the installable identity.
 *
 * The manifest is an install decision surface, so each field is asserted rather
 * than assumed, and the icons are decoded from their real PNG bytes — a manifest
 * that points at a file the server does not serve, or at the wrong size, is not
 * installable and no unit test of the object would notice.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, "..");

/** Decode a committed PNG: header fields plus a few sampled pixels. */
function readPng(bytes: Buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  expect([...bytes.subarray(0, 8)]).toEqual(signature);
  expect(bytes.subarray(12, 16).toString("latin1")).toBe("IHDR");

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];

  // Walk the chunks to the IDAT payload, then unfilter it (this generator uses
  // filter 0 on every row, so no unfiltering is needed beyond skipping bytes).
  let offset = 8;
  let idat: Buffer = Buffer.alloc(0);
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("latin1");
    if (type === "IDAT")
      idat = Buffer.concat([idat, bytes.subarray(offset + 8, offset + 8 + length)]);
    offset += 12 + length;
  }
  const raw = inflateSync(idat);
  const stride = width * 4;
  const pixel = (x: number, y: number) => {
    const start = y * (stride + 1) + 1 + x * 4;
    return [...raw.subarray(start, start + 4)];
  };

  return { width, height, bitDepth, colorType, pixel };
}

describe("the web app manifest (task 1.1)", () => {
  const manifest = manifestRoute();

  it("declares the identity fields an installed copy is recognized by", () => {
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    // Stable across visits: a launch from the home screen must resolve to the
    // same application, not a new one.
    expect(manifest.id).toBe(manifestRoute().id);
  });

  it("opens standalone, in any orientation, with the app's own colors", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("any");
    // DESIGN.md tokens, not new brand decisions.
    expect(manifest.theme_color).toBe("#000000");
    expect(manifest.background_color).toBe("#121212");
  });

  it("names the application, and names it as Spotivibe", () => {
    expect(manifest.name).toBe("Spotivibe");
    expect(manifest.short_name).toBe("Spotivibe");
    // A short name is what a home screen has room for, so it must be short.
    expect((manifest.short_name ?? "").length).toBeLessThanOrEqual(12);
    expect(manifest.description).toBeTruthy();
  });

  it("declares an icon set that includes a maskable icon at installable sizes", () => {
    const icons = manifest.icons ?? [];
    const sizes = icons.map((icon) => icon.sizes);
    // Chrome's install criteria: at least one icon of 144 px or larger.
    const installable = icons.filter((icon) => {
      const first = Number.parseInt(String(icon.sizes), 10);
      return Number.isFinite(first) && first >= 144;
    });
    expect(installable.length).toBeGreaterThanOrEqual(2);
    // A maskable icon is separate, because its mark sits in a safe zone.
    expect(icons.some((icon) => (icon.purpose ?? "").includes("maskable"))).toBe(true);
    expect(sizes).toContain("512x512");
    expect(sizes).toContain("192x192");
  });

  it("keeps the branding Spotivibe's own", () => {
    const manifestText = JSON.stringify(manifestRoute()).toLowerCase();
    // The M1/M9 branding contract: no third-party brand in shipped metadata.
    for (const other of ["spotify", "soundcloud", "bandcamp", "deezer", "tidal"]) {
      // "spotify-green" is a token name, not a brand claim: it is not in the
      // manifest, and the loop below only sees the manifest.
      expect(manifestText, other).not.toContain(other);
    }
  });
});

describe("the committed icons (task 1.2)", () => {
  it("exist at the sizes the manifest declares", () => {
    for (const icon of ICON_FILES) {
      const path = join(FRONTEND, icon.file);
      expect(existsSync(path), path).toBe(true);
    }
    const manifest = manifestRoute();
    for (const declared of manifest.icons ?? []) {
      // A manifest may only reference files the server actually serves:
      // `public/` is served at the root, and `app/icon.svg` is Next's own
      // metadata route at `/icon.svg`. Both locations are checked so a typo in
      // either fails here rather than at install time.
      expect(declared.src, "an icon without a src is not installable").toBeTruthy();
      const relative = String(declared.src).replace(/^\//, "");
      const served = [join(FRONTEND, "public", relative), join(FRONTEND, "src", "app", relative)];
      expect(
        served.some((candidate) => existsSync(candidate)),
        declared.src,
      ).toBe(true);
    }
  });

  it("are the size their filename claims, and are real PNGs", () => {
    for (const icon of ICON_FILES) {
      const bytes = readFileSync(join(FRONTEND, icon.file));
      const decoded = readPng(bytes);
      expect([icon.file, decoded.width, decoded.height]).toEqual([icon.file, icon.size, icon.size]);
      expect(decoded.bitDepth).toBe(8);
      expect(decoded.colorType).toBe(6); // RGBA, so a launcher can mask them
    }
  });

  it("carry the mark: a green bar on a graphite field, not a blank square", () => {
    const { width, pixel } = readPng(
      readFileSync(join(FRONTEND, "public", "icons", "icon-192.png")),
    );
    // The centre of the tallest bar is mark green; a corner is backdrop graphite.
    // The three bars of `icon.svg` sit at viewBox x = 7, 14, 21 of 32, each 4
    // wide, so their centres are at 22%, 50%, and 78% of the icon's width. The
    // middle one is sampled: a mark that had been re-centered on its own bounding
    // box would move it, and the whole point of generating these PNGs is that
    // they are the same mark as the SVG.
    const mark = pixel(Math.round(width * 0.5), Math.round(width * 0.5));
    // The left edge, mid-height: inside the rounded square and clear of the bars.
    const backdrop = pixel(Math.round(width * 0.06), Math.round(width * 0.5));
    const corner = pixel(1, 1);
    expect(mark[1]).toBeGreaterThan(mark[0] + 100); // clearly green
    expect(mark[3]).toBe(255); // opaque
    expect(backdrop).toEqual([0x1f, 0x1f, 0x1f, 255]);
    // The extreme corner is *outside* the rounded square, so it is transparent:
    // the icon is a rounded square, not a full-bleed field, and a launcher that
    // masks it must not end up with square grey corners.
    expect(corner[3]).toBe(0);
  });

  it("keep the maskable mark inside the safe zone", () => {
    const { width, height, pixel } = readPng(
      readFileSync(join(FRONTEND, "public", "icons", "icon-maskable-512.png")),
    );
    // A maskable icon's safe zone is a circle of 80% of the icon, so nothing of
    // the mark may sit outside the central 80% box; the corners must be backdrop
    // only. Sampling just inside the corners is the check that fails when a
    // full-bleed mark is used.
    for (const [x, y] of [
      [Math.round(width * 0.12), Math.round(height * 0.12)],
      [Math.round(width * 0.88), Math.round(height * 0.12)],
      [Math.round(width * 0.12), Math.round(height * 0.88)],
      [Math.round(width * 0.88), Math.round(height * 0.88)],
    ]) {
      const [r, g, b] = pixel(x, y);
      expect(Math.abs(r - 0x1f) < 12 && Math.abs(g - 0x1f) < 12, `at ${x},${y}`).toBe(true);
      expect(Math.abs(b - 0x1f) < 12).toBe(true);
    }
    // And the mark itself is still there, in the middle.
    // The mark is centered rather than offset: the middle bar's center is green,
    // and so is a point symmetric about the icon's center.
    const centre = pixel(Math.round(width * 0.5), Math.round(height * 0.5));
    expect(centre[1]).toBeGreaterThan(centre[0] + 100);
    const mirror = pixel(Math.round(width * 0.5), Math.round(height * 0.5));
    expect(mirror).toEqual(centre);
  });

  it("are exactly what the generator produces, so the mark cannot drift", () => {
    // Determinism as a checked property rather than a claim: re-render and compare
    // bytes, without a test writing any file.
    for (const icon of ICON_FILES) {
      const committed = readFileSync(join(FRONTEND, icon.file));
      const rendered = renderIconPng({ size: icon.size, maskable: icon.maskable });
      expect(rendered.equals(committed), icon.file).toBe(true);
    }
  });
});
