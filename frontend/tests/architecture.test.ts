import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static architecture invariants checked against the real source files
 * (M2 task 7.1 + M3 task 6.1 + M4 task 5.1) — routes/components/features
 * depend on
 * repository interfaces (never the IndexedDB implementation), the data layer
 * stays server- and network-free, UI code never reaches into `src/server`
 * or names raw Innertube/provider-response shapes, the server layer never
 * imports IndexedDB, API routes never return media bytes, the
 * stored/backup datasets stay inside the whitelist, the video host stays a
 * single shell-mounted module, UI code never touches the IFrame API loader
 * or YT types directly, nothing can capture or decode media, and outbound
 * links never suppress the referrer.
 *
 * Each detector is first exercised against a violating snippet, so a broken
 * invariant fails this suite instead of slipping through unnoticed.
 */

// Keep the literal in a variable — Vite rewrites new URL("<literal>", import.meta.url).
const srcRel = "../src";
const srcDir = fileURLToPath(new URL(srcRel, import.meta.url));

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function readTree(dir: string): Array<{ file: string; source: string }> {
  return walk(dir).map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

/** Every module specifier referenced by import/export statements. */
function moduleSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/from\s*["']([^"']+)["']/g),
    ...source.matchAll(/import\s+["']([^"']+)["']/g),
    ...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
}

/** True when a specifier reaches into the IndexedDB implementation package. */
function importsIndexedDbImplementation(specifier: string): boolean {
  return /(^|\/)data\/indexeddb(\/|$)/.test(specifier);
}

/** True when a specifier targets the server-only `src/server` package. */
function targetsServerModule(specifier: string): boolean {
  return specifier.startsWith("@/server") || /(^|\.\.\/)server(\/|$)/.test(specifier);
}

function hasDirectIndexedDbImport(source: string): boolean {
  return moduleSpecifiers(source).some(importsIndexedDbImplementation);
}

function hasServerReferenceOrFetch(source: string): boolean {
  return moduleSpecifiers(source).some(targetsServerModule) || /\bfetch\s*\(/.test(source);
}

/**
 * UI scope (task 6.1): pages, components, features, and stores — the API
 * route modules under src/app/api are transport code and legitimately
 * import `src/server`, so they are excluded from this sweep.
 */
function uiSourceFiles(): Array<{ file: string; source: string }> {
  return ["app", "components", "features", "stores"]
    .flatMap((dir) => readTree(join(srcDir, dir)))
    .filter(({ file }) => !/[\\/]api(?:[\\/][^\\/]+)*[\\/]route\.tsx?$/.test(file));
}

/**
 * Raw Innertube renderer/view-model keys and provider-response type names —
 * they may exist only inside `src/server`. Finding one in UI code means
 * un-normalized provider data leaked past the canonical `Track` boundary
 * (spec: normalized Track conversion; raw provider structures never reach
 * the client).
 */
function mentionsRawProviderShape(source: string): boolean {
  return (
    /\b\w+(?:Renderer|ViewModel)\b/.test(source) ||
    /\b(?:InvidiousVideo|PipedItem|MusicRun|MusicFlexColumn|TextRun|SimpleText)\b/.test(source)
  );
}

/** Indicators that an API route streams or proxies raw bytes instead of JSON. */
const MEDIA_BYTE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "byte-body read", pattern: /\.\s*arrayBuffer\s*\(/ },
  { label: "blob body", pattern: /\.\s*blob\s*\(/ },
  {
    label: "raw response body",
    pattern: /new\s+Response\s*\(\s*(?!null\b)/,
  },
  { label: "streamed body", pattern: /new\s+ReadableStream|\bpipeThrough\b|\bpipeTo\b/ },
  {
    label: "media MIME type",
    pattern: /\b(?:audio|video)\/[a-z0-9.+-]+|\bapplication\/octet-stream/i,
  },
];

function mediaByteIndicators(source: string): string[] {
  return MEDIA_BYTE_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
    ({ label }) => label,
  );
}

/** Top-level keys of an `export const <name> = { ... } as const;` block. */
function extractConstantKeys(source: string, constantName: string): string[] {
  const block = source.match(
    new RegExp(`export const ${constantName} = \\{([\\s\\S]*?)\\} as const;`),
  );
  if (!block) return [];
  return [...block[1].matchAll(/^\s*(\w+):\s*"([^"]+)"\s*,/gm)].map((match) => match[1]);
}

/** `name:` entries of STORE_DEFINITIONS, ignoring nested index definitions. */
function extractStoreDefinitionNames(source: string): string[] {
  const block = source.match(/export const STORE_DEFINITIONS[\s\S]*?\n\];/)?.[0] ?? "";
  const storesOnly = block.replace(/indexes:\s*\[[\s\S]*?\]/g, "");
  return [...storesOnly.matchAll(/name:\s*(?:STORE\.(\w+)|"(\w+)")/g)].map(
    (match) => match[1] ?? match[2],
  );
}

