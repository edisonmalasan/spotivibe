import { describe, expect, it } from "vitest";
import {
  migrateEnvelope,
  prepareImport,
  type BackupMigration,
  type RawEnvelope,
} from "@/data/backup";
import {
  encode,
  makeBackupData,
  makeEnvelope,
  makeMix,
  makeTrack,
} from "./helpers/backup-fixtures";

/**
 * Task 4.2: import preparation — malformed input, foreign formats, newer
 * versions, and invalid records all reject before any mutation; the migration
 * pipeline runs pure steps in ascending order without mutating its input.
 */

describe("prepareImport", () => {
  it("rejects malformed JSON", () => {
    const result = prepareImport("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid-json");
  });

  it("rejects files that are not Spotivibe backup envelopes", () => {
    const foreign = [
      "[]",
      '"hello"',
      "42",
      "null",
      JSON.stringify({ foo: 1 }),
      JSON.stringify({ format: "other-backup", version: 1 }),
      JSON.stringify({ version: 1 }),
      JSON.stringify({ format: "spotivibe-backup" }),
    ];
    for (const input of foreign) {
      const result = prepareImport(input);
      expect(result.ok, `input: ${input}`).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid-format");
    }
  });

  it("rejects an unsupported newer version", () => {
    const envelope = { ...makeEnvelope(), version: 99 };
    const result = prepareImport(encode(envelope));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsupported-version");
      if (result.error.kind === "unsupported-version") {
        expect(result.error.version).toBe(99);
      }
    }
  });

  it("rejects records that violate the schema", () => {
    const missingCapabilities: {
      data: { likedTracks: { track: Record<string, unknown> }[] };
    } = JSON.parse(encode(makeEnvelope()));
    delete missingCapabilities.data.likedTracks[0].track.capabilities;
    const r1 = prepareImport(encode(missingCapabilities));
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.error.kind).toBe("invalid-records");
      if (r1.error.kind === "invalid-records") {
        expect(r1.error.issues.join(" ")).toContain("capabilities");
      }
    }

    const unknownTopLevel = { ...makeEnvelope(), secretField: "token" };
    const r2 = prepareImport(encode(unknownTopLevel));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.kind).toBe("invalid-records");

    const badContext = makeBackupData();
    badContext.history[0].context = "nowhere" as (typeof badContext.history)[0]["context"];
    const r3 = prepareImport(encode(makeEnvelope(badContext)));
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error.kind).toBe("invalid-records");
  });

  it("accepts a valid current-version envelope", () => {
    const result = prepareImport(encode(makeEnvelope()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sourceVersion).toBe(1);
      expect(result.envelope.version).toBe(1);
      expect(result.envelope.data.likedTracks).toHaveLength(2);
      expect(result.envelope.data.preferences.languages).toEqual(["hi"]);
    }
  });

  it("rejects backups claiming offlineDownload (ROADMAP §8.1 invariant)", () => {
    const tampered = JSON.parse(encode(makeEnvelope())) as {
      data: { likedTracks: { track: { capabilities: { offlineDownload: boolean } } }[] };
    };
    tampered.data.likedTracks[0].track.capabilities.offlineDownload = true;

    const result = prepareImport(encode(tampered));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid-records");
      if (result.error.kind === "invalid-records") {
        expect(result.error.issues.join(" ")).toContain("offlineDownload");
      }
    }
  });

  it("accepts a session carrying the M6 queue fields (task 5.1)", () => {
    const data = makeBackupData();
    data.session = {
      ...data.session!,
      history: [{ track: makeTrack("t1"), playedAt: 950 }],
      playOrder: [0],
      source: "search",
    };

    const result = prepareImport(encode(makeEnvelope(data)));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.data.session?.source).toBe("search");
  });

  it("still accepts an old-shape session without the M6 queue fields (task 5.1)", () => {
    const data = makeBackupData(); // fixture session has no M6 keys
    expect(data.session).not.toHaveProperty("history");
    expect(data.session).not.toHaveProperty("playOrder");
    expect(data.session).not.toHaveProperty("source");

    expect(prepareImport(encode(makeEnvelope(data))).ok).toBe(true);
  });

  it("rejects malformed M6 queue fields in a session", () => {
    const tampered = JSON.parse(encode(makeEnvelope())) as {
      data: { session: { source: string; playOrder: string } };
    };
    tampered.data.session.source = "nowhere";
    tampered.data.session.playOrder = "not-an-array";

    const result = prepareImport(encode(tampered));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid-records");
  });

  it("migrates an older supported version before validating the result", () => {
    // A v0-era envelope: no session dataset yet, so as-is it cannot pass the
    // v1 schema — it only becomes valid after the registered migration runs.
    const legacy = JSON.parse(encode(makeEnvelope())) as {
      version: number;
      data: Record<string, unknown>;
    };
    legacy.version = 0;
    delete legacy.data.session;
    const step: BackupMigration = {
      fromVersion: 0,
      description: "v0 → v1: introduce the session snapshot field",
      migrate: (envelope) => ({
        ...envelope,
        data: { ...(envelope.data as Record<string, unknown>), session: null },
      }),
    };

    // Without a registered step the same file cannot be imported at all.
    const noPath = prepareImport(encode(legacy));
    expect(noPath.ok).toBe(false);
    if (!noPath.ok) expect(noPath.error.kind).toBe("unsupported-version");

    const result = prepareImport(encode(legacy), { migrations: [step] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sourceVersion).toBe(0);
      expect(result.envelope.version).toBe(1);
      expect(result.envelope.data.session).toBeNull();
      expect(result.envelope.data.likedTracks).toHaveLength(2);
    }
  });

  it("applies schema validation to the migrated result, not the raw file", () => {
    const legacy = JSON.parse(encode(makeEnvelope())) as {
      version: number;
      data: Record<string, unknown>;
    };
    legacy.version = 0;
    delete legacy.data.session;
    const broken: BackupMigration = {
      fromVersion: 0,
      description: "v0 → v1: repairs the shape but emits an offlineDownload claim",
      migrate: (envelope) => {
        const data = envelope.data as Record<string, unknown>;
        const likedTracks = data.likedTracks as {
          track: { capabilities: Record<string, boolean> };
        }[];
        const first = likedTracks[0];
        return {
          ...envelope,
          data: {
            ...data,
            session: null,
            likedTracks: [
              {
                ...first,
                track: {
                  ...first.track,
                  capabilities: { ...first.track.capabilities, offlineDownload: true },
                },
              },
              ...likedTracks.slice(1),
            ],
          },
        };
      },
    };

    const result = prepareImport(encode(legacy), { migrations: [broken] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid-records");
      if (result.error.kind === "invalid-records") {
        expect(result.error.issues.join(" ")).toContain("offlineDownload");
      }
    }
  });
});

