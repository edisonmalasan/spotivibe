import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Task 7.1: static architecture invariants checked against the real source
 * files — routes/components/features depend on repository interfaces (never
 * the IndexedDB implementation), the data layer stays server- and
 * network-free, and the stored/backup datasets stay inside the whitelist.
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