/** Dataset keys of the backup envelope's `data: z.strictObject({ ... })`. */
function extractBackupDatasetKeys(source: string): string[] {
  const block = source.match(/data:\s*z\.strictObject\(\{([\s\S]*?)\}\),/)?.[1] ?? "";
  return [...block.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]);
}

/** Whitelists: the seven stores (ROADMAP §8/§13) and six exportable datasets. */
const STORE_WHITELIST = [
  "likedTracks",
  "playlists",
  "listeningHistory",
  "searchHistory",
  "preferences",
  "session",
  "metadataCache",
];
const BACKUP_WHITELIST = [
  "preferences",
  "likedTracks",
  "playlists",
  "history",
  "searchHistory",
  "session",
];

describe("architecture violation detectors", () => {
  it("flags direct IndexedDB implementation imports and passes interface imports", () => {
    expect(hasDirectIndexedDbImport('import { createRepositories } from "@/data/indexeddb";')).toBe(
      true,
    );
    expect(
      hasDirectIndexedDbImport('export type { RepositorySet } from "@/data/indexeddb/index";'),
    ).toBe(true);
    expect(
      hasDirectIndexedDbImport('const mod = await import("../../data/indexeddb/likedTracks");'),
    ).toBe(true);
    expect(hasDirectIndexedDbImport('import { getLocalData } from "@/data/localData";')).toBe(
      false,
    );
    expect(
      hasDirectIndexedDbImport('import type { Repositories } from "@/data/repositories";'),
    ).toBe(false);
  });

  it("flags server references and fetch calls but passes pure data-layer code", () => {
    expect(targetsServerModule("@/server/env")).toBe(true);
    expect(targetsServerModule("../server/env")).toBe(true);
    expect(targetsServerModule("@/data/backup/prepare")).toBe(false);
    expect(hasServerReferenceOrFetch('const res = await fetch("/api/search");')).toBe(true);
    expect(hasServerReferenceOrFetch("const res = await prefetchData();")).toBe(false);
    expect(hasServerReferenceOrFetch("export function load() { return readAll(); }")).toBe(false);
  });

  it("extracts an extra store or dataset so the whitelist comparison fails", () => {
    const rogueStore = `export const STORE = {\n  likedTracks: "likedTracks",\n  telemetry: "telemetry",\n} as const;`;
    expect(extractConstantKeys(rogueStore, "STORE")).toEqual(["likedTracks", "telemetry"]);
    expect([...extractConstantKeys(rogueStore, "STORE")].sort()).not.toEqual(
      [...STORE_WHITELIST].sort(),
    );

    const rogueDataset = `data: z.strictObject({\n  preferences: preferencesSchema,\n  telemetry: z.array(z.string()),\n}),`;
    expect(extractBackupDatasetKeys(rogueDataset)).toEqual(["preferences", "telemetry"]);
    expect([...extractBackupDatasetKeys(rogueDataset)].sort()).not.toEqual(
      [...BACKUP_WHITELIST].sort(),
    );
  });

  it("flags raw provider shape names but passes normalized UI code", () => {
    expect(mentionsRawProviderShape("const item: MusicResponsiveListItemRenderer = node;")).toBe(
      true,
    );
    expect(mentionsRawProviderShape('const key = "videoRenderer";')).toBe(true);
    expect(mentionsRawProviderShape("interface PipedItem { id: string }")).toBe(true);
    expect(mentionsRawProviderShape("interface TextRun { text?: string }")).toBe(true);
    expect(mentionsRawProviderShape("const tracks = useSearchStore((s) => s.tracks);")).toBe(false);
    expect(mentionsRawProviderShape("const rows = items.map((track) => renderRow(track));")).toBe(
      false,
    );
  });

  it("flags media-byte indicators but passes JSON-only route bodies", () => {
    expect(
      mediaByteIndicators(
        'return new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } });',
      ),
    ).toContain("media MIME type");
    expect(mediaByteIndicators("const buf = await upstream.arrayBuffer();")).toContain(
      "byte-body read",
    );
    expect(mediaByteIndicators("const stream = new Response(webStream);")).toContain(
      "raw response body",
    );
    expect(mediaByteIndicators("const out = upstream.body.pipeThrough(transform);")).toContain(
      "streamed body",
    );
    expect(mediaByteIndicators("return Response.json({ tracks, diagnostics });")).toEqual([]);
    expect(mediaByteIndicators("return new Response(null, { status: 499 });")).toEqual([]);
  });

  it("scopes the UI sweep to non-route app code, components, features, and stores", () => {
    const files = uiSourceFiles().map(({ file }) => file);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => /[\\/]app[\\/]page\.tsx$/.test(file))).toBe(true);
    // The API route legitimately imports @/server; it must sit outside this sweep.
    expect(files.some((file) => /[\\/]api[\\/]search[\\/]route\.ts$/.test(file))).toBe(false);
    expect(existsSync(join(srcDir, "app", "api", "search", "route.ts"))).toBe(true);
  });
});

