import {
  BACKUP_FORMAT,
  CURRENT_BACKUP_VERSION,
  backupEnvelopeSchema,
  type BackupEnvelope,
} from "./schema";

/**
 * Import preparation (ROADMAP §13): parse → verify format/version → run
 * pure migrations in ascending order → validate every record — all before any
 * live mutation. The applier only ever receives a `PrepareResult` with
 * `ok: true`.
 */

/** Loose shape for envelopes on their way through migrations. */
export type RawEnvelope = Record<string, unknown>;

export interface BackupMigration {
  /** Version this step upgrades FROM (to `fromVersion + 1`). */
  fromVersion: number;
  description: string;
  /** Pure transform: must return a new envelope and never mutate its input. */
  migrate(envelope: RawEnvelope): RawEnvelope;
}

export type PrepareFailure =
  | { kind: "invalid-json"; message: string }
  | { kind: "invalid-format"; message: string }
  | { kind: "unsupported-version"; message: string; version: number }
  | { kind: "invalid-records"; message: string; issues: string[] };

export type PrepareResult =
  | { ok: true; envelope: BackupEnvelope; sourceVersion: number }
  | { ok: false; error: PrepareFailure };

export type MigrateResult =
  { ok: true; envelope: RawEnvelope; sourceVersion: number } | { ok: false; error: PrepareFailure };

/**
 * Run the migration registry against a parsed envelope object.
 *
 * Pure: the input object is deep-cloned before any step runs, so callers can
 * keep references to their original without risk of mutation.
 */
export function migrateEnvelope(
  raw: RawEnvelope,
  targetVersion: number,
  migrations: readonly BackupMigration[],
): MigrateResult {
  const version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return {
      ok: false,
      error: {
        kind: "invalid-format",
        message: "Backup version must be an integer.",
      },
    };
  }
  if (version > targetVersion) {
    return {
      ok: false,
      error: {
        kind: "unsupported-version",
        message: `Backup version ${version} was created by a newer version of Spotivibe (supported up to ${targetVersion}).`,
        version,
      },
    };
  }

  const sourceVersion = version;
  let working: RawEnvelope = structuredClone(raw);
  const ordered = [...migrations].sort((a, b) => a.fromVersion - b.fromVersion);

  let current = sourceVersion;
  while (current < targetVersion) {
    const step = ordered.find((migration) => migration.fromVersion === current);
    if (!step) {
      return {
        ok: false,
        error: {
          kind: "unsupported-version",
          message: `No migration path from backup version ${sourceVersion} to ${targetVersion}.`,
          version: sourceVersion,
        },
      };
    }
    const migrated = step.migrate(working);
    if (typeof migrated !== "object" || migrated === null || Array.isArray(migrated)) {
      return {
        ok: false,
        error: {
          kind: "invalid-records",
          message: `Migration from version ${step.fromVersion} produced an invalid envelope.`,
          issues: [],
        },
      };
    }
    working = { ...migrated, version: current + 1 };
    current += 1;
  }

  return { ok: true, envelope: working, sourceVersion };
}

export interface PrepareOptions {
  migrations?: readonly BackupMigration[];
  targetVersion?: number;
}

/**
 * Fully prepare an import from raw file text. Never touches storage —
 * rejection here means the live database is guaranteed untouched.
 */
export function prepareImport(json: string, options: PrepareOptions = {}): PrepareResult {
  const targetVersion = options.targetVersion ?? CURRENT_BACKUP_VERSION;
  const migrations = options.migrations ?? [];

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return {
      ok: false,
      error: {
        kind: "invalid-json",
        message: `File is not valid JSON (${
          error instanceof Error ? error.message : "parse error"
        }).`,
      },
    };
  }

  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    !("format" in raw) ||
    !("version" in raw)
  ) {
    return {
      ok: false,
      error: {
        kind: "invalid-format",
        message: "File is not a Spotivibe backup envelope.",
      },
    };
  }
  const rawEnvelope = raw as RawEnvelope;
  if (rawEnvelope.format !== BACKUP_FORMAT) {
    return {
      ok: false,
      error: {
        kind: "invalid-format",
        message: "File is not a Spotivibe backup envelope.",
      },
    };
  }

  const migrated = migrateEnvelope(rawEnvelope, targetVersion, migrations);
  if (!migrated.ok) {
    return { ok: false, error: migrated.error };
  }

  const parsed = backupEnvelopeSchema.safeParse(migrated.envelope);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 10)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    return {
      ok: false,
      error: {
        kind: "invalid-records",
        message: "Backup contents failed validation.",
        issues,
      },
    };
  }

  return {
    ok: true,
    envelope: parsed.data,
    sourceVersion: migrated.sourceVersion,
  };
}
