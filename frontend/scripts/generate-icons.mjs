#!/usr/bin/env node
/**
 * Icon generator (M13, design decision 4).
 *
 * Rasterizes the *same* geometry as `src/app/icon.svg` — a graphite rounded
 * square with three Spotify-green bars — into the PNG sizes a Web App Manifest
 * needs, with no image library: Node's built-in `zlib` plus a small PNG writer.
 * Node built-ins only, so the icons have reproducible provenance and the
 * generator is a file in the repository rather than a binary in someone's
 * design tool.
 *
 * The outputs are committed. Nothing regenerates them at build time: the icons
 * are assets, and a build step that rewrites assets makes a diff mean two things.
 *
 *   node scripts/generate-icons.mjs        # rewrite the committed PNGs
 *   node scripts/generate-icons.mjs --check # fail if they differ (CI-friendly)
 *
 * `renderIconPng` is pure and exported so a test can re-render and compare
 * bytes: that is what makes "the generator is deterministic" checkable without a
 * test writing files.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The brand mark, in the 32x32 viewBox units of `src/app/icon.svg`. */
const VIEWBOX = 32;
const BACKDROP = [0x1f, 0x1f, 0x1f]; // --color-graphite
const MARK = [0x1e, 0xd7, 0x60]; // --color-spotify-green

/** Rounded rectangles as [x, y, width, height, cornerRadius] in viewBox units. */
const BACKDROP_RECT = [0, 0, VIEWBOX, VIEWBOX, 8];
const BARS = [
  [7, 17, 4, 9, 2],
  [14, 12, 4, 14, 2],
  [21, 7, 4, 19, 2],
];

/* ------------------------------------------------------------------ *
 * PNG writing (8-bit RGBA, no interlacing)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/** Encode RGBA pixel data as a PNG. */
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte (0 = none) per scanline. The images are flat blocks of color,
  // so filtering would cost bytes and buy nothing.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ *
 * Rasterizing
 * ------------------------------------------------------------------ */

/** Whether a point is inside a rounded rectangle, in pixel units. */
function insideRoundedRect(px, py, [x, y, w, h, r]) {
  const left = x;
  const right = x + w;
  const top = y;
  const bottom = y + h;
  if (px < left || px > right || py < top || py > bottom) return false;
  const cx = Math.min(Math.max(px, left + r), right - r);
  const cy = Math.min(Math.max(py, top + r), bottom - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

/** 4x4 supersampling: the edges are the only antialiasing these images need. */
const SAMPLES = 4;

/**
 * Render one icon.
 *
 * @param {object} options
 * @param {number} options.size       edge length in pixels
 * @param {boolean} [options.maskable] draw for a maskable icon: full-bleed
 *   backdrop (the platform applies the mask) with the mark inset into the central
 *   80% safe zone, so no launcher mask can clip it.
 * @returns {Buffer} PNG bytes
 */
export function renderIconPng({ size, maskable = false }) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = size / VIEWBOX;

  // The mark's extent within the viewBox, so a maskable icon can center and
  // shrink it rather than scaling the whole 32x32 artwork.
  const markBounds = BARS.reduce(
    (bounds, [x, y, w, h]) => ({
      minX: Math.min(bounds.minX, x),
      minY: Math.min(bounds.minY, y),
      maxX: Math.max(bounds.maxX, x + w),
      maxY: Math.max(bounds.maxY, y + h),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  const markWidth = markBounds.maxX - markBounds.minX;
  const markHeight = markBounds.maxY - markBounds.minY;
  // Only a maskable icon is re-fitted. A normal icon must be the *same* artwork
  // as `icon.svg`, pixel for pixel in viewBox units: re-centering it on the
  // mark's own bounding box would shift every bar by the bounding box's margin
  // and produce a mark that is subtly, permanently different from the favicon.
  // A maskable icon has to be smaller and centered, because the platform applies
  // a mask whose safe zone is a circle of 80% of the icon.
  const markRects = maskable
    ? (() => {
        const fit = 0.6;
        const offsetX = (VIEWBOX - markWidth * fit) / 2 - markBounds.minX * fit;
        const offsetY = (VIEWBOX - markHeight * fit) / 2 - markBounds.minY * fit;
        return BARS.map(([x, y, w, h, r]) => [
          (x - markBounds.minX) * fit + offsetX,
          (y - markBounds.minY) * fit + offsetY,
          w * fit,
          h * fit,
          r * fit,
        ]);
      })()
    : BARS;
  const backdrop = maskable ? [0, 0, VIEWBOX, VIEWBOX, 0] : BACKDROP_RECT;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let backdropHits = 0;
      let markHits = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) / scale;
          const y = (py + (sy + 0.5) / SAMPLES) / scale;
          if (insideRoundedRect(x, y, backdrop)) backdropHits += 1;
          for (const bar of markRects) {
            if (insideRoundedRect(x, y, bar)) {
              markHits += 1;
              break;
            }
          }
        }
      }
      const total = SAMPLES * SAMPLES;
      // Composite: the mark over the backdrop, both partially transparent at the
      // edges, so a launcher mask reveals a clean edge instead of a halo.
      const backdropAlpha = backdropHits / total;
      const markAlpha = markHits / total;
      const offset = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const blended =
          markAlpha > 0
            ? MARK[channel] * markAlpha + BACKDROP[channel] * (backdropAlpha - markAlpha)
            : BACKDROP[channel] * backdropAlpha;
        rgba[offset + channel] = Math.round(backdropAlpha === 0 ? 0 : blended / backdropAlpha);
      }
      rgba[offset + 3] = Math.round(backdropAlpha * 255);
    }
  }

  return encodePng(size, size, rgba);
}

/* ------------------------------------------------------------------ *
 * Outputs
 * ------------------------------------------------------------------ */

/** The committed icon set, as the manifest refers to it. */
export const ICON_FILES = [
  { file: join("public", "icons", "icon-192.png"), size: 192, maskable: false },
  { file: join("public", "icons", "icon-512.png"), size: 512, maskable: false },
  {
    file: join("public", "icons", "icon-maskable-512.png"),
    size: 512,
    maskable: true,
  },
];

export function renderAll() {
  return ICON_FILES.map((icon) => ({
    ...icon,
    bytes: renderIconPng({ size: icon.size, maskable: icon.maskable }),
  }));
}

function main(argv) {
  const check = argv.includes("--check");
  const rendered = renderAll();
  let drifted = 0;
  for (const { file, bytes } of rendered) {
    const path = join(FRONTEND, file);
    if (check) {
      const existing = readFileSync(path);
      if (!existing.equals(bytes)) {
        drifted += 1;
        console.error(`drift: ${file} differs from the generator's output`);
      }
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      console.log(`wrote ${file} (${bytes.length} bytes)`);
    }
  }
  if (check) {
    if (drifted > 0) {
      console.error(
        "\nRun `node scripts/generate-icons.mjs` and commit the result. The icons are" +
          " committed assets, so a silent drift between them and the mark is a bug.",
      );
      process.exit(1);
    }
    console.log("icons match the generator");
  }
}

if (process.argv[1] && process.argv[1].endsWith("generate-icons.mjs")) {
  main(process.argv.slice(2));
}