describe("architecture: routes and features use repository interfaces only", () => {
  it("contains no direct src/data/indexeddb imports in app, components, or features", () => {
    const offenders = ["app", "components", "features"]
      .flatMap((dir) => readTree(join(srcDir, dir)))
      .filter(({ source }) => hasDirectIndexedDbImport(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("architecture: the data layer is server- and network-free", () => {
  it("contains no src/server imports and no fetch calls under src/data", () => {
    const offenders = readTree(join(srcDir, "data"))
      .filter(({ source }) => hasServerReferenceOrFetch(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("architecture: datasets stay inside the whitelist", () => {
  it("declares exactly the whitelisted IndexedDB stores", () => {
    const schema = readFileSync(join(srcDir, "data", "indexeddb", "schema.ts"), "utf8");

    expect([...extractConstantKeys(schema, "STORE")].sort()).toEqual([...STORE_WHITELIST].sort());
    expect([...extractStoreDefinitionNames(schema)].sort()).toEqual([...STORE_WHITELIST].sort());
  });

  it("declares exactly the whitelisted backup datasets", () => {
    const schema = readFileSync(join(srcDir, "data", "backup", "schema.ts"), "utf8");

    expect([...extractBackupDatasetKeys(schema)].sort()).toEqual([...BACKUP_WHITELIST].sort());
  });
});

describe("architecture: UI never crosses into server or provider shapes (task 6.1)", () => {
  it("imports no src/server module from pages, components, features, or stores", () => {
    const offenders = uiSourceFiles()
      .filter(({ source }) => moduleSpecifiers(source).some(targetsServerModule))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("names no Innertube renderer or provider-response type in UI code", () => {
    const offenders = uiSourceFiles()
      .filter(({ source }) => mentionsRawProviderShape(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("architecture: the server layer stays off IndexedDB (task 6.1)", () => {
  it("imports no src/data/indexeddb module from src/server", () => {
    const serverFiles = readTree(join(srcDir, "server"));
    expect(serverFiles.length).toBeGreaterThan(0);

    const offenders = serverFiles
      .filter(({ source }) => hasDirectIndexedDbImport(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("architecture: API routes never return media bytes (task 6.1)", () => {
  it("finds no media-byte indicators in any src/app/api route", () => {
    const routes = readTree(join(srcDir, "app", "api")).filter(({ file }) =>
      /[\\/]route\.tsx?$/.test(file),
    );
    expect(routes.length).toBeGreaterThan(0);

    for (const { file, source } of routes) {
      expect(mediaByteIndicators(source), file).toEqual([]);
    }
  });
});

/**
 * Playback invariants (M4 task 5.1): the video host is imported only by the
 * shell, UI code depends on the store/engine interface instead of the IFrame
 * API loader or its YT types, no surface in the app can capture or decode
 * media (extraction stays prohibited), and outbound links/headers never
 * suppress the referrer (YouTube embedded-player policy compliance).
 */

/** True when a specifier reaches the IFrame API loader or its YT types. */
function targetsPlayerInternals(specifier: string): boolean {
  if (specifier.includes("/components/player/")) return false; // Spotivibe's own UI folder
  return /(^|\/)player\/(ytApi|types)(\.tsx?)?$/.test(specifier);
}

/** Indicators of audio/video capture or decode — extraction surfaces. */
const EXTRACTION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "MediaRecorder", pattern: /\bMediaRecorder\b/ },
  { label: "decodeAudioData", pattern: /\bdecodeAudioData\b/ },
  { label: "audio element", pattern: /<audio\b/ },
  { label: "video element", pattern: /<video\b/ },
];

function extractionIndicators(source: string): string[] {
  return EXTRACTION_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
    ({ label }) => label,
  );
}

/** True when source suppresses the referrer (link rel or policy header). */
function suppressesReferrer(source: string): boolean {
  return (
    /\bnoreferrer\b/i.test(source) ||
    /referrer[-_]?policy["']?\s*[:=]\s*["']?no-referrer/i.test(source)
  );
}

/** Next config files next to src — where a Referrer-Policy header would live. */
function frontendConfigFiles(): Array<{ file: string; source: string }> {
  const frontendDir = join(srcDir, "..");
  return readdirSync(frontendDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^next\.config\.(?:ts|js|mjs)$/.test(entry.name))
    .map((entry) => {
      const file = join(frontendDir, entry.name);
      return { file, source: readFileSync(file, "utf8") };
    });
}

describe("architecture violation detectors (task 5.1)", () => {
  it("flags IFrame loader/YT-type imports but passes the engine interface", () => {
    expect(targetsPlayerInternals("@/player/ytApi")).toBe(true);
    expect(targetsPlayerInternals("@/player/types")).toBe(true);
    expect(targetsPlayerInternals("../../player/ytApi")).toBe(true);
    expect(targetsPlayerInternals("@/player/engine")).toBe(false);
    expect(targetsPlayerInternals("@/components/player/PlayerHost")).toBe(false);
    expect(targetsPlayerInternals("@/stores/playerStore")).toBe(false);
  });

  it("flags capture/decode indicators but passes the iframe player surface", () => {
    expect(extractionIndicators("const rec = new MediaRecorder(stream);")).toContain(
      "MediaRecorder",
    );
    expect(extractionIndicators("const buf = await ctx.decodeAudioData(raw);")).toContain(
      "decodeAudioData",
    );
    expect(extractionIndicators("return <audio src={url} controls />;")).toContain("audio element");
    expect(extractionIndicators("return <video src={blob} />;")).toContain("video element");
    // The YouTube video ID shape and the IFrame embed are not media elements.
    expect(extractionIndicators('const id = "youtube:<videoId>";')).toEqual([]);
    expect(extractionIndicators('return <iframe src={embedUrl} allow="autoplay" />;')).toEqual([]);
  });

  it("flags referrer suppression but passes the compliant watch link", () => {
    expect(suppressesReferrer('<a rel="noopener noreferrer" href={url} />')).toBe(true);
    expect(suppressesReferrer('"Referrer-Policy": "no-referrer"')).toBe(true);
    expect(suppressesReferrer('referrerPolicy="no-referrer"')).toBe(true);
    expect(suppressesReferrer('<a rel="noopener" target="_blank" href={url} />')).toBe(false);
    expect(suppressesReferrer('referrerPolicy="origin"')).toBe(false);
  });
});

describe("architecture: single persistent player host (task 5.1)", () => {
  it("is imported only by the AppShell, which the root layout mounts", () => {
    const importers = readTree(srcDir)
      .filter(({ source }) =>
        moduleSpecifiers(source).some((spec) => spec === "@/components/player/PlayerHost"),
      )
      .map(({ file }) => file);

    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers) {
      expect(/[\\/]components[\\/]layout[\\/]AppShell\.tsx$/.test(file), file).toBe(true);
    }

    const layout = readFileSync(join(srcDir, "app", "layout.tsx"), "utf8");
    expect(moduleSpecifiers(layout)).toContain("@/components/layout/AppShell");
    expect(layout).toMatch(/<AppShell>/);
  });

  it("keeps UI code off the IFrame API loader and raw YT types", () => {
    const offenders = uiSourceFiles()
      .filter(({ source }) => moduleSpecifiers(source).some(targetsPlayerInternals))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("architecture: no audio-extraction surfaces (task 5.1)", () => {
  it("finds no capture or decode indicators anywhere in src", () => {
    const offenders = readTree(srcDir)
      .filter(({ source }) => extractionIndicators(source).length > 0)
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("architecture: outbound links never suppress the referrer (task 5.1)", () => {
  it("finds no noreferrer or no-referrer policy in src or the Next config", () => {
    const files = [...readTree(srcDir), ...frontendConfigFiles()];
    const offenders = files
      .filter(({ source }) => suppressesReferrer(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