describe("migrateEnvelope", () => {
  it("runs steps in ascending order, bumps versions, and never mutates input", () => {
    const order: number[] = [];
    const steps: BackupMigration[] = [
      {
        fromVersion: 2,
        description: "v2 → v3",
        migrate: (envelope) => {
          order.push(2);
          return { ...envelope, marker: "after-2" };
        },
      },
      {
        fromVersion: 1,
        description: "v1 → v2",
        migrate: (envelope) => {
          order.push(1);
          return { ...envelope, marker: "after-1" };
        },
      },
    ];
    const input = makeEnvelope() as unknown as RawEnvelope;
    const snapshot = structuredClone(input);

    const result = migrateEnvelope(input, 3, steps);
    expect(result.ok).toBe(true);
    expect(order).toEqual([1, 2]);
    if (result.ok) {
      expect(result.sourceVersion).toBe(1);
      expect(result.envelope.version).toBe(3);
      expect(result.envelope.marker).toBe("after-2");
    }
    // Purity: the caller's object is untouched.
    expect(input).toEqual(snapshot);
  });

  it("fails when no migration path exists to the target version", () => {
    const result = migrateEnvelope(makeEnvelope() as unknown as RawEnvelope, 3, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unsupported-version");
  });

  it("rejects versions above the target", () => {
    const result = migrateEnvelope({ version: 5 }, 1, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("unsupported-version");
      if (result.error.kind === "unsupported-version") {
        expect(result.error.version).toBe(5);
      }
    }
  });

  it("rejects non-integer versions", () => {
    const result = migrateEnvelope({ version: 1.5 }, 3, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid-format");
  });
});

describe("M11: an envelope without the mixes dataset is a valid envelope", () => {
  it("validates a pre-M11 envelope that carries no mixes key at all", () => {
    // The dataset is optional in the schema, and an envelope exported before mixes
    // existed has no such key. `delete` is deliberate: the case is a *missing*
    // dataset, not an empty one.
    const envelope = JSON.parse(encode(makeEnvelope())) as {
      data: Record<string, unknown>;
    };
    delete envelope.data.mixes;

    const result = prepareImport(encode(envelope));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.data.mixes).toBeUndefined();
    }
  });

  it("accepts an envelope whose mixes carry a full track list", () => {
    const envelope = makeEnvelope(makeBackupData({ mixes: [makeMix()] }));
    const result = prepareImport(encode(envelope));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const expected = envelope.data.mixes?.[0];
      expect(expected).toBeDefined();
      expect(result.envelope.data.mixes?.[0]).toMatchObject({
        id: expected?.id,
        name: expected?.name,
        period: expected?.period,
      });
    }
  });

  it("rejects a mix record that violates the schema", () => {
    const envelope = JSON.parse(encode(makeEnvelope(makeBackupData({ mixes: [makeMix()] })))) as {
      data: { mixes: Array<Record<string, unknown>> };
    };
    // No name: a mix the listener cannot recognize is not a mix record.
    envelope.data.mixes[0].name = "";

    expect(prepareImport(encode(envelope)).ok).toBe(false);
  });
});
