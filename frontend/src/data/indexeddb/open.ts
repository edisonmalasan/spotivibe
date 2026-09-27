import { StorageUnavailableError } from "@/data/repositories";
import { SCHEMA_MIGRATIONS, type SchemaMigration } from "@/data/migrations";
import { DATABASE_NAME, SCHEMA_VERSION } from "./schema";

export interface OpenDatabaseOptions {
  /** Override the database name (tests use isolated names). */
  name?: string;
  /** Override the target schema version (migration tests). */
  version?: number;
  /** Override the migration registry (migration tests). */
  migrations?: readonly SchemaMigration[];
}

/**
 * Open the Spotivibe database, running any needed migrations before the
 * promise resolves. Rejects with `StorageUnavailableError` when IndexedDB
 * cannot be opened (storage disabled, private mode, quota).
 */
export function openDatabase(options: OpenDatabaseOptions = {}): Promise<IDBDatabase> {
  const name = options.name ?? DATABASE_NAME;
  const version = options.version ?? SCHEMA_VERSION;
  const migrations = [...(options.migrations ?? SCHEMA_MIGRATIONS)].sort(
    (a, b) => a.version - b.version,
  );

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new StorageUnavailableError("IndexedDB is not available in this environment."));
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, version);
    } catch (error) {
      reject(
        new StorageUnavailableError("Could not open the Spotivibe database.", {
          cause: error,
        }),
      );
      return;
    }

    request.onupgradeneeded = (event) => {
      const targetVersion = event.newVersion ?? version;
      for (const step of migrations) {
        if (step.version > event.oldVersion && step.version <= targetVersion) {
          step.run(request.result);
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Never block a future schema upgrade from another connection/tab.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () =>
      reject(
        new StorageUnavailableError("Could not open the Spotivibe database.", {
          cause: request.error,
        }),
      );
  });
}
